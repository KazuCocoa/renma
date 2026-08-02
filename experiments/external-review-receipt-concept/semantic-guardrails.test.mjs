import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const experimentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(experimentDirectory, "../..");
const concept = JSON.parse(
  await readFile(
    path.join(experimentDirectory, "receipt-concept.json"),
    "utf8",
  ),
);
const projections = Object.fromEntries(
  concept.projections.map((projection) => [projection.caseId, projection]),
);

test("the projection remains explicitly experimental and all evidence states are exercised", () => {
  assert.equal(
    concept.concept.label,
    "renma.experiment.external-review-receipt-concept.v0",
  );
  assert.equal(
    concept.concept.stability,
    "deliberately-unstable-no-compatibility-promise",
  );

  const observedStates = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.state === "string") {
      observedStates.add(value.state);
      assert.ok(
        Array.isArray(value.sources) && value.sources.length > 0,
        `state ${value.state} must retain provenance`,
      );
      for (const source of value.sources) {
        assert.ok(
          concept.sourceRegistry[source],
          `unknown provenance source ${source}`,
        );
      }
      if (value.state === "known") assert.ok("value" in value);
      if (value.state !== "known") assert.equal(typeof value.reason, "string");
    }
    Object.values(value).forEach(visit);
  };
  visit(concept);

  assert.deepEqual(
    [...observedStates].sort(),
    [...concept.concept.stateVocabulary].sort(),
  );
});

test("recorded artifact digests still identify the referenced committed evidence", async () => {
  for (const source of Object.values(concept.sourceRegistry)) {
    if (!source.sha256) continue;
    const bytes = await readFile(path.join(repositoryRoot, source.path));
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.equal(digest, source.sha256, source.path);
  }
});

test("ignored Cisco artifacts remain documentary references rather than required files", async () => {
  for (const sourceName of ["cisco-native-json", "cisco-native-sarif"]) {
    const source = concept.sourceRegistry[sourceName];
    assert.equal(
      source.availability,
      "documented-observation-only-raw-artifact-not-committed",
    );
    assert.equal(source.path, undefined);
    const evidenceRecord = await readFile(
      path.join(repositoryRoot, source.evidenceRecordPath),
      "utf8",
    );
    assert.ok(evidenceRecord.includes(source.observedSha256.slice(7)));
  }

  const catalog = concept.sourceRegistry["cisco-renma-catalog"];
  assert.equal(
    catalog.availability,
    "documented-observation-only-generated-artifact-not-committed",
  );
  assert.equal(catalog.path, undefined);
  const catalogEvidence = await readFile(
    path.join(repositoryRoot, catalog.evidenceRecordPath),
    "utf8",
  );
  const subject =
    projections["cisco-renma-release-prep"].logicalSubjectBinding.value;
  assert.ok(catalogEvidence.includes(subject.renmaAssetId));
  assert.ok(catalogEvidence.includes(subject.rootContentEvidence.value));
});

test("execution, native completeness, and required-profile completeness stay separate", () => {
  const skillspector = projections["skillspector-executable-context-fixture"];
  const cisco = projections["cisco-renma-release-prep"];

  assert.equal(skillspector.executionStatus.value.classification, "completed");
  assert.equal(skillspector.producerNativeCompleteness.value.isComplete, false);
  assert.equal(
    skillspector.producerNativeCompleteness.value.coveragePercent,
    100,
  );
  assert.equal(skillspector.requiredProfileCompleteness.state, "unknown");

  assert.equal(cisco.executionStatus.value.classification, "completed");
  assert.equal(cisco.producerNativeCompleteness.state, "unavailable");
  assert.equal(cisco.requiredProfileCompleteness.state, "unknown");
});

test("successful execution and executable relationships cannot manufacture exact reviewed scope", () => {
  for (const projection of concept.projections) {
    assert.equal(projection.executionStatus.value.classification, "completed");
    assert.equal(projection.reviewedScopeBinding.value.status, "partial");
  }

  const context =
    projections["skillspector-executable-context-fixture"]
      .repositoryRelationshipContext;
  assert.equal(context.state, "known");
  assert.equal(context.value.reviewedScopeEffect, "none");
  assert.equal(context.value.scannerCoverageEffect, "none");
});

test("Cisco version is externally qualified and not relabeled as native report evidence", () => {
  const version = projections["cisco-renma-release-prep"].producer.version;
  assert.equal(version.state, "contradictory");
  assert.equal(version.resolution.value, "2.0.12");
  assert.equal(
    version.resolution.qualification,
    "externally-qualified-version-not-native-report-evidence",
  );
  assert.deepEqual(version.resolution.sources, ["cisco-installation-receipt"]);
  assert.ok(
    version.reportedValues.some(
      (reported) => reported.state === "invalid" && reported.value === "1.0.0",
    ),
  );
});

test("native findings and assessments remain opaque and cannot satisfy a Renma requirement", () => {
  for (const projection of concept.projections) {
    assert.equal(
      projection.nativeFindings.value.preservation,
      "opaque-native-collection-reference",
    );
    assert.equal(
      projection.nativeFindings.value.crossProducerNormalization,
      "none",
    );
    assert.equal(
      projection.nativeFindings.value.crossProducerDeduplication,
      "none",
    );
    assert.equal(
      projection.nativeAssessment.value.preservation,
      "producer-native-only",
    );
    assert.equal(projection.requirementSatisfaction.state, "unknown");
  }

  assert.equal(
    projections["cisco-renma-release-prep"].nativeAssessment.value.isSafe,
    true,
  );
});

test("an empty repeated SARIF digest has no subject or scope identity effect", () => {
  const collision = concept.crossCaseGuardrails.emptySarifDigestCollision.value;
  assert.ok(collision.observedDistinctTargets.length > 1);
  assert.equal(collision.identityEffect, "none");
});
