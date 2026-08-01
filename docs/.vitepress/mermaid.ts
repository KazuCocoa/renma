import type { MermaidConfig } from "mermaid";
import type { MarkdownOptions } from "vitepress";

type MarkdownRenderer = Parameters<NonNullable<MarkdownOptions["config"]>>[0];

export const mermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral",
  htmlLabels: false,
  suppressErrorRendering: true,
  deterministicIds: true,
  flowchart: {
    useMaxWidth: false,
  },
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "maxTextSize",
    "maxEdges",
    "suppressErrorRendering",
    "htmlLabels",
    "theme",
    "deterministicIds",
  ],
} satisfies MermaidConfig;

export function configureMermaidMarkdown(md: MarkdownRenderer): void {
  const defaultFenceRenderer = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    if (token === undefined || token.info.trim().toLowerCase() !== "mermaid") {
      return defaultFenceRenderer
        ? defaultFenceRenderer(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
    }

    return [
      '<div class="mermaid-container" role="figure" aria-label="Mermaid diagram">',
      `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`,
      "</div>",
      "",
    ].join("\n");
  };
}
