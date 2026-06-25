import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ScaffoldKind = "skill" | "context";
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
  const content =
    options.kind === "skill"
      ? renderSkillScaffold({ id, title, owner, tags })
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
    }),
  };
}

function renderSkillScaffold(metadata: {
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
requires_context:
optional_context:
conflicts:
---

# ${metadata.title}

## When To Use

- Describe the recurring task, decision, or workflow this skill should guide.

## Instructions

1. State the inputs the agent should inspect before acting.
2. Describe the deterministic checks or steps Renma can verify.
3. Identify the expected output, artifact, or handoff.

## Guardrails

- Keep recommendations grounded in repository evidence.
- Do not invent domain facts, policies, owners, or dependencies.

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

## Applies To

- List the systems, workflows, or skills that should consider this context.

## Guidance

- Keep this context specific, reviewable, and source-backed.
- Prefer stable facts over transient implementation notes.

## Validation

- Run \`renma scan\`, \`renma catalog\`, and \`renma graph\` before review.
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
}): string {
  return `Create a Renma ${input.kind} asset at \`${input.targetPath}\`.

Use this metadata exactly:

- id: \`${input.id}\`
- title: \`${input.title}\`
- owner: \`${input.owner}\`
- tags: \`${input.tags.join(",")}\`
- version: \`0.1.0\`
- status: \`experimental\`

Start from this deterministic scaffold and replace placeholder prose with repository-grounded content:

\`\`\`md
${input.content}\`\`\`

Constraints:

- Preserve the YAML frontmatter shape unless the repository already requires a stricter local convention.
- Use only supported statuses: experimental, stable, deprecated, archived.
- Move durable domain, testing, platform, product, or tool knowledge into separately owned context assets under \`contexts/\`.
- Use \`requires_context\` for context the skill normally depends on.
- Use \`optional_context\` for context useful only in some cases.
- Use simple supported metadata shapes only.
- For context assets, keep content durable, reviewable, and source-backed.
- Do not put task-specific prompt instructions in context assets.
- Add explicit metadata and references where appropriate.
- Do not invent owners, dependencies, policies, or domain facts.
- Do not choose runtime task context.
- Do not assemble prompts for live model calls.
- Do not call external services.
- Keep the asset LLM-facing and Renma-verifiable.
- After creating files, run \`renma scan\`, \`renma catalog\`, \`renma graph . --focus ${input.id}\`, \`renma graph . --focus ${input.id} --format mermaid\`, and \`renma graph . --focus does.not.exist\`.
`;
}

function renderTagBlock(tags: string[]): string {
  return `tags:
${tags.map((tag) => `  - ${tag}`).join("\n")}`;
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
