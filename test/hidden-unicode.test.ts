import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import fc from "fast-check";

import { DIAGNOSTIC_IDS } from "../src/diagnostic-ids.js";
import { hiddenUnicodeFindings } from "../src/hidden-unicode.js";
import { scan } from "../src/scanner.js";
import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import type { Artifact, Finding } from "../src/types.js";

const BIDI_ID = DIAGNOSTIC_IDS.SEC_SUSPICIOUS_BIDI_CONTROL;
const INVISIBLE_ID = DIAGNOSTIC_IDS.SEC_SUSPICIOUS_INVISIBLE_CHARACTER;
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const ZWSP = String.fromCodePoint(0x200b);
const ZWNJ = String.fromCodePoint(0x200c);
const ZWJ = String.fromCodePoint(0x200d);
const BOM = String.fromCodePoint(0xfeff);
const MONGOLIAN_FVS1 = String.fromCodePoint(0x180b);
const MONGOLIAN_FVS4 = String.fromCodePoint(0x180f);
const MONGOLIAN_VOWEL_SEPARATOR = String.fromCodePoint(0x180e);
const VS16 = String.fromCodePoint(0xfe0f);
const VS17 = String.fromCodePoint(0xe0100);
const PROPERTY_PARAMETERS = { seed: 0x260730, numRuns: 80 };

test("detects bidi controls in prose, fenced commands, and frontmatter", () => {
  const fixtures = [
    {
      content: `Review this ${RLO}instruction.`,
      line: 1,
      codePoint: "U+202E",
    },
    {
      content: `\`\`\`bash\nnpm ${LRI}install example\n\`\`\``,
      line: 2,
      codePoint: "U+2066",
    },
    {
      content: `---\nowner: te${RLO}am\n---\n# Example`,
      line: 2,
      codePoint: "U+202E",
    },
  ];

  for (const fixture of fixtures) {
    const findings = hiddenUnicodeFindings(artifact(fixture.content));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.id, BIDI_ID);
    assert.equal(findings[0]?.evidence.startLine, fixture.line);
    assert.ok(findings[0]?.evidence.snippet.includes(`<${fixture.codePoint} `));
  }
});

test("detects conservative invisible character ranges and non-leading BOM", () => {
  const tag = String.fromCodePoint(0xe0061);
  const content = [
    `npm${ZWSP} install dependency`,
    `mid${BOM}file`,
    `c0:${String.fromCodePoint(0x0007)} c1:${String.fromCodePoint(0x0085)}`,
    `tag:${tag}`,
  ].join("\r\n");
  const findings = hiddenUnicodeFindings(artifact(content));

  assert.deepEqual(
    findings.map(({ id, evidence, details }) => ({
      id,
      line: evidence.startLine,
      totalCount: details?.totalCount,
    })),
    [
      { id: INVISIBLE_ID, line: 1, totalCount: 1 },
      { id: INVISIBLE_ID, line: 2, totalCount: 1 },
      { id: INVISIBLE_ID, line: 3, totalCount: 2 },
      { id: INVISIBLE_ID, line: 4, totalCount: 1 },
    ],
  );
  assert.match(findings[1]?.evidence.snippet ?? "", /U\+FEFF/);
  assert.match(findings[2]?.evidence.snippet ?? "", /U\+0007/);
  assert.match(findings[2]?.evidence.snippet ?? "", /U\+0085/);
  assert.match(
    findings[3]?.evidence.snippet ?? "",
    /U\+E0061 TAG LATIN SMALL LETTER A/,
  );
});

test("allows exactly one BOM at the beginning of a text artifact", () => {
  assert.deepEqual(hiddenUnicodeFindings(artifact(`${BOM}# Heading\n`)), []);

  const repeated = hiddenUnicodeFindings(artifact(`${BOM}${BOM}# Heading\n`));
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0]?.id, INVISIBLE_ID);
  assert.equal(repeated[0]?.details?.totalCount, 1);
});

