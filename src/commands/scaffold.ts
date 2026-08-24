import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareUtf16CodeUnits } from "../canonical-json.js";
import { CLI_EXIT, CliUserError } from "../cli-errors.js";
import { normalizeAgentSkillDirectoryName } from "../agent-skills.js";
import {
  classifyAbsoluteSkillEntrypointPath,
  classifyAssetPath,
  classifyRepositorySkillEntrypointPath,
  normalizeAssetRepositoryRelativePath,
  repositoryClassificationPath,
} from "../discovery.js";
import {
  RENMA_FIRST_AUTHORING_BOUNDARY,
  SKILL_AUTHORING_PRINCIPLE,
} from "../guidance/skill-authoring.js";
import { formatVersionedJsonDocument } from "../report.js";
import {
  readSkillAuthoringHandoff,
  validateSkillAuthoringHandoffIdentityAndGraph,
  validateSkillAuthoringHandoffTarget,
  type SkillAuthoringHandoff,
} from "../skill-authoring-handoff.js";
import { CANONICAL_SKILL_DESCRIPTION_AUTHORING_RULE } from "../types/skill-description.js";
import { RESERVED_SKILL_SUPPORT_DIRS } from "../skill-path-contract.js";
import { RENMA_SCAFFOLD_PLACEHOLDERS } from "../scaffold-placeholders.js";

type ScaffoldKind = "skill" | "context" | "context_lens";
type ScaffoldFormat = "file" | "prompt" | "json";
export type ScaffoldResource = "references" | "scripts" | "assets";
export const SCAFFOLD_JSON_SCHEMA_VERSION = "renma.scaffold.v1" as const;

export interface ScaffoldOptions {
  kind: ScaffoldKind;
  targetPath: string;
  format: ScaffoldFormat;
  id?: string;
  title?: string;
  owner?: string;
  tags?: string[];
  resources?: ScaffoldResource[];
  handoffPath?: string;
}

interface ScaffoldBundle {
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
  handoff?: SkillAuthoringHandoff;
}

