import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import {
  inspectAssetBindings,
  compareAssetBinding,
  type AssetBindingFile,
} from "../src/public-asset-bindings.js";

const file = (path: string, content: string): AssetBindingFile => ({
  path,
  bytes: Buffer.from(content),
});
const pin = (target: string, version = "1.0.0", alias = "b") => ({
  alias,
  target,
  version,
});
function skill(
  name: string,
  target?: string,
  bindings: unknown = target ? [pin(target)] : [],
  body = "",
  version = "1.0.1",
  relation = "requires-skill",
) {
  return file(
    `skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: Use this skill to review workflows.\nmetadata:\n  renma.id: skill.${name}\n  renma.version: "${version}"\n${target ? `  renma.${relation}: '["${target}"]'\n` : ""}  renma.asset-bindings: '${JSON.stringify(bindings)}'\n---\n${body}`,
  );
}
const context = (id: string, version = "1.0.0", extra = "") =>
  file(
    `contexts/${id}.md`,
    `---\nid: ${id}\nversion: "${version}"\n${extra}---\nContext\n`,
  );
const source = (files: AssetBindingFile[]) =>
  inspectAssetBindings(files).documents.find(
    (d) => d.identity.path === "skills/a/SKILL.md",
  )!;

test("local mismatch is distinct from declaration validity and historical satisfaction", () => {
  const a = skill(
    "a",
    "skill.b",
    [pin("skill.b")],
    "Follow [B](renma-asset:b).",
  );
  const report = source([a, skill("b", undefined, [], "", "2.0.0")]);
  assert.equal(report.declarationValid, true);
  assert.equal(report.bindings[0]!.satisfaction.status, "version-mismatch");
  assert.equal(report.diagnostics[0]!.phase, "local-satisfaction");
  const historical = inspectAssetBindings([
    skill("b", undefined, [], "", "1.0.0"),
  ]);
  assert.equal(
    compareAssetBinding(
      report.bindings[0]!,
      historical.documents.map((d) => d.identity),
    ).status,
    "matched",
  );
  assert.equal(report.bindings[0]!.satisfaction.status, "version-mismatch");
  assert.equal(report.references[0]!.destination!.raw, "renma-asset:b");
});

test("transitive Skill, Lens and Context annotations reuse every original relationship", () => {
  const files = [
    skill("a", "skill.b"),
    skill("b", "ctx", [pin("ctx")], "", "1.0.0", "requires-context"),
    context(
      "ctx",
      "1.0.0",
      "requires_context: [leaf]\nasset_bindings:\n  - {alias: leaf, target: leaf, version: '2026-09'}\n",
    ),
    context("leaf", "2026-09"),
  ];
  const report = inspectAssetBindings(files);
  assert.ok(report.documents.every((d) => d.declarationValid));
  assert.ok(
    report.documents
      .flatMap((d) => d.bindings)
      .every((b) => b.satisfaction.status === "matched"),
  );
  const lens = file(
    "contexts/review.lens.md",
    "---\nid: lens.review\ntype: context_lens\nversion: '1'\nrelease_version: 'release-A'\nowner: qa\npurpose: Review\napplies_to: [ctx]\nasset_bindings:\n  - {alias: rules, target: ctx, version: '1.0.0'}\n---\n[rules](renma-asset:rules)\n",
  );
  const withLens = inspectAssetBindings([
    skill(
      "a",
      "lens.review",
      [pin("lens.review", "release-A")],
      "",
      "1.0.1",
      "optional-lens",
    ),
    lens,
    context("ctx"),
  ]);
  const l = withLens.documents.find((d) => d.identity.kind === "context_lens")!;
  assert.equal(l.identity.version, "release-A");
  assert.equal(l.bindings[0]!.relationships[0]!.relationship, "applies_to");
  assert.equal(
    withLens.documents.at(-1)!.bindings[0]!.relationships[0]!.relationship,
    "optional_lens",
  );
  assert.ok(
    withLens.documents
      .flatMap((d) => d.bindings)
      .every((b) => b.satisfaction.status === "matched"),
  );
  const formatOnly = file(
    lens.path,
    Buffer.from(lens.bytes)
      .toString()
      .replace("release_version: 'release-A'\n", ""),
  );
  assert.equal(
    source([
      skill(
        "a",
        "lens.review",
        [pin("lens.review", "1")],
        "",
        "1",
        "requires-lens",
      ),
      formatOnly,
    ]).bindings[0]!.satisfaction.status,
    "target-version-invalid",
  );
});