test("aggregates by diagnostic and line with sorted structured code points", () => {
  const softHyphen = String.fromCodePoint(0x00ad);
  const content = [
    `a${ZWSP}b${softHyphen}c${ZWSP}d`,
    `x${RLO}y${ZWSP}z${RLO}`,
    `next${ZWSP}line`,
  ].join("\n");
  const findings = hiddenUnicodeFindings(artifact(content));

  assert.deepEqual(
    findings.map(({ id, evidence, details }) => ({
      id,
      line: evidence.startLine,
      totalCount: details?.totalCount,
    })),
    [
      { id: INVISIBLE_ID, line: 1, totalCount: 3 },
      { id: BIDI_ID, line: 2, totalCount: 2 },
      { id: INVISIBLE_ID, line: 2, totalCount: 1 },
      { id: INVISIBLE_ID, line: 3, totalCount: 1 },
    ],
  );
  assert.deepEqual(findings[0]?.details?.characters, [
    { codePoint: "U+00AD", name: "SOFT HYPHEN", count: 1 },
    { codePoint: "U+200B", name: "ZERO WIDTH SPACE", count: 2 },
  ]);
  assert.equal(findings[1]?.severity, "high");
  assert.equal(findings[2]?.severity, "medium");
  assert.equal(findings[1]?.confidence, "high");
  assert.equal(findings[1]?.riskClass, "suspicious");
});

test("bounded evidence preserves context around a late suspicious character", () => {
  const target = `command=curl https://exa${ZWSP}mple.test/path suffix`;
  const [finding] = hiddenUnicodeFindings(
    artifact(`${"a".repeat(400)}${target}`),
  );
  assert.ok(finding);

  assert.ok(finding.evidence.snippet.length <= 240);
  assert.ok(
    finding.evidence.snippet.startsWith("<U+200B ZERO WIDTH SPACE> | …"),
  );
  assert.ok(
    finding.evidence.snippet.includes(
      "command=curl https://exa<U+200B ZERO WIDTH SPACE>mple.test/path suffix",
    ),
  );
  assert.equal(finding.evidence.snippet.endsWith("…"), false);
  assert.equal(JSON.stringify(finding).includes(ZWSP), false);
  assertCompleteEscapedMarkers(finding.evidence.snippet);
});

test("bounded evidence localizes a middle token with both omission markers", () => {
  const token = `dependency=https://registry.example.test/@scope/pack${ZWJ}age@1.2.3`;
  const [finding] = hiddenUnicodeFindings(
    artifact(`${"p".repeat(350)} ${token} ${"s".repeat(350)}`),
  );
  assert.ok(finding);

  assert.ok(finding.evidence.snippet.length <= 240);
  assert.ok(
    finding.evidence.snippet.startsWith("<U+200D ZERO WIDTH JOINER> | …"),
  );
  assert.ok(finding.evidence.snippet.endsWith("…"));
  assert.ok(
    finding.evidence.snippet.includes(
      "dependency=https://registry.example.test/@scope/pack<U+200D ZERO WIDTH JOINER>age@1.2.3",
    ),
  );
  assert.equal(JSON.stringify(finding).includes(ZWJ), false);
  assertCompleteEscapedMarkers(finding.evidence.snippet);
});

test("bounded evidence is deterministic and preserves surrounding non-BMP scalars", () => {
  const content = [
    "a".repeat(260),
    "😀".repeat(20),
    `pkg${ZWJ}name`,
    "🧪".repeat(20),
    "z".repeat(260),
  ].join("");
  const first = hiddenUnicodeFindings(artifact(content));
  const second = hiddenUnicodeFindings(artifact(content));
  const snippet = first[0]?.evidence.snippet ?? "";

  assert.deepEqual(first, second);
  assert.ok(snippet.includes("😀"));
  assert.ok(snippet.includes("🧪"));
  assertNoLoneSurrogates(snippet);
  assertCompleteEscapedMarkers(snippet);
});

