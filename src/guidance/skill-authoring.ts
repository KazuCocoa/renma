import { CANONICAL_SKILL_METADATA_KEYS } from "../metadata.js";

export const SKILL_AUTHORING_PRINCIPLE =
  "Create the smallest non-redundant Renma asset graph that preserves execution clarity and traceability.";

export const RENMA_FIRST_AUTHORING_BOUNDARY =
  "Use Renma to establish repository asset and metadata boundaries first. Use platform-native Skill authoring guidance to refine semantics within those boundaries.";

export interface SkillAuthoringProgressionClasses {
  blocking: string;
  reversibleDefault: string;
  deferred: string;
}

export interface SkillAuthoringUnknownScopes {
  authoringDecision: string;
  runtimeTaskUnknown: string;
}

export interface SkillAuthoringUnresolvedItemDispositions {
  askNow: string;
  queueAsBlocker: string;
  proceedWithReversibleDefault: string;
  defer: string;
  reportAsFinding: string;
}

export interface SkillAuthoringProgressionSummary {
  blocking: string[];
  reversibleDefaults: string[];
  deferred: string[];
  queuedBlockers: string[];
}

export interface SkillAuthoringClarificationExample {
  request: string;
  confirmed: string[];
  proposed: string[];
  unresolved: string[];
  questions: string[];
  progression?: SkillAuthoringProgressionSummary;
  runtimeTaskUnknowns?: string[];
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
  unknownScopes: SkillAuthoringUnknownScopes;
  progressionClasses: SkillAuthoringProgressionClasses;
  unresolvedItemDispositions: SkillAuthoringUnresolvedItemDispositions;
  questionRules: string[];
  creationGate: string[];
  postValidationActions: string[];
  persistenceRules: string[];
  handoffRules: string[];
  minimalTriggerExample: SkillAuthoringClarificationExample;
  reviewSkillIllustration: string[];
  productAInitialClarification: Omit<
    SkillAuthoringClarificationExample,
    "request"
  > & {
    progression: SkillAuthoringProgressionSummary;
    runtimeTaskUnknowns: string[];
  };
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
        "Understand the provisional recurring task and expected result; do not require a complete upfront specification.",
        "Investigate only the applicable evidence needed for current decisions.",
        "Before treating an unknown as a creation-gate decision, classify it as an authoring decision or a runtime task unknown.",
        "Classify the current understanding as Confirmed, Proposed, and Unresolved.",
        "Separately classify each pending authoring decision as Blocking, a Reversible default, or Deferred, and choose an unresolved-item disposition.",
        "Group related raw unknowns into decision themes while preserving their underlying evidence.",
        "Ask one to three focused questions about the highest-impact Blocking decisions in the current batch while retaining the complete blocker set.",
        "Propose the smallest justified Skill, Context, and support-file structure.",
        "Continue focused question batches and pass the creation gate when no Blocking decision remains.",
        "Scaffold the agreed structure and author within it.",
        "Validate with relevant Renma commands.",
        "Classify each finding with the post-validation rules, apply only uniquely supported repairs, and rerun relevant validation after changes.",
        "If refinement, source review, usage, or validation reveals a possible boundary change, stop structural edits.",
        "Record the boundary-change need as Proposed or Unresolved, inspect relevant evidence, ask only when human truth remains necessary, re-enter the creation gate, update the agreed structure after it passes, and then continue authoring and validation.",
        "Finish with human review of meaningful decisions and unresolved non-blocking uncertainty.",
      ],
      truthSources: [
        "Explicit user statements: confirm user intent, governance decisions, source designation, fallback choices, and other decisions the user has authority to make; they do not by themselves prove the contents of a separately designated authoritative specification.",
        "User-provided artifacts: documents, specifications, examples, logs, schemas, or other supplied material can confirm facts when provenance and applicability are clear; cite or identify the artifact when relying on it.",
        "Repository evidence: confirm a fact only when the evidence is applicable, effective, and unambiguous; do not confirm deprecated, archived, stale, conflicting, unresolved, or diagnostic-blocked evidence merely because it exists, and identify the relevant file, metadata, lifecycle evidence, or command result.",
        "Reviewed authoritative external source content: when the user designates an external source as authoritative and the authoring environment is permitted and able to access it, successfully consulted content can confirm the domain facts it governs; identify the source and relevant section or evidence, and never substitute model memory merely because a URL is known.",
        "Source designation is not source-content truth: a user can confirm that a URL is intended to be authoritative, but its schema, fields, constraints, and behavior remain unresolved until the source content is successfully consulted or supplied through another approved process.",
        "Authoring-time access and finished-Skill runtime access are separate: current consultation depends on the user request, available tools, and authoring environment, while future access instructions must agree with the finished Skill's effective Renma security policy; future metadata never retroactively authorizes the authoring agent.",
        "When authoring-time access is unavailable, ask the user for the relevant source content when needed or preserve source-dependent facts as Unresolved; do not fill them from memory or plausible assumptions.",
        "Renma structural rules: determine structural constraints and supply proposed defaults, but do not establish product or domain truth; an existing pattern is not authoritative merely because it exists.",
      ],
      decisionClasses: {
        confirmed:
          "A fact supported by an applicable truth source above, or authority to choose one reversible implementation decision through explicit user delegation. Never present a model assumption as confirmed domain truth; this includes model memory, source designation alone, and stale or conflicting evidence.",
        proposed:
          "A justified but unconfirmed Renma structural default or reversible design suggestion, such as one Skill plus one source-of-truth Context, no script or Context Lens by default, a directory name, or required-versus-optional Context pending clarification. A proposal must not silently become confirmed.",
        unresolved:
          "Human truth or missing applicable evidence that must not be invented, such as the recurring task, inaccessible source-dependent facts, source authority, ownership, product behavior, authoring-time or runtime source access, fallback behavior, external-action permission, required-versus-optional Context, executable implementation intent, or domain completion criteria.",
      },
      unknownScopes: {
        authoringDecision:
          "A decision needed to define the Skill contract, such as the recurring workflow, expected output, usage boundaries, required inputs, completion or failure contract, source authority, Skill-versus-Context placement, runtime source-access policy, evidence-backed security policy, or another choice that changes repository structure or Skill behavior. An unresolved authoring decision may be Blocking.",
        runtimeTaskUnknown:
          "A fact expected to vary or be missing in material the finished Skill processes, such as ambiguity in a reviewed specification, an unspecified timeout, retry or rollback behavior, permissions, acceptance criteria, expected results, or a currently unavailable schema. It does not automatically block Skill creation; define how execution preserves and reports it, continues independent analysis, asks the runtime user only when the current execution stage depends on it, or stops safely rather than inventing truth. Do not ask the author to resolve task-instance unknowns merely because the finished Skill may encounter them.",
      },
      progressionClasses: {
        blocking:
          "A decision that must be resolved before the current creation gate can pass, such as an unclear recurring task or expected result, required but unresolved source authority or product behavior, security permission that materially affects the workflow, unsafe or ambiguous failure behavior, an unjustified Skill-versus-Context boundary, or a missing owner required by file-mode scaffold. Retain every Blocking decision even when the current question batch cannot ask about all of them.",
        reversibleDefault:
          "A Proposed decision that permits progress because it is safe, easy to change, does not invent domain or governance truth, does not broaden security permissions, and can return to clarification when evidence changes. Proceeding with it never changes it from Proposed to Confirmed.",
        deferred:
          "An Unresolved or Proposed decision that is not required for the current authoring stage, such as wording, optional examples, final tags, non-blocking edge cases, possible future reuse, or speculative features. Keep it visible rather than treating it as forgotten or resolved; if later evidence makes it material to correctness, security, completion, or asset boundaries, move it to Blocking and re-enter clarification.",
      },
      unresolvedItemDispositions: {
        askNow:
          "Select a current-stage Blocking decision theme for this question batch.",
        queueAsBlocker:
          "Keep a Blocking theme visible in the complete blocker set when it is not addressed by the current question batch.",
        proceedWithReversibleDefault:
          "Use a safe Proposed choice that invents no domain or governance truth and broadens no permission.",
        defer:
          "Keep a Proposed or Unresolved item visible when the current stage does not depend on it.",
        reportAsFinding:
          "Preserve an evidence-backed runtime task unknown in the finished Skill's output with its impact or risk instead of requiring it to be resolved during authoring or execution.",
      },
      questionRules: [
        "Before asking, check whether an applicable truth source above answers the question and whether a Renma rule supplies a safe structural default; ask only when human truth or unavailable source content is still required.",
        "In an existing repository, use only commands that answer the current question, such as `renma scan . --fail-on high --format json`, `renma catalog . --format json`, `renma inspect <relevant-file> --format json`, or `renma graph . --focus <relevant-id-or-path> --format json`; do not make every command mandatory ceremony.",
        "Look for an existing Skill that owns the workflow, reusable Context Assets, naming and ownership evidence, security profiles, nearby validated examples, and conflicting or unhealthy conventions before asking questions those sources can answer.",
        "Preserve raw unknowns and their evidence, group related items by the decision they depend on, prioritize themes by risk and downstream impact, ask only about Blocking themes, keep non-blocking themes as findings or Deferred items, and expand an individual item only when the distinction materially changes the result. For example, timeout, retry count, partial success, and rollback normally form one Failure and recovery behavior theme rather than four default questions.",
        "Maintain the complete current set of unresolved and proposed decisions with separate progression classifications. The limit of one to three closely related questions applies to the current turn, not to the total number of unresolved or Blocking decisions; never impose an arbitrary maximum on that total set.",
        "Prioritize the highest-impact Blocking decisions, ask at most three closely related questions in the current batch, keep additional Blocking decisions visible as queued blockers, and continue with the next batch after the user answers. Never relabel an unasked Blocking decision as Deferred merely because the batch limit was reached.",
        "When more unresolved items exist than can be asked about now, use a compact Current progression summary with the Blocking count, questions being asked, queued blockers, reversible defaults, and meaningful Deferred decisions; later report only material changes instead of repeating the unchanged set in full.",
        "Do not guess does not mean stop and ask about every unknown: never present missing truth as Confirmed, continue work that does not depend on it, preserve the unknown with evidence, report assumptions and uncertainty, ask only when it blocks the current stage, and never manufacture expected behavior merely to complete an output.",
        "Ask the author only about authoring decisions that materially affect responsibility, usage boundaries, inputs, output, completion or failure behavior, placement, Context necessity, source authority, security policy, or support-file justification; do not send a comprehensive questionnaire. Do not ask the author to resolve runtime task unknowns that the finished Skill should detect, report, request, or handle safely.",
        "A runtime-stage blocker is execution behavior that the authored Skill must handle. It does not enter the authoring creation-gate blocker set merely because a future task instance may encounter it. Only an unresolved authoring decision about whether the Skill should ask, report, defer, or stop for that runtime blocker may block Skill creation.",
        "At each meaningful stage transition, when the workflow actually has stages, reassess unresolved decision themes. Treat a runtime task unknown as a runtime-stage blocker when the next execution stage depends on it, follow the Skill's authored ask, report, defer, or stop policy, and return it to Report as finding when a later requested output does not require resolution. Do not add the task-instance fact to the authoring creation-gate blocker set; re-enter authoring clarification only when the Skill's handling policy or asset boundary itself is unresolved.",
        "Do not require a plan-mode-quality specification, ask the user to choose metadata syntax, repeat supplied facts, request unneeded future extensions, or block on wording, tags, examples, or formatting that can be refined later.",
        "On the first meaningful response, present a compact Current understanding with Confirmed, Proposed, Unresolved, and Question sections plus progression status when useful; never write this temporary summary as a Renma asset.",
        "If the user does not know, retain domain or governance truth as unresolved, continue with other decisions when possible, and stop before creation only when it is blocking.",
        "If the user says to use your judgment, treat that as delegation only for identified reversible choices: record the authority as Confirmed, keep the selected default Proposed, explain the smallest safe choice, and do not infer product behavior, source authority, ownership, security permission, or unrelated facts.",
        "A high number of raw unknowns or themes alone does not imply a Skill split; for review Skills, many unknowns may be the expected output. Reconsider the boundary only when Blocking themes reveal materially independent tasks, inputs, outputs, users, security contracts, completion criteria, or workflows. Then propose a split or narrower first Skill, explain the independent responsibilities, keep the boundary Proposed, ask only if evidence cannot resolve it, and re-enter the creation gate after the decision.",
      ],
      creationGate: [
        "Before file creation, establish the focused recurring task, expected result, and meaningful completion or failure behavior.",
        "Establish the smallest justified Skill, Context, and support-file structure, including source authority and required-versus-optional Context semantics when relevant.",
        "Resolve authoring-time source consultation, finished-Skill runtime source-access intent, blocking security-policy decisions, and product or domain rules that cannot safely be inferred when they affect the workflow.",
        "Treat authoritative source content as an authoring blocker only when source-specific instructions, transformations, embedded examples, or validation behavior cannot be defined without consulting it; otherwise define a safe runtime consultation and fallback contract without requiring the full specification during authoring.",
        "Resolve the owner required by file-mode scaffold unless repository evidence already provides it.",
        "Do not create files while any blocking decision remains unresolved, merely because a generic generator is available, or to make progress appear complete.",
        "Do not block creation on task-instance unknowns when the Skill contract can safely detect and report them with evidence, continue unaffected work, request runtime input only when needed, and stop without inventing truth when the requested output cannot be produced.",
        "Do not block creation on a complete plan, every edge case, final prose, all examples, finalized tags, speculative future capabilities, or perfect certainty about non-blocking details.",
        "Proceed when no Blocking decision remains. Reversible defaults and Deferred decisions may remain when they are visible and safe and do not conceal missing domain or governance truth.",
        "When proceeding, identify the reversible defaults being used and meaningful Deferred decisions, keep them Proposed or Unresolved rather than presenting them as Confirmed, do not ask for redundant confirmation after the user has authorized progress, and re-enter clarification if later evidence changes their impact.",
        "Once the gate passes, present the smallest proposed asset structure; ask for confirmation only for a meaningful discretionary boundary that remains uncertain.",
        "Run the appropriate Renma scaffold commands, then refine generated content only within the established boundaries; re-enter this gate before changing those boundaries later.",
      ],
      postValidationActions: [
        "A finding is not a deterministic repair merely because its detection is deterministic.",
        "Deterministic repair: make a bounded correction only when evidence uniquely determines the patch, such as correcting an invalid encoding when the intended supported value is explicit and unambiguous, correcting a path or ID typo when repository evidence proves exactly one intended existing target, or applying an explicitly supplied diagnostic repair whose constraints uniquely determine the change.",
        "Unsupported field: remove it deterministically only when evidence proves that removal loses no intended meaning; otherwise investigate why it exists and whether the information belongs in the Skill body, supported metadata, a Context Asset, or nowhere, then request a human decision when necessary.",
        "Repeated-context evidence: do not delete or rewrite content solely because a repeated section, code block, or context-pattern finding exists. Inspect all occurrences, determine intended ownership and source-of-truth boundaries, prepare a consolidation proposal, and require human review before any semantic consolidation; choosing an authoritative copy, owning asset, Context, or replacement references is not an automatic repair.",
        "Repository investigation: inspect more evidence before asking when a target, parent, owner, reusable Context, convention, or intended boundary is unresolved or ambiguous.",
        "Human decision required: ask a focused question and update the decision summary when owner, authority, product behavior, permission, Context necessity, fallback behavior, long-form coherence, or script intent depends on human truth.",
        "No change justified: explain why evidence does not support a repair or why an advisory reflects reviewed intentional design.",
        "Diagnostics v2: follow supplied repair constraints and verification steps; when a diagnostic prohibits automatic semantic changes, preserve that boundary.",
        "Boundary-change re-entry: if a finding reveals a possible need to add or remove files, metadata, Context relationships, scripts, examples, or support assets, stop the structural edit, record the need as Proposed or Unresolved, investigate, ask if needed, and re-enter the creation gate before changing the agreed structure.",
        "Boundary-change examples include discovering that deterministic validation genuinely requires a script, a proposed Context is task-local, an existing Context should be reused, security policy needs change, required-versus-optional Context semantics are wrong, or an example is needed to resolve real ambiguity.",
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
        "If semantic refinement reveals a justified asset-boundary change, stop structural edits and return the need to the Renma clarification protocol as Proposed or Unresolved; inspect evidence and re-enter the creation gate instead of silently changing files, metadata, Context relationships, scripts, examples, or support assets.",
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
      reviewSkillIllustration: [
        "A specification review finds 20 raw gaps across authorization, failure recovery, validation boundaries, and observability.",
        "The review can continue because the gaps are runtime task unknowns and valuable findings rather than failed authoring clarification.",
        "Preserve the underlying evidence and report four decision themes with their impact or risk.",
        "Ask only about a theme that blocks the requested output; keep other themes as findings.",
      ],
      productAInitialClarification: {
        confirmed: [
          "The workflow builds a Product A JSON body.",
          "The user designates the official Product A URL as the intended authoritative source.",
          "The request expresses authoring-time intent to consult that URL, subject to the current tools and authoring environment permitting access.",
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
          "Whether the Product A Context is required or optional for correct execution.",
          "The Context owner, unless repository evidence resolves it.",
          "Whether source-specific instructions, transformations, embedded examples, or validation behavior must be authored now.",
          "Whether authoring-time consultation is needed for any source-specific authoring decision.",
        ],
        questions: [
          "Should the finished Skill access the official URL during execution, or should its runtime consumer provide the relevant documentation through another approved process?",
          "When the source is unavailable, should the Skill stop or request approved supplied content rather than infer the JSON schema?",
          "Must the Skill embed any source-specific instructions, transformations, examples, or validation behavior now, or can it consult the current source during execution?",
        ],
        progression: {
          blocking: [
            "Finished-Skill runtime source-access intent.",
            "Safe fallback behavior when the source is unavailable.",
            "Whether the Product A Context is required or optional for correct execution.",
            "The Context owner when applicable repository evidence does not supply one.",
            "Any source-specific instructions, transformations, examples, or validation behavior that must be embedded during authoring.",
          ],
          reversibleDefaults: [
            "No script by default.",
            "No Context Lens by default.",
          ],
          deferred: [
            "Authoring-time source consultation when no source-specific authoring decision depends on it.",
            "Final wording and tags.",
            "Additional examples unless real ambiguity emerges.",
          ],
          queuedBlockers: [
            "Whether the Product A Context is required or optional for correct execution.",
            "The Context owner when applicable repository evidence does not supply one.",
          ],
        },
        runtimeTaskUnknowns: [
          "The current Product A schema.",
          "The current documented fields and constraints.",
          "Operation-specific behavior read from the authoritative source.",
        ],
      },
    },
    workflow: [
      "Follow the normative interactive phases above from clarification through human review, including creation-gate re-entry whenever asset boundaries may change.",
      "After the gate passes, use `renma scaffold` for the agreed structure, author within it, run relevant Renma verification, and complete human review.",
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
      "Create a script only when deterministic implementation is materially safer than model judgment, an exact repeated transformation or validation is required, ordering or behavior is safety-critical, the implementation is meaningfully tested, or the user explicitly requests executable implementation.",
      "Do not create a script merely because the output is JSON, YAML, XML, or another structured format; straightforward JSON construction from a documented schema does not justify a script by itself.",
      "Add an example only when it resolves a real ambiguity.",
      "Do not add a README that restates the Skill, a paraphrased usage guide, an empty support file, a speculative future-extension document, or a resource directory without a current responsibility.",
      "Every file must have one distinct, reviewable responsibility.",
      "Treat a name change that alters the canonical Skill directory/name relationship as an intentional path and identity change requiring Agent Skills and Renma validation, not as an ordinary semantic rewrite.",
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
        "`contexts/product-a-api.md` contains the user-designated official Product A URL. The URL is not a Renma asset node or graph edge; source-dependent facts require successfully consulted or supplied content with the relevant section identified.",
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
        "Preserve the official URL as the user-designated authoritative external source.",
        "Require current supported fields and constraints to be read from that source.",
        "Define behavior when the source cannot be accessed.",
        "Avoid copying the entire specification.",
      ],
      securityReview: [
        "Treat authoring-time consultation separately from finished-Skill runtime access; current access depends on the user request, available tools, and authoring environment.",
        "Do not treat the finished Skill's future security metadata as retroactive authorization for the authoring agent; if authoring-time access is unavailable, request supplied source content or keep source-dependent facts unresolved.",
        "Decide separately whether finished-Skill execution reads the external URL or uses source content supplied by the user or another approved process.",
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
      "Classify relevant findings with the interaction protocol, follow Diagnostics v2 repair constraints and verification steps, and rerun the same commands after uniquely supported repairs.",
      "Have a human review source authority, successful URL access, semantic correctness, meaningful design decisions, and unresolved uncertainty; a clean scan or graph does not prove them.",
      "Renma scan validates and exposes repository evidence; it does not automatically create Context Assets or authorize semantic consolidation of repeated content.",
    ],
  };
}
