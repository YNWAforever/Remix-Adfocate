import { parentPort, workerData } from "node:worker_threads";
import { Buffer } from "node:buffer";

// No viewer, renderer, annotation actions, URL input, resource URLs or ambient fetch.
globalThis.fetch = async () => { throw new Error("PDF_NETWORK_DISABLED"); };
try {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: workerData.bytes,
    isEvalSupported: false, useWorkerFetch: false, useSystemFonts: false,
    disableFontFace: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    stopAtErrors: true, maxImageSize: 0, verbosity: 0,
  });
  task.onPassword = () => { void task.destroy(); parentPort.postMessage(null); };
  const document = await task.promise;
  if (document.numPages > workerData.maxPages) throw new Error("PDF_LIMIT");
  let size = 0;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const reader = page.streamTextContent().getReader();
    const parts = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if (typeof item.str !== "string") continue;
        size += Buffer.byteLength(item.str, "utf8") + 1;
        if (size > workerData.maxTextBytes) throw new Error("PDF_LIMIT");
        parts.push(item.str + (item.hasEOL ? "\n" : " "));
      }
    }
    pages.push(parts.join("").trim());
    page.cleanup();
  }
  await task.destroy();
  parentPort.postMessage(pages.join("\n").trim());
} catch { parentPort.postMessage(null); }
