import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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

async function scanFixture(files: Record<string, string>): Promise<ScanResult> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-repeated-context-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }

  return scan(root);
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
