// @vitest-environment node
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prepareJpeg, type LocalImageCodec } from "./jpegPreparation";
const png = () => { const b = new Uint8Array(33); b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]); new DataView(b.buffer).setUint32(16,400); new DataView(b.buffer).setUint32(20,500); return b; };
const jpg = new Uint8Array([255,216,255,192,0,11,8,1,244,1,144,1,1,17,0,255,217]);
function codec() { const dispose = vi.fn(); const encodeJpeg = vi.fn(async () => jpg.slice()); const decode = vi.fn(async () => ({ width:400,height:500,encodeJpeg,dispose })); return { value: {decode} satisfies LocalImageCodec, decode, encodeJpeg, dispose }; }
const digest = async (bytes: Uint8Array) => new Uint8Array(await webcrypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer));
describe("bounded local JPEG preparation", () => {
  it("rejects duplicate extended frames and invalid odd-chunk padding before decoding",async()=>{
    const b=new Uint8Array(48);b.set(new TextEncoder().encode("RIFF"));const v=new DataView(b.buffer);v.setUint32(4,40,true);b.set(new TextEncoder().encode("WEBPVP8X"),8);v.setUint32(16,10,true);b.set([143,1,0,243,1,0],24);b.set(new TextEncoder().encode("VP8 "),30);v.setUint32(34,10,true);b.set([0,0,0,157,1,42,144,1,244,1],38);
    const duplicate=new Uint8Array(66);duplicate.set(b);duplicate.set(b.slice(30),48);new DataView(duplicate.buffer).setUint32(4,58,true);
    const padded=new Uint8Array(58);padded.set(b);padded.set(new TextEncoder().encode("XMP "),48);new DataView(padded.buffer).setUint32(4,50,true);new DataView(padded.buffer).setUint32(52,1,true);padded[56]=65;
    expect((await prepareJpeg(padded,"image/webp",codec().value,digest)).mime).toBe("image/jpeg");
    padded[57]=1;
    for(const invalid of [duplicate,padded]){const c=codec();await expect(prepareJpeg(invalid,"image/webp",c.value,digest)).rejects.toThrow("IMAGE_INVALID");expect(c.decode).not.toHaveBeenCalled();}
  });
  it("converts bounded simple VP8 WebP and rejects malformed containers before decoding", async () => {
    const b=new Uint8Array(30); b.set(new TextEncoder().encode("RIFF"));new DataView(b.buffer).setUint32(4,22,true);b.set(new TextEncoder().encode("WEBPVP8 "),8);new DataView(b.buffer).setUint32(16,10,true);b.set([0,0,0,157,1,42,144,1,244,1],20);
    const c=codec();expect((await prepareJpeg(b,"image/webp",c.value,digest)).mime).toBe("image/jpeg");
    for(const offset of [4,12,16,23]) {const bad=b.slice();bad[offset]=0;const invalid=codec();await expect(prepareJpeg(bad,"image/webp",invalid.value,digest)).rejects.toThrow("IMAGE_INVALID");expect(invalid.decode).not.toHaveBeenCalled();}
  });
  it("accepts a static extended WebP header but rejects animation before decoding",async()=>{
    const b=new Uint8Array(48);b.set(new TextEncoder().encode("RIFF"));const v=new DataView(b.buffer);v.setUint32(4,40,true);b.set(new TextEncoder().encode("WEBPVP8X"),8);v.setUint32(16,10,true);b.set([143,1,0,243,1,0],24);b.set(new TextEncoder().encode("VP8 "),30);v.setUint32(34,10,true);b.set([0,0,0,157,1,42,144,1,244,1],38);
    expect((await prepareJpeg(b,"image/webp",codec().value,digest)).width).toBe(400);
    for(const mutate of [(x:Uint8Array)=>{new DataView(x.buffer).setUint16(44,10000,true);},(x:Uint8Array)=>{new DataView(x.buffer).setUint32(34,100,true);},(x:Uint8Array)=>{x[26]=1;},(x:Uint8Array)=>{x.set(new TextEncoder().encode("ANMF"),30);}]){
      const bad=b.slice();mutate(bad);const invalid=codec();await expect(prepareJpeg(bad,"image/webp",invalid.value,digest)).rejects.toThrow("IMAGE_INVALID");expect(invalid.decode).not.toHaveBeenCalled();
    }
    b[20]=2;const c=codec();await expect(prepareJpeg(b,"image/webp",c.value,digest)).rejects.toThrow("IMAGE_INVALID");expect(c.decode).not.toHaveBeenCalled();
  });
  it("hashes the final JPEG bytes and disposes decoded resources", async () => {
    const c=codec(); const out=await prepareJpeg(png(),"image/png",c.value,digest);
    expect(out).toMatchObject({ mime:"image/jpeg",width:400,height:500,byteSize:jpg.length });
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/); expect(out.bytes).toEqual(jpg);
    expect(c.dispose).toHaveBeenCalledTimes(1); expect(c.encodeJpeg).toHaveBeenCalledTimes(1);
  });
  it.each(["image/svg+xml","image/webp","text/plain"])("rejects unsupported %s before decoding", async mime => {
    const c=codec(); await expect(prepareJpeg(png(),mime,c.value,digest)).rejects.toThrow("IMAGE_INVALID"); expect(c.decode).not.toHaveBeenCalled();
  });
  it("rejects MIME mismatch and excessive dimensions before decoding", async () => {
    const c=codec(); await expect(prepareJpeg(png(),"image/jpeg",c.value,digest)).rejects.toThrow("IMAGE_INVALID");
    const large=png(); new DataView(large.buffer).setUint32(16,100000);
    await expect(prepareJpeg(large,"image/png",c.value,digest)).rejects.toThrow("IMAGE_INVALID"); expect(c.decode).not.toHaveBeenCalled();
  });
  it("rejects excessive input bytes before decoding", async () => {
    const c=codec(); await expect(prepareJpeg(new Uint8Array(5*1024*1024+1),"image/png",c.value,digest)).rejects.toThrow("IMAGE_INVALID"); expect(c.decode).not.toHaveBeenCalled();
  });
  it("checks encoded bytes rather than trusting MIME metadata", async () => {
    const c=codec(); c.encodeJpeg.mockResolvedValue(png());
    await expect(prepareJpeg(png(),"image/png",c.value,digest)).rejects.toThrow("IMAGE_INVALID"); expect(c.dispose).toHaveBeenCalledOnce();
  });
  it("rejects unexpected decoded dimensions and still closes the frame", async () => {
    const c=codec(); c.decode.mockResolvedValue({width:401,height:500,encodeJpeg:c.encodeJpeg,dispose:c.dispose});
    await expect(prepareJpeg(png(),"image/png",c.value,digest)).rejects.toThrow("IMAGE_INVALID"); expect(c.dispose).toHaveBeenCalledOnce();
  });
  it("bounds codec errors and closes a frame after encoder failure", async () => {
    const c=codec(); c.encodeJpeg.mockRejectedValue(new Error("secret raw diagnostic"));
    await expect(prepareJpeg(png(),"image/png",c.value,digest)).rejects.toThrow(/^IMAGE_INVALID$/); expect(c.dispose).toHaveBeenCalledOnce();
  });
});
