import assert from "node:assert/strict";
import test from "node:test";

import {
  agentSkillFrontmatterEnvelope,
  consumeOneLeadingEncodingBom,
  frontmatterEnvelope,
  isFrontmatterCloser,
  isFrontmatterOpener,
  LEADING_ENCODING_BOM,
  normalizeFrontmatterOpener,
  renmaFrontmatterEnvelope,
  YAML_FRONTMATTER_MARKER,
  type FrontmatterContract,
} from "../src/frontmatter-envelope.js";
import { resolveOperationalSecurityPolicy } from "../src/security-policy.js";
import type { Artifact } from "../src/types/artifact.js";
import {
  parseAgentSkillFrontmatter,
  parseRenmaFrontmatter,
} from "../src/yaml-frontmatter.js";

test("frontmatter marker and one-leading-BOM primitives are exact", () => {
  assert.equal(YAML_FRONTMATTER_MARKER, "---");
  assert.equal(LEADING_ENCODING_BOM, "\uFEFF");
  assert.deepEqual(consumeOneLeadingEncodingBom("---"), {
    content: "---",
    consumed: false,
  });
  assert.deepEqual(consumeOneLeadingEncodingBom("\uFEFF---"), {
    content: "---",
    consumed: true,
  });
  assert.deepEqual(consumeOneLeadingEncodingBom("\uFEFF\uFEFF---"), {
    content: "\uFEFF---",
    consumed: true,
  });
});

test("Agent Skill and Renma opener contracts retain distinct parity", () => {
  const cases: Array<{
    line: string;
    agentSkill: boolean;
    renma: boolean;
  }> = [
    { line: "---", agentSkill: true, renma: true },
    { line: "\uFEFF---", agentSkill: true, renma: true },
    { line: "\uFEFF\uFEFF---", agentSkill: true, renma: false },
    { line: " --- ", agentSkill: true, renma: false },
    { line: "\uFEFF --- ", agentSkill: true, renma: false },
    { line: "---\u200E", agentSkill: false, renma: false },
    { line: "----", agentSkill: false, renma: false },
    { line: "--", agentSkill: false, renma: false },
  ];

  for (const fixture of cases) {
    assert.equal(
      isFrontmatterOpener(fixture.line, "agent-skill"),
      fixture.agentSkill,
      JSON.stringify(fixture.line),
    );
    assert.equal(
      isFrontmatterOpener(fixture.line, "renma"),
      fixture.renma,
      JSON.stringify(fixture.line),
    );
    assert.equal(
      normalizeFrontmatterOpener(fixture.line, "agent-skill") ===
        YAML_FRONTMATTER_MARKER,
      fixture.agentSkill,
      JSON.stringify(fixture.line),
    );
    assert.equal(
      normalizeFrontmatterOpener(fixture.line, "renma") ===
        YAML_FRONTMATTER_MARKER,
      fixture.renma,
      JSON.stringify(fixture.line),
    );
  }
});

test("Agent Skill and Renma closer contracts retain distinct parity", () => {
  const cases: Array<{
    line: string;
    agentSkill: boolean;
    renma: boolean;
  }> = [
    { line: "---", agentSkill: true, renma: true },
    { line: "--- \t", agentSkill: true, renma: false },
    { line: " ---", agentSkill: false, renma: false },
    { line: "\uFEFF---", agentSkill: false, renma: false },
    { line: "---\u200E", agentSkill: false, renma: false },
    { line: "----", agentSkill: false, renma: false },
  ];

  for (const fixture of cases) {
    assert.equal(
      isFrontmatterCloser(fixture.line, "agent-skill"),
      fixture.agentSkill,
      JSON.stringify(fixture.line),
    );
    assert.equal(
      isFrontmatterCloser(fixture.line, "renma"),
      fixture.renma,
      JSON.stringify(fixture.line),
    );
  }
});

