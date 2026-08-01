import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { normalizeEvidenceWithExecutableContext } from "./lib.mjs";
import { renderExecutableExperimentReport } from "./report.mjs";

const experimentRoot = import.meta.dirname;
const repositoryRoot = path.resolve(experimentRoot, "../../../..");
const generatedExperimentRoot = path.join(
  experimentRoot,
  "..",
  "..",
  "generated",
  "evidence-correlation-executable-context",
);
const fixtureRoot = path.join(generatedExperimentRoot, "repository");
const scannerTargetRoot = path.join(fixtureRoot, "skills", "shared-owner");
const capture = process.argv.slice(2).includes("--capture");
if (process.argv.slice(2).some((argument) => argument !== "--capture")) {
  fail("Usage: node run-experiment.mjs [--capture]");
}
const outputRoot = capture
  ? path.join(experimentRoot, "captured", "fixture-run")
  : path.join(generatedExperimentRoot, "run");
const scannerCommand =
  process.env.RENMA_SKILLSPECTOR_EXECUTABLE ?? "skillspector";
const harnessPaths = [
  "experiments/skillspector/evidence-correlation/lib.mjs",
  "experiments/skillspector/evidence-correlation/executable-context/README.md",
  "experiments/skillspector/evidence-correlation/executable-context/lib.mjs",
  "experiments/skillspector/evidence-correlation/executable-context/lib.test.mjs",
  "experiments/skillspector/evidence-correlation/executable-context/report.mjs",
  "experiments/skillspector/evidence-correlation/executable-context/run-experiment.mjs",
  "experiments/skillspector/evidence-correlation/executable-context/prepare-fixture.mjs",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/renma.config.json.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/alpha/SKILL.md.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/beta/SKILL.md.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/shared-owner/README.md.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/shared-owner/SKILL.md.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/shared-owner/scripts/callee-probe.py.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/shared-owner/scripts/caller-probe.mjs.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/shared-owner/scripts/contained-probe.py.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/shared-owner/scripts/direct-probe.py.template",
  "experiments/skillspector/evidence-correlation/executable-context/fixtures/repository/skills/shared-owner/scripts/shared-probe.py.template",
];

