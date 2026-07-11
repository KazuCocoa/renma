import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { encodeRenmaMetadataList, yamlString } from "../renma-metadata.js";

export type ScaffoldKind = "skill" | "context" | "context_lens";
export type ScaffoldFormat = "file" | "prompt" | "json";

export interface ScaffoldOptions {
  kind: ScaffoldKind;
  targetPath: string;
  format: ScaffoldFormat;
  id?: string;
  title?: string;
  owner?: string;
  tags?: string[];
}

export interface ScaffoldBundle {
  kind: ScaffoldKind;
  path: string;
  id: string;
  title: string;
  owner: string;
  tags: string[];
  format: ScaffoldFormat;
  content: string;
  prompt: string;
  name?: string;
  description?: string;
  agentSkillsSpecification?: string;
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
  process.stdout.write(`Created ${options.targetPath}\n`);
  return 0;
}

export function buildScaffoldBundle(options: ScaffoldOptions): ScaffoldBundle {
  const id = options.id ?? inferId(options.kind, options.targetPath);
  const title = options.title ?? titleFromId(id);
  const owner = options.owner ?? "unowned";
  const tags =
    options.tags && options.tags.length > 0 ? options.tags : ["authoring"];
  const skillIdentity =
    options.kind === "skill"
      ? {
          name: inferSkillName(options.targetPath),
          description: draftSkillDescription(title),
        }
      : undefined;
  const content =
    options.kind === "skill"
      ? renderSkillScaffold({
          id,
          title,
          owner,
          tags,
          name: skillIdentity?.name ?? "skill",
          description: skillIdentity?.description ?? "",
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
    format: options.format,
    content,
    prompt: renderPrompt({
      kind: options.kind,
      targetPath: options.targetPath,
      id,
      title,
      owner,
      tags,
      content,
      ...(skillIdentity ? skillIdentity : {}),
    }),
    ...(skillIdentity
      ? {
          name: skillIdentity.name,
          description: skillIdentity.description,
          agentSkillsSpecification: "https://agentskills.io/specification",
        }
      : {}),
  };
}

function renderSkillScaffold(metadata: {
  id: string;
  title: string;
  owner: string;
  tags: string[];
  name: string;
  description: string;
}): string {
  return `---
name: ${yamlString(metadata.name)}
description: ${yamlString(metadata.description)}
metadata:
  renma.id: ${yamlString(metadata.id)}
  renma.title: ${yamlString(metadata.title)}
  renma.version: ${yamlString("0.1.0")}
  renma.owner: ${yamlString(metadata.owner)}
  renma.status: ${yamlString("experimental")}
  renma.tags: ${yamlString(encodeRenmaMetadataList(metadata.tags))}
---

# ${metadata.title}

## Use this skill when

- Replace this placeholder with the concrete task, decision, or workflow boundary this skill owns.

## Do not use this skill when

- Replace this placeholder with nearby cases that require a different skill, human decision, or stop condition.

## Required Inputs

- List the inputs, evidence, repository artifacts, permissions, and preconditions the agent must inspect before acting.

## Instructions

1. State the inputs, evidence, or repository artifacts the agent should inspect.
2. Describe the review steps, checks, and decision points that should remain explicit and reviewable.
3. Identify the expected output, artifact, or handoff.

## Context References

Use Renma metadata fields metadata.renma.requires-context and metadata.renma.optional-context to reference durable context assets. Store list values as JSON array strings.

Move reusable domain, testing, platform, product, or tool knowledge into separately owned context assets under contexts/.

## Hard Constraints

- Keep recommendations grounded in provided inputs and repository evidence.
- Do not invent domain facts, policies, owners, dependencies, or product behavior.
- State what the agent must do instead when a prohibited action or missing-input condition applies.
- Do not choose runtime task context beyond this skill's declared scope.
- Do not assemble prompts for live model calls.
- Do not call external services unless the surrounding workflow explicitly allows it.

## Validation

- Replace this placeholder with checks that prove the result is ready for human review.
- Run renma scan . and confirm the Agent Skills validation summary is valid.
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
- Keep this asset focused on reusable knowledge that can be referenced by skills.
- Do not duplicate large source material when a reference is enough.
- Do not invent domain facts, policies, owners, dependencies, or product behavior.

## Validation

- Run renma scan, renma catalog, and renma graph before review.
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
purpose: spec_review
applies_to:
  - context.example.replace-me
focus:
  - ambiguity
  - missing boundary
expected_outputs:
  - unresolved questions
  - risk notes
---

# ${metadata.title}

## Purpose

This context lens is a purpose-oriented interpretation layer for the context assets listed in applies_to.

## Boundary

- Detailed domain knowledge belongs in context assets, not in this lens.
- This file must not become a prompt template, runtime selector, or context injection rule.
- Keep focus terms and expected outputs compact, deterministic, and reviewable.

## Interpretation Notes

- Replace this placeholder with review focus guidance grounded in the applied context assets.
`;
}

function renderPrompt(input: {
  kind: ScaffoldKind;
  targetPath: string;
  id: string;
  title: string;
  owner: string;
  tags: string[];
  content: string;
  name?: string;
  description?: string;
}): string {
  const agentSkillsRules =
    input.kind === "skill"
      ? [
          "- Keep the top-level skill frontmatter compatible with https://agentskills.io/specification.",
          "- Preserve top-level name and description as the Agent Skills discovery surface.",
          "- Keep Renma extensions inside the metadata mapping with renma.* string keys.",
          "- Store Renma list metadata as JSON array strings.",
          "- Make the important negative selection boundary visible in description.",
          "- Group activated-workflow prohibitions under a prominent Do Not Use or Hard Constraints section, and state the required alternative or stop behavior.",
        ]
      : [];

  const identityLines = [
    input.name ? `- Agent Skills name: ${input.name}` : undefined,
    input.description
      ? `- Draft Agent Skills description: ${input.description}`
      : undefined,
  ].filter((line): line is string => line !== undefined);

  return `Create a Renma ${input.kind} asset at ${input.targetPath}.

Use this metadata exactly:

- id: ${input.id}
- title: ${input.title}
- owner: ${input.owner}
- tags: ${input.tags.join(",")}
- version: 0.1.0
- status: experimental
${identityLines.length > 0 ? `${identityLines.join("\n")}\n` : ""}
Start from this deterministic scaffold and replace placeholder prose with repository-grounded content:

~~~md
${input.content}~~~

Constraints:

- Preserve the YAML frontmatter shape unless the repository already requires a stricter local convention.
${agentSkillsRules.join("\n")}${agentSkillsRules.length > 0 ? "\n" : ""}- Use only supported statuses: experimental, stable, deprecated, archived.
- Move durable domain, testing, platform, product, or tool knowledge into separately owned context assets under contexts/.
- For skill assets, use renma.requires-context for context the skill normally depends on.
- For skill assets, use renma.optional-context for context useful only in some cases.
- For skill assets, use renma.requires-lens or renma.optional-lens for static lens relationships.
- For context lens assets, use applies_to for context assets the lens interprets.
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
- After creating files, run renma scan ., renma catalog . --format json, and renma graph . --focus ${input.id} --format mermaid.
`;
}

function renderTagBlock(tags: string[]): string {
  return `tags:\n${tags.map((tag) => `  - ${tag}`).join("\n")}`;
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
    const skillRoot = normalized.lastIndexOf("skills");
    const parts = normalized.slice(skillRoot >= 0 ? skillRoot + 1 : 0);
    return parts[0] === "skill"
      ? parts.join(".")
      : ["skill", ...parts].join(".");
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

function inferSkillName(targetPath: string): string {
  const normalized = targetPath.replaceAll("\\", "/");
  const directory = normalized.slice(0, normalized.lastIndexOf("/"));
  return slugify(directory.split("/").filter(Boolean).at(-1) ?? "skill");
}

function draftSkillDescription(title: string): string {
  return `Drafts reviewed guidance for ${title}. Use when the requested task matches this skill's documented purpose, inputs, and routing boundary. Do not use until the placeholders and hard constraints in this scaffold have been replaced with repository-grounded guidance.`;
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
