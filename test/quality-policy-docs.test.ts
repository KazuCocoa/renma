import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_QUALITY_PROFILE } from "../src/quality-profile.js";

const ROOT = process.cwd();

test("normative token-budget documentation matches DEFAULT_QUALITY_PROFILE", async () => {
  const [readme, changelog, manual, profile, diagnostics, metadataBudget] =
    await Promise.all([
      readFile(`${ROOT}/README.md`, "utf8"),
      readFile(`${ROOT}/CHANGELOG.md`, "utf8"),
      readFile(`${ROOT}/docs/user-manual.md`, "utf8"),
      readFile(`${ROOT}/docs/quality-profile.md`, "utf8"),
      readFile(`${ROOT}/docs/diagnostics.md`, "utf8"),
      readFile(`${ROOT}/docs/metadata-budget.md`, "utf8"),
    ]);
  const unreleasedChangelog = changelog.slice(
    0,
    changelog.indexOf("## [0.31.0]"),
  );

  const configThresholds: Array<readonly [string, number]> = [
    ["skill_token_warning", DEFAULT_QUALITY_PROFILE.skillTokenWarning],
    ["skill_token_high", DEFAULT_QUALITY_PROFILE.skillTokenHigh],
    ...Object.entries(DEFAULT_QUALITY_PROFILE.contentTokenWarning).flatMap(
      ([kind, warning]) => [
        [`${kind}_token_warning`, warning] as const,
        [
          `${kind}_token_high`,
          DEFAULT_QUALITY_PROFILE.contentTokenHigh[
            kind as keyof typeof DEFAULT_QUALITY_PROFILE.contentTokenHigh
          ],
        ] as const,
      ],
    ),
  ];

  for (const [key, value] of configThresholds) {
    assert.match(
      readme,
      new RegExp(`"${key}"\\s*:\\s*${value}`),
      `README ${key}`,
    );
    assert.match(
      manual,
      new RegExp(`\\b${key}\\b[^\\n]*${formatted(value)}`),
      `User Manual ${key}`,
    );
  }

  const profileRows: Array<readonly [string, number]> = [
    ["skillTokenWarning", DEFAULT_QUALITY_PROFILE.skillTokenWarning],
    ["skillTokenHigh", DEFAULT_QUALITY_PROFILE.skillTokenHigh],
    ...Object.entries(DEFAULT_QUALITY_PROFILE.contentTokenWarning).flatMap(
      ([kind, warning]) => [
        [`contentTokenWarning.${kind}`, warning] as const,
        [
          `contentTokenHigh.${kind}`,
          DEFAULT_QUALITY_PROFILE.contentTokenHigh[
            kind as keyof typeof DEFAULT_QUALITY_PROFILE.contentTokenHigh
          ],
        ] as const,
      ],
    ),
  ];
  for (const [field, value] of profileRows) {
    assert.match(
      profile,
      new RegExp(
        "\\| `" + escapeRegExp(field) + "` \\| " + formatted(value) + " \\|",
      ),
      `quality profile ${field}`,
    );
  }

  for (const [label, warning, high] of tokenBudgetPairs()) {
    assert.match(
      compact(diagnostics),
      new RegExp(`${label} ${formatted(warning)}/${formatted(high)}`),
      `diagnostics ${label} defaults`,
    );
    if (label !== "Skill") {
      assert.match(
        compact(metadataBudget),
        new RegExp(`${label} ${formatted(warning)}/${formatted(high)}`),
        `metadata-budget ${label} defaults`,
      );
    }
    assert.match(
      compact(unreleasedChangelog),
      new RegExp(`${label} \\(${formatted(warning)}/${formatted(high)}\\)`),
      `changelog ${label} defaults`,
    );
  }

  const portable = formatted(
    DEFAULT_QUALITY_PROFILE.agentSkills.skillBodyRecommendedMaxTokens,
  );
  const repository = formatted(DEFAULT_QUALITY_PROFILE.skillTokenWarning);
  for (const [label, document] of [
    ["README", readme],
    ["User Manual", manual],
    ["quality profile", profile],
    ["diagnostics", diagnostics],
  ] as const) {
    assert.match(
      document,
      new RegExp(`${portable}[\\s\\S]{0,180}${repository}`),
      label,
    );
  }
});

function tokenBudgetPairs(): Array<readonly [string, number, number]> {
  const quality = DEFAULT_QUALITY_PROFILE;
  return [
    ["Skill", quality.skillTokenWarning, quality.skillTokenHigh],
    ...(["context", "reference", "profile", "example"] as const).map(
      (kind) =>
        [
          title(kind),
          quality.contentTokenWarning[kind],
          quality.contentTokenHigh[kind],
        ] as const,
    ),
  ];
}

function formatted(value: number): string {
  return value.toLocaleString("en-US");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ");
}

function title(value: string): string {
  return `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
