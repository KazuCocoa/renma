import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { Mermaid } from "mermaid";
import { createMarkdownRenderer } from "vitepress";

import {
  configureMermaidMarkdown,
  mermaidConfig,
} from "../docs/.vitepress/mermaid.js";

const docsRoot = path.join(process.cwd(), "docs");
const mermaidFence = /^```mermaid[\t ]*\r?\n([\s\S]*?)^```[\t ]*$/gm;

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findMarkdownFiles(absolutePath);
      return entry.isFile() && entry.name.endsWith(".md") ? [absolutePath] : [];
    }),
  );
  return files.flat();
}

async function collectMermaidSources(): Promise<Map<string, string[]>> {
  const inventory = new Map<string, string[]>();
  for (const file of await findMarkdownFiles(docsRoot)) {
    const markdown = await readFile(file, "utf8");
    const sources = Array.from(
      markdown.matchAll(mermaidFence),
      (match) => match[1] ?? "",
    );
    if (sources.length > 0) {
      inventory.set(path.relative(process.cwd(), file), sources);
    }
  }
  return inventory;
}

async function loadMermaidParser(): Promise<Mermaid> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  // Mermaid's parser sanitizes labels through DOMPurify. Give DOMPurify the
  // minimal window shape it needs to expose its pass-through Node sanitizer;
  // real sanitization and SVG rendering are covered by the browser smoke test.
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      document: {
        nodeType: 9,
        currentScript: null,
        createElement: () => ({}),
      },
      Element: class {},
    },
  });

  try {
    return (await import("mermaid")).default;
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", previousWindow);
    }
  }
}

test("documentation Mermaid inventory remains covered", async () => {
  const inventory = await collectMermaidSources();
  assert.deepEqual(
    Object.fromEntries(
      Array.from(inventory, ([file, sources]) => [file, sources.length]).sort(),
    ),
    {
      "docs/development/architecture.md": 1,
      "docs/development/design.md": 1,
      "docs/external-review-governance.md": 1,
      "docs/repository-context-bom.md": 1,
      "docs/user-manual.md": 2,
    },
  );
});

test("only Mermaid fences use the Mermaid source container", async () => {
  const markdown = await createMarkdownRenderer(docsRoot, {
    config: configureMermaidMarkdown,
  });
  const html = await markdown.render(`\
\`\`\`mermaid
flowchart LR
  A["<unsafe>&"] --> B
\`\`\`

\`\`\`bash
printf ok
\`\`\`

\`\`\`json
{"normal": true}
\`\`\`
`);

  assert.equal(html.match(/class="mermaid-container"/g)?.length, 1);
  assert.match(html, /role="figure" aria-label="Mermaid diagram"/);
  assert.match(html, /A\[&quot;&lt;unsafe&gt;&amp;&quot;\] --&gt; B/);
  assert.match(html, /class="language-bash/);
  assert.match(html, /class="language-json/);
});

test("all documentation Mermaid sources parse with the site configuration", async () => {
  assert.equal(mermaidConfig.securityLevel, "strict");
  assert.equal(mermaidConfig.htmlLabels, false);
  assert.equal(mermaidConfig.startOnLoad, false);
  assert.equal(mermaidConfig.suppressErrorRendering, true);
  assert.ok(mermaidConfig.secure.includes("securityLevel"));
  assert.ok(mermaidConfig.secure.includes("htmlLabels"));

  const mermaid = await loadMermaidParser();
  mermaid.initialize(mermaidConfig);
  for (const [file, sources] of await collectMermaidSources()) {
    for (const [index, source] of sources.entries()) {
      assert.doesNotMatch(
        source,
        /<br\s*\/?\s*>/i,
        `${file} diagram ${index + 1}`,
      );
      await assert.doesNotReject(
        mermaid.parse(source),
        `${file} diagram ${index + 1}`,
      );
    }
  }
});
