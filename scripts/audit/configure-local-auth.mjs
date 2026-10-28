// Enable phone password transport for synthetic phone-primary bootstrap fixtures.
// No SMS provider, OTP delivery or external message is configured.
import { execFileSync } from "node:child_process";
import http from "node:http";
import { Buffer } from "node:buffer";
import process from "node:process";
import { verifiedTarget } from "./local-targets.mjs";
const kind=process.argv[2]??"empty";
const target=verifiedTarget(kind); // identity gate before inspecting private container config
const docker=(args)=>execFileSync("docker",args,{encoding:"utf8",timeout:60000}).trim();
const name=`supabase_auth_${target.identity.projectId}`;
const [source]=JSON.parse(docker(["inspect",name]));
if(source.Config.Labels?.["com.supabase.cli.project"]!==target.identity.projectId
  || !Object.values(source.NetworkSettings.Networks).some((network)=>network.NetworkID===target.identity.networkId))throw new Error("local auth identity mismatch");
if(!source.Config.Env.includes("GOTRUE_EXTERNAL_PHONE_ENABLED=true")){
  const [networkName,network]=Object.entries(source.NetworkSettings.Networks)[0];
  const config={...source.Config,Image:source.Image,Env:[...source.Config.Env.filter((item)=>!item.startsWith("GOTRUE_EXTERNAL_PHONE_ENABLED=")),"GOTRUE_EXTERNAL_PHONE_ENABLED=true"],
    HostConfig:source.HostConfig,NetworkingConfig:{EndpointsConfig:{[networkName]:{Aliases:network.Aliases?.filter((value)=>value!==source.Id.slice(0,12))}}}};
  docker(["stop","--time","20",source.Id]);docker(["rm",source.Id]);
  const created=await new Promise((resolve,reject)=>{
    const body=JSON.stringify(config);
    const req=http.request({socketPath:"\\\\.\\pipe\\dockerDesktopLinuxEngine",path:`/containers/create?name=${name}`,method:"POST",
      headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}},(res)=>{
      let output="";res.on("data",(chunk)=>output+=chunk);res.on("end",()=>res.statusCode<300?resolve(JSON.parse(output)):reject(new Error(`local auth create failed ${res.statusCode}`)));
    });req.on("error",reject);req.end(body);
  });
  docker(["start",created.Id]);
}
process.stdout.write("Owned local Auth: phone password transport enabled; external SMS unconfigured.\n");
