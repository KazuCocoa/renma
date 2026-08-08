import assert from "node:assert/strict";
import test from "node:test";

import { ciReport, formatCiReport } from "../src/commands/ci-report.js";
import {
  buildMetadataPolicyDiff,
  type MetadataPolicyDiff,
} from "../src/metadata-policy-diff.js";
import {
  METADATA_POLICY_CI_MATCH_IDS,
  effectiveMetadataPolicyCiPolicy,
  evaluateMetadataPolicyCiPolicy,
  metadataPolicyCiModeTransition,
} from "../src/metadata-policy-ci-policy.js";
import type {
  MetadataCiPolicyMode,
  MetadataConfig,
} from "../src/types/configuration.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("required-field diff preserves simultaneous tightening and weakening in registry order", () => {
  const first = buildMetadataPolicyDiff(
    policy("fail", ["owner", "tags"]),
    policy("fail", ["version", "tags"]),
    "base/renma.config.jsonc",
    "target/renma.config.jsonc",
  );
  const second = buildMetadataPolicyDiff(
    policy("fail", ["owner", "tags"]),
    policy("fail", ["version", "tags"]),
    "base/renma.config.jsonc",
    "target/renma.config.jsonc",
  );

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, "renma.metadata-policy-diff.v1");
  assert.deepEqual(
    first.changes.map((change) => [change.field, change.direction]),
    [
      ["version", "tightening"],
      ["owner", "weakening"],
    ],
  );
  assert.deepEqual(first.addedRequiredFields, ["version"]);
  assert.deepEqual(first.removedRequiredFields, ["owner"]);
  assert.deepEqual(first.changes[1]?.from.provenance, {
    source: "repository_configuration",
    configKey: "metadata.required",
    configPath: "base/renma.config.jsonc",
  });
  assert.deepEqual(first.changes[1]?.to.provenance, {
    source: "repository_configuration",
    configKey: "metadata.required",
    configPath: "target/renma.config.jsonc",
  });
});

test("unchanged required metadata policy has no transition", () => {
  assert.deepEqual(
    buildMetadataPolicyDiff(
      policy("fail", ["owner"]),
      policy("fail", ["owner"]),
    ),
    {
      schemaVersion: "renma.metadata-policy-diff.v1",
      changes: [],
      addedRequiredFields: [],
      removedRequiredFields: [],
    },
  );
});

test("required-field addition is visible tightening and non-blocking in its policy evaluator", () => {
  const diff = buildMetadataPolicyDiff(
    policy("fail", []),
    policy("fail", ["owner"]),
  );
  const evaluation = evaluateMetadataPolicyCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.deepEqual(evaluation.requiredFieldChanges, {
    weakenings: 0,
    tightenings: 1,
  });
  assert.equal(evaluation.outcome, "pass");
  assert.equal(evaluation.matchCount, 0);
});

test("required-field removal is governed independently from mode transitions", () => {
  const diff = buildMetadataPolicyDiff(
    policy("fail", ["owner"]),
    policy("fail", []),
  );
  const evaluation = evaluateMetadataPolicyCiPolicy(diff, {
    from: "fail",
    to: "fail",
  });

  assert.deepEqual(evaluation.requiredFieldChanges, {
    weakenings: 1,
    tightenings: 0,
  });
  assert.equal(evaluation.outcome, "fail");
  assert.deepEqual(
    evaluation.matches.map((match) => match.id),
    [METADATA_POLICY_CI_MATCH_IDS.REQUIRED_FIELD_REMOVED],
  );
});

test("metadata mode-only weakening uses the stricter archived endpoint", async (t) => {
  const cases = [
    ["fail", "off", "fail", "fail"],
    ["fail", "warn", "fail", "fail"],
    ["warn", "off", "warn", "warn"],
  ] as const;
  for (const [from, to, effective, outcome] of cases) {
    await t.test(`${from} -> ${to}`, () => {
      const configured = { from, to };
      const evaluation = evaluateMetadataPolicyCiPolicy(
        { changes: [] },
        configured,
      );
      assert.equal(effectiveMetadataPolicyCiPolicy(configured), effective);
      assert.deepEqual(metadataPolicyCiModeTransition(configured), {
        from,
        to,
        direction: "weakening",
      });
      assert.equal(evaluation.outcome, outcome);
      assert.deepEqual(
        evaluation.matches.map((match) => match.id),
        [METADATA_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED],
      );
      assert.deepEqual(evaluation.requiredFieldChanges, {
        weakenings: 0,
        tightenings: 0,
      });
    });
  }
});

