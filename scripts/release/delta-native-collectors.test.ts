// @vitest-environment node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { digestDeltaProofPayload } from "./delta-evidence";
import { DELTA_FINALIZE_CONSTRAINTS_SQL } from "./delta-program";
import { assertNativeOwnedContainer, nativeOwnedResource, NATIVE_COLLECTOR_IMAGES } from "./delta-native-collectors";

// Pure safety/protocol fixtures. Importing the runner never invokes Docker.
const token="ab12".repeat(8),imageId="sha256:"+"d1".repeat(32),serverId="a1".repeat(32),toolId="b2".repeat(32);
const owned=(role:"server"|"tool"="server")=>({...nativeOwnedResource(token,role,imageId,["/var/lib/postgresql/data"],role==="tool"?serverId:undefined),id:role==="server"?serverId:toolId});
function metadata(role:"server"|"tool"="server"){
  const resource=owned(role);
  return [{Id:resource.id,Name:`/${resource.name}`,Image:imageId,Config:{Image:NATIVE_COLLECTOR_IMAGES[role],User:"100:101",Labels:{"adfocate.native-collectors":token,"adfocate.native-collectors.role":role,"adfocate.native-collectors.profile":resource.profile,"adfocate.native-collectors.namespace":role==="server"?"none":serverId}},
    HostConfig:{NetworkMode:role==="server"?"none":`container:${serverId}`,LogConfig:{Type:"none"},ReadonlyRootfs:true,Privileged:false,PublishAllPorts:false,PortBindings:null,
      CapDrop:["ALL"],CapAdd:null,SecurityOpt:["no-new-privileges"],Tmpfs:Object.fromEntries(resource.tmpfs.map(path=>[path,"rw,nosuid,nodev,noexec"])),PidsLimit:256,Memory:1073741824,NanoCpus:1000000000,Binds:null,VolumesFrom:null},
    Mounts:resource.tmpfs.map(Destination=>({Type:"tmpfs",Destination})),State:{OOMKilled:false,Running:false,Status:"created"}}];
}
type NativeObservedReceipt={kind:string;profile?:string;images:{server:string;tool:string};validReleaseEvidence:boolean;productionApplied:boolean;productionEquivalent?:boolean;status:string;contentDigest:string;inputSha256:Record<string,string>;
  scope:{syntheticOnly:boolean;actualProductionBaseline:boolean;providerAuthTested:boolean;checkpointStatementsActuallyExecuted:boolean};
  checks:{identity:{serverVersionNum:string};dumpVersion:string;inputHashesAfter:string;
    extensionAvailability:{sourceProfileVerified:boolean;missing:{name:string;version:string}[]};installedExtensions:{name:string;version:string}[];
    first:{beforeRows:number;afterRows:number;assertedBeforeCommit:boolean;constraintsFinalizedBeforeInvariant?:boolean;finalizeConstraintsSha256?:string};replay:{beforeRows:number;afterRows:number;assertedBeforeCommit:boolean;constraintsFinalizedBeforeInvariant?:boolean;finalizeConstraintsSha256?:string};
    source:{finalizeConstraintsExport?:string;finalizeConstraintsSha256?:string;applySqlSha256?:string};
    semanticRoots:{before:string;after:string;replay:string;snapshotBound:boolean};driftRejection:{case:string;result:string;rollbackAcknowledged:boolean;withoutFlushInvariantPassed?:boolean;flushChangedApplicationData?:boolean;restoredAfterRollback?:boolean;finalizeConstraintsSha256?:string}[]};
  cleanup:{containers:{role:string;confirmed:boolean}[]}};

