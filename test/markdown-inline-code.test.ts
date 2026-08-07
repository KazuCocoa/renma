import assert from "node:assert/strict";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";

import {
  formatMarkdownInlineCode,
  visibleMarkdownInlineValue,
} from "../src/renderers/markdown-inline-code.js";

test("Markdown inline code uses safe delimiters and preserves edge whitespace", () => {
  const cases = [
    { value: "one`tick", delimiterLength: 2 },
    { value: "two``ticks", delimiterLength: 3 },
    { value: " leading and trailing ", delimiterLength: 1 },
    { value: "`edge ticks`", delimiterLength: 2 },
    { value: "echo `date`", delimiterLength: 2 },
  ];

  for (const { value, delimiterLength } of cases) {
    const rendered = formatMarkdownInlineCode(value);
    const root = fromMarkdown(rendered);
    const node = root.children[0];
    assert.equal(node?.type, "paragraph", value);
    if (node?.type !== "paragraph") continue;
    const inlineCode = node.children[0];
    assert.equal(inlineCode?.type, "inlineCode", value);
    if (inlineCode?.type !== "inlineCode") continue;
    assert.equal(inlineCode.value, value, value);
    assert.ok(
      rendered.startsWith("`".repeat(delimiterLength)),
      `${value}: ${rendered}`,
    );
  }
});

test("Markdown inline code exposes line-breaking characters on one line", () => {
  const value =
    "first\r\nsecond\vthird\fnext\u0085nel\u2028line\u2029paragraph";
  const visible =
    "first\\r\\nsecond\\vthird\\fnext\\u0085nel\\u2028line\\u2029paragraph";
  const rendered = formatMarkdownInlineCode(value);

  assert.equal(visibleMarkdownInlineValue(value), visible);
  assert.doesNotMatch(rendered, /[\r\n\v\f\u0085\u2028\u2029]/u);
  const root = fromMarkdown(rendered);
  const paragraph = root.children[0];
  assert.equal(paragraph?.type, "paragraph");
  if (paragraph?.type !== "paragraph") return;
  const inlineCode = paragraph.children[0];
  assert.equal(inlineCode?.type, "inlineCode");
  if (inlineCode?.type === "inlineCode") {
    assert.equal(inlineCode.value, visible);
  }
});

test("Markdown inline code renders terminal control characters visibly", () => {
  const value = "tab\tbackspace\bescape\u001bdelete\u007f";
  const visible = "tab\\tbackspace\\bescape\\u001bdelete\\u007f";
  const rendered = formatMarkdownInlineCode(value);

  assert.equal(visibleMarkdownInlineValue(value), visible);
  assert.doesNotMatch(rendered, /\p{Cc}/u);
  assert.match(rendered, /\\u001b/);
});
