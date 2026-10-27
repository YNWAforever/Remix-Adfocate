import { createServer } from "node:http";
import { readFileSync,statSync } from "node:fs";
import { resolve,extname,sep } from "node:path";
import { gzipSync } from "node:zlib";
import { verifiedTarget } from "./local-targets.mjs";
const target=verifiedTarget();
Object.assign(process.env,target.env,{OPENAI_API_KEY:"",OPENROUTER_API_KEY:"",ANTHROPIC_API_KEY:""});
const [{createApp},{createViteApiMiddleware}]=await Promise.all([import("../../server/app.js"),import("../../server/devApi.js")]);
const api=createViteApiMiddleware(createApp().app),root=resolve("dist");
const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".woff2":"font/woff2",".json":"application/json"};
createServer((req,res)=>api(req,res,()=>{
 let file=resolve(root,"."+decodeURIComponent(new URL(req.url??"/","http://127.0.0.1").pathname));
 if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{if(!statSync(file).isFile())file=resolve(root,"index.html");}catch{file=resolve(root,"index.html");}
 const body=readFileSync(file),gzip=req.headers["accept-encoding"]?.includes("gzip")&&[".js",".css",".html"].includes(extname(file));
 res.setHeader("Content-Type",mime[extname(file)]??"application/octet-stream");
 res.setHeader("Cache-Control",extname(file)===".html"?"no-cache":"public,max-age=3600");
 if(gzip){res.setHeader("Content-Encoding","gzip");res.setHeader("Vary","Accept-Encoding");}
 res.end(gzip?gzipSync(body):body);
})).listen(target.context?.manifest.target.ports.web??56400,"127.0.0.1",()=>console.log("D17 production assets + local API listening on loopback"));
