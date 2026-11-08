import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, readDeletionStatus } from "./integration-deletion.$receipt";

const receipt = "a".repeat(32);
afterEach(() => { vi.restoreAllMocks(); });
describe("public deletion status route", () => {
  it("uses only the receipt endpoint with no cookies, redirects, cache or referrer", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "pending", account: "PRIVATE_ACCOUNT", workspace: "PRIVATE_WORKSPACE", filename: "PRIVATE_FILE" })));
    expect(await readDeletionStatus(receipt, request)).toBe("pending");
    expect(request).toHaveBeenCalledWith(`/api/integration-notices/deletion/${receipt}`, {
      method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
    });
  });
  it.each(["123456", "../private", "a".repeat(33), "<script>", ""])("rejects malformed receipt %s locally", async value => {
    const request = vi.fn();
    expect(await readDeletionStatus(value, request)).toBe("unknown");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    [200, { status: "pending" }, "pending"], [200, { status: "completed" }, "completed"],
    [404, { status: "completed" }, "unknown"], [503, { status: "completed" }, "unavailable"],
    [200, { status: "deleted", message: "PRIVATE_FILE" }, "unavailable"], [200, null, "unavailable"],
    [200, { completed: true }, "unavailable"], [200, [{ status: "completed" }], "unavailable"],
  ])("maps HTTP %s and untrusted body %j to %s", async (status, body, expected) => {
    expect(await readDeletionStatus(receipt, vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: Number(status) })))).toBe(expected);
  });
  it("does not show raw fetch or parser errors", async () => {
    expect(await readDeletionStatus(receipt, vi.fn().mockRejectedValue(new Error("PRIVATE_ACCOUNT")))).toBe("unavailable");
    expect(await readDeletionStatus(receipt, vi.fn().mockResolvedValue(new Response("PRIVATE_FILE")))).toBe("unavailable");
  });
  it("wires the public loader and returns only the status", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"status":"pending"}'));
    const loader = Route.options.loader as (input: { params: { receipt: string } }) => Promise<unknown>;
    const status = await loader({ params: { receipt } });
    expect(status).toBe("pending"); expect(request).toHaveBeenCalledTimes(1);
  });
});
