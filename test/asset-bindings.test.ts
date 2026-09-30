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

test("Lens declaration errors survive standalone inspection without requiring local targets", () => {
  const content =
    "---\nid: lens.review\ntype: context_lens\nversion: '1'\nrelease_version: 'release-A'\nowner: qa\npurpose: Review\napplies_to: [ctx]\nasset_bindings:\n - {alias: rules, target: ctx, version: '1'}\n---\n[rules](renma-asset:rules)\n";
  const inspect = (text: string) =>
    inspectAssetBindings([file("contexts/review.lens.md", text)]).documents[0]!;
  const valid = inspect(content);
  assert.equal(valid.declarationValid, true);
  assert.equal(valid.bindings[0]!.satisfaction.status, "missing");
  assert.ok(valid.diagnostics.every((d) => d.phase === "local-satisfaction"));

  for (const [from, to, message] of [
    ["version: '1'", "version: '99'", 'unsupported version "99"'],
    [
      "type: context_lens",
      "type: context_lens\nscope: skill",
      'unsupported scope "skill"',
    ],
    ["owner: qa\n", "", 'missing required field "owner"'],
    ["purpose: Review\n", "", 'missing required field "purpose"'],
    ["applies_to: [ctx]\n", "", 'missing required field "applies_to"'],
  ] as const) {
    const original = content.replace(from, to);
    const report = inspect(original);
    assert.equal(report.declarationValid, false, message);
    assert.equal(report.bindings[0]!.declarationValid, false);
    const diagnostic = report.diagnostics.find((d) =>
      d.message.includes(message),
    );
    assert.ok(diagnostic, message);
    assert.equal(diagnostic.phase, "declaration");
    assert.equal(diagnostic.code, "RN-BINDING-METADATA");
    assert.equal(
      original.slice(diagnostic.evidence.start, diagnostic.evidence.end),
      diagnostic.evidence.raw,
    );
  }
  // An unbound acquired target must retain the same format validation.
  const target = inspect(
    content
      .replace(/asset_bindings:\n.*\n/u, "")
      .replace("[rules](renma-asset:rules)", "Review")
      .replace("version: '1'", "version: '99'"),
  );
  assert.deepEqual(target.bindings, []);
  assert.equal(target.declarationValid, false);
});

test("CR, CRLF and mixed newlines retain reference, metadata and hash evidence", () => {
  const body =
    "😀\n\n> [B\n> ](\n> <renma-asset:b>\n> )\n\n[B](renma-asset:b)\n";
  const original = Buffer.from(
    skill("a", "skill.b", [pin("skill.b")], body).bytes,
  ).toString();
  for (const endings of [["\r"], ["\r\n"], ["\n", "\r", "\r\n"]]) {
    let index = 0;
    const content =
      "\uFEFF" +
      original.replace(/\n/gu, () => endings[index++ % endings.length]!);
    const input = file("skills/a/SKILL.md", content);
    const report = source([input]);
    assert.equal(
      report.declarationValid,
      true,
      JSON.stringify(report.diagnostics),
    );
    assert.equal(report.references.length, 2);
    for (const evidence of [
      report.identity.idEvidence,
      report.identity.versionEvidence,
      report.bindings[0]!.evidence,
      report.relationships[0]!.evidence,
      ...report.references.flatMap((r) => [r.evidence, r.destination!]),
    ]) {
      assert.ok(evidence.start >= 0 && evidence.end <= content.length);
      assert.equal(content.slice(evidence.start, evidence.end), evidence.raw);
      assert.equal(
        evidence.startLine,
        content.slice(0, evidence.start).split(/\r\n|[\r\n]/u).length,
      );
      assert.equal(
        evidence.sha256,
        createHash("sha256").update(input.bytes).digest("hex"),
      );
    }
    for (const reference of report.references)
      assert.equal(reference.destination!.raw, "renma-asset:b");
    assert.match(report.identity.idEvidence.raw, /renma.id: skill.a/u);
    assert.match(report.identity.versionEvidence.raw, /renma.version:/u);
    assert.match(report.bindings[0]!.evidence.raw, /renma.asset-bindings:/u);
  }
});

