import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "renma package verification-"),
);
const packDirectory = path.join(temporaryRoot, "packed artifact");
const consumerDirectory = path.join(temporaryRoot, "clean consumer");
const cacheDirectory = path.join(temporaryRoot, "npm cache");

try {
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  const packed = spawnSync(
    "npm",
    [
      "pack",
      "--json",
      "--cache",
      cacheDirectory,
      "--pack-destination",
      packDirectory,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (packed.error) {
    throw new Error(`npm pack failed: ${packed.error.message}`);
  }
  if (packed.status !== 0) {
    throw new Error(
      `npm pack failed: ${packed.stderr.trim() || `exit code ${packed.status}`}`,
    );
  }

  let reports;
  try {
    reports = JSON.parse(packed.stdout);
  } catch {
    throw new Error("npm pack failed: npm returned invalid JSON output.");
  }
  const report = reports[0];
  if (!report || !Array.isArray(report.files)) {
    throw new Error("npm pack returned no package file list.");
  }
  if (typeof report.filename !== "string" || report.filename.length === 0) {
    throw new Error("npm pack returned no tarball filename.");
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
    "dist/commands/skill-index.js",
    "dist/commands/skill-index.d.ts",
    "dist/commands/guide.js",
    "dist/commands/guide.d.ts",
    "dist/guidance/skill-authoring.js",
    "dist/guidance/skill-authoring.d.ts",
    "dist/renderers/guide.js",
    "dist/renderers/guide.d.ts",
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

  const tarballPath = path.resolve(packDirectory, report.filename);
  const packageRoot = await installInTemporaryConsumer(
    consumerDirectory,
    tarballPath,
    cacheDirectory,
  );
  await verifyInspectDeclarationCompatibility(packageRoot);
  for (const modulePath of [
    "dist/commands/guide.js",
    "dist/commands/inspect.js",
    "dist/commands/skill-index.js",
    "dist/commands/suggest-metadata.js",
    "dist/discovery.js",
    "dist/skill-migration.js",
  ]) {
    try {
      await import(pathToFileURL(path.join(packageRoot, modulePath)).href);
    } catch (error) {
      throw new Error(
        `Deep import failed for ${modulePath}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  process.stdout.write(
    `Verified ${files.size} packaged files, deep imports, inspect declarations, and every README-relative target.\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function installInTemporaryConsumer(
  consumerDirectory,
  tarballPath,
  cacheDirectory,
) {
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "renma-package-verification",
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  const installed = spawnSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--cache",
      cacheDirectory,
      tarballPath,
    ],
    { cwd: consumerDirectory, encoding: "utf8" },
  );
  if (installed.error) {
    throw new Error(
      `Temporary consumer installation failed: ${installed.error.message}`,
    );
  }
  if (installed.status !== 0) {
    throw new Error(
      `Temporary consumer installation failed: ${installed.stderr.trim() || `npm exited with code ${installed.status}`}`,
    );
  }
  const packageRoot = path.join(consumerDirectory, "node_modules", "renma");
  try {
    await readFile(path.join(packageRoot, "package.json"), "utf8");
  } catch (error) {
    throw new Error(
      `Temporary consumer installation failed: installed renma package is missing (${errorMessage(error)}).`,
      { cause: error },
    );
  }
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