describe("recorded native observation",()=>{
  it("retains actual kernel proof without promoting a missing source profile or synthetic fixture",async()=>{
    const text=await readFile('docs/verification/phase3-protected-delta/native-collectors-20261114.json','utf8');
    const receipt=JSON.parse(text)as NativeObservedReceipt;
    expect(receipt.kind).toBe('owned-native-collector-fixture');expect(receipt.validReleaseEvidence).toBe(false);expect(receipt.productionApplied).toBe(false);
    expect(receipt.scope).toMatchObject({syntheticOnly:true,actualProductionBaseline:false,providerAuthTested:false,checkpointStatementsActuallyExecuted:true});
    expect(receipt.status).toMatch(/^NATIVE_SQL_EXPORT_AND_DELTA_REPLAY_VERIFIED(?:_SOURCE_PROFILE_HOLD)?$/);
    expect(receipt.checks.identity.serverVersionNum).toBe('170006');expect(receipt.checks.dumpVersion).toBe('17.11');expect(receipt.checks.inputHashesAfter).toBe('UNCHANGED');
    expect(receipt.checks.first).toMatchObject({beforeRows:17,afterRows:18,assertedBeforeCommit:true});
    expect(receipt.checks.replay).toMatchObject({beforeRows:18,afterRows:18,assertedBeforeCommit:true});
    expect(receipt.checks.semanticRoots.snapshotBound).toBe(true);expect(receipt.checks.semanticRoots.before).not.toBe(receipt.checks.semanticRoots.after);
    expect(receipt.checks.semanticRoots.after).toBe(receipt.checks.semanticRoots.replay);
    expect(receipt.checks.driftRejection).toHaveLength(4);expect(receipt.checks.driftRejection.every(row=>row.result==='REJECTED_BEFORE_COMMIT'&&row.rollbackAcknowledged)).toBe(true);
    expect(receipt.cleanup.containers.map(row=>row.role).sort()).toEqual(['server','tool']);expect(receipt.cleanup.containers.every(row=>row.confirmed)).toBe(true);
    if(receipt.checks.extensionAvailability.missing.length){expect(receipt.checks.extensionAvailability.sourceProfileVerified).toBe(false);expect(receipt.status).toContain('SOURCE_PROFILE_HOLD');
      for(const missing of receipt.checks.extensionAvailability.missing)expect(receipt.checks.installedExtensions.some(row=>row.name===missing.name&&row.version===missing.version)).toBe(false);}
    // This retained five-extension receipt is historical; do not rewrite its
    // observed input hashes when adding the separate source-six profile.
    expect(Object.values(receipt.inputSha256).every(value=>/^[a-f0-9]{64}$/.test(value))).toBe(true);
    const {contentDigest,...payload}=receipt;expect(contentDigest).toBe(digestDeltaProofPayload(payload));
    expect(text).not.toMatch(/postgres(?:ql)?:\/\/|PGPASSWORD|BEGIN ISOLATION|CREATE TABLE|CREATE FUNCTION/);
  });
  it("records a separate exact source-six native profile without claiming production equivalence",async()=>{
    const receipt=JSON.parse(await readFile('docs/verification/phase3-protected-delta/native-collectors-source6-20261114.json','utf8'))as NativeObservedReceipt;
    expect(receipt.profile).toBe('source6-17.6.1.081');expect(receipt.images.server).toBe('public.ecr.aws/supabase/postgres@sha256:b7c9e3315b351a747af1763d3e78e990b2ae97fbdcf5d538d08a3dd6723a88a4');
    expect(receipt.validReleaseEvidence).toBe(false);expect(receipt.productionApplied).toBe(false);expect(receipt.productionEquivalent).toBe(false);expect(receipt.scope.actualProductionBaseline).toBe(false);expect(receipt.scope.providerAuthTested).toBe(false);
    expect(receipt.status).toBe('NATIVE_SQL_EXPORT_AND_DELTA_REPLAY_VERIFIED');expect(receipt.checks.identity.serverVersionNum).toBe('170006');expect(receipt.checks.dumpVersion).toBe('17.11');
    expect(receipt.checks.extensionAvailability).toMatchObject({sourceProfileVerified:true,missing:[]});expect(receipt.checks.installedExtensions).toHaveLength(6);
    expect(receipt.checks.installedExtensions).toContainEqual({name:'vector',schema:'public',version:'0.8.0'});
    expect(receipt.checks.first).toMatchObject({beforeRows:17,afterRows:18,assertedBeforeCommit:true});expect(receipt.checks.replay).toMatchObject({beforeRows:18,afterRows:18,assertedBeforeCommit:true});
    expect(receipt.checks.semanticRoots.before).not.toBe(receipt.checks.semanticRoots.after);expect(receipt.checks.semanticRoots.after).toBe(receipt.checks.semanticRoots.replay);
    const flushSha=createHash('sha256').update(DELTA_FINALIZE_CONSTRAINTS_SQL).digest('hex');
    expect(receipt.checks.first).toMatchObject({constraintsFinalizedBeforeInvariant:true,finalizeConstraintsSha256:flushSha});
    expect(receipt.checks.replay).toMatchObject({constraintsFinalizedBeforeInvariant:true,finalizeConstraintsSha256:flushSha});
    expect(receipt.checks.source).toMatchObject({finalizeConstraintsExport:'DELTA_FINALIZE_CONSTRAINTS_SQL',finalizeConstraintsSha256:flushSha});
    expect(receipt.checks.source.applySqlSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.checks.driftRejection).toHaveLength(9);expect(receipt.checks.driftRejection.every(row=>row.result==='REJECTED_BEFORE_COMMIT'&&row.rollbackAcknowledged)).toBe(true);
    expect(receipt.checks.driftRejection).toContainEqual({case:'deferred-constraint-trigger',result:'REJECTED_BEFORE_COMMIT',rollbackAcknowledged:true,
      withoutFlushInvariantPassed:true,flushChangedApplicationData:true,restoredAfterRollback:true,finalizeConstraintsSha256:flushSha});
    expect(receipt.cleanup.containers).toHaveLength(2);expect(receipt.cleanup.containers.every(row=>row.confirmed)).toBe(true);
    for(const path of ['scripts/release/delta-native-collectors.ts','scripts/release/delta-fingerprint.ts','scripts/release/delta-semantic-capture.sql','scripts/release/delta-invariant-capture.sql','scripts/release/delta-program.ts'])
      expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(receipt.inputSha256[path]);
    const{contentDigest,...payload}=receipt;expect(contentDigest).toBe(digestDeltaProofPayload(payload));
  });
});

