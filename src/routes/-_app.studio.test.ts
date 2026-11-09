import { describe, expect, it } from "vitest";
import { parseStudioSearch } from "./_app.studio";

describe("Studio route search", () => {
  it("keeps only the thread and an allowlisted skill ID", () => {
    expect(
      parseStudioSearch({
        thread: "thread-a",
        skill: "next_caption",
        image: "data:image/png;base64,private",
        url: "https://example.test/private",
      }),
    ).toEqual({ thread: "thread-a", skill: "next_caption", send: false });
  });

  it("drops unknown, non-string, and duplicate values instead of enabling mocks", () => {
    expect(
      parseStudioSearch({
        thread: ["one", "two"],
        skill: "external-provider",
        mock: "rue",
        url: "https://example.test/private",
      }),
    ).toEqual({ thread: undefined, skill: undefined, send: false });
    expect(
      parseStudioSearch({ thread: "https://example.test/private" }),
    ).toEqual({ thread: undefined, skill: undefined, send: false });
  });

  it("accepts the one-shot auto-send flag", () => {
    expect(parseStudioSearch({ thread: "thread-a", send: "1" }).send).toBe(true);
    expect(parseStudioSearch({ thread: "thread-a", send: true }).send).toBe(true);
    expect(parseStudioSearch({ thread: "thread-a", send: "yes" }).send).toBe(false);
  });
});
