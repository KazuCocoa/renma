import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "../src/markdown.js";
import {
  ensureMarkdownSyntaxForDocument,
  markdownSyntaxForDocument,
} from "../src/markdown-syntax.js";
import type { Artifact, ParsedDocument } from "../src/types.js";

test("parseDocument preserves the complete established Markdown projection", () => {
  const document = parseDocument(
    artifact(`---
id: demo-skill
owner: qa-platform
tags:
  - parser
  - stable
---
# Demo Skill

Read [the guide](references/guide.md).

\`\`\`bash
npm test
\`\`\`
`),
  );

  assert.deepEqual(document.lines, [
    "---",
    "id: demo-skill",
    "owner: qa-platform",
    "tags:",
    "  - parser",
    "  - stable",
    "---",
    "# Demo Skill",
    "",
    "Read [the guide](references/guide.md).",
    "",
    "```bash",
    "npm test",
    "```",
    "",
  ]);
  assert.deepEqual(document.headings, [
    { depth: 1, text: "Demo Skill", line: 8 },
  ]);
  assert.deepEqual(document.links, [
    { text: "the guide", target: "references/guide.md", line: 10 },
  ]);
  assert.deepEqual(document.codeFences, [
    {
      language: "bash",
      content: "npm test",
      startLine: 12,
      endLine: 14,
    },
  ]);
  assert.deepEqual(document.metadata, {
    id: "demo-skill",
    owner: "qa-platform",
    tags: ["parser", "stable"],
  });
  assert.deepEqual(document.metadataFields, {
    id: fieldEvidence("id", 2, 2, "id: demo-skill"),
    owner: fieldEvidence("owner", 3, 3, "owner: qa-platform"),
    tags: fieldEvidence("tags", 4, 6, "tags:\n  - parser\n  - stable"),
  });
  assert.deepEqual(document.metadataListItems, {
    tags: [
      fieldEvidence("tags", 5, 5, "  - parser"),
      fieldEvidence("tags", 6, 6, "  - stable"),
    ],
  });
});

test("syntax recovery supports original, copied, and reconstructed documents", () => {
  const parsed = parseDocument(artifact("# Demo\n\n```text\nexample\n```\n"));
  const attached = markdownSyntaxForDocument(parsed);
  assert.ok(attached);
  assert.equal(ensureMarkdownSyntaxForDocument(parsed), attached);

  const copied: ParsedDocument = { ...parsed };
  assert.equal(markdownSyntaxForDocument(copied), undefined);
  const copiedSyntax = ensureMarkdownSyntaxForDocument(copied);
  assert.ok(copiedSyntax);
  assert.equal(ensureMarkdownSyntaxForDocument(copied), copiedSyntax);

  const reconstructed: ParsedDocument = {
    artifact: parsed.artifact,
    lines: [...parsed.lines],
    headings: [...parsed.headings],
    codeFences: [...parsed.codeFences],
    links: [...parsed.links],
    metadata: { ...parsed.metadata },
    metadataFields: { ...parsed.metadataFields },
    metadataListItems: { ...parsed.metadataListItems },
  };
  const reconstructedSyntax = ensureMarkdownSyntaxForDocument(reconstructed);
  assert.ok(reconstructedSyntax);
  assert.deepEqual(
    reconstructedSyntax.codeBlocks.map((block) => block.kind),
    ["fenced"],
  );
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
  assert.equal(ensureMarkdownSyntaxForDocument(document), undefined);
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

test("links retain image targets while mdast keeps node kinds distinct", () => {
  const document = parseDocument(
    artifact(`![diagram](assets/flow.png) then [guide](docs/guide.md).

\`![inline](assets/inline.png)\`

    ![indented](assets/indented.png)

\`\`\`markdown
![fenced](assets/fenced.png)
\`\`\`

<!-- ![comment](assets/comment.png) -->
!\\[escaped](assets/escaped.png)
![malformed](assets/malformed.png
`),
  );
  const syntax = ensureMarkdownSyntaxForDocument(document);

  assert.deepEqual(document.links, [
    { text: "diagram", target: "assets/flow.png", line: 1 },
    { text: "guide", target: "docs/guide.md", line: 1 },
  ]);
  assert.deepEqual(
    syntax?.linkTargets.map((target) => [target.kind, target.target]),
    [
      ["image", "assets/flow.png"],
      ["link", "docs/guide.md"],
    ],
  );
  assert.equal(syntax?.images[0]?.text, "diagram");
});

test("reference-style target resolution remains intentionally deferred", () => {
  const document = parseDocument(
    artifact(`[guide][guide-ref] and ![diagram][diagram-ref]

[guide-ref]: docs/guide.md
[diagram-ref]: assets/flow.png
`),
  );

  assert.deepEqual(document.links, []);
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
  assert.equal(ensureMarkdownSyntaxForDocument(document), undefined);
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

function fieldEvidence(
  key: string,
  startLine: number,
  endLine: number,
  raw: string,
) {
  return {
    path: "skills/demo/SKILL.md",
    key,
    startLine,
    endLine,
    raw,
  };
}
