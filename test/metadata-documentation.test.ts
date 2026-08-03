import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateAgentSkill } from "../src/agent-skills.js";
import { buildCatalog } from "../src/catalog.js";
import { parseDocument } from "../src/markdown.js";
import {
  CANONICAL_SKILL_METADATA_KEYS,
  CANONICAL_SKILL_PUBLICATION_METADATA_KEY,
  NON_SKILL_AUXILIARY_METADATA_DEFINITIONS,
  NON_SKILL_CATALOG_METADATA_KEYS,
  RENMA_CATALOG_METADATA_DEFINITIONS,
  SECURITY_METADATA_FIELD_DEFINITIONS,
} from "../src/metadata-definitions.js";
import { resolveOperationalSecurityPolicy } from "../src/security-policy.js";
import type { Artifact, ArtifactKind } from "../src/types.js";

const START_MARKER = "<!-- renma-operational-metadata:start -->";
const END_MARKER = "<!-- renma-operational-metadata:end -->";
const MANUAL = readFileSync("docs/user-manual.md", "utf8");

interface DocumentedMetadataRow {
  skillKey?: string;
  nonSkillKey?: string;
  valueFormat: string;
  appliesTo: string;
  authoringStatus: string;
  effects: string;
}

interface ExpectedMetadataMapping {
  skillKey?: string;
  nonSkillKey?: string;
}

test("authoritative metadata table exactly covers operational registries", () => {
  assertOperationalMetadataTable(MANUAL);

  const rows = parseOperationalMetadataTable(MANUAL);
  const documentedSkillKeys = sorted(
    rows.flatMap((row) => (row.skillKey ? [row.skillKey] : [])),
  );
  const expectedGovernanceAndPublication = sorted([
    ...Object.values(CANONICAL_SKILL_METADATA_KEYS),
    CANONICAL_SKILL_PUBLICATION_METADATA_KEY,
  ]);
  const documentedGovernanceAndPublication = documentedSkillKeys.filter((key) =>
    expectedGovernanceAndPublication.includes(
      key as (typeof expectedGovernanceAndPublication)[number],
    ),
  );
  assert.deepEqual(
    documentedGovernanceAndPublication,
    expectedGovernanceAndPublication,
  );

  const documentedSecurityKeys = documentedSkillKeys.filter((key) =>
    SECURITY_METADATA_FIELD_DEFINITIONS.some(
      (definition) => definition.skillKey === key,
    ),
  );
  assert.deepEqual(
    documentedSecurityKeys,
    sorted(
      SECURITY_METADATA_FIELD_DEFINITIONS.map(
        (definition) => definition.skillKey,
      ),
    ),
  );

  const documentedNonSkillKeys = sorted(
    rows.flatMap((row) => (row.nonSkillKey ? [row.nonSkillKey] : [])),
  );
  assert.deepEqual(
    documentedNonSkillKeys,
    sorted([
      ...Object.values(NON_SKILL_CATALOG_METADATA_KEYS),
      ...SECURITY_METADATA_FIELD_DEFINITIONS.map(
        (definition) => definition.nonSkillKey,
      ),
      ...NON_SKILL_AUXILIARY_METADATA_DEFINITIONS.map(
        (definition) => definition.nonSkillKey,
      ),
    ]),
  );
});

test("metadata table parser rejects a missing operational key", () => {
  const fixture = MANUAL.replace(/^\| `renma\.owner` \| `owner` \|.*\n/m, "");
  assert.throws(
    () => assertOperationalMetadataTable(fixture),
    /missing mapping: renma\.owner -> owner/,
  );
});

test("metadata table parser rejects duplicate keys", () => {
  const ownerRow = MANUAL.match(/^\| `renma\.owner` \| `owner` \|.*$/m)?.[0];
  assert.ok(ownerRow);
  const fixture = MANUAL.replace(END_MARKER, `${ownerRow}\n${END_MARKER}`);
  assert.throws(
    () => assertOperationalMetadataTable(fixture),
    /duplicate Skill key: renma\.owner/,
  );
});

