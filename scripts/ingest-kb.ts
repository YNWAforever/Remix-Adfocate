import { serviceClient } from "../server/lib/supabase.js";
import { embedTexts } from "../server/lib/llm.js";
import { chunkText } from "../server/lib/assistant/chunk.js";
import { toKbDocument, type SourceDoc } from "../server/lib/assistant/collect.js";

const LOCALE = "zh-HK";

/** Load published guide_doc rows from academy_content as KB source articles. body_zh is already
 *  frontmatter-stripped at seed, so content = body_zh directly. sourceRef = slug keeps the
 *  kb_documents unique key (source_type,source_ref,locale) stable across runs. */
async function loadFromDb(db: ReturnType<typeof serviceClient>): Promise<SourceDoc[]> {
  const { data, error } = await db.from("academy_content")
    .select("slug, title_zh, body_zh").eq("kind", "guide_doc").eq("status", "published");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    sourceType: "article" as const,
    sourceRef: r.slug as string,
    title: r.title_zh as string,
    locale: LOCALE,
    content: ((r.body_zh as string) ?? "").trim(),
  }));
}

async function main() {
  const db = serviceClient();
  const docs = await loadFromDb(db);

  for (const doc of docs) {
    const row = toKbDocument(doc);
    const { data: existing } = await db.from("kb_documents")
      .select("id, content_hash").eq("source_type", row.source_type)
      .eq("source_ref", row.source_ref).eq("locale", row.locale).maybeSingle();
    if (existing?.content_hash === row.content_hash) { console.log(`skip ${row.source_ref}`); continue; }

    const { data: upserted, error } = await db.from("kb_documents")
      .upsert(row, { onConflict: "source_type,source_ref,locale" }).select("id").single();
    if (error || !upserted) { console.error(`doc fail ${row.source_ref}`, error); continue; }
    const docId = upserted.id as string;

    await db.from("kb_chunks").delete().eq("document_id", docId);
    const chunks = chunkText(doc.content, { maxChars: 1500, overlapChars: 200 });
    const embeddings = await embedTexts(chunks);
    const rows = chunks.map((content, i) => ({ document_id: docId, chunk_index: i, content, token_count: Math.ceil(content.length / 4), embedding: embeddings[i] }));
    const { error: chunkErr } = await db.from("kb_chunks").insert(rows);
    if (chunkErr) { console.error(`chunks fail ${row.source_ref}`, chunkErr); continue; }
    console.log(`ingested ${row.source_ref} (${chunks.length} chunks)`);
  }

  // Prune: remove KB articles whose guide_doc is no longer published (archived/unpublished/deleted).
  // kb_chunks cascade on the kb_documents FK. Only touches source_type='article' rows.
  const liveSlugs = docs.map((d) => d.sourceRef);
  const { data: stale } = await db.from("kb_documents")
    .select("id, source_ref").eq("source_type", "article").eq("locale", LOCALE);
  const orphans = (stale ?? []).filter((r) => !liveSlugs.includes(r.source_ref as string));
  for (const o of orphans) {
    await db.from("kb_documents").delete().eq("id", o.id);
    console.log(`pruned ${o.source_ref}`);
  }
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
