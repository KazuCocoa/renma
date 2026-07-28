import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const experimentRoot = import.meta.dirname;
const repositoryRoot = path.resolve(experimentRoot, "../..");
const generatedRoot = path.join(experimentRoot, "generated");
const supportedKinds = new Set(["canonical-skill", "repository-probe"]);
const executable = process.env.RENMA_SKILLSPECTOR_EXECUTABLE ?? "skillspector";

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  process.stdout.write(`Usage: node experiments/skillspector/run.mjs [options]

  --list                     List configured targets without scanning
  --kind <kind>              Scan canonical-skill or repository-probe targets
  --target <id>              Scan one configured target
  --llm                      Enable the optional non-deterministic LLM path
  -h, --help                 Show this help

Default: --kind canonical-skill with static-only analysis.
Set RENMA_SKILLSPECTOR_EXECUTABLE only when the installed tool is not on PATH.
`);
  process.exit(0);
}

const targets = await loadTargets();
if (options.list) {
  for (const target of targets) {
    process.stdout.write(`${target.id}\t${target.kind}\t${target.path}\n`);
  }
  process.exit(0);
}

const selected = selectTargets(targets, options);
const versionProbe = await captureVersion();
const mode = options.llm ? "llm-enabled" : "static-only";
process.stdout.write(`SkillSpector ${versionProbe.version}; mode ${mode}\n`);

let failed = false;
for (const target of selected) {
  const targetFailed = await scanTarget(target, mode, versionProbe);
  failed = targetFailed || failed;
}
if (failed) process.exitCode = 1;

function parseOptions(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (argument === "--list") parsed.list = true;
    else if (argument === "--llm") parsed.llm = true;
    else if (argument === "--kind" || argument === "--target") {
      const value = args[++index];
      if (value === undefined || value.length === 0 || value.startsWith("-")) {
        fail(`${argument} requires a value.`);
      }
      parsed[argument.slice(2)] = value;
    } else fail(`Unknown option: ${argument}`);
  }

  if (parsed.kind !== undefined && !supportedKinds.has(parsed.kind)) {
    fail(`Unsupported target kind "${parsed.kind}".`);
  }
  if (parsed.kind !== undefined && parsed.target !== undefined) {
    fail("Use either --kind or --target, not both.");
  }
  if (
    parsed.list &&
    (parsed.kind !== undefined || parsed.target !== undefined || parsed.llm)
  ) {
    fail("--list cannot be combined with scan options.");
  }
  return parsed;
}

async function loadTargets() {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(experimentRoot, "targets.json"), "utf8"),
    );
  } catch (error) {
    fail(`Cannot read targets.json: ${error.message}`);
  }
  if (!Array.isArray(manifest.targets)) {
    fail("targets.json must contain a targets array.");
  }

  const repositoryRealPath = await realpath(repositoryRoot);
  const ids = new Set();
  const validated = [];
  for (const target of manifest.targets) {
    if (target === null || typeof target !== "object") {
      fail("Every configured target must be an object.");
    }
    const { id, kind, path: targetPath } = target;
    if (
      typeof id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) ||
      ids.has(id)
    ) {
      fail(`Invalid or duplicate target ID: ${String(id)}`);
    }
    ids.add(id);
    if (!supportedKinds.has(kind)) fail(`Invalid kind for target "${id}".`);
    if (
      typeof targetPath !== "string" ||
      path.isAbsolute(targetPath) ||
      targetPath.includes("\\") ||
      path.posix.normalize(targetPath) !== targetPath
    ) {
      fail(`Invalid repository-relative path for target "${id}".`);
    }

    const resolved = path.resolve(repositoryRoot, targetPath);
    requireInside(repositoryRoot, resolved, id);
    let targetRealPath;
    try {
      await access(resolved);
      targetRealPath = await realpath(resolved);
    } catch (error) {
      fail(`Target "${id}" is unavailable: ${error.message}`);
    }
    requireInside(repositoryRealPath, targetRealPath, id);
    validated.push({
      id,
      kind,
      path: targetPath,
      absolutePath: targetRealPath,
    });
  }
  return validated.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function requireInside(root, candidate, id) {
  const relative = path.relative(root, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail(`Target "${id}" resolves outside the repository root.`);
  }
}