test("a BOM at the Markdown body start does not shift destination evidence", () => {
  const original = skill(
    "a",
    "skill.b",
    [pin("skill.b")],
    "\uFEFF[B](renma-asset:b)",
  );
  const content = Buffer.from(original.bytes).toString();
  const report = source([original]);
  assert.equal(report.declarationValid, true);
  assert.equal(report.references[0]!.evidence.raw, "[B](renma-asset:b)");
  const destination = report.references[0]!.destination!;
  assert.equal(destination.start, content.indexOf("renma-asset:b"));
  assert.equal(
    content.slice(destination.start, destination.end),
    destination.raw,
  );
});

test("Markdown-generated containers participate in HTML namespace and raw-text parsing", () => {
  for (const tag of ["svg", "math"]) {
    for (const markdown of ["text", "# Heading", "> text", "- text"]) {
      const html = '<![CDATA[foo > <a href="renma-asset:b">B</a>]]>';
      const body = `<${tag}>\n\n${markdown}\n\n${html}`;
      const input = skill("a", "skill.b", [pin("skill.b")], body);
      const report = source([input]);
      const diagnostics = report.diagnostics.filter(
        (d) => d.code === "RN-BINDING-UNSUPPORTED-REFERENCE",
      );
      assert.equal(report.declarationValid, false, body);
      assert.equal(diagnostics.length, 1, body);
      const evidence = diagnostics[0]!.evidence;
      const content = Buffer.from(input.bytes).toString();
      assert.equal(evidence.start, content.indexOf(html));
      assert.equal(evidence.raw, html);
      assert.equal(content.slice(evidence.start, evidence.end), html);
      assert.equal(
        evidence.sha256,
        createHash("sha256").update(input.bytes).digest("hex"),
      );
    }
    // A generated paragraph exits foreign content: this becomes HTML script
    // data rather than inspectable SVG/MathML children.
    const inert = source([
      skill(
        "a",
        "skill.b",
        [pin("skill.b")],
        `<${tag}>\n\ntext\n\n<script/><a href="renma-asset:b">B</a>`,
      ),
    ]);
    assert.equal(inert.declarationValid, true);
    assert.deepEqual(
      inert.diagnostics.filter((d) => d.phase === "declaration"),
      [],
    );
  }
});

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
  const ambiguousReport = source([a, b, duplicate]);
  const ambiguousBinding = ambiguousReport.bindings[0]!;
  const ambiguous = ambiguousBinding.satisfaction;
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguousReport.declarationValid, true);
  const diagnostic = ambiguousReport.diagnostics.find(
    (item) => item.code === "RN-BINDING-AMBIGUOUS",
  );
  assert.ok(diagnostic);
  assert.equal(diagnostic.phase, "local-satisfaction");
  assert.equal(diagnostic.entryIndex, ambiguousBinding.entryIndex);
  assert.deepEqual(diagnostic.evidence, ambiguousBinding.evidence);
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

test("unbound dependency targets retain metadata errors locally and in historical snapshots", () => {
  const a = skill("a", "ctx", [pin("ctx", "1")], "", "1", "requires-context");
  const ctx = context(
    "ctx",
    "1",
    "requires_context: [leaf]\nrequires_context: [other]\n",
  );
  const report = inspectAssetBindings([a, ctx]);
  const caller = report.documents.find((d) => d.identity.id === "skill.a")!;
  const target = report.documents.find((d) => d.identity.id === "ctx")!;
  assert.equal(caller.declarationValid, true);
  assert.equal(caller.bindings[0]!.satisfaction.status, "matched");
  assert.deepEqual(target.bindings, []);
  assert.deepEqual(target.references, []);
  assert.deepEqual(target.relationships, []);
  assert.equal(target.declarationValid, false);
  const diagnostic = target.diagnostics.find(
    (d) =>
      d.code === "RN-BINDING-METADATA" &&
      d.message.includes("requires_context"),
  );
  assert.ok(diagnostic);
  assert.equal(diagnostic.phase, "declaration");
  assert.equal(diagnostic.evidence.path, ctx.path);
  const content = Buffer.from(ctx.bytes).toString();
  assert.match(diagnostic.evidence.raw, /requires_context:/u);
  assert.equal(
    content.slice(diagnostic.evidence.start, diagnostic.evidence.end),
    diagnostic.evidence.raw,
  );
  assert.equal(
    diagnostic.evidence.sha256,
    createHash("sha256").update(ctx.bytes).digest("hex"),
  );

  const historical = inspectAssetBindings([ctx]).documents[0]!;
  assert.deepEqual(historical, target);
  assert.equal(
    compareAssetBinding(caller.bindings[0]!, [historical.identity]).status,
    "matched",
  );
  assert.equal(historical.declarationValid, false);
  const repaired = inspectAssetBindings([
    context("ctx", "1", "requires_context: [leaf]\n"),
  ]).documents[0]!;
  assert.equal(repaired.declarationValid, true);
  assert.deepEqual(repaired.diagnostics, []);
  assert.equal(repaired.relationships[0]!.target, "leaf");
});