test("missing, ambiguous, kind and version failures never select by pin", () => {
  const a = skill("a", "skill.b");
  assert.equal(source([a]).bindings[0]!.satisfaction.status, "missing");
  assert.equal(
    source([a, context("skill.b")]).bindings[0]!.satisfaction.status,
    "kind-mismatch",
  );
  assert.equal(
    source([a, skill("b", undefined, [], "", "")]).bindings[0]!.satisfaction
      .status,
    "target-version-invalid",
  );
  const b = skill("b", undefined, [], "", "1.0.0");
  const duplicate = context("skill.b", "2.0.0");
  const ambiguous = source([a, b, duplicate]).bindings[0]!.satisfaction;
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(
    ambiguous.candidates.map((c) => c.path),
    ["contexts/skill.b.md", "skills/b/SKILL.md"],
  );
});

test("malformed metadata, duplicate aliases/targets and undeclared relationships fail closed", () => {
  for (const bindings of [
    { b: "skill.b" },
    [null],
    [pin("skill.b"), pin("skill.b", "2", "other")],
    [pin("skill.b"), pin("ctx", "2")],
    [{ ...pin("skill.b"), extra: true }],
    [pin("skills/b/SKILL.md")],
    [pin("skill.b", " 1 ")],
    [pin("skill.b", "1", "B")],
  ]) {
    assert.equal(
      source([skill("a", "skill.b", bindings)]).declarationValid,
      false,
      JSON.stringify(bindings),
    );
  }
  assert.equal(
    source([skill("a", undefined, [pin("skill.b")])]).declarationValid,
    false,
  );
  const original = skill("a", "skill.b");
  for (const replacement of [
    '\'[ {"alias":"b","alias":"c","target":"skill.b","version":"1"} ]\'',
    '[{alias: b, target: skill.b, version: "1"}]',
    "'[{broken}]'",
  ]) {
    const malformed = file(
      original.path,
      Buffer.from(original.bytes)
        .toString()
        .replace(/'\[\{"alias".*\]'/u, replacement),
    );
    assert.equal(source([malformed]).declarationValid, false);
  }
  const duplicateYaml = file(
    "contexts/dup.md",
    "---\nid: dup\nversion: '1'\nrequires_context: [ctx]\nasset_bindings:\n - {alias: b, alias: c, target: ctx, version: '1'}\n---\n",
  );
  assert.equal(
    inspectAssetBindings([duplicateYaml]).documents[0]!.declarationValid,
    false,
  );
});

test("Markdown references are structural, literal, digest-bound and CRLF/Unicode exact", () => {
  const body =
    '😀 [**B**](<renma-asset:b> "[fake](renma-asset:b)")\n[B](renma-asset:b)\n`[x](renma-asset:code)`\n\n    [x](renma-asset:indented)\n\n```md\n[x](renma-asset:fenced)\n```\nplain renma-asset:text\n';
  const original = skill("a", "skill.b", [pin("skill.b")], body);
  const text =
    "\uFEFF" + Buffer.from(original.bytes).toString().replaceAll("\n", "\r\n");
  const a = file(original.path, text);
  const result = source([a]);
  assert.equal(result.references.length, 2);
  assert.equal(result.declarationValid, true);
  const first = result.references[0]!.destination!;
  assert.equal(first.start, text.indexOf("renma-asset:b"));
  for (const reference of result.references) {
    assert.equal(
      text.slice(reference.destination!.start, reference.destination!.end),
      "renma-asset:b",
    );
    assert.equal(
      reference.destination!.sha256,
      createHash("sha256").update(a.bytes).digest("hex"),
    );
  }
  assert.notEqual(
    createHash("sha256")
      .update(Buffer.from(text + " "))
      .digest("hex"),
    first.sha256,
  );
});

test("unsupported links and missing aliases are diagnosed; ordinary references add no edges", () => {
  const body =
    '[x](renma-asset:unknown)\n![image](renma-asset:b)\n[x][ref]\n\n[ref]: renma-asset:b\n\n<renma-asset:b>\n[x](renma-asset:b?q)\n<a href="renma-asset:b">x</a>\n[x](renma-asset:%62)\n[x](renma-asset:b\\-x)\n';
  const result = source([skill("a", "skill.b", [pin("skill.b")], body)]);
  assert.equal(result.declarationValid, false);
  assert.ok(
    result.diagnostics.some((d) => d.code === "RN-BINDING-UNDECLARED-ALIAS"),
  );
  assert.ok(
    result.diagnostics.filter(
      (d) => d.code === "RN-BINDING-UNSUPPORTED-REFERENCE",
    ).length >= 7,
  );
  assert.equal(result.relationships.length, 1);
  const unbound = inspectAssetBindings([
    context("plain", "1", "references: [other]\n"),
  ]).documents[0]!;
  assert.equal(unbound.relationships.length, 0);
  assert.equal(unbound.bindings.length, 0);
  assert.equal(unbound.declarationValid, true);
});

