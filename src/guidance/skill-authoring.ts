import { CANONICAL_SKILL_METADATA_KEYS } from "../metadata.js";

export const SKILL_AUTHORING_PRINCIPLE =
  "Create the smallest non-redundant Renma asset graph that preserves execution clarity and traceability.";

export const RENMA_FIRST_AUTHORING_BOUNDARY =
  "Use Renma to establish repository asset and metadata boundaries first. Use platform-native Skill authoring guidance to refine semantics within those boundaries.";

export interface SkillAuthoringClarificationExample {
  request: string;
  confirmed: string[];
  proposed: string[];
  unresolved: string[];
  questions: string[];
}

export interface SkillAuthoringInteraction {
  openingRule: string;
  phases: string[];
  truthSources: string[];
  decisionClasses: {
    confirmed: string;
    proposed: string;
    unresolved: string;
  };
  questionRules: string[];
  creationGate: string[];
  postValidationActions: string[];
  persistenceRules: string[];
  handoffRules: string[];
  minimalTriggerExample: SkillAuthoringClarificationExample;
  productAInitialClarification: Omit<
    SkillAuthoringClarificationExample,
    "request"
  >;
}

export interface SkillAuthoringExample {
  request: string;
  initialStructure: string[];
  externalSourceReference: string;
  skillResponsibilities: string[];
  contextResponsibilities: string[];
  securityReview: string[];
  notCreatedByDefault: string[];
}