if (capture) {
  try {
    await access(outputRoot);
    fail(
      "Captured executable-context evidence already exists. Remove it deliberately before replacing the reviewed run.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
} else {
  await rm(outputRoot, { recursive: true, force: true });
}
await mkdir(outputRoot, { recursive: true });

const preparation = await run(process.execPath, [
  path.join(experimentRoot, "prepare-fixture.mjs"),
]);
if (preparation.exitCode !== 0) fail(preparation.stderr || preparation.stdout);

const scannerVersion = await run(scannerCommand, ["--version"]);
if (scannerVersion.error?.code === "ENOENT") {
  fail(`SkillSpector executable not found: ${scannerCommand}`);
}
if (scannerVersion.exitCode !== 0) fail("SkillSpector version probe failed.");
const scannerExecutable = await resolveExecutable(scannerCommand);

const rawReportPath = path.join(outputRoot, "skillspector-report.json");
const scannerArgs = [
  "scan",
  scannerTargetRoot,
  "--no-llm",
  "--format",
  "json",
  "--output",
  rawReportPath,
];
const scanner = await run(scannerCommand, scannerArgs);
if (![0, 1].includes(scanner.exitCode)) {
  fail(
    `SkillSpector did not complete evidence collection (exit ${scanner.exitCode}).`,
  );
}
await access(rawReportPath);

const renmaCli = path.join(repositoryRoot, "dist", "index.js");
try {
  await access(renmaCli);
} catch {
  fail("Renma dist/index.js is missing. Run npm run build first.");
}

const catalogArgs = [renmaCli, "catalog", fixtureRoot, "--format", "json"];
const renmaCatalog = await run(process.execPath, catalogArgs);
if (renmaCatalog.exitCode !== 0 || renmaCatalog.stderr !== "") {
  fail(
    `Renma catalog did not complete cleanly (exit ${renmaCatalog.exitCode}, stderr ${renmaCatalog.stderr === "" ? "empty" : "non-empty"}).`,
  );
}
const catalogPath = path.join(outputRoot, "renma-catalog.json");
await writeFile(catalogPath, renmaCatalog.stdout);

const graphArgs = [
  renmaCli,
  "graph",
  fixtureRoot,
  "--view",
  "executable",
  "--format",
  "json",
];
const [renmaGraph, repeatedRenmaGraph] = await Promise.all([
  run(process.execPath, graphArgs),
  run(process.execPath, graphArgs),
]);
if (renmaGraph.exitCode !== 0 || renmaGraph.stderr !== "") {
  fail(
    `First Renma executable graph invocation did not complete cleanly (exit ${renmaGraph.exitCode}, stderr ${renmaGraph.stderr === "" ? "empty" : "non-empty"}).`,
  );
}
if (repeatedRenmaGraph.exitCode !== 0 || repeatedRenmaGraph.stderr !== "") {
  fail(
    `Repeated Renma executable graph invocation did not complete cleanly (exit ${repeatedRenmaGraph.exitCode}, stderr ${repeatedRenmaGraph.stderr === "" ? "empty" : "non-empty"}).`,
  );
}
if (renmaGraph.stdout !== repeatedRenmaGraph.stdout) {
  fail("Repeated public executable graph invocations were not byte-identical.");
}
const graphPath = path.join(outputRoot, "renma-executable-graph.json");
await writeFile(graphPath, renmaGraph.stdout);

const rawReportText = await readFile(rawReportPath, "utf8");
const catalogText = await readFile(catalogPath, "utf8");
const graphText = await readFile(graphPath, "utf8");
const rawReport = JSON.parse(rawReportText);
const catalog = JSON.parse(catalogText);
const executableGraph = JSON.parse(graphText);
const relativeOutputRoot = path
  .relative(
    path.join(repositoryRoot, "experiments", "skillspector"),
    outputRoot,
  )
  .split(path.sep)
  .join("/");
const normalized = normalizeEvidenceWithExecutableContext({
  rawReport,
  rawReportText,
  rawOutputReference: `${relativeOutputRoot}/skillspector-report.json`,
  catalog,
  catalogReference: `${relativeOutputRoot}/renma-catalog.json`,
  catalogText,
  executableGraph,
  executableGraphReference: `${relativeOutputRoot}/renma-executable-graph.json`,
  executableGraphText: graphText,
  fixtureId: "skillspector-executable-context-v1",
  scannerTargetPath: "skills/shared-owner",
});
await writeFile(
  path.join(outputRoot, "normalized-evidence.json"),
  `${JSON.stringify(normalized, null, 2)}\n`,
);

const [headRevision, renmaCliRevision, worktreeStatus] = await Promise.all([
  run("git", ["rev-parse", "HEAD"]),
  run("git", [
    "log",
    "-1",
    "--format=%H",
    "--",
    "src",
    "package.json",
    "package-lock.json",
    "scripts",
    "tools",
    "tsconfig.json",
  ]),
  run("git", ["status", "--porcelain=v1", "--untracked-files=all"]),
]);
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
const experimentHarnessFiles = await hashSelectedFiles(
  repositoryRoot,
  harnessPaths,
);
const statusPorcelain = worktreeStatus.stdout
  .split(/\r?\n/u)
  .filter((line) => line.length > 0);
const invocation = {
  experiment: "non-production-skillspector-executable-context-correlation",
  captured: capture,
  renmaCli: {
    revision:
      renmaCliRevision.exitCode === 0
        ? renmaCliRevision.stdout.trim()
        : "unknown",
    version: packageJson.version,
    executable: renmaCli,
    executableSha256: await hashFile(renmaCli),
  },
  git: {
    headRevision:
      headRevision.exitCode === 0 ? headRevision.stdout.trim() : "unknown",
    worktreeState:
      worktreeStatus.exitCode === 0
        ? statusPorcelain.length === 0
          ? "clean"
          : "dirty"
        : "unknown",
    statusPorcelain,
  },
  experimentHarness: {
    revisionContext:
      headRevision.exitCode === 0 ? headRevision.stdout.trim() : "unknown",
    revisionContainsExactHarness: statusPorcelain.length === 0,
    sha256: hashHarness(experimentHarnessFiles),
    files: experimentHarnessFiles,
  },
  scanner: {
    requestedExecutable: scannerCommand,
    executable: scannerExecutable,
    versionProbeOutput:
      `${scannerVersion.stdout}${scannerVersion.stderr}`.trim(),
    args: scannerArgs,
    exitCode: scanner.exitCode,
    stdout: scanner.stdout,
    stderr: scanner.stderr,
  },
  renmaCatalog: {
    executable: process.execPath,
    args: catalogArgs,
    exitCode: renmaCatalog.exitCode,
    stderr: renmaCatalog.stderr,
  },
  renmaExecutableGraph: {
    executable: process.execPath,
    args: graphArgs,
    firstInvocation: {
      exitCode: renmaGraph.exitCode,
      stderr: renmaGraph.stderr,
    },
    repeatedInvocation: {
      exitCode: repeatedRenmaGraph.exitCode,
      stderr: repeatedRenmaGraph.stderr,
      stdoutByteIdenticalToFirst:
        repeatedRenmaGraph.stdout === renmaGraph.stdout,
    },
  },
  fixture: {
    id: normalized.source.fixture.id,
    root: path.relative(repositoryRoot, fixtureRoot).split(path.sep).join("/"),
    scannerTarget: path
      .relative(repositoryRoot, scannerTargetRoot)
      .split(path.sep)
      .join("/"),
    files: await hashFiles(fixtureRoot),
  },
  rawArtifacts: {
    scanner: {
      reference: normalized.source.rawOutput.reference,
      sha256: normalized.source.rawOutput.sha256,
    },
    catalog: {
      reference: normalized.source.renmaCatalog.reference,
      sha256: normalized.source.renmaCatalog.sha256,
    },
    executableGraph: {
      reference: normalized.source.renmaExecutableGraph.reference,
      sha256: normalized.source.renmaExecutableGraph.sha256,
    },
  },
};
await writeFile(
  path.join(outputRoot, "invocation.json"),
  `${JSON.stringify(invocation, null, 2)}\n`,
);
await writeFile(
  path.join(outputRoot, "EXPERIMENT-REPORT.md"),
  renderExecutableExperimentReport({ normalized, rawReport, invocation }),
);

process.stdout.write(
  `Preserved ${normalized.counts.rawFindingCount} raw findings; executable context correlated ${normalized.counts.executableCorrelatedCount}, unresolved ${normalized.counts.executableUnresolvedCount}, ambiguous ${normalized.counts.executableAmbiguousCount}, inconclusive ${normalized.counts.executableInconclusiveCount}.\nArtifacts: ${outputRoot}\n`,
);

async function resolveExecutable(command) {
  if (command.includes(path.sep)) return realpath(path.resolve(command));
  const lookup = await run("which", [command]);
  if (lookup.exitCode !== 0 || lookup.stdout.trim().length === 0)
    return command;
  return realpath(lookup.stdout.trim());
}

async function hashFiles(root) {
  const files = [];
  await visit(root);
  return files;

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        files.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          sha256: await hashFile(absolute),
        });
      }
    }
  }
}

async function hashSelectedFiles(root, relativePaths) {
  return Promise.all(
    relativePaths.map(async (relativePath) => ({
      path: relativePath,
      sha256: await hashFile(path.join(root, relativePath)),
    })),
  );
}

async function hashFile(filePath) {
  return `sha256:${createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")}`;
}

function hashHarness(files) {
  return `sha256:${createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.sha256}`).join("\n"))
    .digest("hex")}`;
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      resolve({ exitCode: null, stdout, stderr, error }),
    );
    child.on("close", (exitCode, signal) =>
      resolve({ exitCode, signal, stdout, stderr }),
    );
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
