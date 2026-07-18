import assert from "node:assert/strict";
import test from "node:test";

import { MarkdownSecurityView } from "../src/markdown-security-view.js";
import {
  markdownCodeLineNumbers,
  parseMarkdownSyntax,
} from "../src/markdown-syntax.js";

interface FenceCase {
  name: string;
  source: string;
  expected: {
    closed: boolean;
    startLine: number;
    endLine: number;
    contentStartLine: number;
    contentEndLine: number;
    content: string;
  };
}

const fenceCases: FenceCase[] = [
  {
    name: "top-level backtick",
    source: "```bash\nnode scripts/check.js\n```",
    expected: closedFence(1, 3, "node scripts/check.js"),
  },
  {
    name: "top-level tilde",
    source: "~~~bash\nnode scripts/check.js\n~~~",
    expected: closedFence(1, 3, "node scripts/check.js"),
  },
  {
    name: "unordered-list",
    source: "- outer\n\n  ```bash\n  node scripts/check.js\n  ```",
    expected: closedFence(3, 5, "  node scripts/check.js"),
  },
  {
    name: "nested unordered-list",
    source:
      "- outer\n  - inner\n\n    ```bash\n    node scripts/check.js\n    ```",
    expected: closedFence(4, 6, "    node scripts/check.js"),
  },
  {
    name: "ordered-list",
    source: "1. outer\n\n   ```bash\n   node scripts/check.js\n   ```",
    expected: closedFence(3, 5, "   node scripts/check.js"),
  },
  {
    name: "nested ordered-list",
    source:
      "1. outer\n   1. inner\n\n      ```bash\n      node scripts/check.js\n      ```",
    expected: closedFence(4, 6, "      node scripts/check.js"),
  },
  {
    name: "blockquote",
    source: "> ```bash\n> node scripts/check.js\n> ```",
    expected: closedFence(1, 3, "> node scripts/check.js"),
  },
  {
    name: "different allowed opening and closing indentation",
    source: "  ```bash\n  node scripts/check.js\n ```",
    expected: closedFence(1, 3, "  node scripts/check.js"),
  },
  {
    name: "closing marker longer than opening marker",
    source: "```bash\nnode scripts/check.js\n`````",
    expected: closedFence(1, 3, "node scripts/check.js"),
  },
  {
    name: "unclosed nested fence without trailing newline",
    source: "- outer\n\n  ````bash\n  node scripts/check.js\n  ```",
    expected: {
      closed: false,
      startLine: 3,
      endLine: 5,
      contentStartLine: 4,
      contentEndLine: 5,
      content: "  node scripts/check.js\n  ```",
    },
  },
  {
    name: "unclosed nested fence with trailing newline",
    source: "- outer\n\n  ````bash\n  node scripts/check.js\n  ```\n",
    expected: {
      closed: false,
      startLine: 3,
      endLine: 6,
      contentStartLine: 4,
      contentEndLine: 6,
      content: "  node scripts/check.js\n  ```\n",
    },
  },
];

for (const fixture of fenceCases) {
  test(`projects ${fixture.name} fence source ranges`, () => {
    const syntax = parseMarkdownSyntax(fixture.source);
    const block = syntax.codeBlocks[0];
    assert.ok(block);
    assert.equal(syntax.codeBlocks.length, 1);
    assert.deepEqual(
      {
        kind: block.kind,
        closed: block.closed,
        startLine: block.startLine,
        endLine: block.endLine,
        contentStartLine: block.contentStartLine,
        contentEndLine: block.contentEndLine,
        content: block.content,
      },
      { kind: "fenced", ...fixture.expected },
    );

    const codeLines = markdownCodeLineNumbers(syntax);
    assert.deepEqual(
      [...codeLines],
      inclusiveLines(fixture.expected.startLine, fixture.expected.endLine),
    );

    const view = new MarkdownSecurityView(syntax);
    for (let line = 1; line <= syntax.sourceLines.length; line += 1) {
      assert.equal(
        view.isCodeBlockLine(line - 1),
        line >= fixture.expected.startLine && line <= fixture.expected.endLine,
        `${fixture.name}: code block line ${line}`,
      );
      assert.equal(
        view.isCodeContentLine(line - 1),
        line >= fixture.expected.contentStartLine &&
          line <= fixture.expected.contentEndLine,
        `${fixture.name}: code content line ${line}`,
      );
    }
  });
}

function closedFence(
  startLine: number,
  endLine: number,
  content: string,
): FenceCase["expected"] {
  return {
    closed: true,
    startLine,
    endLine,
    contentStartLine: startLine + 1,
    contentEndLine: endLine - 1,
    content,
  };
}

function inclusiveLines(startLine: number, endLine: number): number[] {
  return Array.from(
    { length: endLine - startLine + 1 },
    (_, index) => startLine + index,
  );
}
