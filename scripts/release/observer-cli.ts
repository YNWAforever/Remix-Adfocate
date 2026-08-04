delete process.env.VITEST;
const { executeObserverCli } = await import("./observer");

try {
  const result = await executeObserverCli(process.argv.slice(2), process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if ("decision" in (result as object) && (result as { decision: string }).decision !== "expand") {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "observer command failed";
  process.stderr.write(`${JSON.stringify({ status: "failed", error: message.replace(/(?:postgres(?:ql)?:\/\/|eyJ)[^\s"']+/gi, "[REDACTED]") })}\n`);
  process.exitCode = 1;
}
