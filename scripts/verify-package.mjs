import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGE_NAME = "renma";
const PACKAGE_JSON_SPECIFIER = "renma/package.json";
const REPOSITORY_ONLY_README_PREFIXES = ["docs/development/"];
const PUBLIC_DEEP_IMPORTS = [
  ["renma/dist/types.js", "dist/types.js", "dist/types.d.ts"],
  [
    "renma/dist/types/artifact.js",
    "dist/types/artifact.js",
    "dist/types/artifact.d.ts",
  ],
  [
    "renma/dist/types/classification.js",
    "dist/types/classification.js",
    "dist/types/classification.d.ts",
  ],
  [
    "renma/dist/types/configuration.js",
    "dist/types/configuration.js",
    "dist/types/configuration.d.ts",
  ],
  [
    "renma/dist/types/decision.js",
    "dist/types/decision.js",
    "dist/types/decision.d.ts",
  ],
  [
    "renma/dist/types/diagnostics.js",
    "dist/types/diagnostics.js",
    "dist/types/diagnostics.d.ts",
  ],
  [
    "renma/dist/types/governance.js",
    "dist/types/governance.js",
    "dist/types/governance.d.ts",
  ],
  [
    "renma/dist/types/metadata.js",
    "dist/types/metadata.js",
    "dist/types/metadata.d.ts",
  ],
  [
    "renma/dist/types/scan-result.js",
    "dist/types/scan-result.js",
    "dist/types/scan-result.d.ts",
  ],
  ["renma/dist/discovery.js", "dist/discovery.js", "dist/discovery.d.ts"],
  [
    "renma/dist/commands/inspect.js",
    "dist/commands/inspect.js",
    "dist/commands/inspect.d.ts",
  ],
  [
    "renma/dist/commands/skill-index.js",
    "dist/commands/skill-index.js",
    "dist/commands/skill-index.d.ts",
  ],
  [
    "renma/dist/commands/guide.js",
    "dist/commands/guide.js",
    "dist/commands/guide.d.ts",
  ],
  [
    "renma/dist/guidance/skill-authoring.js",
    "dist/guidance/skill-authoring.js",
    "dist/guidance/skill-authoring.d.ts",
  ],
  [
    "renma/dist/renderers/guide.js",
    "dist/renderers/guide.js",
    "dist/renderers/guide.d.ts",
  ],
  [
    "renma/dist/commands/suggest-metadata.js",
    "dist/commands/suggest-metadata.js",
    "dist/commands/suggest-metadata.d.ts",
  ],
  [
    "renma/dist/skill-migration.js",
    "dist/skill-migration.js",
    "dist/skill-migration.d.ts",
  ],
];
const PRIVATE_BODY_POLICY_SPECIFIERS = [
  "renma/dist/security-body-policy/clause-facts.js",
  "renma/dist/security-body-policy/model.js",
  "renma/dist/security-body-policy/lexical-recognition.js",
  "renma/dist/security-body-policy/statement-components.js",
  "renma/dist/security-body-policy/statement-state.js",
  "renma/dist/security-body-policy/fact-projection.js",
  "renma/dist/security-body-policy/policy-context.js",
];
const PRIVATE_EXECUTABLE_SURFACE_SPECIFIERS = [
  "renma/dist/helper-command-evidence.js",
  "renma/dist/executable-dependency-analyzer.js",
  "renma/dist/executable-dependency-js-ts.js",
  "renma/dist/executable-dependency-python.js",
  "renma/dist/executable-dependency-resolution.js",
  "renma/dist/executable-surface-inventory.js",
  "renma/dist/executable-surface-diff.js",
];
const PRIVATE_PACKAGE_SPECIFIERS = [
  ...PRIVATE_BODY_POLICY_SPECIFIERS,
  ...PRIVATE_EXECUTABLE_SURFACE_SPECIFIERS,
];
const CLI_ONLY_PACKAGE_SPECIFIERS = ["renma", "renma/dist/index.js"];
const PUBLIC_MODULE_IMPORTS = [...PUBLIC_DEEP_IMPORTS];
const PRIVATE_DECLARATION_SPECIFIERS = [
  ...PRIVATE_PACKAGE_SPECIFIERS,
  ...PRIVATE_PACKAGE_SPECIFIERS.map((specifier) =>
    specifier.replace(/\.js$/u, ".d.ts"),
  ),
];
const CLI_ONLY_DECLARATION_SPECIFIERS = [...CLI_ONLY_PACKAGE_SPECIFIERS];

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
    "dist/index.d.ts",
    ...PUBLIC_MODULE_IMPORTS.flatMap(([, modulePath, declarationPath]) => [
      modulePath,
      declarationPath,
    ]),
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
    if (isRepositoryOnlyReadmeTarget(target)) {
      await requireRepositoryPath(target);
      continue;
    }
    requirePackagedPath(files, target);
  }

  for (const forbiddenPrefix of [
    "node_modules/",
    "dist-test/",
    "test/",
    "src/",
    "examples/",
    "coverage/",
    "docs/development/",
    ".git/",
  ]) {
    if ([...files].some((file) => file.startsWith(forbiddenPrefix))) {
      throw new Error(`Package unexpectedly includes ${forbiddenPrefix}`);
    }
  }
  for (const forbidden of [
    "plan.md",
    "plan-discovery.md",
    "npm-debug.log",
    "scripts/verify-release-tag.mjs",
  ]) {
    if (files.has(forbidden)) {
      throw new Error(`Package unexpectedly includes ${forbidden}`);
    }
  }
  const generatedSourceMap = [...files].find((file) =>
    file.endsWith(".js.map"),
  );
  if (generatedSourceMap) {
    throw new Error(
      `Package unexpectedly includes generated source map ${generatedSourceMap}`,
    );
  }

  const tarballPath = path.resolve(packDirectory, report.filename);
  const packageRoot = await installInTemporaryConsumer(
    consumerDirectory,
    tarballPath,
    cacheDirectory,
  );
  await verifyInstalledExports(packageRoot);
  await verifyInspectDeclarationCompatibility(packageRoot);
  await verifyPackageSpecifierPolicy(consumerDirectory);
  await verifyPackageSpecifierDeclarations(consumerDirectory);
  verifyPackagedCli(consumerDirectory);

  process.stdout.write(
    `Verified ${files.size} packaged files, ${PUBLIC_MODULE_IMPORTS.length + 1} supported package specifiers, ${PUBLIC_MODULE_IMPORTS.length} supported declaration paths, ${PRIVATE_PACKAGE_SPECIFIERS.length} private module subpaths, ${PRIVATE_DECLARATION_SPECIFIERS.length} private declaration paths, ${CLI_ONLY_PACKAGE_SPECIFIERS.length} CLI-only module paths, CLI behavior, inspect declaration compatibility, and every README-relative target.\n`,
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

async function verifyInstalledExports(packageRoot) {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  if (packageJson.bin?.renma !== "./dist/index.js") {
    throw new Error("Installed package changed the Renma CLI entrypoint.");
  }
  const exportsMap = packageJson.exports;
  if (
    exportsMap === null ||
    typeof exportsMap !== "object" ||
    Array.isArray(exportsMap)
  ) {
    throw new Error("Installed package has no explicit exports map.");
  }

  const expectedKeys = new Set([
    packageExportKey(PACKAGE_JSON_SPECIFIER),
    ...PUBLIC_DEEP_IMPORTS.map(([specifier]) => packageExportKey(specifier)),
  ]);
  assertSameStrings(
    Object.keys(exportsMap),
    [...expectedKeys],
    "Installed package exports changed",
  );

  for (const [specifier, modulePath, declarationPath] of [
    ...PUBLIC_MODULE_IMPORTS,
  ]) {
    const exported = exportsMap[packageExportKey(specifier)];
    if (
      exported?.types !== `./${declarationPath}` ||
      exported?.import !== `./${modulePath}` ||
      exported?.default !== `./${modulePath}`
    ) {
      throw new Error(
        `Installed package has an invalid export for ${specifier}`,
      );
    }
  }

  for (const specifier of PRIVATE_PACKAGE_SPECIFIERS) {
    if (packageExportKey(specifier) in exportsMap) {
      throw new Error(`Private package path is exported: ${specifier}`);
    }
  }
}

async function verifyPackageSpecifierPolicy(consumerDirectory) {
  const verificationScript = path.join(
    consumerDirectory,
    "verify-package-specifiers.mjs",
  );
  await writeFile(
    verificationScript,
    `const publicImports = ${JSON.stringify(
      PUBLIC_MODULE_IMPORTS.map(([specifier]) => specifier),
    )};
const privateImports = ${JSON.stringify(PRIVATE_PACKAGE_SPECIFIERS)};
const cliOnlyImports = ${JSON.stringify(CLI_ONLY_PACKAGE_SPECIFIERS)};

for (const specifier of publicImports) {
  try {
    await import(specifier);
  } catch (error) {
    throw new Error(\`Public package import failed for \${specifier}: \${error instanceof Error ? error.message : String(error)}\`, { cause: error });
  }
}

const packageMetadata = await import(${JSON.stringify(PACKAGE_JSON_SPECIFIER)}, {
  with: { type: "json" },
});
if (packageMetadata.default?.name !== ${JSON.stringify(PACKAGE_NAME)}) {
  throw new Error("Public package metadata import did not resolve Renma package.json");
}

for (const specifier of privateImports) {
  let rejected = false;
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      throw new Error(\`Private package import failed with \${error?.code ?? "no error code"} instead of ERR_PACKAGE_PATH_NOT_EXPORTED for \${specifier}\`, { cause: error });
    }
    rejected = true;
  }
  if (!rejected) {
    throw new Error(\`Private package import unexpectedly succeeded for \${specifier}\`);
  }
}

for (const specifier of cliOnlyImports) {
  let rejected = false;
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      throw new Error(\`CLI-only package import failed with \${error?.code ?? "no error code"} instead of ERR_PACKAGE_PATH_NOT_EXPORTED for \${specifier}\`, { cause: error });
    }
    rejected = true;
  }
  if (!rejected) {
    throw new Error(\`CLI-only package import unexpectedly succeeded for \${specifier}\`);
  }
}
`,
  );
  const verified = spawnSync(process.execPath, [verificationScript], {
    cwd: consumerDirectory,
    encoding: "utf8",
  });
  if (verified.error) {
    throw new Error(
      `Package-specifier verification failed: ${verified.error.message}`,
    );
  }
  if (verified.status !== 0) {
    throw new Error(
      `Package-specifier verification failed: ${verified.stderr.trim() || `node exited with code ${verified.status}`}`,
    );
  }
}

async function verifyPackageSpecifierDeclarations(consumerDirectory) {
  const verificationSource = path.join(
    consumerDirectory,
    "verify-package-declarations.ts",
  );
  await writeFile(
    verificationSource,
    `${PUBLIC_MODULE_IMPORTS.map(
      ([specifier], index) =>
        `type PublicDeepImport${index} = typeof import(${JSON.stringify(specifier)});`,
    ).join("\n")}
export {};
`,
  );
  const typescriptBin = path.resolve("node_modules/typescript/bin/tsc");
  const verified = spawnSync(
    process.execPath,
    [
      typescriptBin,
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      verificationSource,
    ],
    { cwd: consumerDirectory, encoding: "utf8" },
  );
  if (verified.error) {
    throw new Error(
      `Package declaration verification failed: ${verified.error.message}`,
    );
  }
  if (verified.status !== 0) {
    throw new Error(
      `Package declaration verification failed: ${verified.stderr.trim() || verified.stdout.trim() || `tsc exited with code ${verified.status}`}`,
    );
  }

  await verifyPrivatePackageSpecifierDeclarations(consumerDirectory);
  await verifyCliOnlyPackageSpecifierDeclarations(consumerDirectory);
}

async function verifyPrivatePackageSpecifierDeclarations(consumerDirectory) {
  const verificationSource = path.join(
    consumerDirectory,
    "verify-private-package-declarations.ts",
  );
  await writeFile(
    verificationSource,
    `${PRIVATE_DECLARATION_SPECIFIERS.map(
      (specifier, index) =>
        `type PrivatePackageImport${index} = typeof import(${JSON.stringify(specifier)});`,
    ).join("\n")}
export {};
`,
  );
  const typescriptBin = path.resolve("node_modules/typescript/bin/tsc");
  const verified = spawnSync(
    process.execPath,
    [
      typescriptBin,
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      verificationSource,
    ],
    { cwd: consumerDirectory, encoding: "utf8" },
  );
  if (verified.error) {
    throw new Error(
      `Private package declaration verification failed: ${verified.error.message}`,
    );
  }
  if (verified.status === 0) {
    throw new Error(
      "Private package declaration verification unexpectedly succeeded.",
    );
  }
  const diagnostics = `${verified.stdout}\n${verified.stderr}`;
  for (const specifier of PRIVATE_DECLARATION_SPECIFIERS) {
    if (
      !diagnostics.includes(`error TS2307: Cannot find module '${specifier}'`)
    ) {
      throw new Error(
        `Private package declaration did not fail with TS2307 for ${specifier}: ${diagnostics.trim()}`,
      );
    }
  }
}

async function verifyCliOnlyPackageSpecifierDeclarations(consumerDirectory) {
  const verificationSource = path.join(
    consumerDirectory,
    "verify-cli-only-package-declarations.ts",
  );
  await writeFile(
    verificationSource,
    `${CLI_ONLY_DECLARATION_SPECIFIERS.map(
      (specifier, index) =>
        `type CliOnlyPackageImport${index} = typeof import(${JSON.stringify(specifier)});`,
    ).join("\n")}
export {};
`,
  );
  const typescriptBin = path.resolve("node_modules/typescript/bin/tsc");
  const verified = spawnSync(
    process.execPath,
    [
      typescriptBin,
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      verificationSource,
    ],
    { cwd: consumerDirectory, encoding: "utf8" },
  );
  if (verified.error) {
    throw new Error(
      `CLI-only package declaration verification failed: ${verified.error.message}`,
    );
  }
  if (verified.status === 0) {
    throw new Error(
      "CLI-only package declaration verification unexpectedly succeeded.",
    );
  }
  const diagnostics = `${verified.stdout}\n${verified.stderr}`;
  for (const specifier of CLI_ONLY_DECLARATION_SPECIFIERS) {
    if (
      !diagnostics.includes(`error TS2307: Cannot find module '${specifier}'`)
    ) {
      throw new Error(
        `CLI-only package declaration did not fail with TS2307 for ${specifier}: ${diagnostics.trim()}`,
      );
    }
  }
}

function verifyPackagedCli(consumerDirectory) {
  const binaryName = process.platform === "win32" ? "renma.cmd" : "renma";
  const binaryPath = path.join(
    consumerDirectory,
    "node_modules",
    ".bin",
    binaryName,
  );
  const verified = spawnSync(binaryPath, ["--help"], {
    cwd: consumerDirectory,
    encoding: "utf8",
  });
  if (verified.error) {
    throw new Error(`Packaged CLI failed: ${verified.error.message}`);
  }
  if (
    verified.status !== 0 ||
    !/^renma \d+\.\d+\.\d+/u.test(verified.stdout) ||
    !verified.stdout.includes("Renma provides deterministic repository")
  ) {
    throw new Error(
      `Packaged CLI help failed: ${verified.stderr.trim() || verified.stdout.trim() || `exit code ${verified.status}`}`,
    );
  }
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

function packageExportKey(specifier) {
  const prefix = `${PACKAGE_NAME}/`;
  if (!specifier.startsWith(prefix)) {
    throw new Error(`Package specifier has an unexpected name: ${specifier}`);
  }
  return `./${specifier.slice(prefix.length)}`;
}

function assertSameStrings(actual, expected, message) {
  const actualOrdered = [...actual].sort();
  const expectedOrdered = [...expected].sort();
  if (
    actualOrdered.length !== expectedOrdered.length ||
    actualOrdered.some((value, index) => value !== expectedOrdered[index])
  ) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expectedOrdered)}, received ${JSON.stringify(actualOrdered)}`,
    );
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

function isRepositoryOnlyReadmeTarget(target) {
  const normalized = path.posix.normalize(target).replace(/^\.\//, "");
  return REPOSITORY_ONLY_README_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

async function requireRepositoryPath(target) {
  const normalized = path.posix.normalize(target).replace(/^\.\//, "");
  try {
    await lstat(normalized);
  } catch {
    throw new Error(`Repository-only README target is missing: ${target}`);
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
