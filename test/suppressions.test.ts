import assert from "node:assert/strict";
import test from "node:test";
import { applySuppressions, pathPatternMatches } from "../src/suppressions.js";
import type { Finding } from "../src/types/diagnostics.js";

test("suppression path matcher supports exact path matches", () => {
  assert.equal(
    pathPatternMatches("skills/demo/SKILL.md", "skills/demo/SKILL.md"),
    true,
  );
});

test("suppression path matcher supports directory-prefix matches without globs", () => {
  assert.equal(pathPatternMatches("skills/demo", "skills/demo/SKILL.md"), true);
});

test("suppression path matcher supports double-star directory globs", () => {
  assert.equal(
    pathPatternMatches("skills/demo/**", "skills/demo/SKILL.md"),
    true,
  );
  assert.equal(
    pathPatternMatches("skills/demo/**", "skills/demo/references/guide.md"),
    true,
  );
});

test("suppression path matcher does not match sibling directories", () => {
  assert.equal(
    pathPatternMatches("skills/demo/**", "skills/demo-other/SKILL.md"),
    false,
  );
});

test("suppression path matcher normalizes backslashes", () => {
  assert.equal(
    pathPatternMatches("skills\\demo\\**", "skills/demo/SKILL.md"),
    true,
  );
});

test("suppression application omits active findings but retains structured evidence", () => {
  const finding: Finding = {
    id: "SEC-LITERAL-SECRET",
    title: "Literal secret",
    category: "safety",
    severity: "high",
    confidence: "high",
    riskClass: "violation",
    evidence: {
      path: "skills/demo/SKILL.md",
      startLine: 8,
      endLine: 8,
      snippet: 'api_key = "fake"',
    },
    whyItMatters: "test",
    remediation: "test",
  };
  const result = applySuppressions(
    [finding],
    [
      {
        id: finding.id,
        paths: ["skills/demo/**"],
        reason: "reviewed fixture",
        expires: "never",
      },
    ],
    new Date("2026-08-07T00:00:00.000Z"),
  );

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.suppressedFindings, [
    {
      suppression: {
        id: finding.id,
        matchedPath: "skills/demo/**",
        reason: "reviewed fixture",
        expires: "never",
      },
      finding,
    },
  ]);
});

test("suppression selection uses UTF-16 order when matching reasons contain non-ASCII text", () => {
  const finding: Finding = {
    id: "SEC-LITERAL-SECRET",
    title: "Literal secret",
    category: "safety",
    severity: "high",
    confidence: "high",
    evidence: {
      path: "skills/demo/SKILL.md",
      startLine: 8,
      endLine: 8,
      snippet: 'api_key = "fake"',
    },
    whyItMatters: "test",
    remediation: "test",
  };
  const result = applySuppressions(
    [finding],
    ["é reviewed", "ä reviewed"].map((reason) => ({
      id: finding.id,
      paths: ["skills/demo/**"],
      reason,
      expires: "never" as const,
    })),
    new Date("2026-08-07T00:00:00.000Z"),
  );

  assert.equal(result.suppressedFindings[0]?.suppression.reason, "ä reviewed");
});
