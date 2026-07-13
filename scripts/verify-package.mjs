import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cache = await mkdtemp(path.join(os.tmpdir(), "renma-npm-pack-"));

try {
  const packed = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--cache", cache],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (packed.error) throw packed.error;
  if (packed.status !== 0) {
    throw new Error(packed.stderr.trim() || "npm pack --dry-run failed.");
  }

  const reports = JSON.parse(packed.stdout);
  const report = reports[0];
  if (!report || !Array.isArray(report.files)) {
    throw new Error("npm pack --dry-run returned no package file list.");
  }
  const files = new Set(report.files.map((file) => file.path));

  for (const required of [
    "package.json",
    "README.md",
    "dist/index.js",
    "docs/trust-graph.md",
    "docs/schemas/repository-context-bom-v2.schema.json",
    "docs/schemas/trust-graph-v2.schema.json",
  ]) {
    requirePackagedPath(files, required);
  }

  const readme = await readFile("README.md", "utf8");
  for (const rawTarget of markdownLinkTargets(readme)) {
    const target = repositoryRelativeTarget(rawTarget);
    if (!target) continue;
    requirePackagedPath(files, target);
  }

  for (const forbiddenPrefix of [
    "node_modules/",
    "dist-test/",
    "test/",
    "src/",
    "coverage/",
    ".git/",
  ]) {
    if ([...files].some((file) => file.startsWith(forbiddenPrefix))) {
      throw new Error(`Package unexpectedly includes ${forbiddenPrefix}`);
    }
  }
  for (const forbidden of [
    "examples/interactive-placeholder/workspace/output.txt",
    "npm-debug.log",
  ]) {
    if (files.has(forbidden)) {
      throw new Error(`Package unexpectedly includes ${forbidden}`);
    }
  }

  process.stdout.write(
    `Verified ${files.size} packaged files and every README-relative target.\n`,
  );
} finally {
  await rm(cache, { recursive: true, force: true });
}

function requirePackagedPath(files, target) {
  const normalized = path.posix.normalize(target).replace(/^\.\//, "");
  const present =
    files.has(normalized) ||
    [...files].some((file) => file.startsWith(`${normalized}/`));
  if (!present) {
    throw new Error(`Packaged README target is missing: ${target}`);
  }
}

function markdownLinkTargets(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(
    (match) => match[1]?.trim() ?? "",
  );
}

function repositoryRelativeTarget(rawTarget) {
  if (
    !rawTarget ||
    rawTarget.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
  ) {
    return undefined;
  }
  const withoutTitle = rawTarget.startsWith("<")
    ? rawTarget.slice(1, rawTarget.indexOf(">"))
    : (rawTarget.split(/\s+["']/)[0] ?? rawTarget);
  const target = decodeURIComponent(withoutTitle.split("#", 1)[0] ?? "");
  if (!target || target === ".." || target.startsWith("../")) {
    throw new Error(`README link escapes the package root: ${rawTarget}`);
  }
  return target;
}