function selectTargets(targetsToSelect, parsed) {
  if (parsed.target !== undefined) {
    const match = targetsToSelect.find((target) => target.id === parsed.target);
    if (match === undefined) {
      fail(`Unknown target "${parsed.target}". Run with --list first.`);
    }
    return [match];
  }
  const kind = parsed.kind ?? "canonical-skill";
  const matches = targetsToSelect.filter((target) => target.kind === kind);
  if (matches.length === 0) fail(`No configured targets have kind "${kind}".`);
  return matches;
}

async function captureVersion() {
  if (executable.length === 0) {
    fail("RENMA_SKILLSPECTOR_EXECUTABLE must not be empty.");
  }
  for (const args of [["--version"], ["version"]]) {
    const result = await run(executable, args);
    if (result.error?.code === "ENOENT") {
      fail(
        `The SkillSpector executable "${executable}" was not found. Install it externally, make it available on PATH or set RENMA_SKILLSPECTOR_EXECUTABLE to its exact path, then rerun. Renma dependencies were not modified.`,
      );
    }
    if (result.exitCode === 0) {
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const match = output.match(
        /\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/u,
      );
      return {
        version: match?.[1] ?? output.split(/\r?\n/u)[0] ?? "unknown",
        command: { executable, args, exitCode: result.exitCode, output },
      };
    }
  }
  return { version: "unknown", command: null };
}

async function scanTarget(target, mode, versionProbeResult) {
  const outputDirectory = path.join(generatedRoot, mode, target.id);
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const commands = [];
  let scanFailed = false;

  process.stdout.write(`Scanning ${target.id} (${target.path})\n`);
  for (const format of ["json", "sarif"]) {
    const reportPath = path.join(
      outputDirectory,
      format === "json" ? "report.json" : "report.sarif",
    );
    await rm(reportPath, { force: true });
    const args = ["scan", target.absolutePath];
    if (mode === "static-only") args.push("--no-llm");
    args.push("--format", format, "--output", reportPath);

    const commandStartedAt = new Date().toISOString();
    const result = await run(executable, args, true);
    let reportWritten = true;
    try {
      await access(reportPath);
    } catch {
      reportWritten = false;
    }
    commands.push({
      executable,
      args,
      format,
      startedAt: commandStartedAt,
      completedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      signal: result.signal,
      error: result.error?.message,
      reportWritten,
    });
    if (result.exitCode !== 0 || result.error || !reportWritten) {
      scanFailed = true;
      process.stderr.write(
        `No successful ${format} report for ${target.id}.\n`,
      );
    }
  }

  await writeFile(
    path.join(outputDirectory, "run.json"),
    `${JSON.stringify(
      {
        experiment: "non-production-skillspector-evaluation",
        requestedMode: mode,
        producer: {
          name: "SkillSpector",
          version: versionProbeResult.version,
          versionProbe: versionProbeResult.command,
        },
        target: { id: target.id, kind: target.kind, path: target.path },
        startedAt,
        completedAt: new Date().toISOString(),
        commands,
      },
      null,
      2,
    )}\n`,
  );
  return scanFailed;
}

function run(command, args, mirror = false) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (mirror) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (mirror) process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        resolve({ exitCode: null, signal: null, error, stdout, stderr });
      }
    });
    child.on("close", (exitCode, signal) => {
      if (!settled) {
        settled = true;
        resolve({ exitCode, signal, error: undefined, stdout, stderr });
      }
    });
  });
}

function fail(message) {
  process.stderr.write(`SkillSpector experiment: ${message}\n`);
  process.exit(1);
}