test("metadata table parser rejects an inaccurate Skill/non-Skill mapping", () => {
  const fixture = MANUAL.replace(
    /^\| `renma\.owner` \| `owner` \|/m,
    "| `renma.owner` | `maintainer` |",
  );
  assert.throws(
    () => assertOperationalMetadataTable(fixture),
    /missing mapping: renma\.owner -> owner/,
  );
});

test("metadata table markers must be present exactly once and bound one table", () => {
  assert.throws(
    () => parseOperationalMetadataTable(MANUAL.replace(START_MARKER, "")),
    /expected exactly one start marker/,
  );
  assert.throws(
    () => parseOperationalMetadataTable(`${START_MARKER}\n${MANUAL}`),
    /expected exactly one start marker/,
  );
});

test("machine-checked compatibility labels remain explicit", () => {
  const rows = parseOperationalMetadataTable(MANUAL);
  for (const key of ["renma.when-to-use", "renma.when-not-to-use"]) {
    assert.match(
      rowFor(rows, "skillKey", key).authoringStatus,
      /recognized but deprecated for new authoring/i,
    );
  }
  for (const key of ["target", "targets", "output", "outputs"]) {
    assert.match(
      rowFor(rows, "nonSkillKey", key).authoringStatus,
      /^Deprecated;/,
    );
  }
  assert.match(
    rowFor(rows, "nonSkillKey", "canonical_context").authoringStatus,
    /^Recognized compatibility-only;/,
  );
});

test("manual Skill and Context examples are operationally valid together", () => {
  const skill = parseDocument(
    artifact(
      "skills/review-public-json/SKILL.md",
      "skill",
      fencedExample(MANUAL, "Complete canonical Skill example"),
    ),
  );
  const context = parseDocument(
    artifact(
      "contexts/release/public-json-compatibility.md",
      "context",
      fencedExample(MANUAL, "Complete independent Context example"),
    ),
  );

  const validation = validateAgentSkill(skill);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  assert.deepEqual(resolveOperationalSecurityPolicy(skill).issues, []);

  const catalog = buildCatalog([skill, context]);
  assert.deepEqual(catalog.diagnostics, []);
  assert.ok(
    catalog.catalog.dependencies.some(
      (dependency) =>
        dependency.from === "skill.release.review-public-json" &&
        dependency.to === "context.release.public-json-compatibility" &&
        dependency.kind === "requires",
    ),
  );
});

function assertOperationalMetadataTable(markdown: string): void {
  const rows = parseOperationalMetadataTable(markdown);
  assertUniqueKeys(rows, "skillKey", "Skill");
  assertUniqueKeys(rows, "nonSkillKey", "non-Skill");

  const actualMappings = new Set(rows.map(mappingIdentity));
  const expectedMappings = expectedOperationalMappings();
  for (const mapping of expectedMappings) {
    const identity = mappingIdentity(mapping);
    assert.ok(actualMappings.has(identity), `missing mapping: ${identity}`);
  }
  for (const row of rows) {
    const identity = mappingIdentity(row);
    assert.ok(
      expectedMappings.some(
        (expected) => mappingIdentity(expected) === identity,
      ),
      `unexpected operational mapping: ${identity}`,
    );
  }
}

function expectedOperationalMappings(): ExpectedMetadataMapping[] {
  return [
    ...RENMA_CATALOG_METADATA_DEFINITIONS.map((definition) => ({
      ...("skillKey" in definition ? { skillKey: definition.skillKey } : {}),
      ...("nonSkillKey" in definition
        ? { nonSkillKey: definition.nonSkillKey }
        : {}),
    })),
    { skillKey: CANONICAL_SKILL_PUBLICATION_METADATA_KEY },
    ...SECURITY_METADATA_FIELD_DEFINITIONS.map((definition) => ({
      skillKey: definition.skillKey,
      nonSkillKey: definition.nonSkillKey,
    })),
    ...NON_SKILL_AUXILIARY_METADATA_DEFINITIONS.map((definition) => ({
      nonSkillKey: definition.nonSkillKey,
    })),
  ];
}

