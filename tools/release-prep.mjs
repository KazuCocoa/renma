#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const RELEASE_FILES = ["package.json", "package-lock.json", "CHANGELOG.md"];

const args = process.argv.slice(2);
if (!existsSync("package.json")) {
  throw new Error("Run this script from the repository root.");
}

const options = parseArgs(args);

if (options.help) {
  printHelp();
  process.exit(0);
}

const version = options.version ?? readPackageVersion();
const base = options.from ?? latestVersionTag(version);
const target = options.to ?? "HEAD";
const tag = `v${version}`;
const finalize = options.finalize === true;

const checks = [];

checks.push(check("package.json version", readPackageVersion() === version));
checks.push(check("package-lock.json version", readLockVersion() === version));
checks.push(check("CHANGELOG section", changelogHasVersion(version)));
checks.push(
  check("CHANGELOG compare link", changelogHasCompareLink(version, base)),
);

if (base) {
  checks.push(check("base tag exists", gitOk(["rev-parse", "--verify", base])));
}

if (finalize) {
  checks.push(...releaseFinalizationChecks(RELEASE_FILES, tag));
}

const commands = [
  ["npm", ["test"]],
  ["npm", ["run", "build"]],
  ["node", ["dist/index.js", "scan", ".", "--fail-on", "high"]],
  ["node", ["dist/index.js", "catalog", ".", "--format", "markdown"]],
  ["node", ["dist/index.js", "readiness", ".", "--format", "markdown"]],
  [
    "node",
    [
      "dist/index.js",
      "graph",
      ".",
      "--focus",
      "skill.release-prep",
      "--format",
      "mermaid",
    ],
  ],
];

if (base) {
  commands.push([
    "node",
    [
      "dist/index.js",
      "diff",
      ".",
      "--from",
      base,
      "--to",
      target,
      "--format",
      "markdown",
    ],
  ]);
  commands.push([
    "node",
    [
      "dist/index.js",
      "ci-report",
      ".",
      "--from",
      base,
      "--to",
      target,
      "--format",
      "markdown",
    ],
  ]);
}

const failedChecks = checks.filter((item) => !item.ok);

printSummary({ version, base, target, tag, finalize, checks, commands });

if (options.checkOnly) {
  process.exit(failedChecks.length === 0 ? 0 : 1);
}

if (failedChecks.length > 0) {
  process.exit(1);
}

for (const [command, commandArgs] of commands) {
  run(command, commandArgs);
}

if (finalize) {
  ensureReleaseFinalizationReady(RELEASE_FILES, tag);
  run("git", ["add", ...RELEASE_FILES]);
  run("git", ["commit", "-m", version]);
  run("git", ["tag", "-a", tag, "-m", version]);
}

function parseArgs(input) {
  const parsed = {
    checkOnly: false,
    finalize: false,
    help: false,
    version: undefined,
    from: undefined,
    to: undefined,
  };

  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--check-only") parsed.checkOnly = true;
    else if (arg === "--finalize") parsed.finalize = true;
    else if (arg === "--version")
      parsed.version = requiredValue(input, ++index, arg);
    else if (arg === "--from") parsed.from = requiredValue(input, ++index, arg);
    else if (arg === "--to") parsed.to = requiredValue(input, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function requiredValue(input, index, flag) {
  const value = input[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readPackageVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function readLockVersion() {
  return JSON.parse(readFileSync("package-lock.json", "utf8")).version;
}

function changelogHasVersion(releaseVersion) {
  return readFileSync("CHANGELOG.md", "utf8").includes(
    `## [${releaseVersion}]`,
  );
}

function changelogHasCompareLink(releaseVersion, baseTag) {
  if (!baseTag) return true;
  return readFileSync("CHANGELOG.md", "utf8").includes(
    `[${releaseVersion}]: https://github.com/KazuCocoa/renma/compare/${baseTag}...v${releaseVersion}`,
  );
}

function latestVersionTag(releaseVersion) {
  const result = spawnSync("git", ["tag", "--sort=-creatordate"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return undefined;
  const currentTag = `v${releaseVersion}`;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^v\d+\.\d+\.\d+/.test(line) && line !== currentTag);
}

function releaseFinalizationChecks(allowedFiles, releaseTag) {
  return [
    check("tag is absent", !gitOk(["rev-parse", "--verify", releaseTag])),
    check(
      "only release files changed",
      workingTreeContainsOnlyAllowedChanges(allowedFiles),
    ),
    check("release files have changes", releaseFilesHaveChanges(allowedFiles)),
  ];
}

function ensureReleaseFinalizationReady(allowedFiles, releaseTag) {
  const failed = releaseFinalizationChecks(allowedFiles, releaseTag).filter(
    (item) => !item.ok,
  );

  if (failed.length === 0) return;

  console.error("\nRelease finalization stopped before staging files.");
  for (const item of failed) {
    console.error(`- FAIL ${item.label}`);
  }
  process.exit(1);
}

function workingTreeContainsOnlyAllowedChanges(allowedFiles) {
  const allowed = new Set(allowedFiles);
  const status = gitStatusPaths();
  return status.ok && status.paths.every((item) => allowed.has(item));
}

function releaseFilesHaveChanges(allowedFiles) {
  const allowed = new Set(allowedFiles);
  const status = gitStatusPaths();
  return status.ok && status.paths.some((item) => allowed.has(item));
}

function gitStatusPaths() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" },
  );

  if (result.status !== 0) return { ok: false, paths: [] };

  return {
    ok: true,
    paths: result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => parseStatusPaths(line)),
  };
}

function parseStatusPaths(line) {
  const pathPart = line.slice(3).trim();
  if (!pathPart.includes(" -> ")) return [unquoteStatusPath(pathPart)];
  return pathPart.split(" -> ").map((item) => unquoteStatusPath(item));
}

function unquoteStatusPath(pathName) {
  if (!pathName.startsWith('"') || !pathName.endsWith('"')) return pathName;
  try {
    return JSON.parse(pathName);
  } catch {
    return pathName;
  }
}

function gitOk(commandArgs) {
  return spawnSync("git", commandArgs, { stdio: "ignore" }).status === 0;
}

function check(label, ok) {
  return { label, ok };
}

function run(command, commandArgs) {
  const rendered = [command, ...commandArgs].join(" ");
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printSummary(input) {
  console.log(`# Release prep`);
  console.log(`Version: ${input.version}`);
  console.log(`Base: ${input.base ?? "(none)"}`);
  console.log(`Target: ${input.target}`);
  console.log(`Tag: ${input.tag}`);
  console.log(`Finalize: ${input.finalize ? "yes" : "no"}`);
  console.log("\n## Preconditions");
  for (const item of input.checks) {
    console.log(`- ${item.ok ? "PASS" : "FAIL"} ${item.label}`);
  }
  console.log("\n## Commands");
  for (const [command, commandArgs] of input.commands) {
    console.log(`- ${[command, ...commandArgs].join(" ")}`);
  }
}

function printHelp() {
  console.log(`Usage: node tools/release-prep.mjs [options]

Options:
  --version <version>  Release version. Defaults to package.json version.
  --from <tag>         Base tag. Defaults to latest v* tag.
  --to <ref>           Target ref for Renma diff reports. Defaults to HEAD.
  --check-only         Check metadata consistency without running commands.
  --finalize           After validation, stage release files and create local version commit/tag.
  --help               Show this help.
`);
}