test("metadata mode tightening remains visible and non-blocking", () => {
  const evaluation = evaluateMetadataPolicyCiPolicy(
    { changes: [] },
    { from: "off", to: "fail" },
  );
  assert.equal(evaluation.modeTransition.direction, "tightening");
  assert.equal(evaluation.outcome, "pass");
  assert.equal(evaluation.matchCount, 0);
});

test("first PR in staged metadata-policy disable bypass cannot silently pass", () => {
  const firstPr = evaluateMetadataPolicyCiPolicy(
    { changes: [] },
    { from: "fail", to: "off" },
  );
  const secondPr = evaluateMetadataPolicyCiPolicy(weakeningDiff("owner"), {
    from: "off",
    to: "off",
  });
  assert.equal(firstPr.outcome, "fail");
  assert.deepEqual(
    firstPr.matches.map((match) => match.id),
    [METADATA_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED],
  );
  assert.equal(secondPr.outcome, "pass");
  assert.equal(secondPr.requiredFieldChanges.weakenings, 1);
});

test("ci-report exposes removed policy provenance and vanished asset evidence", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.initializeGit();
  await fixture.writeConfig({
    metadata: { ci_policy: "fail", required: ["owner"] },
  });
  await fixture.skill("demo");
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base required metadata"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({
    metadata: { ci_policy: "fail", required: [] },
  });
  await fixture.git(["add", "renma.config.json"]);
  await fixture.git(["commit", "-m", "remove required metadata"]);

  const first = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  const second = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  const markdown = formatCiReport(first, "markdown");
  const json = formatCiReport(first, "json");

  assert.equal(first.status, "fail");
  assert.equal(first.metadataPolicy?.outcome, "fail");
  assert.equal(first.metadataPolicy?.configured.effective, "fail");
  assert.deepEqual(first.diff.metadataPolicy?.removedRequiredFields, ["owner"]);
  assert.ok(
    first.diff.findings.removed.some(
      (finding) =>
        finding.id === "META-POLICY-REQUIRED-FIELD-MISSING" &&
        finding.evidence?.path === "skills/demo/SKILL.md" &&
        finding.details?.requiredField === "owner" &&
        finding.details?.expectedSerializedKey === "metadata.renma.owner",
    ),
  );
  assert.ok(
    first.notes.some((note) =>
      note.includes("not treated as verified remediation"),
    ),
  );
  assert.ok(!first.notes.includes("Scan findings decreased."));
  assert.ok(!first.notes.includes("No CI report regressions detected."));
  assert.match(markdown, /^## Required Metadata Policy$/m);
  assert.match(markdown, /Required-field removals: 1/);
  assert.match(markdown, /required `owner` as `metadata\.renma\.owner`/);
  assert.match(markdown, /repository configuration `renma\.config\.json`/);
  assert.match(json, /"policySource": "repository_configuration"/);
  assert.equal(json, formatCiReport(second, "json"));
  assert.equal(markdown, formatCiReport(second, "markdown"));
});

test("ci-report shows required-field addition as tightening", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.initializeGit();
  await fixture.writeConfig({ metadata: { required: [] } });
  await fixture.skill("demo", { owner: "platform" });
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({ metadata: { required: ["owner"] } });
  await fixture.git(["add", "renma.config.json"]);
  await fixture.git(["commit", "-m", "require owner"]);

  const report = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  assert.equal(report.status, "pass");
  assert.deepEqual(report.diff.metadataPolicy?.addedRequiredFields, ["owner"]);
  assert.deepEqual(report.metadataPolicy?.requiredFieldChanges, {
    weakenings: 0,
    tightenings: 1,
  });
  assert.equal(report.metadataPolicy?.matchCount, 0);
  assert.match(
    formatCiReport(report, "markdown"),
    /tightening: required `owner`/,
  );
});

