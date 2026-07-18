import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "../src/markdown.js";
import { markdownSyntaxForDocument } from "../src/markdown-syntax.js";
import type { Artifact } from "../src/types.js";

test("parseDocument extracts frontmatter, headings, links, and code fences", () => {
  const document = parseDocument(
    artifact(`---
id: demo-skill
owner: qa-platform
---
# Demo Skill

Read [the guide](references/guide.md).

\`\`\`bash
npm test
\`\`\`
`),
  );

  assert.deepEqual(document.metadata, {
    id: "demo-skill",
    owner: "qa-platform",
  });
  assert.deepEqual(
    document.headings.map((heading) => heading.text),
    ["Demo Skill"],
  );
  assert.deepEqual(
    document.links.map((link) => link.target),
    ["references/guide.md"],
  );
  assert.deepEqual(
    document.codeFences.map((fence) => fence.language),
    ["bash"],
  );
  assert.match(document.codeFences[0]?.content ?? "", /npm test/);
});

test("parseDocument keeps raw lines but skips Markdown structure when ineligible", () => {
  const content = `---
id: hijacked
owner: wrong-team
---
# Not a Markdown heading
[not a link](references/guide.md)

\`\`\`bash
echo not-a-fence
\`\`\`
`;
  const document = parseDocument({
    path: "skills/demo/scripts/check.sh",
    absolutePath: "/tmp/skills/demo/scripts/check.sh",
    kind: "script",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: false,
    content,
  });

  assert.ok(document.lines.length > 0);
  assert.deepEqual(document.metadata, {});
  assert.deepEqual(document.headings, []);
  assert.deepEqual(document.links, []);
  assert.deepEqual(document.codeFences, []);
});

test("CommonMark structure ignores Markdown-looking text in code and comments", () => {
  const document = parseDocument(
    artifact(`~~~markdown
# Tilde example
[tilde link](tilde.md)
~~~

\`\`\`\`text
# Long fence example
[long link](long.md)
\`\`\`
\`\`\`\`

Inline \`[inline link](inline.md)\` remains code.
<!--
# Comment heading
[comment link](comment.md)
-->
`),
  );

  assert.deepEqual(document.headings, []);
  assert.deepEqual(document.links, []);
  assert.deepEqual(
    document.codeFences.map((fence) => [
      fence.language,
      fence.startLine,
      fence.endLine,
    ]),
    [
      ["markdown", 1, 4],
      ["text", 6, 10],
    ],
  );
  assert.match(document.codeFences[1]?.content ?? "", /```/);
});

test("CommonMark structure supports balanced link destinations and rich headings", () => {
  const document = parseDocument(
    artifact(`# **Formatted** heading with [guide](docs/a_(b).md)

Setext *heading*
----------------
`),
  );

  assert.deepEqual(document.headings, [
    { depth: 1, text: "Formatted heading with guide", line: 1 },
    { depth: 2, text: "Setext heading", line: 3 },
  ]);
  assert.deepEqual(document.links, [
    { text: "guide", target: "docs/a_(b).md", line: 1 },
  ]);
});

test("outline headings remain top-level and exclude quoted container headings", () => {
  const document = parseDocument(
    artifact(`> # Quoted heading
>
> Quoted material.

# Top-level heading
`),
  );

  assert.deepEqual(document.headings, [
    { depth: 1, text: "Top-level heading", line: 5 },
  ]);
});

test("fenced projection stays distinct from indented code ranges", () => {
  const document = parseDocument(
    artifact(`    indented code
    # not a heading

\`\`\`js
const value = 1;
\`\`\`
`),
  );
  const syntax = markdownSyntaxForDocument(document);

  assert.ok(syntax);
  assert.equal(JSON.stringify(document).includes('"type":"root"'), false);
  assert.deepEqual(
    syntax.codeBlocks.map((block) => [
      block.kind,
      block.startLine,
      block.endLine,
    ]),
    [
      ["indented", 1, 2],
      ["fenced", 4, 6],
    ],
  );
  assert.deepEqual(document.codeFences, [
    {
      language: "js",
      content: "const value = 1;",
      startLine: 4,
      endLine: 6,
    },
  ]);
});

test("unclosed fences use the mdast source range and retain body content", () => {
  const document = parseDocument(artifact("```text\nfirst\nsecond\n"));
  const syntax = markdownSyntaxForDocument(document);

  assert.deepEqual(document.codeFences, [
    {
      language: "text",
      content: "first\nsecond\n",
      startLine: 1,
      endLine: 4,
    },
  ]);
  assert.equal(syntax?.codeBlocks[0]?.closed, false);
});

test("frontmatter removal preserves original-file lines for CRLF input", () => {
  const document = parseDocument(
    artifact(
      "---\r\nid: offset-demo\r\nowner: qa\r\n---\r\n# Body\r\n\r\n[guide](docs/guide_(v2).md)\r\n",
    ),
  );
  const syntax = markdownSyntaxForDocument(document);

  assert.equal(syntax?.bodyStartLine, 5);
  assert.deepEqual(document.headings, [{ depth: 1, text: "Body", line: 5 }]);
  assert.deepEqual(document.links, [
    { text: "guide", target: "docs/guide_(v2).md", line: 7 },
  ]);
  assert.equal(document.metadataFields.owner?.startLine, 3);
  assert.equal(document.lines[4], "# Body");
});

test("binary artifacts preserve fail-closed empty projections", () => {
  const document = parseDocument({
    ...artifact("# Binary-looking heading\n[link](target.md)"),
    contentClassification: "binary",
  });

  assert.deepEqual(document.lines, []);
  assert.deepEqual(document.headings, []);
  assert.deepEqual(document.links, []);
  assert.deepEqual(document.codeFences, []);
  assert.equal(markdownSyntaxForDocument(document), undefined);
});

function artifact(content: string): Artifact {
  return {
    path: "skills/demo/SKILL.md",
    absolutePath: "/tmp/skills/demo/SKILL.md",
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
