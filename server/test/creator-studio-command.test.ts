import { describe, expect, it } from "vitest";
import { hashCommand, serializeCommand } from "../lib/creatorStudio/command.js";

describe("Creator Studio command serialization", () => {
  it("returns canonical JSON text and rejects non-JSON input", () => {
    expect(serializeCommand({ second: [true, null], first: "value" })).toBe('{"first":"value","second":[true,null]}');
    expect(hashCommand({ first: "value", second: [true, null] })).toBe(hashCommand({ second: [true, null], first: "value" }));
    expect(() => serializeCommand({ commandId: undefined })).toThrow("JSON serializable");
    expect(() => serializeCommand(Number.NaN)).toThrow("JSON serializable");
  });
});