export interface SkillAuthoringGuidance {
  topic: "skill";
  renmaVersion: string;
  principle: string;
  interaction: SkillAuthoringInteraction;
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
    interaction: {
      openingRule:
        "When a user asks to create a Skill with `renma guide skill`, begin with interactive clarification. Do not create files immediately.",
      phases: [
        "Understand the provisional recurring task and expected result without requiring an upfront plan document or complete specification.",
        "Investigate only the available repository evidence needed for the current decisions.",
        "Classify the current understanding as confirmed facts, proposed decisions, and unresolved human decisions.",
        "Ask one to three focused questions about the highest-impact unresolved decisions.",
        "Propose the smallest justified Skill, Context, and support-file structure.",
        "Pass the creation gate by resolving every blocking human decision.",
        "Scaffold and author within the established Renma boundaries.",
        "Validate with the relevant Renma commands.",
        "For each finding, repair deterministically, investigate repository evidence, ask the human, or justify no change; then rerun relevant validation after repairs.",
        "Finish with human review of meaningful decisions and unresolved non-blocking uncertainty.",
      ],
      truthSources: [
        "An explicit user statement can confirm domain or governance truth.",
        "Unambiguous repository evidence can confirm a fact; identify the relevant file, metadata, or command result when explaining it.",
        "An explicit user delegation can confirm authority to choose one reversible implementation decision, but it does not confirm unrelated domain facts.",
        "Renma rules supply structural defaults and deterministic repository evidence; a safe default remains proposed until user, repository, or delegated authority confirms it.",
        "An existing repository pattern is not authoritative merely because it exists; consider Renma diagnostics and explicit evidence before relying on it.",
      ],
      decisionClasses: {
        confirmed:
          "A fact supported by an explicit user statement, unambiguous repository evidence, or explicit delegation to choose that reversible implementation decision. Never present a model assumption as confirmed.",
        proposed:
          "A justified but unconfirmed Renma structural default or reversible design suggestion, such as one Skill plus one source-of-truth Context, no script or Context Lens by default, a directory name, or required-versus-optional Context pending clarification. A proposal must not silently become confirmed.",
        unresolved:
          "Human truth or missing repository evidence that must not be invented, such as the recurring task, source authority, ownership, product behavior, runtime source access, fallback behavior, external-action permission, required-versus-optional Context, executable implementation intent, or domain completion criteria.",
      },
      questionRules: [
        "Before asking, check whether relevant repository evidence answers the question and whether a Renma rule supplies a safe structural default; ask only when human truth is still required.",
        "In an existing repository, use only commands that answer the current question, such as `renma scan . --fail-on high --format json`, `renma catalog . --format json`, `renma inspect <relevant-file> --format json`, or `renma graph . --focus <relevant-id-or-path> --format json`; do not make every command mandatory ceremony.",
        "Look for an existing Skill that owns the workflow, reusable Context Assets, naming and ownership evidence, security profiles, nearby validated examples, and conflicting or unhealthy conventions before asking questions those sources can answer.",
        "Ask one to three closely related questions at a time, prioritize the highest-impact unresolved decisions, state a proposed default when useful, and briefly explain why the answer changes the Skill.",
        "Ask only about decisions that materially affect responsibility, usage boundaries, inputs, output, completion or failure behavior, placement, Context necessity, source authority, security policy, or support-file justification; do not send a comprehensive questionnaire.",
        "Do not require a plan-mode-quality specification, ask the user to choose metadata syntax, repeat supplied facts, request unneeded future extensions, or block on wording, tags, examples, or formatting that can be refined later.",
        "On the first meaningful response, present a compact Current understanding with Confirmed, Proposed, Unresolved, and Question sections; later report only material changes when possible, and never write this temporary summary as a Renma asset.",
        "If the user does not know, retain domain or governance truth as unresolved, continue with other decisions when possible, and stop before creation only when it is blocking.",
        "If the user delegates a reversible choice, record the delegation as confirmed, choose and explain the smallest safe default, and do not extend that delegation to unrelated facts.",
      ],
      creationGate: [
        "Before file creation, establish the focused recurring task, expected result, and meaningful completion or failure behavior.",
        "Establish the smallest justified Skill, Context, and support-file structure, including source authority and required-versus-optional Context semantics when relevant.",
        "Resolve runtime source-access intent, blocking security-policy decisions, and product or domain rules that cannot safely be inferred when they affect the workflow.",
        "Resolve the owner required by file-mode scaffold unless repository evidence already provides it.",
        "Do not create files while any blocking decision remains unresolved, merely because a generic generator is available, or to make progress appear complete.",
        "Do not block creation on a complete plan, every edge case, final prose, all examples, finalized tags, speculative future capabilities, or perfect certainty about non-blocking details.",
        "Once the gate passes, present the smallest proposed asset structure and remaining non-blocking proposals; ask for confirmation only for a meaningful discretionary boundary that remains uncertain, and do not add redundant confirmation after the user has authorized creation.",
        "Run the appropriate Renma scaffold commands, then refine generated content only within the established boundaries.",
      ],
      postValidationActions: [
        "Deterministic repair: make only a bounded correction supported by a diagnostic and repository evidence, such as an invalid supported encoding, clear path or ID typo, unsupported invented field, or exact duplicated passage; follow repair constraints and rerun relevant validation.",
        "Repository investigation: inspect more evidence before asking when a target, parent, owner, reusable Context, convention, or intended boundary is unresolved or ambiguous.",
        "Human decision required: ask a focused question and update the decision summary when owner, authority, product behavior, permission, Context necessity, fallback behavior, long-form coherence, or script intent depends on human truth.",
        "No change justified: explain why evidence does not support a repair or why an advisory reflects reviewed intentional design.",
        "Never add a suppression automatically, weaken security policy, manufacture metadata, perform a semantic rewrite merely to clear a finding, or convert a human decision into a model assumption.",
      ],
      persistenceRules: [
        "Persist only durable reviewed decisions: the focused workflow, usage boundaries, inputs, output and completion behavior, supported metadata, Context relationships, authoritative references, fallback behavior, evidence-backed security policy, and concise rationale that materially supports future review.",
        "Do not automatically persist the conversation transcript, private model reasoning, temporary Confirmed, Proposed, or Unresolved summaries, rejected proposals, unanswered questions, speculative future work, generic motivational prose, or metadata invented to store conversation state.",
        "Pause before writing a misleading final asset when a blocking decision remains unresolved.",
        "Report non-blocking uncertainty to the user instead of hiding it in authoritative prose.",
        "Do not introduce Renma metadata fields for decision state or conversation history.",
      ],
      handoffRules: [
        "Platform-native Skill authoring guidance must not independently generate a generic Skill before the Renma clarification gate.",
        "After the gate, platform-native Skill authoring guidance may refine trigger descriptions, instructions, workflow, constraints, completion criteria, and ambiguity-resolving examples from the Renma scaffold and agreed structure.",
        "Platform-native Skill authoring guidance must not independently add metadata, Context Assets, scripts, examples, or support files outside the agreed structure.",
        "Platform-native Skill authoring guidance must not create a second target file through another generator.",
        "Renma remains non-interactive: the consuming LLM investigates, proposes, asks, and edits; the user supplies domain and governance truth; Renma provides deterministic authoring rules and repository evidence; a human approves meaningful decisions.",
      ],
      minimalTriggerExample: {
        request: "I want to create a Skill with `renma guide skill`.",
        confirmed: [
          "You want to create a new Skill using the Renma authoring contract.",
        ],
        proposed: [
          "No asset structure is justified yet.",
          "I will start with the smallest structure after the workflow is clear.",
        ],
        unresolved: ["The recurring task.", "The expected result."],
        questions: [
          "What recurring task should the Skill perform, and what result should it produce?",
        ],
      },
      productAInitialClarification: {
        confirmed: [
          "The workflow builds a Product A JSON body.",
          "The official Product A documentation is authoritative.",
        ],
        proposed: [
          "One focused Skill.",
          "One concise source-of-truth Context Asset.",
          "The Context is likely required.",
          "No script or Context Lens by default.",
        ],
        unresolved: [
          "Whether the finished Skill accesses the URL at execution time.",
          "What happens when the source cannot be accessed.",
          "The Context owner, unless repository evidence resolves it.",
        ],
        questions: [
          "Should the Skill access the official URL during execution, or should the relevant documentation be supplied through another approved process?",
          "When the source is unavailable, should the Skill stop rather than infer the JSON schema?",
        ],
      },
    },
    workflow: [
      "Run `renma guide skill`, clarify the request, investigate relevant evidence, and define the smallest intended asset structure before generating files.",
      "Use `renma scaffold skill` as the deterministic repository-compatible starting point, then scaffold or reuse only justified Context Assets.",
      "Use platform-native Skill authoring guidance only to refine trigger semantics, ordered instructions, usage boundaries, required inputs, constraints, completion criteria, and ambiguity-resolving examples inside the Renma boundaries.",
      "Run `renma scan . --fail-on high`, inspect only the catalog, graph, or file evidence needed for each question, classify the next action, and rerun validation after deterministic repairs.",
      "Require human review for meaningful semantic decisions and retain unresolved decisions instead of inventing answers.",
    ],
    placementRules: [
      "Skill: keep the focused task contract in `SKILL.md`: positive and negative selection boundaries, required inputs and evidence, ordered steps and decisions, constraints and failure behavior, expected output, completion criteria, and verification.",
      "Do not repeat knowledge in `SKILL.md` when a Context Asset owns it.",
      "Context Asset: create or reuse one only when knowledge has an independent maintenance or governance reason, such as cross-Skill reuse, independent ownership or lifecycle, maintenance separate from the Skill, an authoritative source-of-truth role, or another explicit reason for independent review and governance.",
      "Information being important to Skill correctness does not by itself require a Context Asset when it is task-specific and has no independent maintenance or governance boundary; keep it in `SKILL.md` or justified Skill-local support.",
      "Source-of-truth status alone justifies a Context Asset because it establishes an independent authority and maintenance boundary; cross-Skill reuse is not required.",
      "Represent an external authoritative URL that the Skill depends on with a small Context Asset that records what the source governs, the URL, when it must be consulted, and necessary scope or fallback behavior.",
      "Do not copy the full external document unless an intentional reviewed snapshot is required, and do not repeat the URL and its explanation across the Skill and support files.",
      "After a Context Asset is independently justified, use `metadata.renma.requires-context` when Skill correctness depends on it; use `metadata.renma.optional-context` only when the workflow can validly complete without it.",
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
      "Treat a name change that alters the canonical Skill directory/name relationship as an intentional path and identity change requiring Agent Skills and Renma validation, not as an ordinary semantic rewrite.",
      "For an external source, decide whether the finished Skill reads the URL at execution time or expects relevant source content from the user or another approved process.",
      "When runtime network access is intended, explicitly review and declare supported effective policy for allowed data, network allowance, approved network destinations, external upload, secrets, and human approval where applicable.",
      "Public documentation commonly uses the documented `public-docs` data category, but do not manufacture permissive policy values without evidence.",
      "A Markdown URL records a source reference; it does not grant network permission. Derive an approved destination only from the actual reviewed URL or repository policy.",
      "Ensure the Skill body, Context instructions, and effective security policy agree. Preserve unresolved access intent or policy as a human decision instead of silently allowing or denying network access.",
      "Scaffold generation performs no network operations. A finished Skill may access a reviewed external source only when its authored workflow and effective security policy explicitly permit it.",
      "The guide command does not conduct a conversation, retain session state or history, accept task text, ask the user questions directly, call an LLM, interpret answers, design a Skill automatically, select a runtime Skill or Context, create or edit files, fetch URLs, infer facts or governance, or automatically repair or semantically rewrite assets.",
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
      "Platform-native Skill authoring guidance is not the authority for Renma metadata, Context placement, repository asset boundaries, file count, source-of-truth representation, or whether scripts and support files should exist.",
    ],
    example: {
      request:
        "Create a Skill that builds a JSON body for Product A. The official Product A URL is the source of truth. Improve the Skill with Renma.",
      initialStructure: [
        "skills/build-product-a-json/SKILL.md",
        "  -> requires",
        "contexts/product-a-api.md",
      ],
      externalSourceReference:
        "`contexts/product-a-api.md` contains the reviewed official Product A URL. The URL is not a Renma asset node or graph edge.",
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
      securityReview: [
        "Decide whether execution reads the external URL or uses source content supplied by the user or another approved process.",
        "If runtime access is intended, review the supported effective security policy for allowed data, network access, approved destinations, uploads, secrets, and human approval as applicable.",
        "Do not treat the URL as permission and do not infer permissive policy values; preserve unresolved access intent or policy for human review.",
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
      "Run `renma graph . --format markdown` or a focused graph view to inspect required, optional, orphaned, and unresolved repository-asset relationships. It validates the Skill-to-Context relationship but does not model the external URL as an asset node.",
      "Inspect the Context body to confirm that it preserves the reviewed external source reference and agrees with the Skill workflow and effective security policy.",
      "Fix relevant findings and rerun the same commands.",
      "Have a human review source authority, successful URL access, semantic correctness, meaningful design decisions, and unresolved uncertainty; a clean scan or graph does not prove them.",
      "Renma scan validates and exposes repository evidence; it does not automatically create Context Assets.",
    ],
  };
}
