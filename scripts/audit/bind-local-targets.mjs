// Historical local port rebinding. Only an explicit non-retired target can proceed.
// Preserve its exact image and data volumes; the retired forensic target is excluded.
import { execFileSync } from "node:child_process";
import http from "node:http";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import process from "node:process";
import { assertAcceptanceTargetAllowed } from "../run-integration-tests.mjs";
const runId = "01a16483-e55d-7332-9ddc-7e8a3f68eb11";
const selected=process.argv.slice(2);
if(selected.length>1||selected.some(kind=>!["empty","shaped"].includes(kind)))throw new Error("Select one historical local target: empty or shaped");
const kinds=selected.length?selected:["empty","shaped"];
// Validate the complete selection first; a retired default must not partially
// change the empty target before the shaped target is refused.
for(const kind of kinds)assertAcceptanceTargetAllowed({projectId:`adfocate-r1-${kind}-20261023`});
const docker = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 60000 }).trim();
const endpoint = docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
if (endpoint !== "npipe:////./pipe/dockerDesktopLinuxEngine") throw new Error("unreviewed Docker engine endpoint");
function api(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const request = http.request({ socketPath: "\\\\.\\pipe\\dockerDesktopLinuxEngine", path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (response) => {
      let output = ""; response.on("data", (chunk) => output += chunk);
      response.on("end", () => response.statusCode < 300 ? resolve(JSON.parse(output || "{}")) : reject(new Error(`Docker create failed (${response.statusCode})`)));
    });
    request.on("error", reject); request.end(body);
  });
}
for (const kind of kinds) {
  const project = `adfocate-r1-${kind}-20261023`;
  assertAcceptanceTargetAllowed({ projectId: project });
  for (const service of ["db", "kong"]) {
    const name = `supabase_${service}_${project}`;
    const [source] = JSON.parse(docker(["inspect", name]));
    assertAcceptanceTargetAllowed({ projectId: source.Config.Labels?.["com.supabase.cli.project"],
      id: source.Id, networks: source.NetworkSettings.Networks, mounts: source.Mounts });
    if (source.Config.Labels?.["com.supabase.cli.project"] !== project) throw new Error("container owner mismatch");
    const networks = Object.entries(source.NetworkSettings.Networks);
    if (networks.length !== 1) throw new Error("unexpected container network count");
    const [networkName, network] = networks[0];
    const [networkInfo] = JSON.parse(docker(["network", "inspect", network.NetworkID]));
    if (networkInfo.Labels?.["adfocate.run"] !== runId) throw new Error("network is not owned by this run");
    const bindings = source.HostConfig.PortBindings;
    if (Object.values(bindings).flat().every((binding) => binding.HostIp === "127.0.0.1")) continue;
    const hostConfig = { ...source.HostConfig, RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
      PortBindings: Object.fromEntries(Object.entries(bindings).map(([port, values]) => [port, values.map((value) => ({ ...value, HostIp: "127.0.0.1" }))])) };
    const config = { ...source.Config, Image: source.Image, HostConfig: hostConfig,
      NetworkingConfig: { EndpointsConfig: { [networkName]: { Aliases: network.Aliases?.filter((value) => value !== source.Id.slice(0,12)) } } } };
    docker(["stop", "--time", "20", source.Id]);
    docker(["rm", source.Id]); // No -v; retain only this run's exact data volumes.
    const created = await api(`/containers/create?name=${encodeURIComponent(name)}`, config);
    docker(["start", created.Id]);
    log(`${name}: recreated with loopback binding; image and volumes retained`);
  }
}