test("adding a second missing field preserves the unchanged field and fails CI", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.initializeGit();
  await fixture.writeConfig({ metadata: { required: ["owner"] } });
  await fixture.skill("demo");
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base missing owner"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({
    metadata: { required: ["owner", "tags"] },
  });
  await fixture.git(["add", "renma.config.json"]);
  await fixture.git(["commit", "-m", "require missing tags"]);

  const report = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  const addedPolicyFindings = report.diff.findings.added.filter(
    (finding) => finding.id === "META-POLICY-REQUIRED-FIELD-MISSING",
  );

  assert.equal(report.status, "fail");
  assert.equal(report.summary.findingsDelta, 1);
  assert.equal(report.summary.highOrCriticalFindingsDelta, 1);
  assert.deepEqual(
    addedPolicyFindings.map((finding) => finding.details?.requiredField),
    ["tags"],
  );
  assert.ok(
    !report.diff.findings.removed.some(
      (finding) => finding.details?.requiredField === "owner",
    ),
  );
  assert.match(
    formatCiReport(report, "markdown"),
    /required `tags` as `metadata\.renma\.tags`/,
  );
});

test("all simultaneous missing fields survive semantic diff identity in registry order", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.initializeGit();
  await fixture.writeConfig({ metadata: { required: [] } });
  await fixture.skill("demo");
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({
    metadata: { required: ["tags", "purpose", "owner"] },
  });
  await fixture.git(["add", "renma.config.json"]);
  await fixture.git(["commit", "-m", "require three missing fields"]);

  const report = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  const addedPolicyFindings = report.diff.findings.added.filter(
    (finding) => finding.id === "META-POLICY-REQUIRED-FIELD-MISSING",
  );
  const markdown = formatCiReport(report, "markdown");
  const json = formatCiReport(report, "json");

  assert.equal(report.status, "fail");
  assert.equal(report.summary.findingsDelta, 3);
  assert.equal(report.summary.highOrCriticalFindingsDelta, 3);
  assert.deepEqual(
    addedPolicyFindings.map((finding) => finding.details?.requiredField),
    ["owner", "purpose", "tags"],
  );
  for (const field of ["owner", "purpose", "tags"]) {
    assert.ok(markdown.includes("required `" + field + "`"));
    assert.match(json, new RegExp(`"requiredField": "${field}"`));
  }
});

test("suppressed deltas retain separate required fields on one asset", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  await fixture.initializeGit();
  const suppressions = [
    {
      id: "META-POLICY-REQUIRED-FIELD-MISSING",
      paths: ["skills/demo/**"],
      reason: "Exercise field-specific suppressed finding identity.",
      expires: "never",
    },
  ];
  await fixture.writeConfig({
    suppressions,
    metadata: { required: [] },
  });
  await fixture.skill("demo");
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "base"]);
  await fixture.git(["tag", "base"]);

  await fixture.writeConfig({
    suppressions,
    metadata: { required: ["tags", "purpose", "owner"] },
  });
  await fixture.git(["add", "renma.config.json"]);
  await fixture.git(["commit", "-m", "suppress three missing fields"]);

  const report = await ciReport(fixture.root, {
    fromRef: "base",
    toRef: "HEAD",
  });
  assert.deepEqual(
    report.diff.findings.suppressed.added.map(
      (item) => item.finding.details?.requiredField,
    ),
    ["owner", "purpose", "tags"],
  );
  assert.equal(report.diff.findings.added.length, 0);
  assert.equal(report.summary.findingsDelta, 0);
});

function policy(
  ciPolicy: MetadataCiPolicyMode,
  required: MetadataConfig["required"],
): MetadataConfig {
  return {
    ciPolicy,
    required,
    requiredSource: "repository_configuration",
  };
}

function weakeningDiff(
  field: MetadataConfig["required"][number],
): Pick<MetadataPolicyDiff, "changes"> {
  return {
    changes: buildMetadataPolicyDiff(policy("off", [field]), policy("off", []))
      .changes,
  };
}
