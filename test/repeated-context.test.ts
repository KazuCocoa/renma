import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scan } from "../src/scanner.js";

test("scan reports deterministic repeated context patterns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-repeated-context-"));
  await mkdir(path.join(root, "skills", "alpha"), { recursive: true });
  await mkdir(path.join(root, "skills", "beta"), { recursive: true });
  await mkdir(path.join(root, "contexts", "payments"), { recursive: true });

  const repeatedSection = [
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
    "[Payment contract](../../contexts/payments/idempotency.md)",
  ].join("\n");

  await writeFile(
    path.join(root, "skills", "alpha", "SKILL.md"),
    [
      "# Alpha Skill",
      "",
      repeatedSection,
      "",
      "## Alpha Notes",
      "",
      "Use the alpha sandbox account.",
    ].join("\n"),
  );

  await writeFile(
    path.join(root, "skills", "beta", "SKILL.md"),
    [
      "# Beta Skill",
      "",
      repeatedSection,
      "",
      "## Beta Notes",
      "",
      "Use the beta sandbox account.",
    ].join("\n"),
  );

  await writeFile(
    path.join(root, "contexts", "payments", "review.md"),
    [
      "# Payment Review",
      "",
      "[Payment contract](../../contexts/payments/idempotency.md)",
    ].join("\n"),
  );

  const result = await scan(root);
  const ids = new Set(result.findings.map((finding) => finding.id));

  assert.ok(ids.has("MAINT-REPEATED-SECTION"));
  assert.ok(ids.has("MAINT-REPEATED-HEADING"));
  assert.ok(ids.has("MAINT-REPEATED-CODE-BLOCK"));
  assert.ok(ids.has("MAINT-REPEATED-LINK"));
  assert.ok(ids.has("MAINT-REPEATED-CONTEXT-PATTERN"));

  const repeatedPattern = result.findings.find(
    (finding) => finding.id === "MAINT-REPEATED-CONTEXT-PATTERN",
  );
  assert.equal(repeatedPattern?.category, "maintenance");
  assert.equal(repeatedPattern?.confidence, "high");
  assert.match(
    repeatedPattern?.constraints?.join(" ") ?? "",
    /deterministic evidence/,
  );
});
