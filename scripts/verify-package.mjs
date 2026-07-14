import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const cache = await mkdtemp(path.join(os.tmpdir(), "renma-npm-pack-"));

try {
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--cache", cache, "--pack-destination", cache],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (packed.error) throw packed.error;
  if (packed.status !== 0) {
    throw new Error(packed.stderr.trim() || "npm pack failed.");
  }

  const reports = JSON.parse(packed.stdout);
  const report = reports[0];
  if (!report || !Array.isArray(report.files)) {
    throw new Error("npm pack returned no package file list.");
  }
  const files = new Set(report.files.map((file) => file.path));

  for (const required of [
    "package.json",
    "README.md",
    "dist/index.js",
    "dist/types.js",
    "dist/types.d.ts",
    "dist/discovery.js",
    "dist/discovery.d.ts",
    "dist/commands/inspect.js",
    "dist/commands/inspect.d.ts",
    "dist/commands/suggest-metadata.js",
    "dist/commands/suggest-metadata.d.ts",
    "dist/skill-migration.js",
    "dist/skill-migration.d.ts",
    "docs/internal-architecture.md",
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

  const packageRoot = await extractPackage(cache, report.filename);
  await verifyInspectDeclarationCompatibility(packageRoot);
  for (const modulePath of [
    "dist/commands/inspect.js",
    "dist/commands/suggest-metadata.js",
    "dist/discovery.js",
    "dist/skill-migration.js",
  ]) {
    await import(pathToFileURL(path.join(packageRoot, modulePath)).href);
  }

  process.stdout.write(
    `Verified ${files.size} packaged files, deep imports, inspect declarations, and every README-relative target.\n`,
  );
} finally {
  await rm(cache, { recursive: true, force: true });
}

async function extractPackage(cache, filename) {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack returned no package filename.");
  }
  const unpacked = path.join(cache, "unpacked");
  await mkdir(unpacked, { recursive: true });
  const extracted = spawnSync(
    "tar",
    ["-xzf", path.join(cache, filename), "-C", unpacked],
    { encoding: "utf8" },
  );
  if (extracted.error) throw extracted.error;
  if (extracted.status !== 0) {
    throw new Error(
      extracted.stderr.trim() || "Could not extract npm package.",
    );
  }
  const packageRoot = path.join(unpacked, "package");
  await symlink(
    path.resolve("node_modules"),
    path.join(packageRoot, "node_modules"),
  );
  return packageRoot;
}

async function verifyInspectDeclarationCompatibility(packageRoot) {
  const declarations = await readFile(
    path.join(packageRoot, "dist/commands/inspect.d.ts"),
    "utf8",
  );
  for (const typeName of [
    "InspectOutline",
    "InspectAssetSummary",
    "InspectRelationship",
    "InspectRelationshipChain",
    "InspectSlice",
  ]) {
    const declared = new RegExp(
      `export\\s+(?:interface|type)\\s+${typeName}\\b`,
    ).test(declarations);
    const reexported = new RegExp(
      `export\\s+type\\s*\\{[\\s\\S]*?\\b${typeName}\\b[\\s\\S]*?\\}\\s*from`,
    ).test(declarations);
    if (!declared && !reexported) {
      throw new Error(
        `dist/commands/inspect.d.ts no longer exports ${typeName}.`,
      );
    }
  }
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