export async function runScaffoldCommand(
  options: ScaffoldOptions,
): Promise<number> {
  const handoff = options.handoffPath
    ? await readSkillAuthoringHandoff(options.handoffPath)
    : undefined;
  if (handoff) {
    validateSkillAuthoringHandoffTarget(handoff, options.targetPath);
    validateSkillAuthoringHandoffIdentityAndGraph(handoff);
  }
  const bundle = buildScaffoldBundle(options, handoff);

  if (options.format === "json") {
    process.stdout.write(
      formatVersionedJsonDocument(SCAFFOLD_JSON_SCHEMA_VERSION, bundle),
    );
    return CLI_EXIT.success;
  }

  if (options.format === "prompt") {
    process.stdout.write(bundle.prompt);
    return CLI_EXIT.success;
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
      options.kind === "skill"
        ? `\n${renderSkillNextSteps(handoff !== undefined)}\n`
        : ""
    }`,
  );
  return CLI_EXIT.success;
}

export function buildScaffoldBundle(
  options: ScaffoldOptions,
  handoff?: SkillAuthoringHandoff,
): ScaffoldBundle {
  if (handoff && options.kind !== "skill") {
    throw new CliUserError("--handoff is supported only for skill scaffolds.");
  }
  if (
    handoff &&
    (options.id !== undefined ||
      options.title !== undefined ||
      options.owner !== undefined ||
      options.tags !== undefined ||
      options.resources !== undefined)
  ) {
    throw new CliUserError(
      "--handoff cannot be combined with --id, --title, --owner, --tags, or --resources.",
    );
  }
  validateScaffoldTargetPath(options.kind, options.targetPath);
  const suppliedSkill = handoff?.assetGraph.skill;
  const id =
    suppliedSkill?.id ??
    options.id ??
    inferId(options.kind, options.targetPath);
  const title = suppliedSkill?.title ?? options.title ?? titleFromId(id);
  const owner = suppliedSkill?.owner ?? options.owner ?? "unowned";
  const tags = suppliedSkill
    ? [...suppliedSkill.tags]
    : options.tags && options.tags.length > 0
      ? options.tags
      : ["authoring"];
  const resources = suppliedSkill
    ? [...suppliedSkill.resources]
    : [...new Set(options.resources ?? [])].sort(compareUtf16CodeUnits);
  if (options.kind !== "skill" && resources.length > 0) {
    throw new CliUserError(
      "--resources is supported only for skill scaffolds.",
    );
  }
  const content =
    options.kind === "skill"
      ? renderSkillScaffold({
          name: canonicalSkillName(options.targetPath),
          id,
          title,
          owner,
          tags,
          ...(suppliedSkill
            ? {
                relationships: {
                  requiresContext: suppliedSkill.requiresContext,
                  optionalContext: suppliedSkill.optionalContext,
                  requiresLens: suppliedSkill.requiresLens,
                  optionalLens: suppliedSkill.optionalLens,
                },
              }
            : {}),
        })
      : options.kind === "context_lens"
        ? renderContextLensScaffold({ id, title, owner, tags })
        : renderContextScaffold({ id, title, owner, tags });

  const bundle: ScaffoldBundle = {
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
      ...(handoff ? { handoff } : {}),
    }),
  };
  if (handoff) bundle.handoff = handoff;
  return bundle;
}

function validateScaffoldTargetPath(
  kind: ScaffoldKind,
  targetPath: string,
): void {
  if (kind === "skill") return;
  const normalizedPath = targetPath.replaceAll("\\", "/");
  const repositoryBoundary = repositoryClassificationPath(normalizedPath);
  const relativePath =
    repositoryBoundary.state === "resolved"
      ? repositoryBoundary.relativePath
      : normalizeAssetRepositoryRelativePath(normalizedPath);
  const classification = relativePath
    ? classifyAssetPath(relativePath, {
        ...(kind === "context_lens" ? { metadataType: "context_lens" } : {}),
      })
    : undefined;
  const isMarkdownFile =
    relativePath !== undefined &&
    relativePath.endsWith(".md") &&
    relativePath.split("/").length > 1;

  if (
    kind === "context" &&
    classification?.kind === "context" &&
    isMarkdownFile
  ) {
    return;
  }
  if (
    kind === "context_lens" &&
    classification?.kind === "context_lens" &&
    isMarkdownFile
  ) {
    return;
  }

  throw new CliUserError(
    kind === "context"
      ? "Context scaffolds require a Markdown target under contexts/** so normal discovery classifies it as a Context Asset."
      : "Context Lens scaffolds require a Markdown target under lenses/** or contexts/** so normal discovery classifies it as a Context Lens.",
  );
}

function renderSkillScaffold(metadata: {
  name: string;
  id: string;
  title: string;
  owner: string;
  tags: string[];
  relationships?: {
    requiresContext: string[];
    optionalContext: string[];
    requiresLens: string[];
    optionalLens: string[];
  };
}): string {
  const relationships = metadata.relationships;
  return `---
name: ${metadata.name}
description: ${RENMA_SCAFFOLD_PLACEHOLDERS.skill.description}
metadata:
  renma.id: ${yamlString(metadata.id)}
  renma.title: ${yamlString(metadata.title)}
  renma.version: "0.1.0"
  renma.owner: ${yamlString(metadata.owner)}
  renma.status: experimental
  renma.tags: ${yamlString(JSON.stringify(metadata.tags))}
  renma.requires-context: ${yamlString(JSON.stringify(relationships?.requiresContext ?? []))}
  renma.optional-context: ${yamlString(JSON.stringify(relationships?.optionalContext ?? []))}
${
  relationships
    ? `  renma.requires-lens: ${yamlString(JSON.stringify(relationships.requiresLens))}
  renma.optional-lens: ${yamlString(JSON.stringify(relationships.optionalLens))}
`
    : ""
}  renma.conflicts: '[]'
---

# ${metadata.title}

## Purpose

${RENMA_SCAFFOLD_PLACEHOLDERS.skill.purpose}

## Required Inputs

${RENMA_SCAFFOLD_PLACEHOLDERS.skill.requiredInput}

## Instructions

${RENMA_SCAFFOLD_PLACEHOLDERS.skill.inspectInstruction}
${RENMA_SCAFFOLD_PLACEHOLDERS.skill.reviewInstruction}
${RENMA_SCAFFOLD_PLACEHOLDERS.skill.expectedOutput}

## Context References

Use \`metadata.renma.requires-context\` and \`metadata.renma.optional-context\` JSON-array strings to reference durable context assets.

Move knowledge into a Context Asset under \`contexts/\` only when it has an independent maintenance or governance reason, such as cross-Skill reuse, independent ownership or lifecycle, separate maintenance, or an authoritative source-of-truth role. Keep task-specific knowledge with no independent boundary in this Skill or justified Skill-local support.

## Constraints

- ${CANONICAL_SKILL_DESCRIPTION_AUTHORING_RULE}
- Keep recommendations grounded in provided inputs and repository evidence.
- Leave domain facts, policies, owners, dependencies, and product behavior unspecified when repository evidence does not declare them; stop and report any resulting blocker.
- Stay within this Skill's declared scope; stop and report requests that require different runtime task context.
- Keep the result as reviewable workflow guidance instead of prompt material for live model calls.

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

${RENMA_SCAFFOLD_PLACEHOLDERS.context.summary}

## Scope

This context applies when:

${RENMA_SCAFFOLD_PLACEHOLDERS.context.appliesWhen}

This context does not apply when:

${RENMA_SCAFFOLD_PLACEHOLDERS.context.doesNotApplyWhen}

## Guidance

- Keep this context specific, reviewable, and source-backed.
- Prefer stable facts over transient implementation notes.

## Constraints

- Do not put task-specific prompt instructions in this context asset.
- Keep this asset focused on knowledge with an independent maintenance or governance reason, such as reuse, independent ownership or lifecycle, separate maintenance, or source authority.
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
  handoff?: SkillAuthoringHandoff;
}): string {
  const skillGuidance =
    input.kind === "skill"
      ? [
          "- Keep the Skill in Agent Skills format with Renma extensions under `metadata.renma.*`.",
          `- ${CANONICAL_SKILL_DESCRIPTION_AUTHORING_RULE}`,
          "- Use `metadata.renma.requires-context` for context the skill normally depends on, encoded as a JSON-array string.",
          "- Use `metadata.renma.optional-context` for context useful only in some cases, encoded as a JSON-array string.",
          "- Use `metadata.renma.requires-lens` or `metadata.renma.optional-lens` for static lens relationships, encoded as JSON-array strings.",
          "- State exactly when each local resource should be read or executed. Keep Skill-specific detail in references/, deterministic implementation in scripts/, and output material in assets/.",
          "- Use contexts/ only for knowledge with an independent maintenance or governance reason, such as cross-Skill reuse, independent ownership or lifecycle, separate maintenance, or source authority. Correctness importance alone is not sufficient.",
          "- For an external source, decide whether execution accesses it or expects approved supplied content. A Markdown URL does not grant network permission.",
          "- When runtime access is intended, review the supported effective security policy and derive approved destinations only from the reviewed URL or repository policy. Do not infer permissive values.",
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
  const handoffSection = input.handoff
    ? `${renderAuthoringHandoffPrompt(input.handoff)}\n\n`
    : "";
  return `Create a Renma ${input.kind} asset at \`${input.targetPath}\`.

${handoffSection}Use this metadata exactly:

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
    ? `Apply the authoring contract from \`renma guide skill\`. ${SKILL_AUTHORING_PRINCIPLE} ${RENMA_FIRST_AUTHORING_BOUNDARY} Do not create a generic Skill first and enrich it afterward with Renma-like metadata. Use platform-native Skill authoring guidance only to refine the generated Skill's trigger description, instructions, workflow, constraints, completion criteria, and examples that resolve real ambiguity. Preserve the repository's intended behavior, and do not invent owners, policies, dependencies, domain rules, or source-of-truth claims. After editing, run \`renma scan . --fail-on high\`, inspect catalog and graph evidence, address relevant findings, and rerun validation. Do not weaken security policy or add suppressions merely to make validation pass. Have a human review meaningful semantic changes before merging.\n\n`
    : ""
}Constraints:

