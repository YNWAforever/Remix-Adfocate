import type { StudioBrief, StudioSection, StudioSource } from "./types";

/** Inspect against current lineage, never the permissions captured at save time. */
export function inspectSavedBrief(brief: StudioBrief, threadId: string, sources: StudioSource[]) {
  const unavailable = new Set<string>();
  const validSections = brief.sections.length > 0 && brief.sections.length <= 12
    && new Set(brief.sections.map(s => s.id)).size === brief.sections.length
    && brief.sections.every(s => s.id.trim() && s.text.trim() && s.text.length <= 3000);
  const sections = brief.sections.map(section => {
    const usable = section.sourceIds.every(id => {
      const matches = sources.filter(source => source.id === id);
      const valid = matches.length === 1 && matches[0].thread_id === threadId && !matches[0].revoked_at;
      if (!valid) unavailable.add(id);
      return valid;
    });
    return { id: section.id, text: brief.thread_id === threadId && usable ? section.text : null, sourceIds: [...section.sourceIds] };
  });
  return { copyable: brief.thread_id === threadId && validSections && unavailable.size === 0, unavailableSourceIds: [...unavailable], sections };
}

export function copySavedBrief(brief: StudioBrief, threadId: string, sources: StudioSource[], newId: () => string): StudioSection[] {
  if (!inspectSavedBrief(brief, threadId, sources).copyable) throw new Error("BRIEF_UNAVAILABLE");
  const used = new Set(brief.sections.map(s => s.id));
  return brief.sections.map(section => {
    const id = newId();
    if (!id.trim() || used.has(id)) throw new Error("BRIEF_UNAVAILABLE");
    used.add(id);
    return { ...section, id, sourceIds: [...section.sourceIds] };
  });
}
