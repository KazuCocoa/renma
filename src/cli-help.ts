export interface CommandHelp {
  name: string;
  usage: string;
  question: string;
  purpose: string;
  useWhen: readonly string[];
  doNotUseFor: readonly string[];
  examples: readonly string[];
  interpretation: readonly string[];
  nextSteps: readonly string[];
  options: readonly CommandOptionHelp[];
}

export type CommandOptionHelp =
  | CliOptionName
  | {
      name: CliOptionName;
      description?: string;
    };

const OPTION_HELP = {
  config: {
    flags: "-c, --config <path>",
    description: "Read Renma JSON config from path.",
  },
  "fail-on": {
    flags: "--fail-on <level>",
    description:
      "Exit 1 when scan findings meet severity: low, medium, high, or critical.",
  },
  focus: {
    flags: "--focus <asset-id-or-path>",
    description: "Keep one matched asset and its one-hop graph neighborhood.",
  },
  format: {
    flags: "--format <format>",
    description: "Output format for commands that accept --format.",
  },
  from: {
    flags: "--from <ref>",
    description: "Git ref to use as the comparison baseline.",
  },
  help: {
    flags: "-h, --help",
    description: "Show this help page without running the command.",
  },
  "include-owned": {
    flags: "--include-owned",
    description: "Include flat owned asset details in ownership output.",
  },
  id: {
    flags: "--id <id>",
    description: "Set the scaffolded asset ID instead of deriving one.",
  },
  json: {
    flags: "--json",
    description: "Shortcut for --format json where JSON is supported.",
  },
  lines: {
    flags: "--lines <range>",
    description: "Print an exact line range such as L10-L42 or 10-42.",
  },
  "max-context-bytes": {
    flags: "--max-context-bytes <n>",
    description: "Limit nearby context bytes for semantic split suggestions.",
  },
  "max-source-bytes": {
    flags: "--max-source-bytes <n>",
    description: "Limit source file bytes for semantic split suggestions.",
  },
  "omit-generated-at": {
    flags: "--omit-generated-at",
    description: "Omit the BOM run-time generatedAt timestamp.",
  },
  owner: {
    flags: "--owner <owner>",
    description: "Owner value for commands that accept --owner.",
  },
  tags: {
    flags: "--tags <tags>",
    description: "Set comma-separated or repeated scaffold tags.",
  },
  title: {
    flags: "--title <title>",
    description: "Set scaffold title metadata.",
  },
  to: {
    flags: "--to <ref>",
    description: "Git ref to use as the comparison target.",
  },
  version: {
    flags: "-v, --version",
    description: "Print the Renma package version.",
  },
  view: {
    flags: "--view <view>",
    description: "Graph view: summary, workflow, full, layered, or lens.",
  },
} as const;

export type CliOptionName = keyof typeof OPTION_HELP;

