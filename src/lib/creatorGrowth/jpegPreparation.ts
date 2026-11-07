/** Local demonstration limits, not verified Meta publishing limits. */
const maxBytes = 5 * 1024 * 1024;
export type PreparedJpeg = Readonly<{ bytes: Uint8Array; mime: "image/jpeg"; width: number; height: number; byteSize: number; sha256: string }>;
export interface LocalImageCodec {
  decode(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; encodeJpeg(): Promise<Uint8Array>; dispose(): void }>;
}
function dimensions(b: Uint8Array, mime: string): [number, number] {
  // Static WebP only. Full decoding still belongs to the bounded browser codec.
  if(mime==="image/webp" && b.length>=30){
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
    const tag=(offset:number,text:string)=>Array.from(text).every((c,i)=>b[offset+i]===c.charCodeAt(0));
    const size=v.getUint32(16,true);
    if(tag(0,"RIFF")&&tag(8,"WEBP")&&v.getUint32(4,true)===b.length-8&&tag(12,"VP8X")&&size===10&&!(b[20]&0xc3)&&b[21]===0&&b[22]===0&&b[23]===0){
      let frames=0;
      for(let offset=30;offset<b.length;){
        if(offset+8>b.length)throw new Error("IMAGE_INVALID");
        const length=v.getUint32(offset+4,true),end=offset+8+length;
        if(end+(length%2)>b.length||((length%2)&&b[end]!==0)||tag(offset,"ANIM")||tag(offset,"ANMF")||tag(offset,"VP8X"))throw new Error("IMAGE_INVALID");
        if(tag(offset,"VP8L"))throw new Error("IMAGE_INVALID");
        if(tag(offset,"VP8 ")){
          const p=offset+8;
          if(length<10||(b[p]&1)||b[p+3]!==157||b[p+4]!==1||b[p+5]!==42||(v.getUint16(p+6,true)&16383)!==1+b[24]+(b[25]<<8)+(b[26]<<16)||(v.getUint16(p+8,true)&16383)!==1+b[27]+(b[28]<<8)+(b[29]<<16))throw new Error("IMAGE_INVALID");
          frames++;
        }
        offset=end+(length%2);
      }
      if(frames!==1)throw new Error("IMAGE_INVALID");
      return [1+b[24]+(b[25]<<8)+(b[26]<<16),1+b[27]+(b[28]<<8)+(b[29]<<16)];
    }
    if(tag(0,"RIFF")&&tag(8,"WEBP")&&tag(12,"VP8 ")&&v.getUint32(4,true)===b.length-8&&size>=10&&20+size+(size%2)===b.length&&(!(size%2)||b.at(-1)===0)&&!(b[20]&1)&&b[23]===157&&b[24]===1&&b[25]===42)
      return [v.getUint16(26,true)&16383,v.getUint16(28,true)&16383];
  }
  if (mime === "image/png" && b.length >= 33 && [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((n,i)=>b[i]===n)) {
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength); return [v.getUint32(16),v.getUint32(20)];
  }
  if (mime === "image/jpeg" && b[0]===255 && b[1]===216) {
    for(let i=2;i+3<b.length;) {
      if(b[i++]!==255) break;
      while(b[i]===255)i++;
      const marker=b[i++]; if(marker===218 || marker===217)break;
      if(marker===1 || (marker>=208 && marker<=215))continue;
      const length=(b[i]<<8)|b[i+1]; if(length<2 || i+length>b.length)break;
      if([192,193,194].includes(marker) && length>=8) return [(b[i+5]<<8)|b[i+6],(b[i+3]<<8)|b[i+4]];
      i+=length;
    }
  }
  throw new Error("IMAGE_INVALID");
}
const bounded=(w:number,h:number)=>Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w<=4096&&h<=4096&&w*h<=4_000_000;
export async function prepareJpeg(input: Uint8Array, mime: string, codec: LocalImageCodec, digest: (bytes: Uint8Array)=>Promise<Uint8Array>): Promise<PreparedJpeg> {
  let frame: Awaited<ReturnType<LocalImageCodec["decode"]>> | undefined;
  try {
    if(!input.length || input.length>maxBytes)throw new Error();
    const source=input.slice(); const [w,h]=dimensions(source,mime);
    if(!bounded(w,h))throw new Error();
    frame=await codec.decode(source,mime);
    if(!bounded(frame.width,frame.height) || !((frame.width===w&&frame.height===h)||(frame.width===h&&frame.height===w)))throw new Error();
    const bytes=(await frame.encodeJpeg()).slice();
    if(!bytes.length||bytes.length>maxBytes)throw new Error();
    const [ow,oh]=dimensions(bytes,"image/jpeg");
    if(ow!==frame.width||oh!==frame.height||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error();
    const hash=await digest(bytes.slice()); if(hash.length!==32)throw new Error();
    return {bytes,mime:"image/jpeg",width:ow,height:oh,byteSize:bytes.length,sha256:Array.from(hash,x=>x.toString(16).padStart(2,"0")).join("")};
  } catch { throw new Error("IMAGE_INVALID"); }
  finally { try {frame?.dispose();} catch { /* Disposal cannot expose codec diagnostics. */ } }
}

/** Browser-native decoder and canvas encoder. No upload, fetch or provider call.
 * Canvas paints transparency white and does not copy input EXIF metadata.
 */
export const browserImageCodec: LocalImageCodec = {
  async decode(bytes,mime) {
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes).buffer],{type:mime}),{imageOrientation:"from-image"});
    return { width:bitmap.width,height:bitmap.height,dispose:()=>bitmap.close(),async encodeJpeg() {
      const canvas=document.createElement("canvas"); canvas.width=bitmap.width;canvas.height=bitmap.height;
      try {
        const context=canvas.getContext("2d"); if(!context)throw new Error();
        context.fillStyle="#ffffff"; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(bitmap,0,0);
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error()),"image/jpeg",0.9));
        if(blob.type!=="image/jpeg")throw new Error(); return new Uint8Array(await blob.arrayBuffer());
      } finally { canvas.width=0;canvas.height=0; }
    }};
  },
};
export const browserDigest=async(bytes:Uint8Array)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes).buffer));

/** Generated pixels only: callers cannot provide an uploaded image to this fixture. */
export async function prepareSyntheticJpeg(format:"image/png"|"image/webp"="image/png"): Promise<PreparedJpeg> {
  const canvas=document.createElement("canvas"); canvas.width=480;canvas.height=600;
  try {
    const c=canvas.getContext("2d"); if(!c)throw new Error("IMAGE_INVALID");
    c.fillStyle="#f1e7ff";c.fillRect(0,0,480,600);c.fillStyle="#c7f36a";c.beginPath();c.arc(240,250,140,0,Math.PI*2);c.fill();
    c.fillStyle="#43246c";c.font="bold 38px sans-serif";c.textAlign="center";c.fillText("CREATE & GROW",240,465);c.font="22px sans-serif";c.fillText("LOCAL SYNTHETIC SAMPLE",240,515);
    const source=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b&&b.type===format?resolve(b):reject(new Error("IMAGE_INVALID")),format,0.9));
    return prepareJpeg(new Uint8Array(await source.arrayBuffer()),format,browserImageCodec,browserDigest);
  } finally {canvas.width=0;canvas.height=0;}
}