test("reports ZWJ and ZWNJ only inside an ASCII-like token", () => {
  const suspicious = hiddenUnicodeFindings(
    artifact(`pkg${ZWJ}name https://exa${ZWNJ}mple.test/a`),
  );
  assert.equal(suspicious.length, 1);
  assert.deepEqual(suspicious[0]?.details?.characters, [
    { codePoint: "U+200C", name: "ZERO WIDTH NON-JOINER", count: 1 },
    { codePoint: "U+200D", name: "ZERO WIDTH JOINER", count: 1 },
  ]);

  const legitimate = [
    "日本語の説明と English text",
    "עברית عربية",
    `日${ZWJ}本`,
    `ن${ZWNJ}ص`,
    `👩${ZWJ}💻 👨${ZWJ}👩${ZWJ}👧${ZWJ}👦`,
    "©️ ✈️",
    String.fromCodePoint(0x200e, 0x200f, 0x061c),
    String.fromCodePoint(0x00a0, 0x202f, 0x3000),
  ].join("\n");
  assert.deepEqual(hiddenUnicodeFindings(artifact(legitimate)), []);
});

test("detects an encoded-looking sequence of consecutive variation selectors", () => {
  const hiddenPayload = String.fromCodePoint(
    0xfe00,
    0xfe03,
    0xfe07,
    0xfe0b,
    0xfe02,
    0xfe0f,
  );
  const [finding] = hiddenUnicodeFindings(
    artifact(`# Review\ncarrier${hiddenPayload}\n`),
  );

  assert.ok(finding);
  assert.equal(finding.id, INVISIBLE_ID);
  assert.equal(finding.evidence.startLine, 2);
  assert.equal(finding.details?.totalCount, 6);
  assert.match(
    finding.evidence.snippet,
    /carrier<U\+FE00 VARIATION SELECTOR-1>/u,
  );
  assert.match(finding.evidence.snippet, /<U\+FE0F VARIATION SELECTOR-16>/u);
  assert.deepEqual(finding.details?.variationSelectorAnalysis, {
    heuristic: "consecutive-run",
    minimumConsecutiveCount: 2,
    suspiciousSequenceCount: 1,
    longestSequenceLength: 6,
    reportedRanges: [
      {
        name: "Variation Selectors",
        startCodePoint: "U+FE00",
        endCodePoint: "U+FE0F",
      },
    ],
  });
  assert.equal(JSON.stringify(finding).includes(hiddenPayload), false);
});

test("detects exactly two consecutive variation selectors at the minimum boundary", () => {
  const selectorPair = String.fromCodePoint(0xfe00, 0xfe01);
  const [finding] = hiddenUnicodeFindings(artifact(`carrier${selectorPair}`));

  assert.ok(finding);
  assert.equal(finding.id, INVISIBLE_ID);
  assert.equal(finding.details?.totalCount, 2);
  assert.deepEqual(finding.details?.variationSelectorAnalysis, {
    heuristic: "consecutive-run",
    minimumConsecutiveCount: 2,
    suspiciousSequenceCount: 1,
    longestSequenceLength: 2,
    reportedRanges: [
      {
        name: "Variation Selectors",
        startCodePoint: "U+FE00",
        endCodePoint: "U+FE0F",
      },
    ],
  });
});

test("aggregates multiple suspicious variation selector runs on one line", () => {
  const firstRun = String.fromCodePoint(0xfe02, 0xfe03);
  const secondRun = String.fromCodePoint(0xe0100, 0xe0101);
  const [finding] = hiddenUnicodeFindings(
    artifact(`${firstRun} visible-text ${secondRun}`),
  );

  assert.ok(finding);
  assert.equal(finding.id, INVISIBLE_ID);
  assert.equal(finding.details?.totalCount, 4);
  assert.deepEqual(finding.details?.variationSelectorAnalysis, {
    heuristic: "consecutive-run",
    minimumConsecutiveCount: 2,
    suspiciousSequenceCount: 2,
    longestSequenceLength: 2,
    reportedRanges: [
      {
        name: "Variation Selectors",
        startCodePoint: "U+FE00",
        endCodePoint: "U+FE0F",
      },
      {
        name: "Variation Selectors Supplement",
        startCodePoint: "U+E0100",
        endCodePoint: "U+E01EF",
      },
    ],
  });
  assert.match(finding.evidence.snippet, /visible-text/u);
  assert.match(finding.evidence.snippet, /U\+FE02/u);
  assert.match(finding.evidence.snippet, /U\+E0101/u);
});

