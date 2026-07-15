import { CANONICAL_SKILL_METADATA_KEYS } from "../metadata.js";

export const SKILL_AUTHORING_PRINCIPLE =
  "Create the smallest non-redundant Renma asset graph that preserves execution clarity and traceability.";

export const RENMA_FIRST_AUTHORING_BOUNDARY =
  "Use Renma to establish repository asset and metadata boundaries first. Use platform-native Skill guidance to refine semantics within those boundaries.";

export interface SkillAuthoringExample {
  request: string;
  assetGraph: string[];
  skillResponsibilities: string[];
  contextResponsibilities: string[];
  notCreatedByDefault: string[];
}

export interface SkillAuthoringGuidance {
  topic: "skill";
  renmaVersion: string;
  principle: string;
  workflow: string[];
  placementRules: string[];
  artifactRules: string[];
  concisenessRules: string[];
  metadataRules: string[];
  example: SkillAuthoringExample;
  verification: string[];
}

/** Build the single structured source used by every Skill guide projection. */
export function buildSkillAuthoringGuidance(
  renmaVersion: string,
): SkillAuthoringGuidance {
  const supportedGovernanceKeys = Object.values(
    CANONICAL_SKILL_METADATA_KEYS,
  ).join(", ");

  return {
    topic: "skill",
    renmaVersion,
    principle: SKILL_AUTHORING_PRINCIPLE,
    workflow: [
      "Run `renma guide skill` before generating files and define the smallest intended asset graph.",
      "Use `renma scaffold skill` as the deterministic repository-compatible starting point, then scaffold or reuse only justified Context Assets.",
      "Use platform-native guidance, including Codex `skill-creator`, only to refine trigger semantics, ordered instructions, usage boundaries, required inputs, constraints, completion criteria, and ambiguity-resolving examples inside the Renma boundaries.",
      "Run `renma scan . --fail-on high`, inspect catalog and graph evidence, fix relevant findings, and rerun validation.",
      "Require human review for meaningful semantic decisions and retain unresolved decisions instead of inventing answers.",
    ],
    placementRules: [
      "Skill: keep the focused task contract in `SKILL.md`: positive and negative selection boundaries, required inputs and evidence, ordered steps and decisions, constraints and failure behavior, expected output, completion criteria, and verification.",
      "Do not repeat knowledge in `SKILL.md` when a Context Asset owns it.",
      "Context Asset: create or reuse one when knowledge is reusable across Skills, has independent ownership or lifecycle, is maintained separately, is an authoritative source of truth, or is required for correctness.",
      "Source-of-truth status alone justifies a Context Asset; cross-Skill reuse is not required.",
      "Represent an external authoritative URL that the Skill depends on with a small Context Asset that records what the source governs, the URL, when it must be consulted, and necessary scope or fallback behavior.",
      "Do not copy the full external document unless an intentional reviewed snapshot is required, and do not repeat the URL and its explanation across the Skill and support files.",
      "Declare always-needed Context with `metadata.renma.requires-context`; use `metadata.renma.optional-context` only when the workflow can validly complete without it.",
      "Context Lens: create one only when the same declared Context needs a meaningful, reusable, purpose-specific interpretation; a Context Asset does not require a Lens by itself.",
      "Skill-local Reference: use one for detailed supporting information owned by one Skill, never as a duplicate of independently maintained source-of-truth Context.",
    ],
    artifactRules: [
      "Do not create a generic Skill first and enrich it afterward with Renma-like metadata. Construct the Skill and related assets directly within the Renma authoring contract.",
      "Improving with Renma does not mean adding metadata, files, scripts, copied specifications, or every recommendation from a generic Skill authoring system by default.",
      "Create a script only when deterministic implementation is materially safer than model judgment, an exact repeated transformation or validation is required, ordering or behavior is safety-critical, the implementation is meaningfully tested, or the user explicitly requests executable implementation.",
      "Do not create a script merely because the output is JSON, YAML, XML, or another structured format; straightforward JSON construction from a documented schema does not justify a script by itself.",
      "Add an example only when it resolves a real ambiguity.",
      "Do not add a README that restates the Skill, a paraphrased usage guide, an empty support file, a speculative future-extension document, or a resource directory without a current responsibility.",
      "Every file must have one distinct, reviewable responsibility.",
      "Renma guide output does not call an LLM, accept task text, design a Skill automatically, select runtime Context, create or edit files, fetch URLs, infer facts or governance, or perform semantic rewriting.",
    ],
    concisenessRules: [
      "Write only information that changes execution, interpretation, validation, or review, using direct operational language.",
      "State each requirement once in the asset that owns it; do not repeat Context knowledge in `SKILL.md`.",
      "Do not repeat the same purpose statement in metadata, introduction, and conclusion.",
      "Remove generic introductions, conclusions, motivational prose, and boilerplate best practices.",
      "Do not paraphrase an external source unless the summary is necessary for correct execution.",
      "Do not add an example that merely repeats a rule.",
      "Combine adjacent steps when they have the same condition and outcome.",
      "Preserve required inputs, exceptions, failure behavior, safety constraints, completion criteria, and unresolved uncertainty; concise does not mean omitting important decisions.",
    ],
    metadataRules: [
      "Start from the current Renma scaffold and supported Agent Skills structure.",
      "Use only metadata whose semantics are defined by the installed Renma version or supported Agent Skills format; do not invent fields, infer future fields, or add every optional field by default.",
      `The installed Renma version defines these canonical Skill governance keys: ${supportedGovernanceKeys}. Use the scaffold and installed documentation for their exact encodings and security metadata contracts.`,
      "Add metadata only when it has evidence-backed meaning; keep metadata as a compact index and detailed instructions in the Markdown body.",
      "Do not invent fields such as `source_of_truth`, `trust_level`, `refresh_policy`, `product`, or similar concepts that Renma has not defined.",
      "Represent an external source of truth through supported asset relationships and normal Markdown references, not an invented metadata schema.",
      "Preserve unknown existing vendor metadata when reviewing an existing Skill, but do not manufacture new provider-specific metadata without a requirement.",
      "Platform-native guidance, including `skill-creator`, is not the authority for Renma metadata, Context placement, repository asset boundaries, file count, source-of-truth representation, or whether scripts and support files should exist.",
    ],
    example: {
      request:
        "Create a Skill that builds a JSON body for Product A. The official Product A URL is the source of truth. Improve the Skill with Renma.",
      assetGraph: [
        "skills/build-product-a-json/SKILL.md",
        "  -> requires contexts/product-a-api.md",
        "contexts/product-a-api.md",
        "  -> refers to the official Product A URL",
      ],
      skillResponsibilities: [
        "Determine the requested Product A operation.",
        "Consult the declared Product A Context.",
        "Collect missing required inputs.",
        "Construct only documented JSON fields; do not invent fields or values.",
        "Report assumptions or unresolved ambiguity.",
        "Define the expected JSON output and completion criteria.",
      ],
      contextResponsibilities: [
        "Identify the Product A specification governed by the Context.",
        "Preserve the official URL as the authoritative external source.",
        "Require current supported fields and constraints to be read from that source.",
        "Define behavior when the source cannot be accessed.",
        "Avoid copying the entire specification.",
      ],
      notCreatedByDefault: [
        "JSON-generation script",
        "second explanatory Markdown guide",
        "Context Lens",
        "duplicated URL declarations",
        "speculative metadata",
        "copied API documentation",
      ],
    },
    verification: [
      "Run `renma scan . --fail-on high` to validate supported metadata, placement, relationships, workflow quality, repeated content, mixed responsibility, and security policy.",
      "Run `renma catalog . --format markdown` to inspect the assets and normalized metadata Renma discovered.",
      "Run `renma graph . --format markdown` or a focused graph view to inspect required, optional, orphaned, and unresolved relationships.",
      "Fix relevant findings and rerun the same commands.",
      "Have a human review source authority, semantic correctness, meaningful design decisions, and unresolved uncertainty; a clean scan does not prove them.",
      "Renma scan validates and exposes repository evidence; it does not automatically create Context Assets.",
    ],
  };
}
