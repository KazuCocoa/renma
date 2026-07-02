#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const RELEASE_FILES = ["package.json", "package-lock.json", "CHANGELOG.md"];
const REPOSITORY_URL = "https://github.com/KazuCocoa/renma";

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
const base =
  options.from ?? changelogBaseTag(version) ?? latestVersionTag(version);
const target = options.to ?? "HEAD";
const tag = `v${version}`;
const finalize = options.finalize === true;

if (options.releaseNotes) {
  console.log(buildReleaseNotes({ version, base, target }));
  process.exit(0);
}

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
    releaseNotes: false,
    version: undefined,
    from: undefined,
    to: undefined,
  };

  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--check-only") parsed.checkOnly = true;
    else if (arg === "--finalize") parsed.finalize = true;
    else if (arg === "--release-notes") parsed.releaseNotes = true;
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

function changelogSection(releaseVersion) {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const heading = new RegExp(
    `^## \\[${escapeRegExp(releaseVersion)}\\](?: - .*)?$`,
    "m",
  );
  const match = changelog.match(heading);
  if (!match || match.index === undefined) {
    throw new Error(
      `CHANGELOG.md does not contain a ${releaseVersion} section.`,
    );
  }

  const start = match.index + match[0].length;
  const nextHeading = changelog.slice(start).search(/\n## \[/);
  return nextHeading === -1
    ? changelog.slice(start).trim()
    : changelog.slice(start, start + nextHeading).trim();
}

function changelogBaseTag(releaseVersion) {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const pattern = new RegExp(
    `^\\[${escapeRegExp(releaseVersion)}\\]: ${escapeRegExp(
      REPOSITORY_URL,
    )}/compare/(v\\d+\\.\\d+\\.\\d+(?:[-+][^\\.\\s]+)?)\\.\\.\\.v${escapeRegExp(
      releaseVersion,
    )}$`,
    "m",
  );
  return changelog.match(pattern)?.[1];
}

function changelogHasCompareLink(releaseVersion, baseTag) {
  if (!baseTag) return true;
  return readFileSync("CHANGELOG.md", "utf8").includes(
    `[${releaseVersion}]: ${REPOSITORY_URL}/compare/${baseTag}...v${releaseVersion}`,
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

function buildReleaseNotes({ version: releaseVersion, base: baseTag, target }) {
  const sections = parseChangelogSection(changelogSection(releaseVersion));
  const summary = releaseSummary(sections);
  const validationCommands = releaseValidationCommands(baseTag, target);
  const compareLine = baseTag
    ? `This release covers changes from \`${baseTag}\` to \`v${releaseVersion}\`.`
    : `This release covers changes through \`v${releaseVersion}\`.`;

  const lines = [
    `Renma v${releaseVersion} includes ${summary}.`,
    "",
    compareLine,
    "",
    "## Highlights",
    "",
  ];

  for (const [heading, items] of sections) {
    lines.push(`### ${heading}`, "");
    lines.push(...items, "");
  }

  lines.push(
    "## Upgrade",
    "",
    "```bash",
    "npm install",
    "npm run build",
    "npm test",
    "```",
    "",
    "If using the published package:",
    "",
    "```bash",
    `npm install -g renma@${releaseVersion}`,
    "```",
    "",
    "## Validation",
    "",
    "Validated with:",
    "",
    "```bash",
    ...validationCommands,
    "```",
    "",
    "## Summary",
    "",
    `v${releaseVersion} includes ${summary}.`,
  );

  return lines.join("\n");
}

function parseChangelogSection(section) {
  const parsed = [];
  let currentHeading;
  let currentItems = [];

  for (const line of section.split(/\r?\n/)) {
    const heading = line.match(/^### (.+)$/);
    if (heading) {
      if (currentHeading) parsed.push([currentHeading, currentItems]);
      currentHeading = heading[1] ?? "";
      currentItems = [];
      continue;
    }

    if (line.startsWith("- ")) {
      currentItems.push(line);
    }
  }

  if (currentHeading) parsed.push([currentHeading, currentItems]);
  if (parsed.length === 0) {
    throw new Error("CHANGELOG section does not contain release note entries.");
  }

  return parsed;
}

function releaseSummary(sections) {
  const entryCount = sections.reduce(
    (count, [, entries]) => count + entries.length,
    0,
  );
  const sectionNames = sections.map(([heading]) => heading.toLowerCase());
  const sectionText = formatList(sectionNames);

  return `${entryCount} changelog ${
    entryCount === 1 ? "entry" : "entries"
  } across ${sectionText}`;
}

function releaseValidationCommands(baseTag, target) {
  const commands = ["npm test", "npm run build"];
  commands.push("node dist/index.js scan . --fail-on high");
  commands.push("node dist/index.js catalog . --format markdown");
  commands.push("node dist/index.js readiness . --format markdown");
  commands.push(
    "node dist/index.js graph . --focus skill.release-prep --format mermaid",
  );

  if (baseTag) {
    commands.push(
      `node dist/index.js diff . --from ${baseTag} --to ${target} --format markdown`,
    );
    commands.push(
      `node dist/index.js ci-report . --from ${baseTag} --to ${target} --format markdown`,
    );
  }

  return commands;
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
  --release-notes      Print GitHub-ready release notes from CHANGELOG.md.
  --finalize           After validation, stage release files and create local version commit/tag.
  --help               Show this help.
`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatList(values) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
