import { build, type Plugin } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { verifiedTarget } from "./local-targets.mjs";
const t=process.env.D17_OFFLINE_BUILD==="1"?null:verifiedTarget("empty");
Object.assign(process.env,{VITE_SUPABASE_URL:t?.env.SUPABASE_URL??"http://127.0.0.1:56421",VITE_SUPABASE_ANON_KEY:t?.env.SUPABASE_ANON_KEY??"offline-build-only-no-client",VITE_DEFAULT_WORKSPACE:t?JSON.parse((await import("node:fs")).readFileSync(".codex-tmp/D17-fixture.private.json","utf8")).slug:"d17-placeholder",VITE_ENABLE_WHATSAPP:"false",VITE_ENABLE_GOOGLE:"false"});
const label=process.argv[2]??"before";
process.env.NODE_ENV="production";
const analysis:Plugin={name:"d17-bundle-evidence",writeBundle(_options,bundle){
 const chunks=Object.values(bundle).filter(c=>c.type==="chunk").map(c=>({file:c.fileName,entry:c.isEntry,bytes:readFileSync(resolve("dist",c.fileName)).length,gzipBytes:gzipSync(readFileSync(resolve("dist",c.fileName))).length,imports:c.imports,dynamicImports:c.dynamicImports,
  modules:Object.entries(c.modules).map(([id,m])=>({id:id.replaceAll(resolve(".").replaceAll("\\","/"),".").replaceAll("\\","/"),renderedBytes:m.renderedLength})).sort((a,b)=>b.renderedBytes-a.renderedBytes)}));
 writeFileSync(`docs/verification/D17-bundle-${label}.json`,JSON.stringify({target:t?.identity??null,scope:t?"identity-bound asset build":"offline asset graph only; no SDK/runtime setup",productionAssets:true,chunks},null,2)+"\n");
 console.log("D17 entry modules",JSON.stringify(chunks.filter(c=>c.entry).map(c=>({file:c.file,bytes:c.bytes,modules:c.modules.slice(0,12)}))));
}};
await build({mode:"production",plugins:[analysis],build:{manifest:true,...(process.env.D17_UNSPLIT==="1"?{rollupOptions:{output:{manualChunks:()=>undefined}}}:{})}});
