import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import { isExcluded } from "../src/discovery.js";
import {
  canonicalScanBoundary,
  scanBoundarySource,
  trustedCiSuppressions,
} from "../src/scan-boundary.js";
import {
  SCAN_BOUNDARY_CI_MATCH_IDS,
  evaluateScanBoundaryCiPolicy,
} from "../src/scan-boundary-ci-policy.js";
import { buildScanBoundaryDiff } from "../src/scan-boundary-diff.js";
import type { ScanConfig } from "../src/types/configuration.js";

const TODAY = "2026-08-07";

test("canonical scan boundary sorts exact runtime patterns and exposes active suppressions", () => {
  const config = boundaryConfig({
    globs: ["skills/**/SKILL.md", "./README.md", "skills/**/SKILL.md"],
    exclude: ["dist/", "node_modules", ".git"],
    suppressions: [
      {
        id: "SEC-Z",
        paths: ["skills\\z\\**", "skills/z/**"],
        reason: "active",
      },
      {
        id: "SEC-A",
        paths: ["skills/a/**"],
        reason: "expired",
        expires: "2025-01-01",
      },
    ],
  });

  assert.deepEqual(
    canonicalScanBoundary(
      scanBoundarySource(config, "renma.config.json"),
      TODAY,
    ),
    {
      schemaVersion: "renma.scan-boundary.v1",
      configPath: "renma.config.json",
      globs: ["./README.md", "skills/**/SKILL.md"],
      exclude: [".git", "dist/", "node_modules"],
      maxFileSizeBytes: config.maxFileSizeBytes,
      maxDepth: config.maxDepth,
      activeSuppressions: [
        {
          id: "SEC-Z",
          paths: ["skills/z/**"],
          reason: "active",
          expires: "never",
        },
      ],
    },
  );
});

test("canonical boundary identity preserves runtime-significant pattern syntax", () => {
  const declarations = {
    workingGlob: "skills/**/SKILL.md",
    leadingDotGlob: "./skills/**/SKILL.md",
    trailingSlashGlob: "skills/**/SKILL.md/",
    trailingSlashExclude: "skills/private/",
    directoryExclude: "skills/private",
  };
  const boundary = canonicalScanBoundary(
    scanBoundarySource(
      boundaryConfig({
        globs: [
          declarations.trailingSlashGlob,
          declarations.workingGlob,
          declarations.leadingDotGlob,
        ],
        exclude: [
          declarations.directoryExclude,
          declarations.trailingSlashExclude,
        ],
      }),
    ),
    TODAY,
  );

  assert.deepEqual(boundary.globs, [
    declarations.leadingDotGlob,
    declarations.workingGlob,
    declarations.trailingSlashGlob,
  ]);
  assert.deepEqual(boundary.exclude, [
    declarations.directoryExclude,
    declarations.trailingSlashExclude,
  ]);

  const skillPath = "skills/demo/SKILL.md";
  assert.equal(path.matchesGlob(skillPath, declarations.workingGlob), true);
  assert.equal(path.matchesGlob(skillPath, declarations.leadingDotGlob), false);
  assert.equal(
    path.matchesGlob(skillPath, declarations.trailingSlashGlob),
    false,
  );
  assert.equal(
    isExcluded("skills/private/evil/SKILL.md", [
      declarations.trailingSlashExclude,
    ]),
    false,
  );
  assert.equal(
    isExcluded("skills/private/evil/SKILL.md", [declarations.directoryExclude]),
    true,
  );
});

test("canonically equivalent declarations have equivalent runtime coverage", () => {
  const fromConfig = boundaryConfig({
    globs: ["README.md", "skills/**/SKILL.md", "README.md"],
    exclude: ["dist", ".git", "dist"],
  });
  const toConfig = boundaryConfig({
    globs: ["skills/**/SKILL.md", "README.md"],
    exclude: ["dist", ".git"],
  });
  assert.deepEqual(
    canonicalScanBoundary(scanBoundarySource(fromConfig), TODAY),
    canonicalScanBoundary(scanBoundarySource(toConfig), TODAY),
  );

  for (const candidate of [
    "README.md",
    "skills/demo/SKILL.md",
    "skills/demo/reference.md",
    "dist/SKILL.md",
    ".git/config",
  ]) {
    assert.equal(
      runtimeBoundaryIncludes(fromConfig, candidate),
      runtimeBoundaryIncludes(toConfig, candidate),
      candidate,
    );
  }
});