export const COMMAND_HELP = [
  {
    name: "scan",
    usage: "renma scan [path] [options]",
    question: "What concrete problems should be fixed?",
    purpose:
      "Scan is usually the first command when improving existing skills or context assets. It reports concrete findings and deterministic diagnostics without editing files.",
    useWhen: [
      "You need the first actionable view of repository problems.",
      "You are preparing or verifying a patch for skills, contexts, prompts, or agent-facing docs.",
      "A downstream tool or coding agent needs JSON guidance, repair constraints, and verification steps.",
    ],
    doNotUseFor: [
      "Automatically rewriting files or applying fixes.",
      "An agent inventing owners, references, source-of-truth documents, or product rules.",
      "Selecting runtime context for an LLM or assembling task prompts.",
    ],
    examples: [
      "renma scan .",
      "renma scan . --format json",
      "renma scan . --fail-on high",
    ],
    interpretation: [
      "Text output is a human-readable finding list.",
      "JSON output includes structured diagnostics, review bundles, and guidance intended for downstream tools and coding agents.",
      "Agent Skills migration commands use structured command and args fields in JSON; text display paths use POSIX shell quoting when needed.",
      "When repair constraints or verification steps are present, follow them instead of broadening the edit.",
    ],
    nextSteps: [
      "Inspect evidence before editing.",
      "Use suggest-metadata only when metadata retrofit or Skill migration work is needed.",
      "Prepare a minimal reviewable patch that preserves supported semantics.",
      "Rerun scan with --fail-on high and any relevant structural commands after editing.",
    ],
    options: [
      "config",
      "fail-on",
      {
        name: "format",
        description: "Output format: text or json. Defaults to text.",
      },
      "json",
      "help",
    ],
  },
  {
    name: "catalog",
    usage: "renma catalog [path] [options]",
    question: "What assets and metadata exist?",
    purpose:
      "Catalog inventories discovered assets and normalized metadata so reviewers can see the repository evidence Renma found.",
    useWhen: [
      "You need IDs, kinds, owners, lifecycle states, hashes, tags, declared dependencies, or context relationships.",
      "You want inventory evidence before changing metadata or references.",
      "You need stable JSON or Markdown asset inventory for review.",
    ],
    doNotUseFor: [
      "Treating inventory as a problem list by itself.",
      "Deciding what context an agent should consume at runtime.",
      "Proving that a declared dependency is semantically correct.",
    ],
    examples: [
      "renma catalog . --format markdown",
      "renma catalog . --format json",
    ],
    interpretation: [
      "Catalog output is deterministic inventory evidence.",
      "Missing, duplicate, or unresolved metadata may appear as diagnostics, but catalog is not a substitute for scan.",
      "Dependencies are declared relationships discovered from repository metadata and references.",
    ],
    nextSteps: [
      "Run graph to inspect relationships.",
      "Run readiness for repository-level summary.",
      "Run scan for concrete findings to fix.",
    ],
    options: [
      "config",
      {
        name: "format",
        description: "Output format: json or markdown. Defaults to json.",
      },
      "json",
      "help",
    ],
  },
  {
    name: "graph",
    usage: "renma graph [path] [options]",
    question: "How are assets structurally connected?",
    purpose:
      "Graph shows declared structural relationships between assets, including focused views around one asset.",
    useWhen: [
      "You need to inspect dependencies, references, unresolved targets, or isolation.",
      "You want a one-hop neighborhood with --focus for one asset ID or path.",
      "You need Markdown, JSON, or Mermaid evidence for review.",
    ],
    doNotUseFor: [
      "It does not select context for an LLM.",
      "It does not prove that a dependency is semantically correct.",
      "Deleting isolated assets without human review.",
    ],
    examples: [
      "renma graph . --format markdown",
      "renma graph . --view layered --format mermaid",
      "renma graph . --focus contexts/testing/boundary-value-analysis.md --view full",
    ],
    interpretation: [
      "Edges represent declared relationships Renma can resolve or report as unresolved.",
      "Unexpected isolation is evidence to review, not automatic permission to delete an asset.",
      "Focused output filters to the matched asset and directly connected neighbors.",
    ],
    nextSteps: [
      "Use catalog to inspect the assets behind graph nodes.",
      "Use scan to fix concrete relationship findings.",
      "Rerun graph after metadata or reference changes.",
    ],
    options: [
      "config",
      {
        name: "format",
        description:
          "Output format: json, markdown, or mermaid. Defaults to json. JSON defaults to the full view; non-JSON formats default to the summary view.",
      },
      "json",
      "view",
      "focus",
      "help",
    ],
  },
  {
    name: "trust-graph",
    usage: "renma trust-graph [path] [options]",
    question: "What trust-relevant evidence is connected to each asset?",
    purpose:
      "Trust graph connects deterministic evidence such as ownership, lifecycle, policy, references, dependencies, and diagnostics.",
    useWhen: [
      "A reviewer or downstream tool needs traceable trust-relevant evidence per asset.",
      "You need to connect owners, lifecycle status, effective policy fingerprints, dependencies, and diagnostics.",
      "You want a stable evidence layer for human review.",
    ],
    doNotUseFor: [
      "It is not a subjective trust score.",
      "It does not certify that an asset is trustworthy.",
      "Runtime policy enforcement, prompt assembly, or telemetry.",
    ],
    examples: [
      "renma trust-graph . --format markdown",
      "renma trust-graph . --format json",
    ],
    interpretation: [
      "The report connects evidence; it does not decide trust for you.",
      "Missing owner, lifecycle, policy, or diagnostic evidence should be reviewed in context.",
      "JSON is the source of truth for downstream tooling; Markdown is for human review.",
    ],
    nextSteps: [
      "Use scan for concrete diagnostics.",
      "Use ownership when owner coverage needs deeper review.",
      "Use readiness for repository-level summary.",
    ],
    options: [
      "config",
      {
        name: "format",
        description: "Output format: json or markdown. Defaults to json.",
      },
      "json",
      "help",
    ],
  },
  {
    name: "readiness",
    usage: "renma readiness [path] [options]",
    question: "Is the repository broadly prepared for agent-facing use?",
    purpose:
      "Readiness provides a repository-level scorecard and health summary derived from deterministic repository evidence.",
    useWhen: [
      "You need a broad maintainer or CI summary after scan, catalog, or graph review.",
      "You want repository-level checks for ownership, graph resolution, lifecycle, context lens governance, and selected findings.",
      "You need Markdown for review or JSON for automation.",
    ],
    doNotUseFor: [
      "Replacing scan when you need concrete findings.",
      "Deciding whether an agent should consume a particular context asset at runtime.",
      "Claiming what an LLM actually used.",
    ],
    examples: [
      "renma readiness . --format markdown",
      "renma readiness . --format json",
    ],
    interpretation: [
      "Scan gives concrete findings; readiness gives a broad repository summary.",
      "Readiness scores and checks are static repository review signals.",
      "Security posture and context lens summaries remain deterministic evidence, not runtime decisions.",
    ],
    nextSteps: [
      "Use scan to fix specific findings behind readiness failures.",
      "Use catalog and graph to inspect inventory or relationship causes.",
      "Rerun readiness after the patch.",
    ],
    options: [
      "config",
      {
        name: "format",
        description: "Output format: json or markdown. Defaults to json.",
      },
      "json",
      "help",
    ],
  },
  {
    name: "bom",
    usage: "renma bom [path] [options]",
    question: "What declared repository context manifest should be reviewed?",
    purpose:
      "BOM prints a declared repository evidence snapshot combining catalog, graph, lifecycle, hashes, diagnostics, readiness, and security posture evidence.",
    useWhen: [
      "Reviewers or CI consumers need one manifest of declared repository context evidence.",
      "You need a PR artifact that combines inventory, dependencies, diagnostics, readiness, lifecycle, hashes, and security posture.",
      "You need structured JSON generated from deterministic repository evidence or compact Markdown for review.",
    ],
    doNotUseFor: [
      "Reporting what an LLM actually consumed.",
      "It is not telemetry, prompt assembly, runtime context selection, or agent execution.",
      "Normalizing every repository or environment-dependent metadata value.",
    ],
    examples: [
      "renma bom . --format json",
      "renma bom . --format markdown",
      "renma bom . --format json --omit-generated-at",
    ],
    interpretation: [
      "The BOM is a declared repository manifest, not a runtime usage report or telemetry.",
      "--omit-generated-at only removes the run-time generation timestamp.",
      "With the same checkout path, config path, repository contents, Renma version, and UTC evaluation date, repeated --omit-generated-at JSON runs should be byte-identical.",
      "The option does not remove freshness metadata, suppress freshness diagnostics, normalize absolute root or configPath values, hide file moves, or make output portable across runners.",
    ],
    nextSteps: [
      "Review diagnostics and readiness sections before merging.",
      "Use scan, catalog, or graph for focused follow-up.",
      "Store JSON when automation needs the source of truth.",
    ],
    options: [
      "config",
      {
        name: "format",
        description: "Output format: json or markdown. Defaults to json.",
      },
      "json",
      "omit-generated-at",
      "help",
    ],
  },
  {
    name: "ownership",
    usage: "renma ownership [path] [options]",
    question: "Where is ownership missing or concentrated?",
    purpose:
      "Ownership helps review owner coverage, unowned assets, and concentration by declared owner.",
    useWhen: [
      "You need to find assets without owner metadata.",
      "You want to review what one owner is responsible for.",
      "You need ownership coverage evidence for governance review.",
    ],
    doNotUseFor: [
      "Renma should not invent or assign an owner from paths, prose, Git history, or guesses.",
      "Replacing human or source-of-truth confirmation for missing ownership.",
      "Treating unowned assets as automatic failures in every repository.",
    ],
    examples: [
      "renma ownership . --format markdown",
      "renma ownership . --include-owned",
      "renma ownership . --owner qa-platform --format json",
    ],
    interpretation: [
      "Ownership output reports declared owner metadata and coverage.",
      "Missing ownership normally requires confirmation from a human or an existing source of truth.",
      "Owner filters keep repository-level totals while adding owner-specific details.",
    ],
    nextSteps: [
      "Confirm missing owners before editing metadata.",
      "Use suggest-metadata when preparing a metadata-only retrofit.",
      "Rerun ownership and scan after ownership changes.",
    ],
    options: [
      "config",
      {
        name: "format",
        description: "Output format: json or markdown. Defaults to json.",
      },
      "json",
      "include-owned",
      {
        name: "owner",
        description:
          "Show owner-specific declared asset details while preserving repository-level coverage totals.",
      },
      "help",
    ],
  },
  {
    name: "diff",
    usage: "renma diff [path] --from <ref> --to <ref> [options]",
    question: "What deterministic readiness evidence changed between refs?",
    purpose:
      "Diff compares deterministic repository evidence between Git refs for context and skill review.",
    useWhen: [
      "You need to review readiness, asset, graph, check, or finding changes before merging.",
      "A pull request changes skills, contexts, metadata, or agent-facing docs.",
      "You want JSON or Markdown evidence over repository governance changes.",
    ],
    doNotUseFor: [
      "A generic source-code diff.",
      "Determining what an LLM consumed at runtime.",
      "Replacing human review of semantic changes.",
    ],
    examples: [
      "renma diff . --from main --to HEAD",
      "renma diff . --from origin/main --to HEAD --format markdown",
    ],
    interpretation: [
      "The report compares Renma evidence generated at two refs.",
      "Added or removed findings show deterministic review signal changes, not arbitrary source hunks.",
      "Usage errors exit 2; generated comparison output follows command status rules.",
    ],
    nextSteps: [
      "Use ci-report when a PR-oriented summary is needed.",
      "Use scan or graph on the working tree to investigate changed evidence.",
      "Summarize changed evidence and remaining uncertainty for reviewers.",
    ],
    options: [
      "config",
      "from",
      "to",
      {
        name: "format",
        description: "Output format: json or markdown. Defaults to json.",
      },
      "json",
      "help",
    ],
  },
  {
    name: "ci-report",
    usage: "renma ci-report [path] --from <ref> --to <ref> [options]",
    question: "What should a CI or PR reviewer inspect?",
    purpose:
      "CI report produces a pull-request-oriented summary from deterministic Renma evidence.",
    useWhen: [
      "CI needs a PASS, WARN, or FAIL status with review-focused details.",
      "A PR reviewer needs readiness, graph, and finding changes summarized.",
      "You want Markdown for a PR comment or JSON for automation.",
    ],
    doNotUseFor: [
      "Replacing human review.",
      "A full generic code diff.",
      "Certifying that all semantic changes are correct.",
    ],
    examples: [
      "renma ci-report . --from main --to HEAD --format markdown",
      "renma ci-report . --from origin/main --to HEAD --format json",
    ],
    interpretation: [
      "The report combines deterministic evidence for review.",
      "PASS and WARN exit 0; FAIL exits 1; usage errors exit 2.",
      "Reviewers should still inspect meaningful semantic changes.",
    ],
    nextSteps: [
      "Fix or explain new failures and warnings.",
      "Use diff for the underlying evidence comparison.",
      "Rerun ci-report after updating the branch.",
    ],
    options: [
      "config",
      "from",
      "to",
      {
        name: "format",
        description: "Output format: json or markdown. Defaults to markdown.",
      },
      "json",
      "help",
    ],
  },
  {
    name: "inspect",
    usage: "renma inspect <file> [options]",
    question: "What is the outline or exact line slice of one file?",
    purpose:
      "Inspect provides a compact outline or exact line slice of a single file.",
    useWhen: [
      "You need to inspect one asset before editing without reading the whole repository.",
      "A coding agent needs a deterministic outline or exact line range.",
      "You want Context Lens or relationship hints for one file when repository context can be inferred.",
    ],
    doNotUseFor: [
      "Selecting runtime context for an LLM.",
      "Assembling prompts for task execution.",
      "Replacing scan, catalog, or graph for repository-wide evidence.",
    ],
    examples: [
      "renma inspect skills/testing/spec-review/SKILL.md",
      "renma inspect skills/testing/spec-review/SKILL.md --lines L10-L42",
      "renma inspect contexts/testing/boundary-value-analysis.md --format json",
    ],
    interpretation: [
      "Without --lines, output is a structured outline of one file.",
      "With --lines, output is an exact source slice.",
      "Inspect is an inspection helper, not a runtime context selector or prompt assembler.",
    ],
    nextSteps: [
      "Use scan for concrete findings before or after edits.",
      "Use catalog or graph if one-file inspection reveals relationship questions.",
      "Cite exact lines when summarizing edits for review.",
    ],
    options: [
      {
        name: "format",
        description: "Output format: text or json. Defaults to json.",
      },
      "json",
      "lines",
      "help",
    ],
  },
  {
    name: "scaffold",
    usage: "renma scaffold <skill|context|context_lens> <path> [options]",
    question: "How can a new asset start from a deterministic structure?",
    purpose:
      "Scaffold creates deterministic starter structures or authoring prompts for new Renma assets.",
    useWhen: [
      "You are creating a new skill, context asset, or context lens.",
      "You want a starter file or prompt with expected metadata and sections.",
      "You need a deterministic starting point before authoring content.",
    ],
    doNotUseFor: [
      "Generating a complete production-ready skill or context.",
      "Inventing domain knowledge merely to fill the template.",
      "Replacing author-provided purpose, routing boundaries, inputs, completion criteria, verification, or references.",
    ],
    examples: [
      "renma scaffold skill skills/testing/spec-review/SKILL.md --owner qa-platform",
      "renma scaffold context contexts/testing/boundary-value-analysis.md --owner qa-platform",
      "renma scaffold context_lens lenses/testing/spec-review-boundary-values.md --owner qa-platform",
      "renma scaffold skill skills/testing/spec-review/SKILL.md --owner qa-platform --format prompt",
    ],
    interpretation: [
      "File mode creates the scaffold file at the target path and refuses to overwrite existing files.",
      "Prompt and JSON modes print to stdout instead of creating the scaffold file.",
      "Generated scaffold content is a starting structure, not a complete asset.",
      "For Skills, use the platform's standard Skill authoring guidance to complete the description, instructions, workflow, constraints, and completion criteria.",
      "Domain knowledge must come from evidence or human input.",
    ],
    nextSteps: [
      "Review and complete the generated content with evidence-backed details.",
      "Run renma scan . --fail-on high, fix relevant diagnostics, and rerun the scan.",
      "Have a human review meaningful semantic content before merging.",
    ],
    options: [
      {
        name: "format",
        description:
          "Output format: file, prompt, or json. Defaults to file. File mode writes the scaffold to the target path and requires --owner. Prompt and JSON modes print to stdout instead of creating the target file.",
      },
      {
        name: "owner",
        description:
          "Set owner metadata on the scaffold. Required when --format file is used.",
      },
      "id",
      "title",
      "tags",
      "help",
    ],
  },
  {
    name: "suggest-metadata",
    usage: "renma suggest-metadata <file> [options]",
    question:
      "How can a coding agent prepare a metadata retrofit or one-way Skill migration?",
    purpose:
      "Suggest metadata emits a prompt or structured suggestion for one existing asset. Pre-0.16 Renma Skill targets use the one-way migration path to Agent Skills; non-canonical Skill filenames separately report any required entrypoint migration. Canonical Agent Skills support an explicit owner retrofit, never reverse migration.",
    useWhen: [
      "An asset lacks compact metadata and you want a reviewable metadata patch.",
      "A Skill with pre-0.16 Renma fields needs an Agent Skills plus metadata.renma.* conversion proposal.",
      "A skill.md or *.skill.md entrypoint needs its required rename or move reported.",
      "A canonical Agent Skill needs an explicit metadata.renma.owner candidate from --owner.",
      "You need guidance that preserves the existing Markdown body and semantics.",
      "A human explicitly provides an owner with --owner or the asset already declares one.",
    ],
    doNotUseFor: [
      "Editing the file automatically.",
      "Converting a canonical Agent Skill back to pre-0.16 Renma frontmatter.",
      "Silently resolving blocked, conflicting, duplicate, or unknown migration input.",
      "Changing the Markdown body or asset semantics unless explicitly requested.",
      "Inferring an owner without evidence.",
    ],
    examples: [
      "renma suggest-metadata skills/testing/spec-review/SKILL.md --format prompt",
      "renma suggest-metadata skills/testing/spec-review/SKILL.md --owner qa-platform --format json",
      "renma suggest-metadata skills/testing/spec-review.skill.md --format json",
    ],
    interpretation: [
      "The command prints to stdout and does not edit the target file.",
      "For Skill targets, canonical frontmatter is omitted when migration is unsafe or ambiguous.",
      "Historical skill.md and *.skill.md filename forms report the required rename or move in structured output.",
      "A path migration is blocked when the target exists separately or the rendered target Skill remains specification-invalid.",
      "For canonical Agent Skills, --owner can propose a metadata retrofit without reverse migration.",
      "Without --owner, do not add owner metadata unless the asset already declares one or a maintainer confirms it.",
      "Preserve existing Markdown body and semantics for a metadata-only retrofit.",
      "For Skills, metadata review is only one part of authoring review; use the platform's standard Skill guidance for the trigger description, instructions, workflow, constraints, and completion criteria.",
    ],
    nextSteps: [
      "Review the output; apply only an available, intended, evidence-backed metadata or migration candidate.",
      "If no proposal is available, preserve the source unless a separate intentional authoring change is reviewed.",
      "After intended changes, run renma scan . --fail-on high, fix relevant diagnostics, and rerun the scan.",
      "Report any missing owner, reference, or source-of-truth uncertainty.",
    ],
    options: [
      {
        name: "format",
        description:
          "Output format: prompt or json. Defaults to prompt. The command prints to stdout and does not edit the target file.",
      },
      "json",
      {
        name: "owner",
        description:
          "Explicitly provide an owner candidate. Renma must not infer an owner when this option is absent.",
      },
      "help",
    ],
  },
  {
    name: "suggest-semantic-split",
    usage: "renma suggest-semantic-split <file> [options]",
    question: "How can a coding agent prepare a reviewable semantic split?",
    purpose:
      "Suggest semantic split packages bounded source material and instructions for drafting a semantic split.",
    useWhen: [
      "A Markdown asset is too large or mixes multiple responsibilities.",
      "A coding agent needs bounded source context and deterministic helper commands.",
      "You want a prompt or JSON review bundle before proposing a split.",
    ],
    doNotUseFor: [
      "Editing files automatically.",
      "Splitting merely to satisfy a size metric when boundaries are not semantically meaningful.",
      "Dropping meaning, references, metadata, or review context.",
    ],
    examples: [
      "renma suggest-semantic-split docs/large-runbook.md",
      "renma suggest-semantic-split docs/large-runbook.md --format json",
      "renma suggest-semantic-split docs/large-runbook.md --max-source-bytes 32768",
    ],
    interpretation: [
      "The command prints to stdout and does not edit files.",
      "A split must preserve meaning and references.",
      "The resulting patch requires review.",
    ],
    nextSteps: [
      "Draft bounded files only when the proposed boundaries are meaningful.",
      "Preserve references and summarize uncertainty.",
      "Run scan, catalog, graph, and readiness after editing.",
    ],
    options: [
      {
        name: "format",
        description:
          "Output format: prompt or json. Defaults to prompt. The command prints to stdout and does not edit files.",
      },
      "json",
      "max-source-bytes",
      "max-context-bytes",
      "help",
    ],
  },
] as const satisfies readonly CommandHelp[];