test("multiline labels retain exact destinations after trailing whitespace with LF and CRLF", () => {
  const forms = [
    "[B\n ](renma-asset:b)",
    "[B\n \t ](renma-asset:b)",
    '[**B**\n ](<renma-asset:b> "[fake](renma-asset:b)")',
    '[`[fake](renma-asset:b)`\n ](renma-asset:b "[title](renma-asset:b)")',
    '[B\\]\\(renma-asset:b\\)\n ](<renma-asset:b> "title")',
  ];
  for (const newline of ["\n", "\r\n"]) {
    for (const form of forms) {
      const original = skill(
        "a",
        "skill.b",
        [pin("skill.b")],
        `😀 ${form}\n\n\`[code](renma-asset:b)\`\n\n\`\`\`md\n[fenced](renma-asset:b)\n\`\`\`\n`,
      );
      const content =
        "\uFEFF" +
        Buffer.from(original.bytes).toString().replaceAll("\n", newline);
      const input = file(original.path, content);
      const report = source([input]);
      assert.equal(
        report.declarationValid,
        true,
        JSON.stringify({ form, newline, diagnostics: report.diagnostics }),
      );
      assert.equal(report.references.length, 1);
      const destination = report.references[0]!.destination!;
      // The actual closing label follows its newline indentation, unlike decoys.
      const expectedStart = content.indexOf(
        "renma-asset:b",
        content.indexOf(newline, content.indexOf("😀")) + newline.length,
      );
      assert.equal(destination.start, expectedStart);
      assert.equal(destination.end, expectedStart + "renma-asset:b".length);
      assert.equal(
        content.slice(destination.start, destination.end),
        "renma-asset:b",
      );
      assert.equal(destination.raw, "renma-asset:b");
      assert.equal(
        destination.startLine,
        content.slice(0, expectedStart).split("\n").length,
      );
      assert.equal(destination.endLine, destination.startLine);
      assert.equal(
        destination.sha256,
        createHash("sha256").update(input.bytes).digest("hex"),
      );
    }
  }
});

test("blockquote links preserve original destination spans across container continuations", () => {
  const forms = [
    "[B\n](DESTINATION)",
    "[B](\nDESTINATION\n)",
    "[B\n ](DESTINATION)",
    "[B](\n DESTINATION\n )",
    "[B\n ](\n DESTINATION\n )",
    '[**B**\n ](\n <DESTINATION> "[title](renma-asset:b)"\n )',
    '[`[label](renma-asset:b)`\n ](\n DESTINATION "[title](renma-asset:b)"\n )',
    '[B > renma-asset:b\n ](<DESTINATION> "title > renma-asset:b")',
  ];
  for (const prefix of ["> ", "> > ", ">>"]) {
    for (const newline of ["\n", "\r\n"]) {
      for (const form of forms) {
        const quoted = form
          .split("\n")
          .map((line) => prefix + line)
          .join("\n");
        const inert = [
          "`[code](renma-asset:b)`",
          "",
          "```md",
          "[fenced](renma-asset:b)",
          "```",
        ]
          .map((line) => prefix + line)
          .join("\n");
        const original = skill(
          "a",
          "skill.b",
          [pin("skill.b")],
          `😀\n\n${quoted}\n\n${inert}\n`,
        );
        const template =
          "\uFEFF" +
          Buffer.from(original.bytes).toString().replaceAll("\n", newline);
        const expectedStart = template.indexOf("DESTINATION");
        const content = template.replace("DESTINATION", "renma-asset:b");
        const input = file(original.path, content);
        const report = source([input]);
        assert.equal(
          report.declarationValid,
          true,
          JSON.stringify({
            prefix,
            newline,
            form,
            diagnostics: report.diagnostics,
          }),
        );
        assert.equal(report.references.length, 1);
        const destination = report.references[0]!.destination!;
        assert.equal(destination.start, expectedStart);
        assert.equal(destination.end, expectedStart + "renma-asset:b".length);
        assert.equal(destination.raw, "renma-asset:b");
        assert.equal(
          content.slice(destination.start, destination.end),
          destination.raw,
        );
        assert.equal(
          destination.startLine,
          content.slice(0, expectedStart).split("\n").length,
        );
        assert.equal(destination.endLine, destination.startLine);
        assert.equal(
          destination.sha256,
          createHash("sha256").update(input.bytes).digest("hex"),
        );
      }
    }
  }
});

