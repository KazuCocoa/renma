import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "../src/markdown.js";
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