- Preserve the YAML frontmatter shape unless the repository already requires a stricter local convention.
- Use only supported statuses: experimental, stable, suspended, deprecated, archived. Suspended requires a reviewed non-blank reason and real YYYY-MM-DD status-changed date.
- Move knowledge into a Context Asset under \`contexts/\` only when it has an independent maintenance or governance reason. Keep task-specific knowledge in the Skill or justified Skill-local support.
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
- Scaffold generation performs no network operations. A finished Skill may access a reviewed external source only when its authored workflow and effective security policy explicitly permit it.
- Keep the asset LLM-facing and Renma-verifiable.
- Renma reports its own exact generated Skill and Context starter markers as High findings. Replace every marker before the strict release/CI scan; this exact-marker check does not prove broader semantic completeness.
- After creating files, run \`renma scan .\`, \`renma catalog . --format json\`, and \`renma graph . --focus ${input.id} --format mermaid\`.
`;
}

function renderAuthoringHandoffPrompt(handoff: SkillAuthoringHandoff): string {
  const contract = handoff.skillContract;
  return `Authoring handoff

Schema: ${handoff.schemaVersion}
This is caller-declared authoring evidence. Renma validated its supplied structure and internal consistency; it did not prove the conversation, human review, source authority, completeness of the blocker set, or domain truth.

Current understanding
Confirmed:
${promptList(handoff.currentUnderstanding.confirmed)}
Proposed:
${promptList(handoff.currentUnderstanding.proposed)}
Unresolved:
${promptList(handoff.currentUnderstanding.unresolved)}

Progression
Blocking: ${handoff.progression.blocking.length}
Reversible defaults:
${promptList(handoff.progression.reversibleDefaults)}
Deferred:
${promptList(handoff.progression.deferred)}

Skill contract
Recurring task: ${contract.recurringTask}
Expected result: ${contract.expectedResult}
Required inputs:
${promptList(contract.requiredInputs)}
Completion criteria:
${promptList(contract.completionCriteria)}
Failure behavior:
${promptList(contract.failureBehavior)}
Use when:
${promptList(contract.useWhen)}
Do not use when:
${promptList(contract.doNotUseWhen)}

Asset graph
${JSON.stringify(handoff.assetGraph, null, 2)}

Declared source authorities
${JSON.stringify(handoff.sourceAuthorities, null, 2)}

Recorded security decisions
${JSON.stringify(handoff.securityDecisions, null, 2)}

Runtime unknown handling
${JSON.stringify(handoff.runtimeUnknownHandling, null, 2)}

Use the supplied handoff as the current authoring state. Do not promote Proposed or Unresolved facts to Confirmed. Do not invent omitted domain or governance truth or infer broader security permission. Re-enter clarification if new evidence creates a Blocking authoring decision. Preserve caller-provided facts directly; do not synthesize new semantic prose from them.`;
}