test("blockquote containers do not make unsupported reference forms rewritable", () => {
  const body =
    "> ![B](\n> renma-asset:b\n> )\n\n> [B](\n> renma-asset:%62\n> )\n\n> [B](\n> renma-asset:b\\-x\n> )\n\n> <renma-asset:b>\n\n> [B][ref]\n>\n> [ref]: renma-asset:b\n";
  const report = source([skill("a", "skill.b", [pin("skill.b")], body)]);
  assert.equal(report.declarationValid, false);
  assert.equal(report.references.length, 6);
  assert.ok(
    report.references.every((reference) => reference.destination === undefined),
  );
  assert.equal(
    report.diagnostics.filter(
      (d) => d.code === "RN-BINDING-UNSUPPORTED-REFERENCE",
    ).length,
    6,
  );
});

test("HTML attribute character references cannot hide reserved asset destinations", () => {
  const destinations = [
    "renma&#45;asset:b",
    "renma-asset&#58;b",
    "&#x72;enma-asset:b",
    "renma&hyphen;asset&colon;b",
    "renma-asset&colon;b",
    "RENMA&#x2d;ASSET&#x3a;b",
    "renma&#45asset:b",
    "renma&#9;-asset:b",
    "renma&#10;-asset:b",
    "renma&#13;-asset:b",
    "&#x20;renma&#45;asset:b",
    "&#x01;renma-asset:b",
    "  renma&#45;asset:b",
    "&#x1f;renma&#9;&hyphen;asset&#13;&colon;b&#x01;",
    "renma-asset&#10;:b&#x1f;",
  ];
  for (const destination of destinations) {
    for (const html of [
      `<a href="${destination}">B</a>`,
      `<img SRC='${destination}' alt="B">`,
      `<a href="https://example.com" src="${destination}">B</a>`,
      `<a title="href='ordinary'" HREF = ${destination} data-note="B">B</a>`,
      `<a\n data-note="unrelated"\n HrEf\t=\n "${destination}">B</a>`,
    ]) {
      for (const [prefix, newline] of [
        ["", "\n"],
        ["> > ", "\r\n"],
      ]) {
        const body =
          "😀\n\n" +
          html
            .split("\n")
            .map((line) => prefix + line)
            .join("\n");
        const original = skill("a", "skill.b", [pin("skill.b")], body);
        const content =
          "\uFEFF" +
          Buffer.from(original.bytes).toString().replaceAll("\n", newline!);
        const input = file(original.path, content);
        const report = source([input, skill("b", undefined, [], "", "1.0.0")]);
        assert.equal(report.bindings[0]!.satisfaction.status, "matched");
        assert.equal(
          report.declarationValid,
          false,
          JSON.stringify({ html, prefix, newline }),
        );
        assert.deepEqual(report.references, []);
        const diagnostics = report.diagnostics.filter(
          (d) => d.code === "RN-BINDING-UNSUPPORTED-REFERENCE",
        );
        assert.equal(diagnostics.length, 1);
        const evidence = diagnostics[0]!.evidence;
        assert.equal(evidence.path, input.path);
        assert.equal(
          evidence.start,
          content.indexOf(html.startsWith("<img") ? "<img" : "<a"),
        );
        const openingTag = html
          .slice(0, html.indexOf(">") + 1)
          .split("\n")
          .map((line, index) => (index ? prefix + line : line))
          .join(newline);
        assert.equal(evidence.end, evidence.start + openingTag.length);
        assert.equal(content.slice(evidence.start, evidence.end), evidence.raw);
        assert.ok(evidence.raw.includes(destination));
        assert.equal(
          evidence.startLine,
          content.slice(0, evidence.start).split("\n").length,
        );
        assert.equal(
          evidence.endLine,
          content.slice(0, evidence.end - 1).split("\n").length,
        );
        assert.equal(
          evidence.sha256,
          createHash("sha256").update(input.bytes).digest("hex"),
        );
      }
    }
  }
});

