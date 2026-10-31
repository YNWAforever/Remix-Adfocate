// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PickerTokenChannel } from "./pickerToken.js";
const actor={creatorId:"creator",workspaceId:"workspace"};
const config={origin:"https://pilot.invalid",projectNumber:"123456"};
const grant={accessToken:"fixture-access",refreshToken:"never-return",expiresAt:new Date(Date.now()+3600000).toISOString(),scopes:["https://www.googleapis.com/auth/drive.file","openid"],subject:"private-subject"};
describe("dedicated Picker token channel",()=>{
 it("returns only an actor and generation checked access token, with actual provider expiry",async()=>{
  const get=vi.fn(async()=>grant),channel=new PickerTokenChannel(config,get);
  const value=await channel.issue(actor,"connection",4);
  expect(get).toHaveBeenCalledWith(actor,"connection",4);
  expect(value).toEqual({accessToken:grant.accessToken,expiresAt:grant.expiresAt,scopes:grant.scopes,...config,connectionId:"connection",generation:4});
  expect(JSON.stringify(value)).not.toMatch(/never-return|private-subject/);
 });
 it("rejects invalid generation, origin, expiry, excessive scope and propagate revocation",async()=>{
  expect(()=>new PickerTokenChannel({...config,origin:"http://unsafe.invalid"},async()=>grant)).toThrow("PICKER_CONFIG_INVALID");
  const get=vi.fn(async()=>grant),channel=new PickerTokenChannel(config,get);
  await expect(channel.issue(actor,"connection",0)).rejects.toThrow("INVALID_INPUT");expect(get).not.toHaveBeenCalled();
  for(const bad of [{...grant,expiresAt:"expired"},{...grant,scopes:[...grant.scopes,"https://www.googleapis.com/auth/drive"]}])await expect(new PickerTokenChannel(config,async()=>bad).issue(actor,"connection",1)).rejects.toThrow("PICKER_TOKEN_INVALID");
  await expect(new PickerTokenChannel(config,async()=>{throw new Error("STALE_CONNECTION");}).issue(actor,"connection",1)).rejects.toThrow("STALE_CONNECTION");
 });
});
