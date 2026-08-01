import { defineConfig } from "vitepress";

import { configureMermaidMarkdown } from "./mermaid.js";

const repositoryUrl = "https://github.com/KazuCocoa/renma";
const base = "/renma/";
const cloudflareWebAnalyticsToken = "f11a01438b294ad2a0b56b3e8f607312";

export default defineConfig({
  title: "Renma",
  description:
    "A Git-native Context Repository and deterministic governance CLI for agent-facing knowledge.",
  base,
  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        href: `${base}branding/favicon.png`,
      },
    ],
    [
      "script",
      {
        defer: "",
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        "data-cf-beacon": JSON.stringify({
          token: cloudflareWebAnalyticsToken,
        }),
      },
    ],
  ],
  markdown: {
    config: configureMermaidMarkdown,
  },
  themeConfig: {
    logo: {
      src: "/branding/renma-icon.png",
      alt: "Renma",
      width: 24,
      height: 24,
    },
    nav: [
      { text: "Overview", link: "/" },
      { text: "Documentation Index", link: "/README" },
      {
        text: "Guides",
        items: [
          { text: "User Manual", link: "/user-manual" },
          { text: "Authoring Guide", link: "/authoring-guide" },
        ],
      },
    ],
    sidebar: [
      {
        text: "Start Here",
        items: [
          { text: "Overview", link: "/" },
          { text: "Documentation Index", link: "/README" },
          { text: "User Manual", link: "/user-manual" },
          { text: "Authoring Guide", link: "/authoring-guide" },
        ],
      },
      {
        text: "Core Concepts",
        items: [
          {
            text: "Agent Skills Compatibility",
            link: "/agent-skills-compatibility",
          },
          { text: "Context Lens", link: "/context-lens" },
          { text: "Declared Composition", link: "/declared-composition" },
          { text: "Declared Impact", link: "/declared-impact" },
          { text: "Skill Discovery", link: "/skill-discovery" },
          {
            text: "Repository Context BOM",
            link: "/repository-context-bom",
          },
          { text: "Trust Graph", link: "/trust-graph" },
        ],
      },
      {
        text: "Diagnostics And Security",
        items: [
          { text: "Diagnostics Reference", link: "/diagnostics" },
          { text: "Security Policy Guide", link: "/security-policy" },
          { text: "Quality Profile", link: "/quality-profile" },
        ],
      },
      {
        text: "Architecture And Direction",
        items: [
          {
            text: "Public Architecture (GitHub)",
            link: `${repositoryUrl}/blob/main/architecture.md`,
          },
          { text: "Internal Architecture", link: "/internal-architecture" },
          {
            text: "External Review Governance (Candidate)",
            link: "/external-review-governance",
          },
        ],
      },
    ],
    search: {
      provider: "local",
    },
    socialLinks: [{ icon: "github", link: repositoryUrl }],
    docFooter: {
      prev: "Previous page",
      next: "Next page",
    },
  },
});