export type CommandName = (typeof COMMAND_HELP)[number]["name"];

const COMMAND_MAP = new Map<CommandName, CommandHelp>(
  COMMAND_HELP.map((command) => [command.name, command]),
);

export function isCommandName(value: string): value is CommandName {
  return COMMAND_MAP.has(value as CommandName);
}

/** Return the documented option names accepted by one command. */
export function commandOptionNames(name: CommandName): CliOptionName[] {
  const command = COMMAND_MAP.get(name);
  if (!command) return [];
  return [...new Set(command.options.map(commandOptionName))];
}

export function renderGlobalHelp(version: string): string {
  return [
    `renma ${version}`,
    "",
    "Renma provides deterministic repository governance and maintenance evidence for skills, context assets, and agent-facing documentation.",
    "",
    "Boundaries:",
    "- Renma does not call an LLM.",
    "- Renma does not select runtime context.",
    "- Renma does not assemble prompts for task execution.",
    "- Renma does not execute agents.",
    "- Renma does not collect runtime telemetry.",
    "- Renma does not automatically perform large semantic rewrites.",
    "",
    "Usage",
    "  renma <command> [args] [options]",
    "  renma <command> --help",
    "",
    "Start here: existing repository",
    "  review existing Skills with your platform's standard Skill authoring guidance",
    "  renma scan . --fail-on high",
    "  inspect relevant diagnostics and repository evidence",
    "  use suggest-metadata only for metadata retrofit or Skill migration work",
    "  renma catalog . --format markdown",
    "  renma graph . --format markdown",
    "  renma readiness . --format markdown",
    "",
    "Start here: new skill",
    "  renma scaffold skill skills/<name>/SKILL.md --owner <owner>",
    "  review and complete it with your platform's standard Skill authoring guidance",
    "  renma scan . --fail-on high",
    "  renma catalog . --format markdown",
    "  renma graph . --format markdown",
    "  renma readiness . --format markdown",
    "",
    "Normal maintenance loop",
    "  authoring review -> intended changes -> repository validation -> fix -> rerun -> human review",
    "",
    "Commands",
    ...COMMAND_HELP.map(
      (command) => `  ${command.name.padEnd(24)} ${command.question}`,
    ),
    "",
    "Options",
    `  ${OPTION_HELP.help.flags.padEnd(28)} ${OPTION_HELP.help.description}`,
    `  ${OPTION_HELP.version.flags.padEnd(28)} ${OPTION_HELP.version.description}`,
    "",
    "Run `renma <command> --help` for command-specific purpose, boundaries, examples, and options.",
  ].join("\n");
}

export function renderCommandHelp(name: CommandName, version: string): string {
  const command = COMMAND_MAP.get(name);
  if (!command) {
    throw new Error(`Missing CLI help for command ${name}`);
  }

  return [
    `renma ${version}`,
    "",
    "Usage",
    `  ${command.usage}`,
    "",
    "Purpose",
    `  ${command.purpose}`,
    "",
    "Use when",
    ...renderBullets(command.useWhen),
    "",
    "Do not use for",
    ...renderBullets(command.doNotUseFor),
    "",
    "Examples",
    ...command.examples.map((example) => `  ${example}`),
    "",
    "How to interpret the result",
    ...renderBullets(command.interpretation),
    "",
    "Typical next steps",
    ...renderBullets(command.nextSteps),
    "",
    "Options",
    ...command.options.map((option) => {
      const name = commandOptionName(option);
      const help = OPTION_HELP[name];
      const description =
        typeof option === "string"
          ? help.description
          : (option.description ?? help.description);
      return `  ${help.flags.padEnd(28)} ${description}`;
    }),
  ].join("\n");
}

function commandOptionName(option: CommandOptionHelp): CliOptionName {
  return typeof option === "string" ? option : option.name;
}

function renderBullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}
