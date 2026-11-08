/** Synthetic protocol fixtures only. No account tokens, private files or network. */
import type { ProviderHttpRequest } from "../providerHttp.js";
import { ProviderHttp } from "../providerHttp.js";
import { createHash } from "node:crypto";
export const actor = { creatorId: "fixture-creator", workspaceId: "fixture-workspace" };
export const connection = { ...actor, id: "fixture-connection", provider: "google_drive" as const, generation: 1 };
export const now = new Date("2026-10-31T00:00:00Z");
export const googleScopes = "openid https://www.googleapis.com/auth/drive.file";
export const grant = { subject: "google-sub", label: "Google Drive", scopes: googleScopes.split(" "), accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresAt: "2026-10-31T01:00:00.000Z", issuedAt: "2026-10-31T00:00:00.000Z", grantProject: "fixture-project" };
export const context = { redirectUri: "https://pilot.example.test/oauth/google", codeVerifier: "x".repeat(43), nonce: "fixture-nonce" };
export function fixtureHttp(replies: Array<unknown | Response | ((request: ProviderHttpRequest) => unknown)>) {
  const requests: ProviderHttpRequest[] = [];
  const http = new ProviderHttp(async (url, init) => {
    const request = { url, ...init } as ProviderHttpRequest;
    requests.push(request);
    if (!replies.length) throw new Error("Fixture response queue exhausted");
    let reply = replies.shift();
    if (typeof reply === "function") reply = reply(request);
    return reply instanceof Response ? reply : Response.json(reply);
  }, { transportKind: "fixture", maxReadRetries: 0 });
  return { http, requests };
}
export const fileMetadata = { id: "selected", name: "Synthetic text", mimeType: "text/plain", version: "7", size: "12", trashed: false, capabilities: { canDownload: true }, ownedByMe: true };

/** Small valid PDF with byte-correct xref; also exercises real Flate text streams. */
export function textPdf(text = "Synthetic PDF text", streamBytes?: Uint8Array, extraCatalog = ""): Uint8Array {
  const stream = streamBytes ?? new TextEncoder().encode(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`);
  const objects: Array<string | Buffer> = [
    `<< /Type /Catalog /Pages 2 0 R ${extraCatalog} >>`,
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    Buffer.concat([Buffer.from(`<< /Length ${stream.length}${streamBytes ? " /Filter /FlateDecode" : ""} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
  ];
  return assemblePdf(objects);
}
function assemblePdf(objects: Array<string | Buffer>, trailer = ""): Uint8Array {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(chunks.reduce((n, b) => n + b.length, 0));
    chunks.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(objects[i]), Buffer.from("\nendobj\n"));
  }
  const xref = chunks.reduce((n, b) => n + b.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(chunks));
}

/** A PDF Standard Security revision 2 document generated solely for unit tests. */
export function encryptedPdf(): Uint8Array {
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const pad = (password: string) => Buffer.concat([Buffer.from(password), padding]).subarray(0, 32);
  const md5 = (data: Buffer) => createHash("md5").update(data).digest();
  const rc4 = (key: Buffer, input: Buffer) => {
    const state = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) % 256; [state[i], state[j]] = [state[j], state[i]]; }
    let i = 0; j = 0;
    return Buffer.from(input.map(byte => { i = (i + 1) % 256; j = (j + state[i]) % 256; [state[i], state[j]] = [state[j], state[i]]; return byte ^ state[(state[i] + state[j]) % 256]; }));
  };
  const owner = rc4(md5(pad("fixture-owner")).subarray(0, 5), pad("fixture-password"));
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const fileId = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
  const fileKey = md5(Buffer.concat([pad("fixture-password"), owner, permissions, fileId])).subarray(0, 5);
  const user = rc4(fileKey, padding);
  const objectKey = md5(Buffer.concat([fileKey, Buffer.from([5, 0, 0, 0, 0])])).subarray(0, 10);
  const stream = rc4(objectKey, Buffer.from("BT /F1 12 Tf 72 720 Td (Encrypted fixture text) Tj ET"));
  return assemblePdf([
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`,
  ], `/Encrypt 6 0 R /ID [<${fileId.toString("hex")}> <${fileId.toString("hex")}>]`);
}
export function manyPagePdf(): Uint8Array {
  const pageIds = Array.from({ length: 101 }, (_, index) => `${index + 3} 0 R`);
  return assemblePdf(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count 101 /Kids [${pageIds.join(" ")}] >>`,
    ...pageIds.map(() => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>")]);
}