describe("owned native fixture boundary",()=>{
  it("accepts only the exact UUID/label/image/user/isolation envelope",()=>{
    for(const role of ["server","tool"]as const)expect(assertNativeOwnedContainer(metadata(role),owned(role)).Id).toBe(role==="server"?serverId:toolId);
  });
  it.each(["Id","Name","Image"]as const)("rejects resource identity drift in %s",key=>{
    const value=metadata();value[0]![key]="wrong";expect(()=>assertNativeOwnedContainer(value,owned())).toThrow("owned-container-isolation");
  });
  it.each(["NetworkMode","ReadonlyRootfs","Privileged","PublishAllPorts","PortBindings","CapDrop","CapAdd","SecurityOpt","PidsLimit","Memory","NanoCpus","Binds","VolumesFrom"]as const)("rejects isolation drift in %s",key=>{
    const value=metadata();Object.assign(value[0]!.HostConfig,{[key]:key==="NetworkMode"?"bridge":key==="ReadonlyRootfs"?false:key==="Privileged"||key==="PublishAllPorts"?true:key==="PortBindings"?{"5432/tcp":[{HostPort:"5432"}]}:key==="CapDrop"?[]:key==="CapAdd"?["SYS_ADMIN"]:key==="SecurityOpt"?[]:key==="Binds"||key==="VolumesFrom"?["unowned"]:0});
    expect(()=>assertNativeOwnedContainer(value,owned())).toThrow("owned-container-isolation");
  });
  it("rejects host mounts, anonymous image volumes and unknown tmpfs paths",()=>{
    for(const type of ["bind","volume"]){const value=metadata();value[0]!.Mounts[0]!.Type=type;expect(()=>assertNativeOwnedContainer(value,owned())).toThrow("owned-container-isolation");}
    const value=metadata();value[0]!.HostConfig.Tmpfs["/unexpected"]="rw";expect(()=>assertNativeOwnedContainer(value,owned())).toThrow("owned-container-isolation");
  });
  it("rejects wrong owner token, user, logging driver, namespace binding and resource cardinality",()=>{
    const tokenWrong=metadata();tokenWrong[0]!.Config.Labels["adfocate.native-collectors"]="other";
    const userWrong=metadata();userWrong[0]!.Config.User="0:0";
    const loggerWrong=metadata();loggerWrong[0]!.HostConfig.LogConfig.Type="json-file";
    const namespaceWrong=metadata("tool");namespaceWrong[0]!.Config.Labels["adfocate.native-collectors.namespace"]=toolId;
    for(const value of [tokenWrong,userWrong,loggerWrong])expect(()=>assertNativeOwnedContainer(value,owned())).toThrow("owned-container-isolation");
    expect(()=>assertNativeOwnedContainer(namespaceWrong,owned("tool"))).toThrow("owned-container-isolation");
    expect(()=>assertNativeOwnedContainer([],owned())).toThrow("one-owned-resource-required");
    expect(()=>assertNativeOwnedContainer([...metadata(),...metadata()],owned())).toThrow("one-owned-resource-required");
  });
  it("accepts only the enumerated source-six image and binds its ownership profile",()=>{
    const resource={...nativeOwnedResource(token,'server',imageId,[],undefined,'source6-17.6.1.081'),id:serverId};
    expect(resource.image).toBe('public.ecr.aws/supabase/postgres@sha256:b7c9e3315b351a747af1763d3e78e990b2ae97fbdcf5d538d08a3dd6723a88a4');
    expect(()=>nativeOwnedResource(token,'server',imageId,[],undefined,'arbitrary-image'as never)).toThrow('fixture-profile');
    const value=metadata();Object.assign(value[0]!.Config,{Image:resource.image});value[0]!.Config.Labels['adfocate.native-collectors.profile']=resource.profile;
    value[0]!.HostConfig.Tmpfs=Object.fromEntries(resource.tmpfs.map(path=>[path,'rw,nosuid,nodev,noexec']));value[0]!.Mounts=resource.tmpfs.map(Destination=>({Type:'tmpfs',Destination}));
    expect(assertNativeOwnedContainer(value,resource).Id).toBe(serverId);
    value[0]!.Config.Labels['adfocate.native-collectors.profile']='cached-17.6-partial';expect(()=>assertNativeOwnedContainer(value,resource)).toThrow('owned-container-isolation');
  });
  it("rejects unreviewed image volumes and namespace borrowing without an exact server ID",()=>{
    expect(()=>nativeOwnedResource(token,"server",imageId,["/host"])).toThrow("ownership-profile");
    expect(()=>nativeOwnedResource(token,"tool",imageId,[])).toThrow("ownership-profile");
    expect(()=>nativeOwnedResource("bad","server",imageId,[])).toThrow("ownership-profile");
    expect(()=>nativeOwnedResource(token,"server",imageId,[],serverId)).toThrow("ownership-profile");
  });
});