test("boundary diff preserves simultaneous weakening and tightening facts", () => {
  const from = canonicalScanBoundary(
    scanBoundarySource(
      boundaryConfig({
        globs: ["skills/**/SKILL.md", "contexts/**/*.md"],
        exclude: ["node_modules"],
        maxDepth: 20,
        maxFileSizeBytes: 1_000,
      }),
    ),
    TODAY,
  );
  const to = canonicalScanBoundary(
    scanBoundarySource(
      boundaryConfig({
        globs: ["skills/public/**/SKILL.md", "contexts/**/*.md"],
        exclude: ["node_modules", "skills/private"],
        maxDepth: 5,
        maxFileSizeBytes: 2_000,
      }),
    ),
    TODAY,
  );
  const diff = buildScanBoundaryDiff(from, to);

  assert.ok(
    diff.changes.some(
      (change) =>
        change.kind === "glob" &&
        change.change === "removed" &&
        change.direction === "weakening",
    ),
  );
  assert.ok(
    diff.changes.some(
      (change) =>
        change.kind === "glob" &&
        change.change === "added" &&
        change.direction === "tightening",
    ),
  );
  assert.ok(
    diff.changes.some(
      (change) =>
        change.kind === "limit" &&
        change.property === "maxFileSizeBytes" &&
        change.direction === "tightening",
    ),
  );

  const evaluation = evaluateScanBoundaryCiPolicy(diff, {
    from: "fail",
    to: "off",
  });
  assert.equal(evaluation.configured.effective, "fail");
  assert.equal(evaluation.outcome, "fail");
  assert.deepEqual(
    evaluation.matches.map((match) => match.id),
    [
      SCAN_BOUNDARY_CI_MATCH_IDS.EXCLUSION_ADDED,
      SCAN_BOUNDARY_CI_MATCH_IDS.GLOB_REMOVED,
      SCAN_BOUNDARY_CI_MATCH_IDS.MAX_DEPTH_REDUCED,
    ],
  );
  assert.equal(
    evaluateScanBoundaryCiPolicy(diff, { from: "warn", to: "off" }).outcome,
    "warn",
  );
  const disabled = evaluateScanBoundaryCiPolicy(diff, {
    from: "off",
    to: "off",
  });
  assert.equal(disabled.outcome, "pass");
  assert.equal(disabled.matchCount, 3);
});

test("suppression additions and lifetime extensions gate while tightening does not", () => {
  const from = canonicalScanBoundary(
    scanBoundarySource(
      boundaryConfig({
        suppressions: [
          {
            id: "SEC-A",
            paths: ["skills/a/**", "skills/removed/**"],
            reason: "base",
            expires: "2090-01-01",
          },
        ],
      }),
    ),
    TODAY,
  );
  const to = canonicalScanBoundary(
    scanBoundarySource(
      boundaryConfig({
        suppressions: [
          {
            id: "SEC-A",
            paths: ["skills/a/**", "skills/new/**"],
            reason: "target reason may change",
            expires: "never",
          },
        ],
      }),
    ),
    TODAY,
  );
  const evaluation = evaluateScanBoundaryCiPolicy(
    buildScanBoundaryDiff(from, to),
    { from: "fail", to: "fail" },
  );

  assert.equal(evaluation.outcome, "fail");
  assert.deepEqual(
    evaluation.matches.map((match) => match.id),
    [
      SCAN_BOUNDARY_CI_MATCH_IDS.SUPPRESSION_ADDED,
      SCAN_BOUNDARY_CI_MATCH_IDS.SUPPRESSION_LIFETIME_EXTENDED,
    ],
  );
});

test("CI trusts the stricter active lifetime for common rule/path scopes", () => {
  const common = {
    id: "SEC-A",
    paths: ["skills/a/**"],
    reason: "base reason",
    expires: "2090-01-01" as const,
  };
  assert.deepEqual(
    trustedCiSuppressions(
      [common],
      [{ ...common, reason: "target reason" }],
      TODAY,
    ),
    [common],
  );
  assert.deepEqual(
    trustedCiSuppressions([common], [{ ...common, expires: "never" }], TODAY),
    [common],
  );
  assert.deepEqual(
    trustedCiSuppressions(
      [{ ...common, expires: "never" }],
      [{ ...common, expires: "2090-01-01" }],
      TODAY,
    ),
    [{ ...common, expires: "2090-01-01" }],
  );
  assert.deepEqual(
    trustedCiSuppressions(
      [{ ...common, expires: "2090-01-01" }],
      [{ ...common, expires: "2080-01-01" }],
      TODAY,
    ),
    [{ ...common, expires: "2080-01-01" }],
  );
  assert.deepEqual(
    trustedCiSuppressions(
      [{ ...common, paths: ["skills/a/**"] }],
      [{ ...common, paths: ["skills/a/**", "skills/new/**"] }],
      TODAY,
    ),
    [common],
  );
  assert.deepEqual(
    trustedCiSuppressions(
      [{ ...common, expires: "2025-01-01" }],
      [{ ...common, expires: "never" }],
      TODAY,
    ),
    [],
  );
});

function runtimeBoundaryIncludes(
  config: ScanConfig,
  candidate: string,
): boolean {
  return (
    config.globs.some((pattern) => path.matchesGlob(candidate, pattern)) &&
    !isExcluded(candidate, config.exclude)
  );
}

function boundaryConfig(overrides: Partial<ScanConfig>): ScanConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    suppressions: overrides.suppressions ?? [],
  };
}
