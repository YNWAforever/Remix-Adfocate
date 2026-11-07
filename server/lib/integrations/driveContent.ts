import { Worker } from "node:worker_threads";
import { IntegrationError, MAX_FILE_BYTES } from "./policy.js";

export const PDF_PARSER_VERSION = "pdfjs-dist@6.4.299";
const MAX_EXTRACTED_BYTES = 5 * 1024 * 1024;

/** Parse bytes only: URLs, document scripts, OCR and external resources are never inputs. */
export async function extractDriveContent(mimeType: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new IntegrationError("FILE_TOO_LARGE", 413);
  if (!bytes.length) throw new IntegrationError("UNSUPPORTED_FILE");
  let content: string;
  if (mimeType === "application/pdf") {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new IntegrationError("UNSUPPORTED_FILE");
    content = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(new URL("./providers/pdfTextWorker.mjs", import.meta.url), {
        workerData: { bytes: Uint8Array.from(bytes), maxPages: 100, maxTextBytes: MAX_EXTRACTED_BYTES },
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        stdout: true, stderr: true,
      });
      // Do not forward parser output (which can include provider-controlled PDF details).
      worker.stdout?.resume(); worker.stderr?.resume();
      let settled = false;
      const finish = (text?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer); void worker.terminate();
        if (typeof text === "string") resolve(text); else reject(new IntegrationError("UNSUPPORTED_FILE"));
      };
      const timer = setTimeout(() => finish(), 4000);
      worker.once("error", () => finish());
      worker.once("exit", () => finish());
      worker.once("message", (message: unknown) => finish(typeof message === "string" ? message : undefined));
    });
  } else if (["text/plain", "application/vnd.google-apps.document"].includes(mimeType)) {
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new IntegrationError("UNSUPPORTED_FILE"); }
  } else throw new IntegrationError("UNSUPPORTED_FILE");
  if (!content.trim() || content.includes("\u0000") || new TextEncoder().encode(content).length > MAX_EXTRACTED_BYTES) throw new IntegrationError("UNSUPPORTED_FILE");
  return content;
}
