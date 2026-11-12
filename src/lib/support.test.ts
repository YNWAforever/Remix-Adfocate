import { describe, expect, it } from "vitest";
import { resolveSupport, supportHref } from "./support";

const id = "0b6c7d3e-8f1a-4c2b-9d4e-5f60718293a4";

describe("support handoff", () => {
  it("accepts a well-formed WhatsApp number and strips formatting", () => {
    expect(resolveSupport({ VITE_SUPPORT_WHATSAPP: "+852 9123-4567" })).toEqual({
      whatsapp: "85291234567",
      email: "",
    });
  });

  it("rejects malformed destinations instead of producing a dead link", () => {
    expect(resolveSupport({ VITE_SUPPORT_WHATSAPP: "not-a-number", VITE_SUPPORT_EMAIL: "nope" })).toEqual({
      whatsapp: "",
      email: "",
    });
  });

  it("prefers WhatsApp and keeps the payload to a reason code plus the opaque id", () => {
    const href = supportHref(
      { reason: "rejected_closed", submissionId: id },
      { VITE_SUPPORT_WHATSAPP: "+85291234567", VITE_SUPPORT_EMAIL: "support@example.test" },
    );
    expect(href).toBe(`https://wa.me/85291234567?text=ADFOCATE%3Arejected_closed%3A${id}`);
    expect(href).not.toContain("mission");
    expect(href).not.toContain("https%3A%2F%2Fig");
  });

  it("falls back to email", () => {
    const href = supportHref(
      { reason: "deadline" },
      { VITE_SUPPORT_EMAIL: "support@example.test" },
    );
    expect(href).toBe("mailto:support@example.test?subject=ADFOCATE%20support&body=ADFOCATE%3Adeadline");
  });

  it("stays hidden when no valid destination is configured", () => {
    expect(supportHref({ reason: "revision_limit", submissionId: id }, {})).toBeNull();
    expect(
      supportHref({ reason: "revision_limit", submissionId: id }, { VITE_SUPPORT_WHATSAPP: "123" }),
    ).toBeNull();
  });
});
