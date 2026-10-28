import { afterEach, expect, it } from "vitest";
import { setActivationAnalyticsSink, trackActivationEvent, type ActivationEventMap } from "./activationAnalytics";
const name = "product_action_result" as keyof ActivationEventMap;
const id = "123e4567-e89b-42d3-a456-426614174000";
afterEach(() => setActivationAnalyticsSink(null));
it("D17 outcome events retain only opaque work identity, action, revision and persisted result", () => {
  const events: unknown[] = []; setActivationAnalyticsSink(e => { events.push(e); return true; });
  const properties = { entityId: id, action: "draft_submit", revision: 3, result: "saved", persisted: true, caption: "Private body", email: "private@example.invalid", url: "https://example.invalid/private" };
  expect(trackActivationEvent(name, properties as never)).toBe(true);
  expect(events).toEqual([{ name: "product_action_result", properties: { entityId: id, action: "draft_submit", revision: 3, result: "saved" } }]);
});
it("D17 a render or unconfirmed success never becomes a successful business outcome", () => {
  const events: unknown[] = []; setActivationAnalyticsSink(e => { events.push(e); return true; });
  for (const properties of [
    { entityId: id, action: "draft_submit", revision: 1, result: "saved", persisted: false },
    { entityId: "private@example.invalid", action: "draft_submit", revision: 1, result: "saved", persisted: true },
    { entityId: id, action: "render", revision: 1, result: "saved", persisted: true },
    { entityId: id, action: "draft_submit", revision: -1, result: "saved", persisted: true },
  ]) expect(trackActivationEvent(name, properties as never)).toBe(false);
  expect(events).toEqual([]);
});