test("HTML detection ignores comments, raw text, unrelated attributes and ineffective entities", () => {
  const bodies = [
    '<!-- <a href="renma&#45;asset:b">B</a> -->',
    '<!-- <a href="renma-asset:b">B</a> -->',
    '<!-- unclosed <a href="renma&#45;asset:b">',
    '<div>href="renma&#45;asset:b" and renma&hyphen;asset&colon;b</div>',
    '<div>href="renma-asset:b"</div>',
    '<a data-href="renma&#45;asset:b" title="href=renma-asset:b" href="https://example.com">B</a>',
    '<a title="<a href=renma-asset:b>" aria-label="src=renma-asset:b">B</a>',
    "<script>const example = '<a href=\"renma&#45;asset:b\">B</a>';</script>",
    "text <script>const example = '<a href=\"renma-asset:b\">B</a>';</script> tail",
    '<style>/* <img src="renma-asset:b"> */</style>',
    '<textarea><a href="renma&#45;asset:b">B</a></textarea>',
    '<a href="renma&amp;hyphen;asset&colon;b">B</a>',
    '<a href="renma&unknown;asset:b">B</a>',
    '<a href="renma&ndash;asset:b">B</a>',
    '<a href="renma-aſſet:b">B</a>',
    '<a href="renma-asset&colonb">B</a>',
    '<a href="renma\\-asset:b">B</a>',
    '<a href="https://example.com" HREF="renma&#45;asset:b">B</a>',

    '<a href="renma&hyphenasset&colon;b">B</a>',
    '<a href="renma&notit;asset:b">B</a>',
    '<a href="renma&#0;asset:b">B</a>',
    '<a href="renma&#x01;-asset:b">B</a>',
    '<a href="renma&#12;-asset:b">B</a>',
    '<a href="renma -asset:b">B</a>',
    '<a href="&#0;renma-asset:b">B</a>',
    '<a href="&#x7f;renma-asset:b">B</a>',
    '<a href="&nbsp;renma-asset:b">B</a>',
    '<a href="renma&amp;#9;-asset:b">B</a>',
    '<!-- <a href="renma&#9;-asset:b">B</a> -->',
    '<div>href="renma&#9;-asset:b"</div>',
    '<a data-href="renma&#9;-asset:b" href="https://example.com">B</a>',
    '<a href="https://example.com" HREF="&#x01;renma-asset:b">B</a>',
    "<script>const example = '<a href=\"renma&#9;-asset:b\">B</a>';</script>",
    '<script></ſcript><a href="renma&#45;asset:b">B</a>',
    '<div><svg></div><script><a href="renma&#45;asset:b">B</a></div>',
    '<div><math></div><script/><a href="renma&#45;asset:b">B</a></div>',

    '<a href="https://example.com/renma&#45;asset:b">B</a>',
    '`<a href="renma&#45;asset:b">B</a>`',
    '```html\n<a href="renma&#45;asset:b">B</a>\n```',
  ];
  for (const body of bodies) {
    const report = source([
      skill("a", "skill.b", [pin("skill.b")], body),
      skill("b", undefined, [], "", "1.0.0"),
    ]);
    assert.equal(report.declarationValid, true, body);
    assert.deepEqual(report.references, [], body);
    assert.deepEqual(report.diagnostics, [], body);
  }
});

