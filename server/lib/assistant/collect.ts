import { createHash } from "node:crypto";

export interface SourceDoc { sourceType: "article" | "mission_brief" | "reward" | "level" | "legal"; sourceRef: string; title: string; locale: string; content: string; workspace?: string | null; }

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function toKbDocument(d: SourceDoc) {
  return {
    source_type: d.sourceType, source_ref: d.sourceRef, title: d.title,
    locale: d.locale, workspace: d.workspace ?? null, content: d.content,
    content_hash: hashContent(d.content),
  };
}
