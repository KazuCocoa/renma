import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeAgentSkillDirectoryName } from "../agent-skills.js";
import {
  RENMA_FIRST_AUTHORING_BOUNDARY,
  SKILL_AUTHORING_PRINCIPLE,
} from "../guidance/skill-authoring.js";

export type ScaffoldKind = "skill" | "context" | "context_lens";
export type ScaffoldFormat = "file" | "prompt" | "json";
export type ScaffoldResource = "references" | "scripts" | "assets";

export interface ScaffoldOptions {
  kind: ScaffoldKind;
  targetPath: string;
  format: ScaffoldFormat;
  id?: string;
  title?: string;
  owner?: string;
  tags?: string[];
  resources?: ScaffoldResource[];
}

export interface ScaffoldBundle {
  kind: ScaffoldKind;
  path: string;
  id: string;
  title: string;
  owner: string;
  tags: string[];
  resources: ScaffoldResource[];
  format: ScaffoldFormat;
  content: string;
  prompt: string;
}

export async function runScaffoldCommand(
  options: ScaffoldOptions,
): Promise<number> {
  const bundle = buildScaffoldBundle(options);

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    return 0;
  }

  if (options.format === "prompt") {
    process.stdout.write(bundle.prompt);
    return 0;
  }

  await mkdir(path.dirname(options.targetPath), { recursive: true });
  await writeFile(options.targetPath, bundle.content, { flag: "wx" });
  for (const resource of bundle.resources) {
    await mkdir(path.join(path.dirname(options.targetPath), resource), {
      recursive: true,
    });
  }
  process.stdout.write(
    `Created ${options.targetPath}\n${
      options.kind === "skill" ? `\n${renderSkillNextSteps()}\n` : ""
    }`,
  );
  return 0;
}

export function buildScaffoldBundle(options: ScaffoldOptions): ScaffoldBundle {
  const id = options.id ?? inferId(options.kind, options.targetPath);
  const title = options.title ?? titleFromId(id);
  const owner = options.owner ?? "unowned";
  const tags =
    options.tags && options.tags.length > 0 ? options.tags : ["authoring"];
  const resources = [...new Set(options.resources ?? [])].sort();
  if (options.kind !== "skill" && resources.length > 0) {
    throw new Error("--resources is supported only for skill scaffolds.");
  }
  const content =
    options.kind === "skill"
      ? renderSkillScaffold({
          name: canonicalSkillName(options.targetPath),
          id,
          title,
          owner,
          tags,
        })
      : options.kind === "context_lens"
        ? renderContextLensScaffold({ id, title, owner, tags })
        : renderContextScaffold({ id, title, owner, tags });

  return {
    kind: options.kind,
    path: options.targetPath,
    id,
    title,
    owner,
    tags,
    resources,
    format: options.format,
    content,
    prompt: renderPrompt({
      kind: options.kind,
      targetPath: options.targetPath,
      id,
      title,
      owner,
      tags,
      resources,
      content,
    }),
  };
}

function renderSkillScaffold(metadata: {
  name: string;
  id: string;
  title: string;
  owner: string;
  tags: string[];
}): string {
  return `---
name: ${metadata.name}
description: Replace this description with clear routing guidance. Use when the intended workflow applies.
metadata:
  renma.id: ${yamlString(metadata.id)}
  renma.title: ${yamlString(metadata.title)}
  renma.version: "0.1.0"
  renma.owner: ${yamlString(metadata.owner)}
  renma.status: experimental
  renma.tags: ${yamlString(JSON.stringify(metadata.tags))}
  renma.requires-context: '[]'
  renma.optional-context: '[]'
  renma.conflicts: '[]'
---

# ${metadata.title}

## Purpose

Describe the recurring task, decision, or workflow this skill should guide.

## Required Inputs

- List the inputs, evidence, or repository artifacts the agent should inspect before acting.

## Instructions

1. State the inputs, evidence, or repository artifacts the agent should inspect.
2. Describe the review steps, checks, or decision points that should remain explicit and reviewable.
3. Identify the expected output, artifact, or handoff.

## Context References

Use \`metadata.renma.requires-context\` and \`metadata.renma.optional-context\` JSON-array strings to reference durable context assets.

Move domain, testing, platform, product, or tool knowledge into a Context Asset under \`contexts/\` when it is reused across Skills or has an independent owner, lifecycle, maintenance boundary, source-of-truth role, or correctness responsibility. Source-of-truth status alone is sufficient.

## Constraints

- Keep recommendations grounded in provided inputs and repository evidence.
- Do not invent domain facts, policies, owners, dependencies, or product behavior.
- Do not choose runtime task context beyond this skill's declared scope.
- Do not assemble prompts for live model calls.
- Do not call external services unless the surrounding workflow explicitly allows it.

## Validation

- Run \`renma scan\`, \`renma catalog\`, and \`renma graph\` before review.
`;
}