test("HTML raw-text handling resumes after closing tags and inspects their own attributes", () => {
  for (const body of [
    '<script src="renma&#45;asset:b">const ignored = \'<a href="renma-asset:b">\';</script>',
    'text <script>const ignored = \'<a href="renma-asset:b">\';</script><a href="renma&hyphen;asset&colon;b">B</a>',
    '<!-- <a href="renma-asset:b"> --> <a href="renma&#45;asset:b">B</a>',
  ]) {
    const report = source([skill("a", "skill.b", [pin("skill.b")], body)]);
    assert.equal(
      report.diagnostics.filter(
        (d) => d.code === "RN-BINDING-UNSUPPORTED-REFERENCE",
      ).length,
      1,
      body,
    );
    assert.deepEqual(report.references, []);
  }
});

test("HTML recovery and foreign-content states cannot hide reserved destinations", () => {
  for (const body of [
    '<?bogus><a href="renma&#45;asset:b">B</a>?>',
    '<div><!--><a href="renma&#45;asset:b">B</a></div>',
    '<div><!---><a href="renma&#45;asset:b">B</a></div>',
    '<div><!-- comment --!><a href="renma&#45;asset:b">B</a></div>',
    '<div><!-- nested <!--><a href="renma&#45;asset:b">B</a></div>',
    '<div><a_b href="renma&#45;asset:b">B</a_b></div>',
    '<div><aé href="renma&#45;asset:b">B</aé></div>',
    '<div><a/href="renma&#45;asset:b">B</a></div>',
    '<div><a title="example"/href="renma&#45;asset:b">B</a></div>',
    '<div><a title="example"href="renma&#45;asset:b">B</a></div>',
    '<div><a " href="renma&#45;asset:b">B</a></div>',
    '<div><a broken"name href="renma&#45;asset:b">B</a></div>',
    '<svg><script /></svg><a href="renma&#45;asset:b">B</a>',
    '<svg><title><a href="renma&#45;asset:b">B</a></title></svg>',
    '<svg><foreignObject><div></svg></div></foreignObject><g><script/><a href="renma&#45;asset:b">B</a></g></svg>',
  ]) {
    const report = source([
      skill("a", "skill.b", [pin("skill.b")], body),
      skill("b", undefined, [], "", "1.0.0"),
    ]);
    assert.equal(report.bindings[0]!.satisfaction.status, "matched");
    assert.equal(report.declarationValid, false, body);
    assert.deepEqual(report.references, [], body);
    assert.equal(
      report.diagnostics.filter(
        (diagnostic) => diagnostic.code === "RN-BINDING-UNSUPPORTED-REFERENCE",
      ).length,
      1,
      body,
    );
  }
});

test("foreign-content CDATA and HTML integration raw text remain inert", () => {
  const bodies = [
    '<svg><![CDATA[foo > <a href="renma&#45;asset:b">B</a>]]></svg>',
    '<math><![CDATA[foo > <a href="renma&#45;asset:b">B</a>]]></math>',
    '<svg><title><![CDATA[foo > <a href="renma&#45;asset:b">B</a>]]></title></svg>',
    '<svg><title><![CDATA[<a>]]><![CDATA[foo > <a href="renma&#45;asset:b">B</a>]]></title></svg>',
    '<math><annotation-xml encoding="text/html"><![CDATA[foo > <a href="renma&#45;asset:b">B</a>]]></annotation-xml></math>',
    '<script/><a href="renma&#45;asset:b">B</a></script>',
    "<svg><foreignObject><script>const example = '<a href=\"renma&#45;asset:b\">B</a>';</script></foreignObject></svg>",
    '<math><annotation-xml encoding="text&#47;html"><script><a href="renma&#45;asset:b">B</a></script></annotation-xml></math>',
    '<math><annotation-xml encoding="APPLICATION/XHTML+XML"><script><a href="renma&#45;asset:b">B</a></script></annotation-xml></math>',
    '<svg><p><script><a href="renma&#45;asset:b">B</a></script>',
    '<svg><font color="red"><script><a href="renma&#45;asset:b">B</a></script>',
    '<svg></p><script><a href="renma&#45;asset:b">B</a></script>',
    '<math><mrow></br><script><a href="renma&#45;asset:b">B</a></script>',
  ];
  for (const point of ["mi", "mo", "mn", "ms", "mtext"])
    bodies.push(
      `<math><${point}><script><a href="renma&#45;asset:b">B</a></script></${point}></math>`,
    );
  for (const body of bodies) {
    const report = source([
      skill("a", "skill.b", [pin("skill.b")], body),
      skill("b", undefined, [], "", "1.0.0"),
    ]);
    assert.equal(report.declarationValid, true, body);
    assert.deepEqual(report.references, [], body);
    assert.deepEqual(report.diagnostics, [], body);
  }
});

