// Inspect only the generated local build passed by the candidate runner.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const markers = [
  "查看合成示例", "View synthetic example", "sample-official-metrics",
  "sample-image-asset", "sample-public-image", "合成示例 · 未驗證",
  "CONTROLLED_PILOT_MOCK_ONLY", "/api/controlled-pilot-mock",
  "SAVED_OUTPUT_MOCK_ONLY", "本機示例 · 無真實連接",
];
const dir = process.argv[2];
const files = (await readdir(dir)).filter(file => file.endsWith(".js"));
if (!files.length) throw new Error("No emitted JavaScript to inspect");
for (const file of files) {
  const source = await readFile(join(dir, file), "utf8");
  const match = markers.find(marker => source.includes(marker));
  if (match) throw new Error(`Synthetic marker in ${file}: ${match}`);
}
console.log(`Scanned ${files.length} emitted JavaScript files; none of the ${markers.length} synthetic markers found.`);
