import { defineConfig } from "vitepress";

const repositoryUrl = "https://github.com/KazuCocoa/renma";

export default defineConfig({
  title: "Renma",
  description:
    "A Git-native Context Repository and deterministic governance CLI for agent-facing knowledge.",
  base: "/renma/",
  themeConfig: {
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