test("MathML integration exceptions and non-HTML annotations remain inspectable", () => {
  for (const body of [
    '<math><mtext><mglyph><script><a href="renma&#45;asset:b">B</a></script></mglyph></mtext></math>',
    '<math><mtext><malignmark><script><a href="renma&#45;asset:b">B</a></script></malignmark></mtext></math>',
    '<math><annotation-xml><script><a href="renma&#45;asset:b">B</a></script></annotation-xml></math>',
    '<math><annotation-xml encoding="text/plain"><script><a href="renma&#45;asset:b">B</a></script></annotation-xml></math>',
    '<svg><font><script><a href="renma&#45;asset:b">B</a></script></font></svg>',
  ]) {
    const report = source([
      skill("a", "skill.b", [pin("skill.b")], body),
      skill("b", undefined, [], "", "1.0.0"),
    ]);
    assert.equal(report.declarationValid, false, body);
    assert.equal(
      report.diagnostics.filter(
        (diagnostic) => diagnostic.code === "RN-BINDING-UNSUPPORTED-REFERENCE",
      ).length,
      1,
      body,
    );
  }
});

test("optional externally supplied commit preserves declarations and legacy output", async () => {
  const schema = JSON.parse(
    await readFile("docs/schemas/asset-bindings-v1.schema.json", "utf8"),
  ) as AnySchemaObject;
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const commit = "7e91d1654d" + "a".repeat(30);
  for (const declaration of [
    pin("skill.b"),
    { ...pin("skill.b"), ref: "v1.0.0", resolved: { commit } },
    { alias: "b", target: "skill.b", ref: "main", resolved: { commit } },
    { alias: "b", target: "skill.b", ref: "main" },
    { ...pin("skill.b"), resolved: { commit: "A".repeat(64) } },
  ]) {
    const input = skill("a", "skill.b", [declaration]);
    const before = input.bytes.slice();
    const report = inspectAssetBindings([
      input,
      skill("b", undefined, [], "", "1.0.0"),
    ]);
    assert.ok(validate(report), JSON.stringify(validate.errors));
    const binding = report.documents.find((d) => d.identity.id === "skill.a")!
      .bindings[0]!;
    assert.equal(binding.declarationValid, true);
    assert.equal(binding.satisfied, true);
    const {
      entryIndex,
      evidence,
      relationships,
      declarationValid,
      satisfaction,
      satisfied,
      ...metadata
    } = binding;
    assert.deepEqual(metadata, declaration);
    assert.deepEqual(JSON.parse(JSON.stringify(binding)), binding);
    assert.deepEqual(input.bytes, before);
    assert.equal(evidence.raw.includes("resolved"), "resolved" in declaration);
    // Returned provenance is detached and never replaces the declared release.
    if (binding.resolved) binding.resolved.commit = "b".repeat(40);
    assert.deepEqual(
      inspectAssetBindings([
        input,
        skill("b", undefined, [], "", "1.0.0"),
      ]).documents.find((d) => d.identity.id === "skill.a")!.bindings[0]!
        .resolved,
      "resolved" in declaration ? declaration.resolved : undefined,
    );
  }
});