test("detects consecutive supplementary variation selectors with exact evidence", () => {
  const supplementarySequence = String.fromCodePoint(0xe0100, 0xe0101, 0xe01ef);
  const [finding] = hiddenUnicodeFindings(
    artifact(`variant: 葛${supplementarySequence}`),
  );

  assert.ok(finding);
  assert.equal(finding.id, INVISIBLE_ID);
  assert.deepEqual(finding.details?.characters, [
    { codePoint: "U+E0100", name: "VARIATION SELECTOR-17", count: 1 },
    { codePoint: "U+E0101", name: "VARIATION SELECTOR-18", count: 1 },
    { codePoint: "U+E01EF", name: "VARIATION SELECTOR-256", count: 1 },
  ]);
  assert.deepEqual(finding.details?.variationSelectorAnalysis, {
    heuristic: "consecutive-run",
    minimumConsecutiveCount: 2,
    suspiciousSequenceCount: 1,
    longestSequenceLength: 3,
    reportedRanges: [
      {
        name: "Variation Selectors Supplement",
        startCodePoint: "U+E0100",
        endCodePoint: "U+E01EF",
      },
    ],
  });
  assert.match(finding.evidence.snippet, /U\+E01EF VARIATION SELECTOR-256/u);
});

test("allows ordinary emoji presentation and isolated variation selectors", () => {
  const ideographicVariation = `葛${VS17}`;
  const isolatedTextVariation = `A${String.fromCodePoint(0xfe00)}`;
  const legitimate = [
    `©${VS16} ✈${VS16} ❤${VS16} ☀${VS16}`,
    ideographicVariation,
    isolatedTextVariation,
  ].join("\n");

  assert.deepEqual(hiddenUnicodeFindings(artifact(legitimate)), []);
});

test("allows isolated Mongolian FVS usage and reports selector-only runs", () => {
  assert.deepEqual(hiddenUnicodeFindings(artifact(`ᠠ${MONGOLIAN_FVS4}`)), []);

  const selectorRun = `${MONGOLIAN_FVS1}${MONGOLIAN_FVS4}`;
  const [finding] = hiddenUnicodeFindings(artifact(`ᠠ${selectorRun}`));

  assert.ok(finding);
  assert.equal(finding.id, INVISIBLE_ID);
  assert.deepEqual(finding.details?.characters, [
    {
      codePoint: "U+180B",
      name: "MONGOLIAN FREE VARIATION SELECTOR ONE",
      count: 1,
    },
    {
      codePoint: "U+180F",
      name: "MONGOLIAN FREE VARIATION SELECTOR FOUR",
      count: 1,
    },
  ]);
  assert.deepEqual(finding.details?.variationSelectorAnalysis, {
    heuristic: "consecutive-run",
    minimumConsecutiveCount: 2,
    suspiciousSequenceCount: 1,
    longestSequenceLength: 2,
    reportedRanges: [
      {
        name: "Mongolian Free Variation Selectors",
        startCodePoint: "U+180B",
        endCodePoint: "U+180D",
      },
      {
        name: "Mongolian Free Variation Selectors",
        startCodePoint: "U+180F",
        endCodePoint: "U+180F",
      },
    ],
  });
  assert.match(
    finding.evidence.snippet,
    /U\+180B MONGOLIAN FREE VARIATION SELECTOR ONE/u,
  );
  assert.match(
    finding.evidence.snippet,
    /U\+180F MONGOLIAN FREE VARIATION SELECTOR FOUR/u,
  );
  assert.equal(JSON.stringify(finding).includes(selectorRun), false);
});

test("allows legitimate Mongolian text containing an isolated vowel separator", () => {
  const legitimate = `ᠮᠣᠩᠭᠣᠯ${MONGOLIAN_VOWEL_SEPARATOR}ᠠ`;

  assert.deepEqual(hiddenUnicodeFindings(artifact(legitimate)), []);
});

