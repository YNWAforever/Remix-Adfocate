delete process.env.VITEST;
const { executePilotCli } = await import("./pilot");

try {
  const result = await executePilotCli(process.argv.slice(2), process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if ("eligible" in (result as object) && (result as { eligible: boolean }).eligible === false) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "pilot command failed";
  process.stderr.write(`${JSON.stringify({ status: "failed", error: message.replace(/(?:postgres(?:ql)?:\/\/|eyJ)[^\s"']+/gi, "[REDACTED]") })}\n`);
  process.exitCode = 1;
}