function parseOperationalMetadataTable(
  markdown: string,
): DocumentedMetadataRow[] {
  const startCount = occurrences(markdown, START_MARKER);
  const endCount = occurrences(markdown, END_MARKER);
  assert.equal(startCount, 1, "expected exactly one start marker");
  assert.equal(endCount, 1, "expected exactly one end marker");
  const start = markdown.indexOf(START_MARKER);
  const end = markdown.indexOf(END_MARKER);
  assert.ok(start < end, "metadata table markers are out of order");

  const region = markdown.slice(start + START_MARKER.length, end).trim();
  const lines = region.split(/\r?\n/).filter((line) => line.trim().length > 0);
  assert.ok(lines.length >= 3, "checked metadata table is missing");
  assert.deepEqual(parseMarkdownRow(lines[0]!), [
    "Skill key",
    "Non-Skill key",
    "Value format",
    "Applies to",
    "Requirement / authoring status",
    "Primary Renma effects",
  ]);
  assert.match(lines[1]!, /^\|(?:\s*:?-+:?\s*\|){6}$/);

  return lines.slice(2).map((line, index) => {
    const cells = parseMarkdownRow(line);
    assert.equal(cells.length, 6, `metadata row ${index + 1} has 6 cells`);
    return {
      ...optionalKey("skillKey", cells[0]!),
      ...optionalKey("nonSkillKey", cells[1]!),
      valueFormat: cells[2]!,
      appliesTo: cells[3]!,
      authoringStatus: cells[4]!,
      effects: cells[5]!,
    };
  });
}

function parseMarkdownRow(line: string): string[] {
  assert.ok(
    line.startsWith("|") && line.endsWith("|"),
    `expected Markdown table row: ${line}`,
  );
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line.slice(1, -1)) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
      cell += character;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function optionalKey<Name extends "skillKey" | "nonSkillKey">(
  name: Name,
  cell: string,
): Partial<Record<Name, string>> {
  if (cell === "—") return {};
  const match = cell.match(/^`([^`]+)`$/);
  assert.ok(match?.[1], `${name} must be one code-formatted key or —`);
  return { [name]: match[1] } as Partial<Record<Name, string>>;
}

function assertUniqueKeys(
  rows: DocumentedMetadataRow[],
  field: "skillKey" | "nonSkillKey",
  label: string,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row[field];
    if (!key) continue;
    assert.ok(!seen.has(key), `duplicate ${label} key: ${key}`);
    seen.add(key);
  }
}

function mappingIdentity(mapping: ExpectedMetadataMapping): string {
  return `${mapping.skillKey ?? "—"} -> ${mapping.nonSkillKey ?? "—"}`;
}

function rowFor(
  rows: DocumentedMetadataRow[],
  field: "skillKey" | "nonSkillKey",
  key: string,
): DocumentedMetadataRow {
  const row = rows.find((candidate) => candidate[field] === key);
  assert.ok(row, `missing documented row for ${key}`);
  return row;
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function fencedExample(markdown: string, heading: string): string {
  const headingIndex = markdown.indexOf(`### ${heading}`);
  assert.ok(headingIndex >= 0, `missing example heading: ${heading}`);
  const remainder = markdown.slice(headingIndex);
  const match = remainder.match(/```markdown\n([\s\S]*?)\n```/);
  assert.ok(match?.[1], `missing Markdown example after ${heading}`);
  return match[1];
}

function artifact(path: string, kind: ArtifactKind, content: string): Artifact {
  return {
    path,
    absolutePath: `/repo/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

function sorted<T extends string>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
