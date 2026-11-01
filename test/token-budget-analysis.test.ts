import assert from "node:assert/strict";
import test from "node:test";

import { parseDocument } from "../src/markdown.js";
import { tokenBudgetSectionCandidates } from "../src/token-budget-analysis.js";

function document(content: string) {
  return parseDocument({
    path: "contexts/review.md",
    absolutePath: "/contexts/review.md",
    kind: "context",
    content,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
  });
}

const SECTIONED_CONTENT = [
  "# Title",
  "Introduction",
  "## A",
  "alpha alpha",
  "### Nested",
  "nested nested nested",
  "## B",
  "beta beta",
].join("\n");

test("section candidates include nested content and stop at the next peer", () => {
  assert.deepEqual(tokenBudgetSectionCandidates(document(SECTIONED_CONTENT)), [
    { heading: "A", line: 3, estimatedTokens: 9, sharePercent: 69 },
    { heading: "B", line: 7, estimatedTokens: 4, sharePercent: 31 },
  ]);
});

test("same-line heading evidence shares the next strictly later boundary", () => {
  const parsed = document(SECTIONED_CONTENT);
  parsed.headings = [
    ...parsed.headings,
    { text: "Alias A", line: 3, depth: 2 },
    { text: " ", line: 5, depth: 2 },
  ];
  assert.deepEqual(tokenBudgetSectionCandidates(parsed), [
    { heading: "A", line: 3, estimatedTokens: 9, sharePercent: 41 },
    { heading: "Alias A", line: 3, estimatedTokens: 9, sharePercent: 41 },
    { heading: "B", line: 7, estimatedTokens: 4, sharePercent: 18 },
  ]);
});

test("section review does not manufacture candidates without usable headings", () => {
  assert.deepEqual(tokenBudgetSectionCandidates(document("Plain content")), []);
  assert.deepEqual(tokenBudgetSectionCandidates(document("# Title\nBody")), []);
  const opaque = document(SECTIONED_CONTENT);
  opaque.artifact.markdownParserEligible = false;
  assert.deepEqual(tokenBudgetSectionCandidates(opaque), []);
});

test("section boundary lookup does not rescan headings for each candidate", () => {
  const sectionCount = 300;
  const parsed = document(
    Array.from(
      { length: sectionCount },
      (_, index) => `## Section ${index}\ntext`,
    ).join("\n"),
  );
  let lineReads = 0;
  parsed.headings = parsed.headings.map((heading) => ({
    ...heading,
    get line() {
      lineReads += 1;
      return heading.line;
    },
  }));
  assert.equal(tokenBudgetSectionCandidates(parsed).length, 3);
  assert.ok(
    lineReads < sectionCount * 40,
    `Expected bounded heading access, observed ${lineReads} line reads`,
  );
});