function promptList(items: readonly string[]): string {
  return items.length > 0
    ? items.map((item) => `- ${item}`).join("\n")
    : "- None declared.";
}

function renderSkillNextSteps(fromHandoff = false): string {
  if (fromHandoff) {
    return [
      "Next steps:",
      "1. Author within the supplied handoff's asset boundary without promoting Proposed or Unresolved state to Confirmed.",
      "2. Create supporting assets only through separate explicit scaffold commands when intended.",
      "3. Re-enter clarification if new evidence creates a Blocking decision or changes the agreed asset boundary.",
      "4. Run `renma scan . --fail-on high` and inspect catalog, graph, and readiness evidence; exact generated scaffold residue is a High finding.",
      "5. Fix relevant findings and rerun validation.",
      "6. Have a human review meaningful semantic changes and unresolved decisions before merging.",
    ].join("\n");
  }
  return [
    "Next steps:",
    "1. Confirm the `renma guide skill` authoring gate already established the smallest non-redundant intended asset structure.",
    "2. Scaffold or reuse only Context Assets justified by an independent maintenance or governance boundary.",
    "3. Complete the focused workflow and any evidence-backed security policy; use platform-native Skill authoring guidance only to refine semantics within Renma boundaries.",
    "4. Use `renma guide skill` again only when intentionally reconsidering the agreed asset boundaries.",
    "5. Run `renma scan . --fail-on high` and inspect catalog and graph evidence; exact generated scaffold residue is a High finding.",
    "6. Fix relevant findings and rerun validation.",
    "7. Have a human review meaningful semantic changes and unresolved decisions before merging.",
  ].join("\n");
}

function renderTagBlock(tags: string[]): string {
  return `tags:
${tags.map((tag) => `  - ${tag}`).join("\n")}`;
}

function canonicalSkillName(targetPath: string): string {
  const normalizedPath = targetPath.replaceAll("\\", "/");
  if (path.posix.basename(normalizedPath) !== "SKILL.md") {
    throw new CliUserError(
      "Skill scaffolds require the canonical SKILL.md filename.",
    );
  }
  const repositoryBoundary = repositoryClassificationPath(normalizedPath);
  const entrypoint =
    repositoryBoundary.state === "resolved"
      ? classifyRepositorySkillEntrypointPath(repositoryBoundary.relativePath)
      : (classifyRepositorySkillEntrypointPath(normalizedPath) ??
        classifyAbsoluteSkillEntrypointPath(normalizedPath));
  if (entrypoint?.kind !== "canonical") {
    throw new CliUserError(
      `Skill scaffolds require a canonical target under skills/ or .agents/skills/ with at least one Skill directory and without reserved Skill-support segments (${RESERVED_SKILL_SUPPORT_DIRS.join(", ")}).`,
    );
  }
  const directory = path.posix.basename(path.posix.dirname(normalizedPath));
  const validation = normalizeAgentSkillDirectoryName(directory);
  if (validation.normalized === undefined || validation.problems.length > 0) {
    throw new CliUserError(
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