test("variation selector analysis runs on original text before Markdown visibility filtering", () => {
  const hiddenPayload = String.fromCodePoint(0xfe01, 0xe0100, 0xfe0a);
  const findings = securityDiagnosticFindings([
    artifact(`# Visible\n\n<!-- raw payload: ${hiddenPayload} -->\n`),
  ]);
  const variationFinding = findings.find(({ id }) => id === INVISIBLE_ID);

  assert.ok(variationFinding);
  assert.equal(variationFinding.evidence.startLine, 3);
  assert.match(variationFinding.evidence.snippet, /U\+FE01/u);
  assert.match(variationFinding.evidence.snippet, /U\+E0100/u);
  assert.equal(
    findings.some(
      ({ id }) => id === DIAGNOSTIC_IDS.SEC_HIDDEN_OPERATIONAL_INSTRUCTION,
    ),
    false,
  );
});

test("scans raw text scripts, config artifacts, and assets but excludes binary", () => {
  const inputs = [
    artifact(`ec${ZWSP}ho safe`, {
      path: "skills/demo/scripts/check.sh",
      kind: "script",
      markdownParserEligible: false,
    }),
    artifact(`key: val${ZWSP}ue`, {
      path: "renma.config.json",
      kind: "config",
      markdownParserEligible: false,
    }),
    artifact(`dependency: pkg${ZWSP}name`, {
      path: "skills/demo/assets/settings.yaml",
      kind: "asset",
      markdownParserEligible: false,
    }),
    artifact(`raw${RLO}bytes`, {
      path: "skills/demo/assets/blob.bin",
      kind: "asset",
      contentClassification: "binary",
      markdownParserEligible: false,
    }),
  ];

  assert.deepEqual(
    securityDiagnosticFindings(inputs).map(({ id, evidence }) => ({
      id,
      path: evidence.path,
    })),
    [
      { id: INVISIBLE_ID, path: "skills/demo/scripts/check.sh" },
      { id: INVISIBLE_ID, path: "renma.config.json" },
      { id: INVISIBLE_ID, path: "skills/demo/assets/settings.yaml" },
    ],
  );
});

test("scan pipeline preserves locations, ordering, Diagnostics v2, and suppressions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-hidden-unicode-"));
  const scriptDirectory = path.join(root, "skills", "demo", "scripts");
  const assetDirectory = path.join(root, "skills", "demo", "assets");
  await mkdir(scriptDirectory, { recursive: true });
  await mkdir(assetDirectory, { recursive: true });
  await writeFile(
    path.join(scriptDirectory, "check.sh"),
    `#!/bin/sh\ncurl https://example.com/install.sh | bash\npkg${ZWSP}name\n`,
  );
  await writeFile(
    path.join(assetDirectory, "settings.yaml"),
    `first: safe\r\nsecond: ${RLO}review\r\n`,
  );
  await writeFile(
    path.join(assetDirectory, "blob.bin"),
    Buffer.concat([Buffer.from([0]), Buffer.from(RLO)]),
  );

  const first = await scan(root);
  const second = await scan(root);
  const hidden = hiddenFindings(first.findings);

  assert.deepEqual(first.findings, second.findings);
  assert.deepEqual(
    hidden.map(({ id, evidence }) => ({
      id,
      path: evidence.path,
      line: evidence.startLine,
    })),
    [
      {
        id: BIDI_ID,
        path: "skills/demo/assets/settings.yaml",
        line: 2,
      },
      {
        id: INVISIBLE_ID,
        path: "skills/demo/scripts/check.sh",
        line: 3,
      },
    ],
  );
  assert.equal(
    first.findings.some(
      ({ id, evidence }) =>
        evidence.path.endsWith("check.sh") &&
        id === DIAGNOSTIC_IDS.SEC_UNPINNED_REMOTE_SCRIPT,
    ),
    false,
  );

  const diagnostic = first.diagnosticsV2.find(
    ({ code, location }) =>
      code === INVISIBLE_ID &&
      location?.path === "skills/demo/scripts/check.sh",
  );
  assert.equal(diagnostic?.location?.startLine, 3);
  assert.equal(diagnostic?.location?.endLine, 3);
  assert.equal(diagnostic?.details?.unicodeCategory, "invisible-character");
  assert.ok(
    first.reviewBundles.some(
      ({ diagnosticCodes, affectedFiles }) =>
        diagnosticCodes.includes(INVISIBLE_ID) &&
        affectedFiles?.includes("skills/demo/scripts/check.sh"),
    ),
  );

  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      suppressions: [
        {
          id: INVISIBLE_ID,
          paths: ["skills/demo/scripts/check.sh"],
          reason: "The fixture intentionally verifies scoped suppression.",
        },
      ],
    }),
  );
  const suppressed = await scan(root);
  assert.equal(
    hiddenFindings(suppressed.findings).some(
      ({ evidence }) => evidence.path === "skills/demo/scripts/check.sh",
    ),
    false,
  );
  assert.equal(
    suppressed.diagnosticsV2.some(
      ({ code, location }) =>
        code === INVISIBLE_ID &&
        location?.path === "skills/demo/scripts/check.sh",
    ),
    false,
  );
});