test("envelope helpers and YAML parsers select the same contract boundaries", () => {
  const cases: Array<{
    contract: FrontmatterContract;
    lines: string[];
    present: boolean;
    closingIndex: number | undefined;
  }> = [
    {
      contract: "agent-skill",
      lines: ["\uFEFF --- ", "name: demo", "--- \t", "# Body"],
      present: true,
      closingIndex: 2,
    },
    {
      contract: "renma",
      lines: ["\uFEFF---", "id: context.demo", "---", "# Body"],
      present: true,
      closingIndex: 2,
    },
    {
      contract: "renma",
      lines: ["---", "id: context.demo", "--- ", "# Body"],
      present: true,
      closingIndex: undefined,
    },
    {
      contract: "agent-skill",
      lines: ["---", "name: demo", " ---", "# Body"],
      present: true,
      closingIndex: undefined,
    },
  ];

  for (const fixture of cases) {
    const envelope = frontmatterEnvelope(fixture.lines, fixture.contract);
    const wrapper =
      fixture.contract === "agent-skill"
        ? agentSkillFrontmatterEnvelope(fixture.lines)
        : renmaFrontmatterEnvelope(fixture.lines);
    const parsed =
      fixture.contract === "agent-skill"
        ? parseAgentSkillFrontmatter(fixture.lines.join("\n"))
        : parseRenmaFrontmatter(fixture.lines.join("\n"));

    assert.deepEqual(envelope, wrapper, fixture.contract);
    assert.equal(envelope.present, fixture.present, fixture.contract);
    assert.equal(envelope.closingIndex, fixture.closingIndex, fixture.contract);
    assert.equal(parsed.present, fixture.present, fixture.contract);
    assert.equal(
      parsed.closed,
      fixture.closingIndex !== undefined,
      fixture.contract,
    );
    assert.equal(
      parsed.bodyStartLine,
      fixture.closingIndex === undefined
        ? fixture.lines.length + 1
        : fixture.closingIndex + 2,
      fixture.contract,
    );
  }
});

test("sanitized corrupted delimiters never authorize either security contract", () => {
  const corruptedOpeners = ["---\u200E", "--\uFE0F-"];
  for (const opener of corruptedOpeners) {
    const renma = resolveOperationalSecurityPolicy(
      artifact(
        "context",
        "contexts/demo.md",
        `${opener}\nexternal_upload_allowed: false\n---\n# Body\n`,
      ),
    );
    assert.equal(renma.policy.externalUploadAllowed, undefined, opener);
    assert.ok(
      renma.policy.invalidDeclared.has("externalUploadAllowed"),
      opener,
    );
    assert.equal(renma.policy.declared.size, 0, opener);

    const skill = resolveOperationalSecurityPolicy(
      artifact(
        "skill",
        "skills/demo/SKILL.md",
        `${opener}\nname: demo\ndescription: Review inputs. Use when review is requested.\nmetadata:\n  renma.external-upload-allowed: "false"\n---\n# Body\n`,
      ),
    );
    assert.equal(skill.policy.externalUploadAllowed, undefined, opener);
    assert.ok(
      skill.policy.invalidDeclared.has("externalUploadAllowed"),
      opener,
    );
    assert.equal(skill.policy.declared.size, 0, opener);
  }
});

test("corrupted closers never close or authorize parsed values", () => {
  const corruptedClosers = ["---\u200E", "--\uFE0F-"];
  for (const closer of corruptedClosers) {
    const renma = parseRenmaFrontmatter(
      `---\nexternal_upload_allowed: false\n${closer}\n# Body\n`,
    );
    assert.equal(renma.present, true, closer);
    assert.equal(renma.closed, false, closer);
    assert.deepEqual(renma.values, {}, closer);

    const skill = parseAgentSkillFrontmatter(
      `---\nmetadata:\n  renma.external-upload-allowed: "false"\n${closer}\n# Body\n`,
    );
    assert.equal(skill.present, true, closer);
    assert.equal(skill.closed, false, closer);
    assert.deepEqual(skill.values, {}, closer);
    assert.deepEqual(skill.metadataFields, [], closer);
  }
});

function artifact(
  kind: Artifact["kind"],
  path: string,
  content: string,
): Artifact {
  return {
    path,
    absolutePath: `/tmp/${path}`,
    kind,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
