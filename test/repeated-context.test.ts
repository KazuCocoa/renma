import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatReadinessMarkdown,
  readiness,
} from "../src/commands/readiness.js";
import { repeatedContextFindingCap } from "../src/repeated-context.js";
import { scan } from "../src/scanner.js";
import type { Finding, ScanResult } from "../src/types.js";

test("scan reports deterministic repeated context patterns", async () => {
  const result = await scanFixture({
    "skills/alpha/SKILL.md": [
      "# Alpha Skill",
      "",
      paymentReviewSection(),
      "",
      "## Alpha Notes",
      "",
      "Use the alpha sandbox account.",
    ].join("\n"),
    "skills/beta/SKILL.md": [
      "# Beta Skill",
      "",
      paymentReviewSection(),
      "",
      "## Beta Notes",
      "",
      "Use the beta sandbox account.",
    ].join("\n"),
    "contexts/payments/review.md": [
      "# Payment Review",
      "",
      "[Payment contract](./idempotency.md#contract)",
    ].join("\n"),
  });
  const findings = repeatedFindings(result);
  const ids = new Set(findings.map((finding) => finding.id));

  assert.ok(ids.has("MAINT-REPEATED-SECTION"));
  assert.ok(ids.has("MAINT-REPEATED-HEADING"));
  assert.ok(ids.has("MAINT-REPEATED-CODE-BLOCK"));
  assert.ok(ids.has("MAINT-REPEATED-LINK"));
  assert.ok(ids.has("MAINT-REPEATED-CONTEXT-PATTERN"));

  assertConfidence(findings, "MAINT-REPEATED-SECTION", "high");
  assertConfidence(findings, "MAINT-REPEATED-CODE-BLOCK", "high");
  assertConfidence(findings, "MAINT-REPEATED-CONTEXT-PATTERN", "medium");
  assertConfidence(findings, "MAINT-REPEATED-HEADING", "low");
  assertConfidence(findings, "MAINT-REPEATED-LINK", "low");

  for (const finding of findings) {
    assert.ok(finding.whyItMatters);
    assert.ok(finding.remediation);
    assert.ok(finding.constraints?.length);
    assert.ok(finding.verificationSteps?.length);
    assert.ok(finding.llmHint);
    assert.equal("message" in finding, false);
  }
});

test("whitespace-normalized repeated section still matches", async () => {
  const result = await scanFixture({
    "skills/alpha/SKILL.md": ["# Alpha", "", whitespaceSection("normal")].join(
      "\n",
    ),
    "skills/beta/SKILL.md": ["# Beta", "", whitespaceSection("expanded")].join(
      "\n",
    ),
  });

  assertRepeatedId(result, "MAINT-REPEATED-SECTION");
});

test("very short repeated sections are ignored", async () => {
  const result = await scanFixture({
    "skills/alpha/SKILL.md": "# Alpha\n\n## Tiny Repeat\nSame short note.",
    "skills/beta/SKILL.md": "# Beta\n\n## Tiny Repeat\nSame short note.",
  });

  assertNoRepeatedId(result, "MAINT-REPEATED-SECTION");
});

test("generic repeated headings alone do not emit findings", async () => {
  const result = await scanFixture({
    "skills/alpha/SKILL.md": "# Alpha\n\n## Troubleshooting\nAlpha-only note.",
    "skills/beta/SKILL.md": "# Beta\n\n## Troubleshooting\nBeta-only note.",
  });

  assert.equal(repeatedFindings(result).length, 0);
});

test("unique content emits no repeated-context findings", async () => {
  const result = await scanFixture({
    "skills/alpha/SKILL.md":
      "# Alpha\n\n## Alpha Payment Review\nAlpha-only guidance.",
    "skills/beta/SKILL.md":
      "# Beta\n\n## Beta Refund Review\nBeta-only guidance.",
  });

  assert.equal(repeatedFindings(result).length, 0);
});

test("repeated local links normalize to the same repository target", async () => {
  const result = await scanFixture({
    "skills/alpha/SKILL.md": [
      "# Alpha",
      "",
      "[Payment contract](../../contexts/payments/idempotency.md#contract)",
    ].join("\n"),
    "skills/beta/mobile/SKILL.md": [
      "# Beta Mobile",
      "",
      "[Payment contract](../../../contexts/payments/idempotency.md)",
    ].join("\n"),
    "contexts/payments/review.md": [
      "# Payment Review",
      "",
      "[Payment contract](./idempotency.md#contract)",
    ].join("\n"),
  });
  const finding = repeatedFindings(result).find(
    (candidate) => candidate.id === "MAINT-REPEATED-LINK",
  );

  assert.ok(finding);
  assert.match(finding.llmHint ?? "", /contexts\/payments\/idempotency\.md/);
});

