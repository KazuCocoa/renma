import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import {
  compareBodyPolicyFacts,
  deduplicateBodyPolicyFacts,
} from "../src/security-body-policy/fact-projection.js";
import type {
  BodyPolicyClauseFacts,
  BodyPolicyDomain,
  BodyPolicyModality,
  BodyPolicyScope,
} from "../src/security-body-policy/model.js";
import {
  assertFactRangesWithinSource,
  bodyPolicyFacts,
  bodyPolicyFindings,
} from "./body-policy-test-helpers.js";

const PROPERTY_PARAMETERS = { seed: 0x250101, numRuns: 80 };
const RECOGNIZED_POLICIES = [
  "This workflow must not use the network.",
  "This task must not upload files.",
  "This operation must not access credentials.",
] as const;
const relativePredicateArbitrary = fc.constantFrom(
  { domain: "network" as const, text: "must not use the network" },
  { domain: "upload" as const, text: "must not upload files" },
  { domain: "secrets" as const, text: "must not access credentials" },
);

test("body-policy analysis is total and source ranges remain bounded", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 320 }), (source) => {
      const facts = bodyPolicyFacts(source);
      assertFactRangesWithinSource(source, facts);
    }),
    PROPERTY_PARAMETERS,
  );

  fc.assert(
    fc.property(
      fc.constantFrom(...RECOGNIZED_POLICIES),
      fc.string({ maxLength: 48 }),
      (policy, punctuation) => {
        const source = `${punctuation}${policy}${punctuation}`;
        assertFactRangesWithinSource(source, bodyPolicyFacts(source));
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("facts and public findings are deterministic", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...RECOGNIZED_POLICIES),
      fc.constantFrom("", " Also validate locally.", "\n", " — "),
      (policy, suffix) => {
        const source = `${policy}${suffix}`;
        assert.deepEqual(bodyPolicyFacts(source), bodyPolicyFacts(source));
        assert.deepEqual(
          bodyPolicyFindings(source),
          bodyPolicyFindings(source),
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("private fact deduplication is idempotent and ordered", () => {
  fc.assert(
    fc.property(fc.array(factArbitrary, { maxLength: 60 }), (facts) => {
      const once = deduplicateBodyPolicyFacts(facts);
      const twice = deduplicateBodyPolicyFacts(once);
      assert.deepEqual(twice, once);
      for (let index = 1; index < once.length; index += 1) {
        assert.ok(compareBodyPolicyFacts(once[index - 1]!, once[index]!) <= 0);
      }
    }),
    PROPERTY_PARAMETERS,
  );
});

test("analyzed facts and findings retain deterministic source/domain order", () => {
  fc.assert(
    fc.property(
      fc.shuffledSubarray([...RECOGNIZED_POLICIES], {
        minLength: 1,
        maxLength: RECOGNIZED_POLICIES.length,
      }),
      (policies) => {
        const source = policies.join(" ");
        const facts = bodyPolicyFacts(source);
        for (let index = 1; index < facts.length; index += 1) {
          assert.ok(
            compareBodyPolicyFacts(facts[index - 1]!, facts[index]!) <= 0,
          );
        }
        const findings = bodyPolicyFindings(source);
        for (let index = 1; index < findings.length; index += 1) {
          const previous = findings[index - 1]!.evidence;
          const current = findings[index]!.evidence;
          assert.ok(previous.startLine <= current.startLine);
        }
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("recognized quote enclosures never supply independent workflow scope", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...RECOGNIZED_POLICIES),
      fc.constantFrom(
        ['"', '"'] as const,
        ["'", "'"] as const,
        ["“", "”"] as const,
        ["‘", "’"] as const,
      ),
      (policy, [open, close]) => {
        const source = `${open}${policy}${close}`;
        assert.equal(
          bodyPolicyFacts(source).some(
            ({ modality, scope }) =>
              modality === "prohibited" && scope === "workflow",
          ),
          false,
        );
        assert.deepEqual(bodyPolicyFindings(source), []);
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("paired-relative and main facts stay within their producing boundary", () => {
  fc.assert(
    fc.property(
      fc
        .tuple(relativePredicateArbitrary, relativePredicateArbitrary)
        .filter(([relative, main]) => relative.domain !== main.domain),
      ([relative, main]) => {
        const source = `This workflow, which ${relative.text}, ${main.text}.`;
        const closingComma = source.indexOf(",", source.indexOf("which"));
        assert.ok(closingComma > 0);
        const facts = bodyPolicyFacts(source);
        for (const fact of facts) {
          if (fact.domain === relative.domain) {
            assert.ok(fact.evidenceEnd <= closingComma);
          }
        }
        const mainFact = facts.find(
          (fact) =>
            fact.domain === main.domain &&
            fact.modality === "prohibited" &&
            fact.scope === "workflow" &&
            fact.completeness === "complete",
        );
        assert.ok(mainFact);
        assert.ok(mainFact.evidenceEnd > closingComma);
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

test("ordinary soft wrapping preserves semantic facts after projection", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        [
          "This workflow must not use the network.",
          "This workflow must not use\nthe network.",
        ] as const,
        [
          "This task must not upload files.",
          "This task must not upload\nfiles.",
        ] as const,
        [
          "Credentials must not be used in this workflow.",
          "Credentials must not be used\nin this workflow.",
        ] as const,
      ),
      ([oneLine, softWrapped]) => {
        assert.deepEqual(
          semanticFindingProjection(bodyPolicyFindings(oneLine)),
          semanticFindingProjection(bodyPolicyFindings(softWrapped)),
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
});

const domainArbitrary = fc.option(
  fc.constantFrom<BodyPolicyDomain>("network", "upload", "secrets"),
  { nil: undefined },
);
const modalityArbitrary = fc.constantFrom<BodyPolicyModality>(
  "prohibited",
  "not-required",
  "local-safeguard",
  "unknown",
);
const scopeArbitrary = fc.constantFrom<BodyPolicyScope>(
  "workflow",
  "local-step",
  "specific-target",
  "specific-source",
  "unknown",
);
const factArbitrary: fc.Arbitrary<BodyPolicyClauseFacts> = fc
  .record({
    domain: domainArbitrary,
    modality: modalityArbitrary,
    scope: scopeArbitrary,
    completeness: fc.constantFrom(
      "complete" as const,
      "unsupported-remainder" as const,
    ),
    evidenceStart: fc.integer({ min: 0, max: 200 }),
    length: fc.integer({ min: 0, max: 80 }),
  })
  .map(({ length, ...fact }) => ({
    ...fact,
    evidenceEnd: fact.evidenceStart + length,
  }));

function semanticFindingProjection(
  findings: ReturnType<typeof bodyPolicyFindings>,
): readonly object[] {
  return findings.map(({ evidence, ...finding }) => ({
    ...finding,
    evidence: {
      path: evidence.path,
      snippet: evidence.snippet.replace(/[ \t]*\n[ \t]*/gu, " "),
    },
  }));
}
