import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { main } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import { securityProfileChain } from "../src/security-policy.js";
import type { Artifact } from "../src/types/artifact.js";
import type {
  SecurityConfig,
  SecurityProfileConfig,
} from "../src/types/configuration.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

const PROTOTYPE_PROPERTY_NAMES = [
  "toString",
  "constructor",
  "hasOwnProperty",
  "valueOf",
  "__proto__",
] as const;

const EMPTY_SECURITY_CONFIG: SecurityConfig = {
  approvedDomains: [],
  approvedUploadDomains: [],
  disallowedCommands: [],
  profiles: {},
};

test("profile lookup treats Object prototype properties as missing", () => {
  for (const name of PROTOTYPE_PROPERTY_NAMES) {
    assert.deepEqual(securityProfileChain(name, EMPTY_SECURITY_CONFIG), {
      profiles: [],
      missingProfile: name,
    });
  }
});

test("prototype-safe profile lookup preserves inheritance failure modes", () => {
  const profiles = Object.create(null) as Record<string, SecurityProfileConfig>;
  profiles.parent = profile({ networkAllowed: false });
  profiles.child = profile({ securityProfile: "parent" });
  profiles.orphan = profile({ securityProfile: "missing-parent" });
  profiles.a = profile({ securityProfile: "b" });
  profiles.b = profile({ securityProfile: "a" });
  const config = { ...EMPTY_SECURITY_CONFIG, profiles };

  assert.deepEqual(
    securityProfileChain("child", config).profiles.map((item) => item.name),
    ["parent", "child"],
  );
  assert.deepEqual(securityProfileChain("orphan", config), {
    profiles: [],
    missingProfile: "missing-parent",
  });
  assert.deepEqual(securityProfileChain("a", config), {
    profiles: [],
    cycle: ["a", "b", "a"],
  });
});

test("config normalization stores prototype-property profile names safely", async (t) => {
  const root = await repositoryFixture(t);
  const authoredProfiles = Object.fromEntries(
    PROTOTYPE_PROPERTY_NAMES.map((name) => [
      name,
      { allowed_data: ["public"] },
    ]),
  );
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ security: { profiles: authoredProfiles } }, null, 2)}\n`,
  );

  const loaded = await loadConfig(root, {});
  const profiles = loaded.config.security.profiles;
  assert.ok(profiles);
  assert.equal(Object.getPrototypeOf(profiles), null);
  assert.deepEqual(Object.keys(profiles), [...PROTOTYPE_PROPERTY_NAMES]);
  for (const name of PROTOTYPE_PROPERTY_NAMES) {
    assert.equal(Object.hasOwn(profiles, name), true);
    assert.deepEqual(profiles[name]?.allowedData, ["public"]);
    assert.deepEqual(
      securityProfileChain(name, loaded.config.security).profiles.map(
        (item) => item.name,
      ),
      [name],
    );
  }
});

test("security diagnostics report every prototype-property reference as missing", () => {
  for (const [index, name] of PROTOTYPE_PROPERTY_NAMES.entries()) {
    const findings = securityDiagnosticFindings(
      [profileArtifact(index, name)],
      { security: EMPTY_SECURITY_CONFIG },
    );
    assert.equal(
      findings.filter(
        (finding) => finding.id === "SEC-POLICY-PROFILE-NOT-FOUND",
      ).length,
      1,
      name,
    );
  }
});

test("JSON and strict CLI scans return complete structured missing-profile results", async (t) => {
  const root = await repositoryFixture(t);
  const contextDirectory = path.join(root, "contexts", "prototype-profiles");
  await mkdir(contextDirectory, { recursive: true });
  await writeFile(
    path.join(root, "renma.config.json"),
    `${JSON.stringify({ security: { profiles: {} } }, null, 2)}\n`,
  );
  for (const [index, name] of PROTOTYPE_PROPERTY_NAMES.entries()) {
    await writeFile(
      path.join(contextDirectory, `${index}.md`),
      `---\nid: prototype-profile-${index}\nowner: security\nstatus: stable\nsecurity_profile: ${JSON.stringify(name)}\n---\n# Prototype profile ${index}\n\nUse this reviewed context for deterministic profile lookup validation.\n`,
    );
  }

  for (const args of [
    ["scan", root, "--json", "--fail-on", "high"],
    ["scan", root, "--json", "--fail-on", "high", "--strict"],
  ]) {
    const result = await captureProcessOutput(() => main(args));
    assert.equal(result.code, 1, args.join(" "));
    assert.equal(result.stderr, "", args.join(" "));
    const document = JSON.parse(result.stdout) as Record<string, unknown> & {
      diagnostics: Array<{
        code: string;
        location?: { path?: string };
      }>;
    };
    assert.equal(document.schemaVersion, "renma.scan.v2");
    assert.equal(document.format, "json");
    assert.equal(document.scannedFileCount, PROTOTYPE_PROPERTY_NAMES.length);
    assert.ok(Array.isArray(document.diagnostics));
    assert.ok(Array.isArray(document.suppressedDiagnostics));
    assert.equal(typeof document.inspectionCoverage, "object");
    assert.equal(typeof document.securityAnalysisCoverage, "object");
    assert.equal(typeof document.securityPolicyInventory, "object");
    assert.deepEqual(
      document.diagnostics
        .filter(
          (diagnostic) => diagnostic.code === "SEC-POLICY-PROFILE-NOT-FOUND",
        )
        .map((diagnostic) => diagnostic.location?.path),
      PROTOTYPE_PROPERTY_NAMES.map(
        (_, index) => `contexts/prototype-profiles/${index}.md`,
      ),
    );
  }
});

function profile(
  overrides: Partial<SecurityProfileConfig> = {},
): SecurityProfileConfig {
  return {
    allowedData: [],
    forbiddenInputs: [],
    approvedDomains: [],
    approvedUploadDomains: [],
    disallowedCommands: [],
    ...overrides,
  };
}

function profileArtifact(index: number, name: string): Artifact {
  const artifactPath = `skills/prototype-${index}/SKILL.md`;
  const content = canonicalSkillFixture(
    artifactPath,
    `---\nsecurity_profile: ${JSON.stringify(name)}\n---\n\nValidate the configured security boundary.`,
  );
  return {
    path: artifactPath,
    absolutePath: `/repo/${artifactPath}`,
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

async function repositoryFixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "renma-profile-prototype-safety-"),
  );
  await mkdir(path.join(root, ".git"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function captureProcessOutput(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
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