test("each repeated-context finding ID is capped independently", async () => {
  const result = await scanFixture(capFixtureFiles(12));
  const counts = countRepeatedFindings(result);

  assert.equal(counts.get("MAINT-REPEATED-SECTION"), 10);
  assert.equal(counts.get("MAINT-REPEATED-HEADING"), 10);
  assert.equal(counts.get("MAINT-REPEATED-CODE-BLOCK"), 10);
  assert.equal(counts.get("MAINT-REPEATED-LINK"), 10);
  assert.equal(counts.get("MAINT-REPEATED-CONTEXT-PATTERN"), 10);
});

test("repeated-context cap helper is per finding ID", () => {
  assert.equal(repeatedContextFindingCap("MAINT-REPEATED-SECTION"), 10);
  assert.equal(repeatedContextFindingCap("MAINT-REPEATED-HEADING"), 10);
  assert.equal(repeatedContextFindingCap("MAINT-REPEATED-CODE-BLOCK"), 10);
  assert.equal(repeatedContextFindingCap("MAINT-REPEATED-LINK"), 10);
  assert.equal(repeatedContextFindingCap("MAINT-REPEATED-CONTEXT-PATTERN"), 10);
});

test("token shingles do not suppress other repeated-context signal kinds", async () => {
  const result = await scanFixture(capFixtureFiles(12));
  const ids = new Set(repeatedFindings(result).map((finding) => finding.id));

  assert.ok(ids.has("MAINT-REPEATED-CONTEXT-PATTERN"));
  assert.ok(ids.has("MAINT-REPEATED-SECTION"));
  assert.ok(ids.has("MAINT-REPEATED-HEADING"));
  assert.ok(ids.has("MAINT-REPEATED-CODE-BLOCK"));
  assert.ok(ids.has("MAINT-REPEATED-LINK"));
});

test("token shingle candidates over cap still leave section code and link findings", async () => {
  const result = await scanFixture(capFixtureFiles(14));
  const repeated = repeatedFindings(result);
  const tokenFindings = repeated.filter(
    (finding) => finding.id === "MAINT-REPEATED-CONTEXT-PATTERN",
  );

  assert.equal(tokenFindings.length, 10);
  assert.ok(
    repeated.some((finding) => finding.id === "MAINT-REPEATED-SECTION"),
  );
  assert.ok(
    repeated.some((finding) => finding.id === "MAINT-REPEATED-CODE-BLOCK"),
  );
  assert.ok(repeated.some((finding) => finding.id === "MAINT-REPEATED-LINK"));
});

test("readiness markdown output samples repeated-context IDs before token shingles dominate", async () => {
  const root = await writeFixture(capFixtureFiles(12));
  const report = await readiness(root);
  const markdown = formatReadinessMarkdown(report);

  assert.match(markdown, /MAINT-REPEATED-CONTEXT-PATTERN/);
  assert.match(markdown, /MAINT-REPEATED-SECTION/);
  assert.match(markdown, /MAINT-REPEATED-HEADING/);
  assert.match(markdown, /MAINT-REPEATED-CODE-BLOCK/);
  assert.match(markdown, /MAINT-REPEATED-LINK/);
});

test("overlapping token shingles from one paragraph collapse", async () => {
  const paragraph = [
    "A repeated operational paragraph describes payment retry evidence, customer account identifiers, processor settlement status, webhook delivery records, receipt storage decisions, offline queue reconciliation, audit timestamps, and reviewer expectations in one continuous paragraph.",
    "The same paragraph also preserves device state, network transition notes, ledger comparison details, refund safety checks, idempotency key handling, support escalation criteria, and final approval evidence for maintainers.",
  ].join(" ");
  const result = await scanFixture({
    "skills/alpha/SKILL.md": `# Alpha\n\n## Payment Retry Evidence Window\n${paragraph}`,
    "skills/beta/SKILL.md": `# Beta\n\n## Payment Retry Evidence Window\n${paragraph}`,
  });
  const tokenFindings = repeatedFindings(result).filter(
    (finding) => finding.id === "MAINT-REPEATED-CONTEXT-PATTERN",
  );

  assert.equal(tokenFindings.length, 1);
});

test("repeated-context findings are deterministic and sorted", async () => {
  const first = repeatedProjection(await scanFixture(capFixtureFiles(6)));
  const second = repeatedProjection(await scanFixture(capFixtureFiles(6)));
  const sorted = [...first].sort(compareFindingProjection);

  assert.deepEqual(first, second);
  assert.deepEqual(first, sorted);
});

async function scanFixture(files: Record<string, string>): Promise<ScanResult> {
  const root = await writeFixture(files);

  return scan(root);
}

async function writeFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-repeated-context-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return root;
}

function repeatedFindings(result: ScanResult): Finding[] {
  return result.findings.filter((finding) =>
    finding.id.startsWith("MAINT-REPEATED-"),
  );
}

function assertRepeatedId(result: ScanResult, id: string): void {
  assert.ok(repeatedFindings(result).some((finding) => finding.id === id));
}

function assertNoRepeatedId(result: ScanResult, id: string): void {
  assert.equal(
    repeatedFindings(result).some((finding) => finding.id === id),
    false,
  );
}

