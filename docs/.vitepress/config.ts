import { defineConfig } from "vitepress";

import packageJson from "../../package.json" with { type: "json" };

import { configureMermaidMarkdown } from "./mermaid.js";

const repositoryUrl = "https://github.com/KazuCocoa/renma";
const packageUrl = "https://npmjs.org/package/renma";
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
      { text: "Changelog", link: "/changelog" },
      { text: `v${packageJson.version}`, link: packageUrl },
    ],
    sidebar: [
      {
        text: "Start Here",
        items: [
          { text: "Overview", link: "/" },
          { text: "Documentation Index", link: "/README" },
          { text: "User Manual", link: "/user-manual" },
          { text: "Authoring Guide", link: "/authoring-guide" },
          { text: "Changelog", link: "/changelog" },
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
            text: "Machine-Readable JSON",
            link: "/machine-readable-json",
          },
          {
            text: "Repository Context BOM",
            link: "/repository-context-bom",
          },
          {
            text: "Experimental Execution Contract",
            link: "/execution-contract",
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
        text: "Development",
        items: [
          {
            text: "Public Architecture",
            link: "/development/architecture",
          },
          {
            text: "Internal Architecture",
            link: "/development/internal-architecture",
          },
          { text: "Product Design", link: "/development/design" },
          { text: "Current Roadmap", link: "/development/plan" },
          {
            text: "Skill Discovery Design",
            link: "/development/plan-discovery",
          },
          {
            text: "Release Publication Security",
            link: "/development/release-security",
          },
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
