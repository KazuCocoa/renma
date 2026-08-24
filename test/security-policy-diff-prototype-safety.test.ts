import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import { main } from "../src/cli.js";
import { buildSecurityPolicyChanges } from "../src/security-policy-diff.js";
import { collectSecurityPolicyAssetEvidence } from "../src/security-policy-inventory.js";
import type { Artifact } from "../src/types/artifact.js";
import type {
  SecurityConfig,
  SecurityProfileConfig,
} from "../src/types/configuration.js";

const execFile = promisify(execFileCallback);

const PROTOTYPE_PROPERTY_NAMES = [
  "toString",
  "constructor",
  "hasOwnProperty",
  "valueOf",
  "__proto__",
] as const;

const DIRECTIONS = ["missing-to-configured", "configured-to-missing"] as const;

test("policy changes safely attribute prototype-property profiles in both directions", () => {
  for (const name of PROTOTYPE_PROPERTY_NAMES) {
    for (const direction of DIRECTIONS) {
      const result = buildPrototypePolicyChanges(name, direction);
      const repeated = buildPrototypePolicyChanges(name, direction);
      const source = {
        type: "security_profile" as const,
        id: name,
        path: "renma.config.json",
      };
      const affectedAsset = {
        id: `prototype.${name}`,
        path: `contexts/prototype-${encodeURIComponent(name)}.md`,
        kind: "context" as const,
      };
      const configuredAfter = direction === "missing-to-configured";

      assert.deepEqual(result, repeated, `${name} ${direction}`);
      assert.deepEqual(
        result.policyChanges[0]?.fields,
        [
          {
            kind: "scalar",
            field: "networkAllowed",
            before: configuredAfter ? null : true,
            after: configuredAfter ? true : null,
            provenance: { mode: "inherited", sources: [source] },
          },
          {
            kind: "list",
            field: "allowedData",
            added: configuredAfter ? [`profile-data:${name}`] : [],
            removed: configuredAfter ? [] : [`profile-data:${name}`],
            provenance: { mode: "inherited", sources: [source] },
          },
        ],
        `${name} ${direction}`,
      );
      assert.deepEqual(
        result.sharedPolicyChanges,
        [
          {
            source,
            changedFields: ["networkAllowed", "allowedData"],
            affectedAssets: [affectedAsset],
          },
        ],
        `${name} ${direction}`,
      );
    }
  }
});

test("diff and ci-report emit complete JSON for prototype-property profile transitions", async (t) => {
  for (const direction of DIRECTIONS) {
    await t.test(direction, async (caseContext) => {
      const repo = await prototypeTransitionRepository(caseContext, direction);
      const diffCommand = await captureProcessOutput(() =>
        main([
          "diff",
          repo,
          "--from",
          "base",
          "--to",
          "HEAD",
          "--format",
          "json",
        ]),
      );
      assert.equal(diffCommand.code, 0);
      assert.equal(diffCommand.stderr, "");
      const diffDocument = JSON.parse(diffCommand.stdout) as {
        schemaVersion: string;
        security: MachineSecurityPolicyChanges;
      };
      assert.equal(diffDocument.schemaVersion, "renma.diff.v1");
      assertCompletePrototypePolicyChanges(diffDocument.security);

      const ciCommand = await captureProcessOutput(() =>
        main([
          "ci-report",
          repo,
          "--from",
          "base",
          "--to",
          "HEAD",
          "--format",
          "json",
        ]),
      );
      assert.ok(ciCommand.code === 0 || ciCommand.code === 1);
      assert.equal(ciCommand.stderr, "");
      const ciDocument = JSON.parse(ciCommand.stdout) as {
        schemaVersion: string;
        status: string;
        diff: { security: MachineSecurityPolicyChanges };
        securityPolicy: { outcome: string; matches: unknown[] };
      };
      assert.equal(ciDocument.schemaVersion, "renma.ci-report.v1");
      assert.ok(["pass", "warn", "fail"].includes(ciDocument.status));
      assert.equal(typeof ciDocument.securityPolicy.outcome, "string");
      assert.ok(Array.isArray(ciDocument.securityPolicy.matches));
      assertCompletePrototypePolicyChanges(ciDocument.diff.security);
      assert.deepEqual(
        ciDocument.diff.security.policyChanges,
        diffDocument.security.policyChanges,
      );
      assert.deepEqual(
        ciDocument.diff.security.sharedPolicyChanges,
        diffDocument.security.sharedPolicyChanges,
      );
    });
  }
});

interface MachineSecurityPolicyChanges {
  policyChanges: Array<{
    fields: Array<{
      field: string;
      provenance: {
        mode: string;
        sources: Array<{ type: string; id: string; path?: string }>;
      };
    }>;
  }>;
  sharedPolicyChanges: Array<{
    source: { type: string; id: string; path?: string };
    changedFields: string[];
    affectedAssets: unknown[];
  }>;
}