test("source kind, supporting resources, exact versions and input contract", () => {
  const bad = context(
    "a",
    "1",
    "requires_skill: [skill.b]\nasset_bindings:\n - {alias: b, target: skill.b, version: '1'}\n",
  );
  assert.equal(
    inspectAssetBindings([bad]).documents[0]!.declarationValid,
    false,
  );
  const support = file(
    "skills/a/references/helper.md",
    "---\nid: helper\nversion: '1'\nasset_bindings: []\n---\n",
  );
  assert.equal(
    inspectAssetBindings([support]).documents[0]!.declarationValid,
    false,
  );
  assert.throws(() => inspectAssetBindings([file("../bad.md", "")]));
  assert.throws(() =>
    inspectAssetBindings([
      file("contexts/a.md", ""),
      file("contexts/a.md", ""),
    ]),
  );
  assert.throws(() =>
    inspectAssetBindings([
      { path: "contexts/a.md", bytes: new Uint8Array([255]) },
    ]),
  );
  assert.equal(
    source([
      skill("a", "skill.b", [pin("skill.b", "1+build")]),
      skill("b", undefined, [], "", "1+other"),
    ]).bindings[0]!.satisfaction.status,
    "version-mismatch",
  );
});

test("published schema validates reports and rejects invalid locations/status", async () => {
  const schema = JSON.parse(
    await readFile("docs/schemas/asset-bindings-v1.schema.json", "utf8"),
  ) as AnySchemaObject;
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const report = inspectAssetBindings([skill("a", "skill.b"), skill("b")]);
  assert.ok(validate(report), JSON.stringify(validate.errors));
  const bad = structuredClone(report);
  bad.documents[0]!.identity.evidence.start = -1;
  assert.equal(validate(bad), false);
  assert.deepEqual(
    inspectAssetBindings([skill("b"), skill("a", "skill.b")]),
    report,
  );
});

test("documented example validates all transitive pins and keeps Lens format semantics", async () => {
  const paths = [
    "skills/workflow-a/SKILL.md",
    "skills/workflow-b/SKILL.md",
    "contexts/review.lens.md",
    "contexts/rules.md",
    "contexts/terms.md",
  ];
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      bytes: await readFile(`examples/asset-bindings/${path}`),
    })),
  );
  const report = inspectAssetBindings(files);
  assert.equal(report.documents.flatMap((d) => d.bindings).length, 5);
  assert.ok(report.documents.every((d) => d.declarationValid));
  assert.ok(
    report.documents
      .flatMap((d) => d.bindings)
      .every((b) => b.satisfaction.status === "matched"),
  );
  assert.deepEqual(
    report.documents.flatMap((d) => d.diagnostics),
    [],
  );
});

test("misplaced fields, missing source versions and non-Skill JSON strings are invalid", () => {
  const a = skill("a", "skill.b");
  const text = Buffer.from(a.bytes).toString();
  for (const content of [
    text.replace('  renma.version: "1.0.1"\n', ""),
    text
      .replace(/  renma.asset-bindings: .*\n/u, "")
      .replace("metadata:\n", "asset_bindings: []\nmetadata:\n"),
    text.replace(
      "  renma.requires-skill:",
      "  renma.requires-skill: broken\n  renma.optional-skill:",
    ),
  ])
    assert.equal(source([file(a.path, content)]).declarationValid, false);
  const c = context(
    "ctx",
    "1",
    `asset_bindings: '${JSON.stringify([pin("other")])}'\n`,
  );
  assert.equal(inspectAssetBindings([c]).documents[0]!.declarationValid, false);
});

test("repeated required/optional declarations retain their original indexes and evidence", () => {
  const a = skill("a", "skill.b");
  const modified = file(
    a.path,
    Buffer.from(a.bytes)
      .toString()
      .replace(
        "  renma.requires-skill:",
        '  renma.optional-skill: \'["skill.b", "skill.b"]\'\n  renma.requires-skill:',
      ),
  );
  const binding = source([modified]).bindings[0]!;
  assert.deepEqual(
    binding.relationships.map((r) => [r.relationship, r.declarationIndex]),
    [
      ["requires_skill", 0],
      ["optional_skill", 0],
      ["optional_skill", 1],
    ],
  );
  assert.ok(
    binding.relationships.every((r) => r.evidence.raw.includes("skill.b")),
  );
});
