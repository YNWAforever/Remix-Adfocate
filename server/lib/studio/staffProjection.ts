type Row = Record<string, unknown>;
const pick = (value: unknown, keys: string[]): Row => {
  const row = value && typeof value === "object" ? value as Row : {};
  return Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]));
};

/** A reviewer receives the review surface, never a financial projection. */
export function projectReviewDetail(input: unknown, canReadRewards: boolean): Row {
  const detail = input && typeof input === "object" ? input as Row : {};
  if (canReadRewards) return detail;
  const submission = pick(detail.submission, ["id", "workspace_id", "mission_id", "creator_id", "status", "content_urls", "submitted_at", "reviewed_at", "created_at", "reviewer_notes", "creators"]);
  const source = detail.submission as Row | undefined;
  const missionFields = ["id", "slug", "title", "description", "mission_type", "dos", "donts", "key_messages", "reference_links", "deliverables", "requirements", "platforms", "target_audience"];
  submission.missions = Array.isArray(source?.missions) ? source.missions.map(row => pick(row, missionFields)) : pick(source?.missions, missionFields);
  return {
    ...pick(detail, ["workflow", "workItems", "fulfillment", "versions", "reviews", "grants", "assets", "publicationInstructions", "proofAttempts", "proofReviews", "proofAssets"]),
    submission,
    events: (Array.isArray(detail.events) ? detail.events as Row[] : [])
      .filter(event => !/reward|settle|payment|contract/i.test(String(event.event_type)))
      .map(event => pick(event, ["id", "event_type", "mission_work_item_id", "created_at", "actor_type"])),
  };
}