test("scan covers an explicitly discovered text configuration file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-hidden-config-"));
  await writeFile(
    path.join(root, "renma.config.json"),
    JSON.stringify({
      globs: ["renma.config.json"],
      exclude: [`node_modules${ZWSP}cache`],
    }),
  );

  const result = await scan(root);
  const findings = hiddenFindings(result.findings);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.evidence.path, "renma.config.json");
  assert.equal(findings[0]?.id, INVISIBLE_ID);
});

test("always-detected code points and safe multilingual text obey bounded properties", () => {
  const alwaysDetected: Array<{
    codePoint: number;
    id: typeof BIDI_ID | typeof INVISIBLE_ID;
  }> = [
    ...codePointRange(0x0000, 0x0008),
    ...codePointRange(0x000b, 0x000c),
    ...codePointRange(0x000e, 0x001f),
    ...codePointRange(0x007f, 0x009f),
    0x00ad,
    0x034f,
    0x200b,
    0x2060,
    ...codePointRange(0x206a, 0x206f),
    ...codePointRange(0xfff9, 0xfffb),
    ...codePointRange(0xe0000, 0xe007f),
  ].map((codePoint) => ({ codePoint, id: INVISIBLE_ID }));
  alwaysDetected.push(
    ...[
      ...codePointRange(0x202a, 0x202e),
      ...codePointRange(0x2066, 0x2069),
    ].map((codePoint) => ({ codePoint, id: BIDI_ID })),
  );
  const safeCharacters = [
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ",
    ..."日本語の安全な説明です",
  ] as [string, ...string[]];
  const safeText = fc
    .array(fc.constantFrom(...safeCharacters), { maxLength: 120 })
    .map((characters) => characters.join(""));

  fc.assert(
    fc.property(
      fc.constantFrom(...alwaysDetected),
      safeText,
      safeText,
      ({ codePoint, id }, prefix, suffix) => {
        const content = `${prefix}${String.fromCodePoint(codePoint)}${suffix}`;
        assert.ok(
          hiddenUnicodeFindings(artifact(content)).some(
            (finding) => finding.id === id,
          ),
        );
      },
    ),
    PROPERTY_PARAMETERS,
  );
  fc.assert(
    fc.property(safeText, (content) => {
      const input = artifact(content);
      assert.deepEqual(hiddenUnicodeFindings(input), []);
      assert.deepEqual(
        hiddenUnicodeFindings(input),
        hiddenUnicodeFindings(input),
      );
    }),
    PROPERTY_PARAMETERS,
  );
});

function hiddenFindings(findings: Finding[]): Finding[] {
  return findings.filter(({ id }) => id === BIDI_ID || id === INVISIBLE_ID);
}

function codePointRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function assertCompleteEscapedMarkers(snippet: string): void {
  const starts = snippet.match(/<U\+/gu) ?? [];
  const complete = snippet.match(/<U\+[0-9A-F]{4,6} [^<>]+>/gu) ?? [];
  assert.equal(complete.length, starts.length, snippet);
}

function assertNoLoneSurrogates(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, value);
      index += 1;
    } else {
      assert.ok(codeUnit < 0xdc00 || codeUnit > 0xdfff, value);
    }
  }
}

function artifact(
  content: string,
  overrides: Partial<Artifact> = {},
): Artifact {
  return {
    path: "contexts/security/hidden.md",
    absolutePath: "/repo/contexts/security/hidden.md",
    kind: "context",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
    ...overrides,
  };
}
