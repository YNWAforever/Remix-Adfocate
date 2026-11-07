// Local report assembly only. No browser, network, credentials or database.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = 'C:/Users/laich/.codex/visualizations/2026/10/29/01a1880d-a6f1-7ef1-9ec1-f853a3b65772/auth-pilot-browser-evidence';
const target = path.join(root, 'docs/review/kocmax-stage-4d/d1/auth-permission-execution/browser-evidence');
const report = JSON.parse(await fs.readFile(path.join(source, 'browser-cases.json'), 'utf8'));
if (report.projectRef !== 'mhkoayftiuojxlrkollf' ||
    report.runId !== '5f694251-c6eb-4f5f-a281-25e91db81c04') throw new Error('EVIDENCE_TARGET_MISMATCH');
const aliases = ['C-A','C-P','C-B','S-A','S-O','S-R','S-F','B-A','U-X'];
const matrix = {};
for (const [size, width, height] of [['desktop',1440,1000],['mobile',390,844]]) {
  matrix[size] = aliases.filter(alias => report.cases.some(row => row.alias === alias &&
    row.metrics.width === width && row.metrics.height === height && row.checks.realPasswordLogin === true));
  if (matrix[size].length !== 9) throw new Error('EXACT_VIEWPORT_LOGIN_MATRIX_INCOMPLETE');
}
await fs.mkdir(target, { recursive: true });
for (const row of report.cases) {
  if (!aliases.includes(row.alias) || !/^[A-Z]-[A-Z]-(desktop|mobile)-[a-z-]+\.png$/.test(row.screenshot)) {
    throw new Error('UNSAFE_EVIDENCE_FILENAME');
  }
  let captured = path.join(source, row.screenshot);
  try { await fs.access(captured); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // The persistent browser helper retained its original capture directory
    // for later screenshots. Keep those original files rather than replacing.
    captured = path.join(target, row.screenshot);
  }
  const info = await fs.lstat(captured);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 10485760) {
    throw new Error('UNSAFE_CAPTURE_FILE');
  }
  const bytes = await fs.readFile(captured);
  const format = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' :
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg' : null;
  if (!format) throw new Error('NATIVE_IMAGE_CAPTURE_REQUIRED');
  row.screenshotSha256 = createHash('sha256').update(bytes).digest('hex');
  row.captureFileSource = captured;
  row.originalCaptureFilename = row.screenshot;
  row.screenshot = row.screenshot.replace(/\.png$/, '.' + format);
  if (captured !== path.join(target, row.screenshot)) await fs.copyFile(captured, path.join(target, row.screenshot));
}
report.captureArtifactRoot = source;
report.artifactRoot = target;
report.limits = report.limits.map(value => value.startsWith('Screenshots moved outside')
  ? 'Captures exist in both the initial app-tree directory and the later artifact directory. The persistent capture helper retained its original directory; each delivered image records its actual source and hash.'
  : value);
report.findings.push('Development reload/capture timing affected some UI observations. The staff-logout display observation is a follow-up item, not an established authorization bypass.');
report.loginMatrix = matrix;
report.horizontalOverflowCases = report.cases.filter(row => !row.noHorizontalOverflow)
  .map(({alias,size,journey}) => ({alias,size,journey}));
report.acceptance = {
  passwordLogin: 'NINE_ACCOUNTS_BOTH_VIEWPORTS_VERIFIED',
  geometry: report.horizontalOverflowCases.length ? 'FINDINGS' : 'NO_HORIZONTAL_OVERFLOW_OBSERVED',
  creatorPostConsentInteraction: 'NOT_TESTED_CONSENT_GATE_RETAINED',
  observations: 'Includes initial loading/selector observations and explicit confirmed followups; not every recorded boolean is a passing assertion.',
};
await fs.writeFile(path.join(target, 'browser-cases.json'), JSON.stringify(report, null, 2));
const esc = value => String(value).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards = report.cases.map(row => `<article><a href="${esc(row.screenshot)}"><img loading="lazy" src="${esc(row.screenshot)}" alt="${esc(row.alias+' '+row.size+' '+row.journey)}"></a><h2>${esc(row.alias)} · ${esc(row.size)}</h2><p>${esc(row.journey)}</p><small>${row.metrics.width} × ${row.metrics.height} · ${esc(row.observedAt)}</small><details><summary>核對內容</summary><pre>${esc(JSON.stringify(row.checks,null,2))}</pre></details></article>`).join('\n');
const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><title>KOCmax 九帳戶驗證圖集</title><style>body{margin:0;background:#faf6ef;color:#28253a;font-family:system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:28px}h1{font-size:30px}header{background:#eadefa;border:2px solid #6f42a5;border-radius:24px;padding:24px;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}article{background:white;border:1px solid #ded4e9;border-radius:18px;padding:14px;min-width:0}img{width:100%;height:270px;object-fit:contain;object-position:top;background:#f2edf7;border-radius:10px}h2{font-size:18px;margin-bottom:6px}p,small{overflow-wrap:anywhere}small{color:#666}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer;margin-top:12px}</style><main><header><h1>KOCmax · 九帳戶登入與權限驗證</h1><p>桌面 1440 × 1000、手機 390 × 844：各九帳戶已完成真實密碼登入。共 ${report.cases.length} 次畫面觀察，${report.horizontalOverflowCases.length} 次橫向溢出。</p><p>創作者條款門檻保留，未接受或偽造同意；條款後互動未驗收。圖集保留初始載入／選擇器觀察及後續核對，不能把每一項布林值當成已通過測試。</p><p>所有帳戶及內容均為本輪合成資料；沒有部署或連接 Instagram／Google Drive。</p></header><section class="grid">${cards}</section></main></html>`;
await fs.writeFile(path.join(target, 'index.html'), html);
process.stdout.write(JSON.stringify({screenshots:report.cases.length,loginMatrix:matrix,
  horizontalOverflowCases:report.horizontalOverflowCases.length,gallery:path.join(target,'index.html')})+'\n');