function assertCompletePrototypePolicyChanges(
  security: MachineSecurityPolicyChanges,
): void {
  assert.equal(security.policyChanges.length, PROTOTYPE_PROPERTY_NAMES.length);
  for (const change of security.policyChanges) {
    assert.deepEqual(
      change.fields.map((field) => field.field),
      ["networkAllowed", "allowedData"],
    );
    for (const field of change.fields) {
      assert.equal(field.provenance.mode, "inherited");
      assert.equal(field.provenance.sources.length, 1);
      assert.equal(field.provenance.sources[0]?.type, "security_profile");
      assert.equal(field.provenance.sources[0]?.path, "renma.config.json");
    }
  }
  assert.deepEqual(
    security.sharedPolicyChanges.map((change) => change.source.id),
    [...PROTOTYPE_PROPERTY_NAMES].sort(),
  );
  for (const change of security.sharedPolicyChanges) {
    assert.equal(change.source.type, "security_profile");
    assert.equal(change.source.path, "renma.config.json");
    assert.deepEqual(change.changedFields, ["networkAllowed", "allowedData"]);
    assert.equal(change.affectedAssets.length, 1);
  }
}

function buildPrototypePolicyChanges(
  name: string,
  direction: (typeof DIRECTIONS)[number],
): ReturnType<typeof buildSecurityPolicyChanges> {
  const artifactPath = `contexts/prototype-${encodeURIComponent(name)}.md`;
  const input = artifact(
    artifactPath,
    `---\nsecurity_profile: ${JSON.stringify(name)}\n---\n# Prototype profile\n`,
  );
  const missing = securityConfig({});
  const configured = securityConfig({
    [name]: profile({
      networkAllowed: true,
      allowedData: [`profile-data:${name}`],
    }),
  });
  const fromConfig =
    direction === "missing-to-configured" ? missing : configured;
  const toConfig = direction === "missing-to-configured" ? configured : missing;
  const ids = new Map([[artifactPath, `prototype.${name}`]]);
  return buildSecurityPolicyChanges({
    fromAssets: collectSecurityPolicyAssetEvidence([input], fromConfig),
    toAssets: collectSecurityPolicyAssetEvidence([input], toConfig),
    fromConfig,
    toConfig,
    fromConfigPath: "renma.config.json",
    toConfigPath: "renma.config.json",
    fromAssetIdsByPath: ids,
    toAssetIdsByPath: ids,
  });
}

async function prototypeTransitionRepository(
  t: TestContext,
  direction: (typeof DIRECTIONS)[number],
): Promise<string> {
  const repo = await mkdtemp(
    path.join(os.tmpdir(), "renma-policy-diff-prototype-"),
  );
  t.after(() => rm(repo, { recursive: true, force: true }));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "renma@example.test"]);
  await git(repo, ["config", "user.name", "Renma Test"]);
  await writePrototypeContexts(repo);
  if (direction === "configured-to-missing") {
    await writePrototypeConfig(repo);
  }
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base prototype policy"]);
  await git(repo, ["tag", "base"]);

  if (direction === "missing-to-configured") {
    await writePrototypeConfig(repo);
  } else {
    await rm(path.join(repo, "renma.config.json"));
  }
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", "change prototype policy"]);
  return repo;
}

async function writePrototypeContexts(repo: string): Promise<void> {
  const directory = path.join(repo, "contexts", "prototype-profiles");
  await mkdir(directory, { recursive: true });
  for (const [index, name] of PROTOTYPE_PROPERTY_NAMES.entries()) {
    await writeFile(
      path.join(directory, `${index}.md`),
      `---\nid: prototype.profile.${index}\nowner: security\nstatus: stable\nsecurity_profile: ${JSON.stringify(name)}\n---\n# Prototype profile ${index}\n\nUse this context for deterministic security-policy revision checks.\n`,
    );
  }
}

async function writePrototypeConfig(repo: string): Promise<void> {
  const profiles = Object.fromEntries(
    PROTOTYPE_PROPERTY_NAMES.map((name, index) => [
      name,
      {
        network_allowed: true,
        allowed_data: [`profile-data:${index}`],
      },
    ]),
  );
  await writeFile(
    path.join(repo, "renma.config.json"),
    `${JSON.stringify({ security: { profiles } }, null, 2)}\n`,
  );
}

function securityConfig(
  profiles: Record<string, SecurityProfileConfig>,
): SecurityConfig {
  return {
    approvedDomains: [],
    approvedUploadDomains: [],
    disallowedCommands: [],
    profiles,
  };
}

function profile(
  overrides: Partial<SecurityProfileConfig>,
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

function artifact(artifactPath: string, content: string): Artifact {
  return {
    path: artifactPath,
    absolutePath: `/repo/${artifactPath}`,
    kind: "context",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", cwd, ...args]);
  return stdout.trim();
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
