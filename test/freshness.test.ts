import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAssetFreshness, parseDayDuration } from "../src/freshness.js";
import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { collectRepositorySnapshot } from "../src/repository-evidence.js";
import { scanFromRepositorySnapshot } from "../src/scanner.js";
import { RepositoryFixture } from "./repository-fixture.js";

test("freshness preserves calendar arithmetic and the four-digit year boundary", () => {
  for (const [lastReviewedAt, reviewCycle, expected] of [
    ["2024-02-28", "P2D", "2024-03-01"],
    ["2026-01-01", "P90D", "2026-04-01"],
    ["9999-12-30", "P1D", "9999-12-31"],
    ["9999-12-31", "P1D", undefined],
    ["2026-01-01", "P100000000D", undefined],
    ["2026-01-01", `P${"9".repeat(400)}D`, undefined],
  ] as const) {
    const result = evaluateAssetFreshness(
      { lastReviewedAt, reviewCycle },
      "9999-12-31",
    );
    assert.equal(result.reviewDueAt, expected);
    assert.equal(
      result.reviewOverdue,
      expected !== undefined && expected < "9999-12-31",
    );
  }
  assert.equal(parseDayDuration("P9007199254740993D"), undefined);
});

test("catalog and scan diagnose out-of-range review cycles without aborting", async (t) => {
  const fixture = await RepositoryFixture.create({ testContext: t });
  const cases = [
    ["large", "2026-01-01", "P100000000D"],
    ["year-overflow", "9999-12-31", "P1D"],
    ["nonfinite", "2026-01-01", `P${"9".repeat(400)}D`],
  ] as const;
  for (const [name, date, cycle] of cases) {
    await fixture.write(
      `contexts/${name}.md`,
      `---\nid: context.${name}\nowner: qa\nlast_reviewed_at: ${date}\nreview_cycle: ${cycle}\n---\n# Review\n`,
    );
    await fixture.skill(name, {
      metadata: {
        "last-reviewed-at": date,
        "review-cycle": cycle,
      },
    });
  }
  const snapshot = await collectRepositorySnapshot(fixture.root);
  const invalid = snapshot.catalogDiagnostics.filter(
    (d) => d.code === DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
  );
  assert.equal(invalid.length, cases.length * 2);
  const scan = scanFromRepositorySnapshot(snapshot, {
    evaluationDate: "2026-11-06",
  });
  assert.equal(
    scan.findings.filter(
      (f) => f.id === DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
    ).length,
    cases.length * 2,
  );
  assert.equal(
    scan.findings.some(
      (f) => f.id === DIAGNOSTIC_IDS.MAINT_ASSET_REVIEW_OVERDUE,
    ),
    false,
  );
});