function renderContextScaffold(metadata: {
  id: string;
  title: string;
  owner: string;
  tags: string[];
}): string {
  return `---
id: ${metadata.id}
title: ${metadata.title}
version: 0.1.0
owner: ${metadata.owner}
status: experimental
${renderTagBlock(metadata.tags)}
---

# ${metadata.title}

## Summary

Describe the durable context, rule, constraint, or domain fact this asset records.

## Scope

This context applies when:

- Describe the systems, workflows, or skills that should consider this context.

This context does not apply when:

- Describe nearby cases that should use a different context asset.

## Guidance

- Keep this context specific, reviewable, and source-backed.
- Prefer stable facts over transient implementation notes.

## Constraints

- Do not put task-specific prompt instructions in this context asset.
- Keep this asset focused on independently maintained knowledge that is reused, source-authoritative, or required for Skill correctness.
- Do not duplicate large source material when a reference is enough.
- Do not invent domain facts, policies, owners, dependencies, or product behavior.

## Validation

- Run \`renma scan\`, \`renma catalog\`, and \`renma graph\` before review.
`;
}

function renderContextLensScaffold(metadata: {
  id: string;
  title: string;
  owner: string;
  tags: string[];
}): string {
  return `---
id: ${metadata.id}
type: context_lens
title: ${metadata.title}
owner: ${metadata.owner}
status: experimental
${renderTagBlock(metadata.tags)}
# PLACEHOLDER: replace with this Lens's repository-grounded purpose.
purpose: replace_with_repository_grounded_purpose
# PLACEHOLDER: replace every target with an existing Context Asset ID or path.
applies_to:
  - context.example.replace-with-existing-context
# PLACEHOLDER: replace every item with a concrete question, risk, check, or evidence emphasis.
focus:
  - replace with a concrete interpretation criterion
# PLACEHOLDER: replace every item with the output this interpretation should shape.
expected_outputs:
  - replace with a concrete expected output
---

# ${metadata.title}

## Purpose

Replace this section and every frontmatter placeholder. Explain why the declared Context Assets need this purpose-specific interpretation. The scaffold values are not universal Lens recommendations.

## Boundary

- A Context Lens requires real Context Assets to interpret. Do not create one when no Context Asset belongs in \`applies_to\`.
- A persona may briefly frame the interpretation, but persona-only wording is insufficient. Define concrete questions, risks, checks, evidence, and expected outputs.
- Keep the focused task, ordered workflow, decisions, validation, and completion criteria in the Skill.
- Detailed domain knowledge belongs in context assets, not in this lens.
- This file must not become a prompt template, runtime selector, or context injection rule.
- Keep frontmatter compact and put detailed interpretation guidance in this Markdown body.

## Interpretation Notes

- Replace this placeholder with repository-grounded guidance that makes the interpretation reproducible: state the questions to ask, risks and checks to emphasize, evidence to cite, and expected output to produce.

## Validation

- Confirm that every \`applies_to\` target resolves to an existing Context Asset and that this Lens adds meaningful purpose-specific interpretation.
- Run \`renma scan . --fail-on high\`, \`renma catalog . --format markdown\`, and \`renma graph . --focus ${metadata.id} --format mermaid\` after authoring.
`;
}

function renderPrompt(input: {
  kind: ScaffoldKind;
  targetPath: string;
  id: string;
  title: string;
  owner: string;
  tags: string[];
  resources: ScaffoldResource[];
  content: string;
}): string {
  const skillGuidance =
    input.kind === "skill"
      ? [
          "- Keep the Skill in Agent Skills format with Renma extensions under `metadata.renma.*`.",
          "- Use `metadata.renma.requires-context` for context the skill normally depends on, encoded as a JSON-array string.",
          "- Use `metadata.renma.optional-context` for context useful only in some cases, encoded as a JSON-array string.",
          "- Use `metadata.renma.requires-lens` or `metadata.renma.optional-lens` for static lens relationships, encoded as JSON-array strings.",
          "- State exactly when each local resource should be read or executed. Keep Skill-specific detail in references/, deterministic implementation in scripts/, and output material in assets/.",
          "- Use contexts/ when knowledge is reused across Skills or has an independent owner, lifecycle, maintenance boundary, source-of-truth role, or correctness responsibility. Source-of-truth status alone is sufficient.",
        ]
      : [];
  const contextLensGuidance =
    input.kind === "context_lens"
      ? [
          "- Replace the scaffold `purpose`; it is a placeholder, not a universal recommendation.",
          "- Replace every `applies_to` placeholder with an existing Context Asset ID or path, then verify that each target resolves.",
          "- Replace all `focus` and `expected_outputs` placeholders with repository-grounded interpretation criteria and outputs.",
          "- Confirm that the Lens actually interprets declared Context. If there is no Context Asset to interpret, do not create a Lens.",
          "- A persona may frame the Lens, but persona-only wording is insufficient; define concrete questions, risks, checks, evidence, and expected outputs.",
          "- Keep the focused task and workflow in the Skill, and keep independently maintained or source-authoritative knowledge in Context Assets.",
        ]
      : [];
  return `Create a Renma ${input.kind} asset at \`${input.targetPath}\`.

Use this metadata exactly:

- id: \`${input.id}\`
- title: \`${input.title}\`
- owner: \`${input.owner}\`
- tags: \`${input.tags.join(",")}\`
- local resource directories: \`${input.resources.join(",") || "none"}\`
- version: \`0.1.0\`
- status: \`experimental\`

Start from this deterministic scaffold and replace placeholder prose with repository-grounded content:

\`\`\`md
${input.content}\`\`\`

${
  input.kind === "skill"
    ? `Apply the authoring contract from \`renma guide skill\`. ${SKILL_AUTHORING_PRINCIPLE} ${RENMA_FIRST_AUTHORING_BOUNDARY} Do not create a generic Skill first and enrich it afterward with Renma-like metadata. Use platform-native guidance only to refine the generated Skill's trigger description, instructions, workflow, constraints, completion criteria, and examples that resolve real ambiguity. Preserve the repository's intended behavior, and do not invent owners, policies, dependencies, domain rules, or source-of-truth claims. After editing, run \`renma scan . --fail-on high\`, inspect catalog and graph evidence, address relevant findings, and rerun validation. Do not weaken security policy or add suppressions merely to make validation pass. Have a human review meaningful semantic changes before merging.\n\n`
    : ""
}Constraints:

- Preserve the YAML frontmatter shape unless the repository already requires a stricter local convention.
- Use only supported statuses: experimental, stable, deprecated, archived.
- Move knowledge into a Context Asset under \`contexts/\` when it is reused across Skills or has an independent owner, lifecycle, maintenance boundary, source-of-truth role, or correctness responsibility.
${skillGuidance.join("\n")}
${contextLensGuidance.join("\n")}
- For context lens assets, use \`applies_to\` for context assets the lens interprets.
- Use simple supported metadata shapes only.
- For context assets, keep content durable, reviewable, and source-backed.
- Do not put task-specific prompt instructions in context assets.
- Do not turn context lens assets into prompt templates, runtime selectors, or context injection rules.
- Add explicit metadata and references where appropriate.
- Do not invent owners, dependencies, policies, or domain facts.
- Do not choose runtime task context.
- Do not assemble prompts for live model calls.
- Do not call external services.
- Keep the asset LLM-facing and Renma-verifiable.
- After creating files, run \`renma scan .\`, \`renma catalog . --format json\`, and \`renma graph . --focus ${input.id} --format mermaid\`.
`;
}

function renderSkillNextSteps(): string {
  return [
    "Next steps:",
    "1. Run `renma guide skill` and confirm this is the smallest non-redundant intended asset graph.",
    "2. Scaffold or reuse only justified Context Assets and declare required or optional relationships.",
    "3. Complete the focused workflow; use platform-native guidance only to refine semantics within Renma boundaries.",
    "4. Run `renma scan . --fail-on high` and inspect catalog and graph evidence.",
    "5. Fix relevant findings and rerun validation.",
    "6. Have a human review meaningful semantic changes and unresolved decisions before merging.",
  ].join("\n");
}

function renderTagBlock(tags: string[]): string {
  return `tags:
${tags.map((tag) => `  - ${tag}`).join("\n")}`;
}

function canonicalSkillName(targetPath: string): string {
  const normalizedPath = targetPath.replaceAll("\\", "/");
  if (path.posix.basename(normalizedPath) !== "SKILL.md") {
    throw new Error("Skill scaffolds require the canonical SKILL.md filename.");
  }
  const directory = path.posix.basename(path.posix.dirname(normalizedPath));
  const validation = normalizeAgentSkillDirectoryName(directory);
  if (validation.normalized === undefined || validation.problems.length > 0) {
    throw new Error(
      `Skill scaffold directory "${directory}" is not a valid Agent Skills name: ${validation.problems.join("; ")}.`,
    );
  }
  return validation.normalized;
}

function yamlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function inferId(kind: ScaffoldKind, targetPath: string): string {
  const withoutExtension = targetPath.replace(/\.[^/.]+$/, "");
  const normalized = withoutExtension
    .split(/[\\/]+/)
    .filter(Boolean)
    .filter((part) => part !== "SKILL")
    .map(slugify)
    .filter(Boolean);

  if (kind === "skill") {
    const skillRoot = normalized.indexOf("skills");
    return normalized.slice(skillRoot >= 0 ? skillRoot + 1 : 0).join(".");
  }

  if (kind === "context_lens") {
    const lensRoot = normalized.indexOf("lenses");
    const parts = normalized.slice(lensRoot >= 0 ? lensRoot + 1 : 0);
    return parts[0] === "lens" ? parts.join(".") : ["lens", ...parts].join(".");
  }

  const contextRoot = normalized.findIndex(
    (part) => part === "context" || part === "contexts",
  );
  const parts = normalized.slice(contextRoot >= 0 ? contextRoot + 1 : 0);
  return parts[0] === "context"
    ? parts.join(".")
    : ["context", ...parts].join(".");
}

function titleFromId(id: string): string {
  const lastSegment = id.split(".").filter(Boolean).slice(-1)[0] ?? id;
  return lastSegment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
