import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { serviceClient } from "../server/lib/supabase.js";
import { embedTexts } from "../server/lib/llm.js";
import { chunkText } from "../server/lib/assistant/chunk.js";
import { toKbDocument, type SourceDoc } from "../server/lib/assistant/collect.js";

const HELP_DIR = join(process.cwd(), "content", "help");

function loadArticles(): SourceDoc[] {
  return readdirSync(HELP_DIR).filter((f) => f.endsWith(".md")).map((f) => {
    const raw = readFileSync(join(HELP_DIR, f), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const front = Object.fromEntries((m?.[1] ?? "").split("\n").map((l) => l.split(/:\s(.+)/).map((s) => s.trim())));
    return {
      sourceType: "article" as const,
      sourceRef: front.source_ref ?? f.replace(/\.md$/, ""),
      title: front.title ?? f, locale: front.locale ?? "zh-HK",
      content: (m?.[2] ?? raw).trim(),
    };
  });
}

async function main() {
  const db = serviceClient();
  // Phase-1 scope: authored articles. (Derived content — mission briefs, rewards,
  // levels, legal — added in a follow-up; structure already supports source_type.)
  const docs = loadArticles();
  for (const doc of docs) {
    const row = toKbDocument(doc);
    // Skip unchanged (idempotent).
    const { data: existing } = await db.from("kb_documents")
      .select("id, content_hash").eq("source_type", row.source_type)
      .eq("source_ref", row.source_ref).eq("locale", row.locale).maybeSingle();
    if (existing?.content_hash === row.content_hash) { console.log(`skip ${row.source_ref}`); continue; }

    const { data: upserted, error } = await db.from("kb_documents")
      .upsert(row, { onConflict: "source_type,source_ref,locale" }).select("id").single();
    if (error || !upserted) { console.error(`doc fail ${row.source_ref}`, error); continue; }
    const docId = upserted.id as string;

    await db.from("kb_chunks").delete().eq("document_id", docId); // replace chunks
    const chunks = chunkText(doc.content, { maxChars: 1500, overlapChars: 200 });
    const embeddings = await embedTexts(chunks);
    const rows = chunks.map((content, i) => ({ document_id: docId, chunk_index: i, content, token_count: Math.ceil(content.length / 4), embedding: embeddings[i] }));
    const { error: chunkErr } = await db.from("kb_chunks").insert(rows);
    if (chunkErr) { console.error(`chunks fail ${row.source_ref}`, chunkErr); continue; }
    console.log(`ingested ${row.source_ref} (${chunks.length} chunks)`);
  }
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
