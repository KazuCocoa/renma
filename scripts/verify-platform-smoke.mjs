import { spawnSync } from "node:child_process";
import path from "node:path";

const fixtureRoot = path.resolve("test/fixtures/public-json-baseline");
const result = spawnSync(
  process.execPath,
  ["dist/index.js", "scan", fixtureRoot, "--format", "json"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
  },
);

if (result.error) {
  throw new Error(`Platform scan failed to start: ${result.error.message}`, {
    cause: result.error,
  });
}
if (result.status !== 0) {
  throw new Error(
    `Platform scan failed: ${result.stderr.trim() || `exit code ${result.status}`}`,
  );
}
if (result.stderr !== "") {
  throw new Error(`Platform scan wrote stderr: ${result.stderr.trim()}`);
}

let document;
try {
  document = JSON.parse(result.stdout);
} catch (error) {
  throw new Error("Platform scan did not emit valid JSON.", { cause: error });
}

if (
  document?.schemaVersion !== "renma.scan.v2" ||
  document?.format !== "json" ||
  path.resolve(document?.root ?? "") !== fixtureRoot ||
  document?.inspectionCoverage?.complete !== true ||
  !Array.isArray(document?.diagnostics) ||
  !Array.isArray(document?.suppressedDiagnostics) ||
  "findings" in document ||
  "suppressedFindings" in document ||
  "diagnosticsV2" in document
) {
  throw new Error("Platform scan changed its representative JSON contract.");
}

process.stdout.write(
  `Verified renma.scan.v2 machine-readable behavior on ${process.platform}.\n`,
);