function assertConfidence(
  findings: Finding[],
  id: string,
  confidence: Finding["confidence"],
): void {
  const finding = findings.find((candidate) => candidate.id === id);
  assert.ok(finding);
  assert.equal(finding.confidence, confidence);
}

function countRepeatedFindings(result: ScanResult): Map<string, number> {
  const counts = new Map<string, number>();

  for (const finding of repeatedFindings(result)) {
    counts.set(finding.id, (counts.get(finding.id) ?? 0) + 1);
    assert.equal("message" in finding, false);
  }

  return counts;
}

function repeatedProjection(result: ScanResult): Array<{
  id: string;
  path: string;
  line: number;
  snippet: string;
}> {
  return repeatedFindings(result).map((finding) => ({
    id: finding.id,
    path: finding.evidence.path,
    line: finding.evidence.startLine,
    snippet: finding.evidence.snippet,
  }));
}

function compareFindingProjection(
  left: ReturnType<typeof repeatedProjection>[number],
  right: ReturnType<typeof repeatedProjection>[number],
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.id.localeCompare(right.id)
  );
}

function paymentReviewSection(): string {
  return [
    "## Payment Idempotency Verification Flow",
    "",
    "When validating payment idempotency, create a stable request key, submit the same charge twice, confirm the second response reuses the original transaction, and verify that ledger, receipt, webhook, and refund records remain single sourced.",
    "Capture the request identifier, customer identifier, product identifier, retry timestamp, processor response code, and final settlement state so reviewers can compare each retry without relying on memory.",
    "",
    "```bash",
    "node scripts/payments/check-idempotency.mjs --customer test-customer --product renewal-plan --request-key fixed-review-key --expect-single-ledger-entry",
    "node scripts/payments/verify-ledger.mjs --customer test-customer --request-key fixed-review-key --expect-webhook-count 1 --expect-receipt-count 1",
    "```",
    "",
    "[Payment contract](../../contexts/payments/idempotency.md#contract)",
  ].join("\n");
}

function capFixtureFiles(count: number): Record<string, string> {
  const alphaSections: string[] = ["# Alpha Cap Fixture"];
  const betaSections: string[] = ["# Beta Cap Fixture"];
  const referenceLinks: string[] = ["# Cap Reference Index"];

  for (let index = 0; index < count; index += 1) {
    const section = capSection(index);
    alphaSections.push(section);
    betaSections.push(section);
    referenceLinks.push(
      `[Cap reference ${index}](./ref-${index}.md#source-of-truth)`,
    );
  }

  return {
    "skills/alpha/SKILL.md": alphaSections.join("\n\n"),
    "skills/beta/SKILL.md": betaSections.join("\n\n"),
    "contexts/cap/review.md": referenceLinks.join("\n\n"),
  };
}

function capSection(index: number): string {
  const padded = index.toString().padStart(2, "0");

  return [
    `## Repeated Cap Signal ${padded} Payment Verification Flow`,
    "",
    `When validating cap signal ${padded}, collect the request key, customer account, retry timestamp, processor status, receipt identifier, ledger entry, webhook delivery, refund state, support escalation, and reviewer approval so each repeated context candidate has deterministic evidence.`,
    `The cap signal ${padded} paragraph keeps mobile offline recovery notes, subscription renewal expectations, payment idempotency behavior, audit trail details, and ownership boundaries together while remaining distinct from neighboring cap scenarios.`,
    "",
    "```bash",
    `node scripts/payments/cap-check-${padded}.mjs --customer cap-customer-${padded} --request-key cap-request-${padded} --expect-ledger-count 1 --expect-webhook-count 1`,
    `node scripts/payments/cap-review-${padded}.mjs --receipt cap-receipt-${padded} --refund-state unchanged --approval-state reviewable --deterministic-evidence required`,
    "```",
    "",
    `[Cap reference ${index}](../../contexts/cap/ref-${index}.md#source-of-truth)`,
  ].join("\n");
}

function whitespaceSection(mode: "normal" | "expanded"): string {
  const compact = [
    "## Mobile Offline Payment Recovery",
    "",
    "When validating mobile offline payment recovery, disable network access, queue a renewal request, restore connectivity, and confirm the client retries exactly once with the original idempotency key and account identifier.",
    "Review the local queue record, synchronization timestamp, server ledger entry, receipt event, and webhook delivery so the recovery path can be audited without losing the original customer intent.",
    "Keep processor response codes, retry counters, device clock drift notes, and reconciliation status together so future maintainers can compare offline and online behavior deterministically.",
  ].join("\n");

  if (mode === "normal") return compact;

  return compact
    .replace(
      "mobile offline payment recovery, disable",
      "mobile   offline\npayment recovery, disable",
    )
    .replace("receipt event, and webhook", "receipt event,\n\nand webhook")
    .replace(
      "online behavior deterministically.",
      "online   behavior deterministically.",
    );
}