test("ref-only satisfaction checks identity/kind without claiming Git verification", () => {
  const declaration = {
    alias: "b",
    target: "skill.b",
    ref: "main",
    resolved: { commit: "a".repeat(40) },
  };
  const a = skill("a", "skill.b", [declaration]);
  const noVersion = file(
    "skills/b/SKILL.md",
    "---\nname: b\ndescription: Review workflows.\nmetadata:\n  renma.id: skill.b\n---\n",
  );
  assert.equal(
    source([a, noVersion]).bindings[0]!.satisfaction.status,
    "matched",
  );
  assert.equal(source([a]).bindings[0]!.satisfaction.status, "missing");
  assert.equal(
    source([a, context("skill.b")]).bindings[0]!.satisfaction.status,
    "kind-mismatch",
  );
  assert.equal(
    source([a, noVersion, context("skill.b")]).bindings[0]!.satisfaction.status,
    "ambiguous",
  );
  const versioned = skill("a", "skill.b", [
    { ...declaration, version: "2.0.0" },
  ]);
  assert.equal(
    source([versioned, skill("b", undefined, [], "", "1.0.0")]).bindings[0]!
      .satisfaction.status,
    "version-mismatch",
  );
});

test("provenance validation rejects malformed fields in JSON, YAML and wire schema", async () => {
  const schema = JSON.parse(
    await readFile("docs/schemas/asset-bindings-v1.schema.json", "utf8"),
  ) as AnySchemaObject;
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const valid = inspectAssetBindings([skill("a", "skill.b"), skill("b")]);
  for (const extra of [
    { resolved: null },
    { resolved: [] },
    { resolved: {} },
    { resolved: { commit: "7e91d16" } },
    { resolved: { commit: "g".repeat(40) } },
    { resolved: { commit: "a".repeat(39) } },
    { resolved: { commit: "a".repeat(41) } },
    { resolved: { commit: "a".repeat(40) + " " } },
    { resolved: { commit: "a".repeat(40) + "\n" } },
    { resolved: { commit: 1 } },
    { resolved: { commit: "a".repeat(40), extra: true } },
    { ref: " main" },
    { ref: "" },
    { ref: null },
    { version: null },
  ]) {
    const binding = { ...pin("skill.b"), ...extra };
    const report = source([skill("a", "skill.b", [binding])]);
    assert.equal(report.declarationValid, false, JSON.stringify(extra));
    assert.ok(
      report.diagnostics.some((d) => d.code === "RN-BINDING-MALFORMED"),
    );
    const bad = structuredClone(valid);
    Object.assign(
      bad.documents.find((d) => d.identity.id === "skill.a")!.bindings[0]!,
      extra,
    );
    assert.equal(validate(bad), false, JSON.stringify(extra));
  }
  const noSelector = {
    alias: "b",
    target: "skill.b",
    resolved: { commit: "a".repeat(40) },
  };
  assert.equal(
    source([skill("a", "skill.b", [noSelector])]).declarationValid,
    false,
  );
  const bad = structuredClone(valid);
  delete bad.documents.find((d) => d.identity.id === "skill.a")!.bindings[0]!
    .version;
  assert.equal(validate(bad), false);
  for (const metadata of [
    " - {alias: b, target: ctx, ref: main, resolved: {commit: '" +
      "a".repeat(40) +
      "'}}",
    " - {alias: b, target: ctx, version: '1', ref: v1, resolved: {commit: '" +
      "a".repeat(40) +
      "'}}",
    " - {alias: b, target: ctx, ref: main, resolved: {commit: short}}",
    " - {alias: b, target: ctx, ref: main, resolved: {commit: '" +
      "a".repeat(40) +
      "', commit: '" +
      "b".repeat(40) +
      "'}}",
  ]) {
    const report = inspectAssetBindings([
      context(
        "parent",
        "1",
        "requires_context: [ctx]\nasset_bindings:\n" + metadata + "\n",
      ),
      context("ctx", "1"),
    ]);
    const parent = report.documents.find((d) => d.identity.id === "parent")!;
    assert.equal(
      parent.declarationValid,
      !metadata.includes("short") && !metadata.includes("b".repeat(40)),
    );
    assert.ok(validate(report), JSON.stringify(validate.errors));
  }
  const duplicate = skill("a", "skill.b", [
    { ...pin("skill.b"), resolved: { commit: "a".repeat(40) } },
  ]);
  const text = Buffer.from(duplicate.bytes)
    .toString()
    .replace(
      '"commit":"' + "a".repeat(40) + '"',
      '"commit":"' + "a".repeat(40) + '","commit":"' + "b".repeat(40) + '"',
    );
  assert.equal(source([file(duplicate.path, text)]).declarationValid, false);
});
