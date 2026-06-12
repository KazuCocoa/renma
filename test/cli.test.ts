import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { scan } from "../src/scanner.js";

test("scan discovers default artifacts and emits deterministic findings", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "# Demo\n\nRun `rm -rf /tmp/demo`.\n");

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 1);
  assert.deepEqual(result.findings.map((finding) => finding.id), [
    "QUAL-MISSING-DESCRIPTION",
    "QUAL-MISSING-NEGATIVE-ROUTING",
    "QUAL-MISSING-EXAMPLES",
    "QUAL-MISSING-PREFLIGHT",
    "QUAL-MISSING-VERIFICATION",
    "SEC-DESTRUCTIVE-COMMAND"
  ]);
  assert.equal(result.findings.at(-1)?.evidence.path, "skills/demo/SKILL.md");
});

test("config loads fail_on and CLI override takes precedence", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "skillforge.config.json"), JSON.stringify({ fail_on: "critical", format: "json" }));
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "# Demo\n\npassword = \"supersecretvalue\"\n");

  const fromConfig = await scan(root);
  const fromCli = await scan(root, { failOn: "medium" });

  assert.equal(fromConfig.exitThreshold, "critical");
  assert.equal(fromConfig.format, "json");
  assert.equal(fromCli.exitThreshold, "medium");
  assert.equal(fromConfig.configPath, "skillforge.config.json");
});

test("CLI honors format from config", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "skillforge.config.json"), JSON.stringify({ format: "json" }));

  const exitCode = await withCapturedConsole(() => main(["scan", root]));
  const report = JSON.parse(exitCode.stdout) as { format: string };

  assert.equal(exitCode.code, 0);
  assert.equal(report.format, "json");
});

test("invalid config field is a usage error in CLI", async () => {
  const root = await fixture();
  await writeFile(path.join(root, ".skillforge.json"), JSON.stringify({ failOn: "high" }));

  const exitCode = await withCapturedConsole(() => main(["scan", root]));

  assert.equal(exitCode.code, 2);
  assert.match(exitCode.stderr, /Unknown config field "failOn"/);
});

test("CLI reports JSON and fail-on exit code", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "# Demo\n\napi_key = \"abcd1234abcd1234\"\n");

  const exitCode = await withCapturedConsole(() => main(["scan", root, "--json", "--fail-on", "critical"]));
  const report = JSON.parse(exitCode.stdout) as { findings: Array<{ id: string }> };

  assert.equal(exitCode.code, 1);
  assert.ok(report.findings.some((finding) => finding.id === "SEC-LITERAL-SECRET"));
});

test("help and invalid commands have expected exit codes", async () => {
  const help = await withCapturedConsole(() => main(["--help"]));
  const invalid = await withCapturedConsole(() => main(["inspect"]));

  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage: skillforge scan/);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Unknown command "inspect"/);
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "skillforge-"));
}

async function withCapturedConsole(callback: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
