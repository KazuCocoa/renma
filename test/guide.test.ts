import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { main } from "../src/cli.js";
import { buildSkillAuthoringGuidance } from "../src/guidance/skill-authoring.js";
import {
  renderSkillGuideJson,
  renderSkillGuidePrompt,
} from "../src/renderers/guide.js";

const execFileAsync = promisify(execFile);

test("guide skill defaults to deterministic prompt output for the installed version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version: string;
  };
  const defaultResult = await capture(() => main(["guide", "skill"]));
  const explicitResult = await capture(() =>
    main(["guide", "skill", "--format", "prompt"]),
  );
  const repeatedResult = await capture(() => main(["guide", "skill"]));

  assert.equal(defaultResult.code, 0);
  assert.equal(defaultResult.stderr, "");
  assert.equal(defaultResult.stdout, explicitResult.stdout);
  assert.equal(defaultResult.stdout, repeatedResult.stdout);
  assert.match(
    defaultResult.stdout,
    new RegExp(
      `Renma ${escapeRegExp(packageJson.version)} Skill Authoring Guide`,
    ),
  );
  assert.match(
    defaultResult.stdout,
    /smallest non-redundant Renma asset graph/,
  );
  assert.match(
    defaultResult.stdout,
    /begin with interactive clarification\. Do not create files immediately/,
  );
  assert.match(defaultResult.stdout, /one to three focused questions/);
  assert.match(
    defaultResult.stdout,
    /Confirmed:[\s\S]*Proposed:[\s\S]*Unresolved:/,
  );
  assert.match(defaultResult.stdout, /Source-of-truth status alone justifies/);
  assert.match(
    defaultResult.stdout,
    /important to Skill correctness does not by itself require a Context Asset/,
  );
  assert.match(
    defaultResult.stdout,
    /Do not create a script merely because the output is JSON/,
  );
  assert.match(defaultResult.stdout, /State each requirement once/);
  assert.match(defaultResult.stdout, /Do not copy the full external document/);
  assert.match(
    defaultResult.stdout,
    /Markdown URL.*does not grant network permission/,
  );
  assert.match(
    defaultResult.stdout,
    /allowed data, network allowance, approved network destinations, external upload, secrets, and human approval/,
  );
  assert.match(
    defaultResult.stdout,
    /do not manufacture permissive policy values/,
  );
  assert.match(
    defaultResult.stdout,
    /Skill body, Context instructions, and effective security policy agree/,
  );
  assert.match(
    defaultResult.stdout,
    /Scaffold generation performs no network operations/,
  );
  assert.match(
    defaultResult.stdout,
    /name change.*canonical Skill directory\/name relationship.*intentional path and identity change/i,
  );
  assert.match(defaultResult.stdout, /not a Renma asset node or graph edge/);
  assert.match(defaultResult.stdout, /clean scan or graph does not prove/);
  assert.match(defaultResult.stdout, /renma scan/);
  assert.match(defaultResult.stdout, /renma catalog/);
  assert.match(defaultResult.stdout, /renma graph/);
  assert.match(defaultResult.stdout, /human review/i);
});

test("guide skill JSON and --json are equivalent small structured projections", async () => {
  const formatResult = await capture(() =>
    main(["guide", "skill", "--format", "json"]),
  );
  const aliasResult = await capture(() => main(["guide", "skill", "--json"]));

  assert.equal(formatResult.code, 0);
  assert.equal(formatResult.stderr, "");
  assert.equal(formatResult.stdout, aliasResult.stdout);
  const output = JSON.parse(formatResult.stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(output), [
    "topic",
    "renmaVersion",
    "principle",
    "interaction",
    "workflow",
    "placementRules",
    "artifactRules",
    "concisenessRules",
    "metadataRules",
    "example",
    "verification",
  ]);
  assert.equal(output.topic, "skill");
  assert.equal(typeof output.renmaVersion, "string");
  assert.ok((output.renmaVersion as string).length > 0);
  assert.deepEqual(Object.keys(output.interaction as Record<string, unknown>), [
    "openingRule",
    "phases",
    "truthSources",
    "decisionClasses",
    "unknownScopes",
    "progressionClasses",
    "unresolvedItemDispositions",
    "questionRules",
    "creationGate",
    "postValidationActions",
    "persistenceRules",
    "handoffRules",
    "minimalTriggerExample",
    "reviewSkillIllustration",
    "productAInitialClarification",
  ]);
  assert.deepEqual(
    Object.keys(
      (output.interaction as Record<string, unknown>)[
        "decisionClasses"
      ] as Record<string, unknown>,
    ),
    ["confirmed", "proposed", "unresolved"],
  );
  assert.deepEqual(
    Object.keys(
      (output.interaction as Record<string, unknown>)[
        "progressionClasses"
      ] as Record<string, unknown>,
    ),
    ["blocking", "reversibleDefault", "deferred"],
  );
  assert.deepEqual(
    Object.keys(
      (output.interaction as Record<string, unknown>)[
        "unknownScopes"
      ] as Record<string, unknown>,
    ),
    ["authoringDecision", "runtimeTaskUnknown"],
  );
  assert.deepEqual(
    Object.keys(
      (output.interaction as Record<string, unknown>)[
        "unresolvedItemDispositions"
      ] as Record<string, unknown>,
    ),
    [
      "askNow",
      "queueAsBlocker",
      "proceedWithReversibleDefault",
      "defer",
      "reportAsFinding",
    ],
  );
  assert.deepEqual(Object.keys(output.example as Record<string, unknown>), [
    "request",
    "initialStructure",
    "externalSourceReference",
    "skillResponsibilities",
    "contextResponsibilities",
    "securityReview",
    "notCreatedByDefault",
  ]);
  const example = output.example as {
    initialStructure: string[];
    externalSourceReference: string;
    securityReview: string[];
  };
  assert.deepEqual(example.initialStructure, [
    "skills/build-product-a-json/SKILL.md",
    "  -> requires",
    "contexts/product-a-api.md",
  ]);
  assert.doesNotMatch(
    example.initialStructure.join("\n"),
    /official Product A URL/,
  );
  assert.match(
    example.externalSourceReference,
    /user-designated official Product A URL/,
  );
  assert.match(
    example.externalSourceReference,
    /not a Renma asset node or graph edge/,
  );
  assert.match(
    example.securityReview.join("\n"),
    /effective security policy for allowed data, network access, approved destinations, uploads, secrets, and human approval/,
  );
  assert.match(
    example.securityReview.join("\n"),
    /Do not treat the URL as permission and do not infer permissive policy values/,
  );
});

test("guide renderers consume the same structured guidance data", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const prompt = renderSkillGuidePrompt(guidance);
  const json = JSON.parse(renderSkillGuideJson(guidance)) as typeof guidance;

  assert.deepEqual(json, guidance);
  for (const value of collectStrings(guidance)) {
    assert.ok(prompt.includes(value), value);
  }
});

test("interactive protocol is the prompt entrypoint before placement and artifact rules", () => {
  const prompt = renderSkillGuidePrompt(
    buildSkillAuthoringGuidance("test-version"),
  );
  const principleIndex = prompt.indexOf("Principle");
  const interactionIndex = prompt.indexOf("Interactive authoring protocol");
  const openingIndex = prompt.indexOf(
    "begin with interactive clarification. Do not create files immediately.",
  );
  const placementIndex = prompt.indexOf("Placement rules");
  const artifactIndex = prompt.indexOf("Artifact rules");

  assert.ok(principleIndex >= 0);
  assert.ok(interactionIndex > principleIndex);
  assert.ok(openingIndex > interactionIndex);
  assert.ok(placementIndex > openingIndex);
  assert.ok(artifactIndex > placementIndex);
});

test("interactive protocol separates truth, proposals, and focused questions", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const truth = interaction.truthSources.join("\n");
  const questions = interaction.questionRules.join("\n");
  const decisions = Object.values(interaction.decisionClasses).join("\n");

  assert.match(decisions, /Never present a model assumption as confirmed/);
  assert.match(decisions, /proposal must not silently become confirmed/i);
  assert.match(truth, /Explicit user statements/);
  assert.match(truth, /User-provided artifacts/);
  assert.match(truth, /Repository evidence/);
  assert.match(truth, /Reviewed authoritative external source content/);
  assert.match(truth, /Renma structural rules/);
  assert.match(questions, /applicable truth source above answers the question/);
  assert.match(questions, /Renma rule supplies a safe structural default/);
  assert.match(questions, /existing Skill that owns the workflow/);
  assert.match(questions, /security profiles/);
  assert.match(questions, /nearby validated examples/);
  assert.match(questions, /conflicting or unhealthy conventions/);
  assert.match(questions, /one to three closely related questions/);
  assert.match(questions, /do not send a comprehensive questionnaire/i);
  assert.match(questions, /Do not require a plan-mode-quality specification/);
  assert.match(questions, /use your judgment/);
  assert.match(
    questions,
    /do not infer product behavior, source authority, ownership, security permission, or unrelated facts/,
  );
});

test("epistemic support and authoring progression remain separate", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const epistemic = interaction.decisionClasses;
  const progression = interaction.progressionClasses;

  assert.deepEqual(Object.keys(epistemic), [
    "confirmed",
    "proposed",
    "unresolved",
  ]);
  assert.deepEqual(Object.keys(progression), [
    "blocking",
    "reversibleDefault",
    "deferred",
  ]);
  assert.match(progression.blocking, /current creation gate can pass/);
  assert.match(progression.blocking, /Retain every Blocking decision/);
  assert.match(progression.reversibleDefault, /A Proposed decision/);
  assert.match(
    progression.reversibleDefault,
    /never changes it from Proposed to Confirmed/,
  );
  assert.match(
    progression.deferred,
    /not required for the current authoring stage/,
  );
  assert.match(
    progression.deferred,
    /material to correctness, security, completion, or asset boundaries[\s\S]*move it to Blocking/,
  );
});

test("authoring decisions and runtime task unknowns have separate scope and disposition", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const scopes = interaction.unknownScopes;
  const dispositions = interaction.unresolvedItemDispositions;

  assert.match(scopes.authoringDecision, /needed to define the Skill contract/);
  assert.match(scopes.authoringDecision, /may be Blocking/);
  assert.match(scopes.runtimeTaskUnknown, /finished Skill processes/);
  assert.match(
    scopes.runtimeTaskUnknown,
    /does not automatically block Skill creation/,
  );
  assert.match(
    scopes.runtimeTaskUnknown,
    /Do not ask the author to resolve task-instance unknowns/,
  );
  assert.deepEqual(Object.keys(dispositions), [
    "askNow",
    "queueAsBlocker",
    "proceedWithReversibleDefault",
    "defer",
    "reportAsFinding",
  ]);
  assert.match(dispositions.askNow, /current-stage Blocking decision theme/);
  assert.match(dispositions.queueAsBlocker, /complete blocker set/);
  assert.match(
    dispositions.proceedWithReversibleDefault,
    /safe Proposed choice/,
  );
  assert.match(dispositions.defer, /current stage does not depend on it/);
  assert.match(
    dispositions.reportAsFinding,
    /runtime task unknown[\s\S]*output[\s\S]*impact or risk/,
  );
});

test("unknown handling clusters themes and reassesses stage-dependent blockers", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const questions = interaction.questionRules.join("\n");
  const gate = interaction.creationGate.join("\n");

  assert.match(
    questions,
    /Do not guess does not mean stop and ask about every unknown/,
  );
  assert.match(questions, /continue work that does not depend on it/);
  assert.match(questions, /preserve the unknown with evidence/);
  assert.match(questions, /never manufacture expected behavior/);
  assert.match(questions, /group related items by the decision they depend on/);
  assert.match(
    questions,
    /timeout, retry count, partial success, and rollback[\s\S]*Failure and recovery behavior theme/,
  );
  assert.match(questions, /prioritize themes by risk and downstream impact/);
  assert.match(questions, /At each meaningful stage transition/);
  assert.match(questions, /move a reportable or Deferred theme to Blocking/);
  assert.match(questions, /move a blocker to Report as finding/);
  assert.match(
    gate,
    /Do not block creation on task-instance unknowns[\s\S]*continue unaffected work/,
  );
  assert.match(
    gate,
    /authoritative source content as an authoring blocker only when source-specific instructions, transformations, embedded examples, or validation behavior cannot be defined without consulting it/,
  );
});

test("review Skill illustration treats many unknowns as valuable findings", () => {
  const illustration =
    buildSkillAuthoringGuidance(
      "test-version",
    ).interaction.reviewSkillIllustration.join("\n");

  assert.match(illustration, /20 raw gaps/);
  assert.match(
    illustration,
    /authorization, failure recovery, validation boundaries, and observability/,
  );
  assert.match(illustration, /The review can continue/);
  assert.match(illustration, /report four decision themes/);
  assert.match(illustration, /evidence[\s\S]*impact or risk/);
  assert.match(
    illustration,
    /Ask only about a theme that blocks the requested output/,
  );
  assert.match(illustration, /keep other themes as findings/);
});

test("question batches retain the complete blocker set and define proceeding", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const questions = interaction.questionRules.join("\n");
  const gate = interaction.creationGate.join("\n");

  assert.match(
    questions,
    /complete current set of unresolved and proposed decisions/,
  );
  assert.match(
    questions,
    /one to three closely related questions applies to the current turn, not to the total number/,
  );
  assert.match(
    questions,
    /never impose an arbitrary maximum on that total set/,
  );
  assert.match(
    questions,
    /keep additional Blocking decisions visible as queued blockers/,
  );
  assert.match(
    questions,
    /continue with the next batch after the user answers/,
  );
  assert.match(
    questions,
    /Never relabel an unasked Blocking decision as Deferred merely because the batch limit was reached/,
  );
  assert.match(
    questions,
    /Blocking count, questions being asked, queued blockers/,
  );
  assert.match(
    gate,
    /Proceed when no Blocking decision remains\. Reversible defaults and Deferred decisions may remain/,
  );
  assert.match(
    gate,
    /identify the reversible defaults being used and meaningful Deferred decisions/,
  );
  assert.match(
    gate,
    /keep them Proposed or Unresolved rather than presenting them as Confirmed/,
  );
});

test("delegation and branching blockers preserve decision boundaries", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const questions = interaction.questionRules.join("\n");

  assert.match(questions, /use your judgment/);
  assert.match(questions, /record the authority as Confirmed/);
  assert.match(questions, /keep the selected default Proposed/);
  assert.match(
    questions,
    /do not infer product behavior, source authority, ownership, security permission/,
  );
  assert.match(
    questions,
    /high number of raw unknowns or themes alone does not imply a Skill split/,
  );
  assert.match(
    questions,
    /for review Skills, many unknowns may be the expected output/,
  );
  assert.match(
    questions,
    /materially independent tasks, inputs, outputs, users, security contracts, completion criteria, or workflows/,
  );
  assert.match(questions, /propose a split or narrower first Skill/i);
  assert.match(questions, /keep the boundary Proposed/);
  assert.match(questions, /re-enter the creation gate/);
});

test("truth sources qualify artifacts, repository evidence, and external content", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const truth = interaction.truthSources.join("\n");
  const decisions = Object.values(interaction.decisionClasses).join("\n");

  assert.match(
    truth,
    /documents, specifications, examples, logs, schemas[\s\S]*provenance and applicability are clear/,
  );
  assert.match(truth, /cite or identify the artifact/);
  assert.match(
    truth,
    /applicable, effective, and unambiguous[\s\S]*deprecated, archived, stale, conflicting, unresolved, or diagnostic-blocked/,
  );
  assert.match(
    truth,
    /successfully consulted content can confirm the domain facts it governs/,
  );
  assert.match(truth, /identify the source and relevant section or evidence/);
  assert.match(
    truth,
    /user can confirm that a URL is intended to be authoritative[\s\S]*remain unresolved until the source content is successfully consulted or supplied/,
  );
  assert.match(decisions, /source designation alone/);
  assert.match(decisions, /stale or conflicting evidence/);
});

test("authoring-time source access remains separate from finished-Skill runtime access", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const truth = interaction.truthSources.join("\n");
  const gate = interaction.creationGate.join("\n");

  assert.match(
    truth,
    /Authoring-time access and finished-Skill runtime access are separate/,
  );
  assert.match(truth, /future metadata never retroactively authorizes/);
  assert.match(
    truth,
    /authoring-time access is unavailable[\s\S]*ask the user for the relevant source content[\s\S]*preserve source-dependent facts as Unresolved/,
  );
  assert.match(gate, /authoring-time source consultation/);
  assert.match(gate, /finished-Skill runtime source-access intent/);
});

test("minimal trigger starts with clarification and no invented asset structure", () => {
  const example =
    buildSkillAuthoringGuidance("test-version").interaction
      .minimalTriggerExample;

  assert.equal(
    example.request,
    "I want to create a Skill with `renma guide skill`.",
  );
  assert.deepEqual(example.unresolved, [
    "The recurring task.",
    "The expected result.",
  ]);
  assert.deepEqual(example.questions, [
    "What recurring task should the Skill perform, and what result should it produce?",
  ]);
  assert.equal(example.progression, undefined);
  assert.match(
    example.proposed.join("\n"),
    /No asset structure is justified yet/,
  );
  assert.doesNotMatch(
    JSON.stringify(example),
    /owner|Context Asset|script|metadata/i,
  );
});

test("creation gate distinguishes blocking truth from refinable details", () => {
  const gate =
    buildSkillAuthoringGuidance("test-version").interaction.creationGate.join(
      "\n",
    );

  for (const value of [
    "focused recurring task",
    "expected result",
    "completion or failure behavior",
    "smallest justified Skill, Context, and support-file structure",
    "source authority",
    "runtime source-access intent",
    "blocking security-policy decisions",
    "owner required by file-mode scaffold",
  ]) {
    assert.match(gate, new RegExp(escapeRegExp(value), "i"));
  }
  assert.match(
    gate,
    /Do not create files while any blocking decision remains unresolved/,
  );
  assert.match(
    gate,
    /Do not block creation on a complete plan, every edge case, final prose, all examples, finalized tags, speculative future capabilities/,
  );
});

test("platform-native handoff occurs only after the Renma clarification gate", () => {
  const handoff =
    buildSkillAuthoringGuidance("test-version").interaction.handoffRules.join(
      "\n",
    );

  assert.match(
    handoff,
    /must not independently generate.*before the Renma clarification gate/,
  );
  assert.match(handoff, /After the gate/);
  assert.match(handoff, /from the Renma scaffold and agreed structure/);
  assert.match(
    handoff,
    /must not independently add metadata, Context Assets, scripts, examples, or support files/,
  );
  assert.match(handoff, /must not create a second target file/);
});

test("post-validation and persistence rules preserve human truth", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const actions = interaction.postValidationActions.join("\n");
  const persistence = interaction.persistenceRules.join("\n");

  for (const category of [
    "Deterministic repair",
    "Repository investigation",
    "Human decision required",
    "No change justified",
  ]) {
    assert.match(actions, new RegExp(escapeRegExp(category)));
  }
  assert.match(actions, /Never add a suppression automatically/);
  assert.match(
    actions,
    /A finding is not a deterministic repair merely because its detection is deterministic/,
  );
  assert.match(actions, /evidence uniquely determines the patch/);
  assert.match(actions, /Diagnostics v2/);
  assert.match(persistence, /Persist only durable reviewed decisions/);
  assert.match(persistence, /conversation transcript/);
  assert.match(
    persistence,
    /temporary Confirmed, Proposed, or Unresolved summaries/,
  );
  assert.match(persistence, /metadata invented to store conversation state/);
});

test("repeated-context findings require investigation and reviewed consolidation", () => {
  const actions =
    buildSkillAuthoringGuidance(
      "test-version",
    ).interaction.postValidationActions.join("\n");

  assert.match(
    actions,
    /do not delete or rewrite content solely because a repeated section, code block, or context-pattern finding exists/i,
  );
  assert.match(actions, /Inspect all occurrences/);
  assert.match(actions, /intended ownership and source-of-truth boundaries/);
  assert.match(actions, /prepare a consolidation proposal/);
  assert.match(
    actions,
    /require human review before any semantic consolidation/,
  );
  assert.match(actions, /is not an automatic repair/);
  assert.doesNotMatch(
    actions,
    /Deterministic repair:[^\n]*(?:exact duplicated passage|repeated-context)/i,
  );
});

test("unsupported fields are deterministic only when removal preserves meaning", () => {
  const actions =
    buildSkillAuthoringGuidance(
      "test-version",
    ).interaction.postValidationActions.join("\n");

  assert.match(
    actions,
    /remove it deterministically only when evidence proves that removal loses no intended meaning/,
  );
  assert.match(
    actions,
    /Skill body, supported metadata, a Context Asset, or nowhere/,
  );
});

test("asset-boundary discoveries re-enter clarification and the creation gate", () => {
  const interaction = buildSkillAuthoringGuidance("test-version").interaction;
  const phases = interaction.phases.join("\n");
  const actions = interaction.postValidationActions.join("\n");
  const handoff = interaction.handoffRules.join("\n");
  const combined = [phases, actions, handoff].join("\n");

  assert.match(
    combined,
    /stop the current structural edit|stop structural edits/,
  );
  assert.match(combined, /Proposed or Unresolved/);
  assert.match(combined, /inspect relevant evidence|investigate/);
  assert.match(
    combined,
    /ask only when human truth remains necessary|ask if needed/,
  );
  assert.match(combined, /re-enter the creation gate/);
  assert.match(combined, /update the agreed structure after it passes/);
  assert.match(
    handoff,
    /instead of silently changing files, metadata, Context relationships, scripts, examples, or support assets/,
  );
  for (const example of [
    "requires a script",
    "proposed Context is task-local",
    "existing Context should be reused",
    "security policy needs change",
    "required-versus-optional Context semantics are wrong",
    "example is needed to resolve real ambiguity",
  ]) {
    assert.match(actions, new RegExp(escapeRegExp(example)));
  }
});

test("Product A separates authoring blockers from runtime source knowledge", () => {
  const clarification =
    buildSkillAuthoringGuidance("test-version").interaction
      .productAInitialClarification;

  assert.match(
    clarification.confirmed.join("\n"),
    /builds a Product A JSON body/,
  );
  assert.match(
    clarification.confirmed.join("\n"),
    /official Product A URL as the intended authoritative source/,
  );
  assert.match(
    clarification.confirmed.join("\n"),
    /authoring-time intent to consult that URL[\s\S]*tools and authoring environment permitting access/,
  );
  assert.match(clarification.proposed.join("\n"), /One focused Skill/);
  assert.match(
    clarification.proposed.join("\n"),
    /No script or Context Lens by default/,
  );
  assert.match(
    clarification.unresolved.join("\n"),
    /accesses the URL at execution time/,
  );
  assert.match(
    clarification.unresolved.join("\n"),
    /Context is required or optional/,
  );
  assert.match(
    clarification.unresolved.join("\n"),
    /source-specific instructions, transformations, embedded examples, or validation behavior/,
  );
  assert.match(clarification.unresolved.join("\n"), /Context owner/);
  assert.match(
    clarification.runtimeTaskUnknowns.join("\n"),
    /current Product A schema[\s\S]*documented fields and constraints[\s\S]*Operation-specific behavior/,
  );
  assert.equal(clarification.questions.length, 3);
  assert.equal(clarification.progression.blocking.length, 5);
  assert.ok(
    clarification.progression.blocking.length > clarification.questions.length,
  );
  assert.match(
    clarification.progression.queuedBlockers.join("\n"),
    /Context is required or optional[\s\S]*Context owner/,
  );
  for (const queued of clarification.progression.queuedBlockers) {
    assert.ok(clarification.progression.blocking.includes(queued));
  }
  assert.doesNotMatch(
    clarification.progression.deferred.join("\n"),
    /Context owner/,
  );
  assert.match(
    clarification.progression.deferred.join("\n"),
    /Authoring-time source consultation when no source-specific authoring decision depends on it/,
  );
  assert.doesNotMatch(
    clarification.progression.blocking.join("\n"),
    /current Product A schema|current documented fields|Authoring-time access/,
  );
  assert.match(
    clarification.progression.reversibleDefaults.join("\n"),
    /No script by default[\s\S]*No Context Lens by default/,
  );
  assert.match(
    clarification.proposed.join("\n"),
    /No script or Context Lens by default/,
  );
  assert.doesNotMatch(
    clarification.confirmed.join("\n"),
    /No script|No Context Lens/,
  );
  assert.doesNotMatch(
    clarification.questions.join("\n"),
    /paste|provide the relevant source content/,
  );
  assert.doesNotMatch(
    JSON.stringify(clarification),
    /approvedDomains|allow_network/,
  );
});

test("progression rendering distinguishes proposed defaults and queued subsets", () => {
  const prompt = renderSkillGuidePrompt(
    buildSkillAuthoringGuidance("test-version"),
  );
  const start = prompt.indexOf("Current progression");
  const end = prompt.indexOf("Questions", start);
  const progression = prompt.slice(start, end);
  const owner =
    "The Context owner when applicable repository evidence does not supply one.";

  assert.match(progression, /Blocking decisions: 5/);
  assert.match(progression, /Proposed reversible defaults/);
  assert.doesNotMatch(progression, /Proceeding with reversible defaults/);
  assert.match(
    progression,
    /Queued from the complete blocker list above \(not additional\): 3, 4\./,
  );
  assert.equal(countOccurrences(progression, owner), 1);
});

test("progression rendering says proceeding only when no blocker remains", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const clarification = guidance.interaction.productAInitialClarification;
  clarification.progression.blocking = [];
  clarification.progression.queuedBlockers = [];
  clarification.questions = [];

  const prompt = renderSkillGuidePrompt(guidance);
  const start = prompt.indexOf("Current progression");
  const end = prompt.indexOf("Expected initial Renma asset structure", start);
  const progression = prompt.slice(start, end);

  assert.match(progression, /Blocking decisions: 0/);
  assert.match(progression, /Proceeding with reversible defaults/);
  assert.doesNotMatch(progression, /Proposed reversible defaults/);
  assert.doesNotMatch(progression, /Asking now: 0/);
});

test("workflow summary cross-references interaction rules without duplicating them", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const prompt = renderSkillGuidePrompt(guidance);

  assert.equal(guidance.workflow.length, 2);
  assert.match(
    guidance.workflow.join("\n"),
    /normative interactive phases above/,
  );
  for (const rule of [
    "A finding is not a deterministic repair merely because its detection is deterministic.",
    "When authoring-time access is unavailable",
    "If semantic refinement reveals a justified asset-boundary change",
  ]) {
    assert.equal(countOccurrences(prompt, rule), 1, rule);
  }
});

test("guide rejects missing and unknown topics, unsupported options, and extra arguments", async () => {
  const cases: Array<{ argv: string[]; message: RegExp }> = [
    {
      argv: ["guide"],
      message: /guide requires a topic.*only supported topic is skill/i,
    },
    {
      argv: ["guide", "unknown"],
      message: /Unknown guide topic "unknown".*only supported topic is skill/i,
    },
    {
      argv: ["guide", "skill", "--owner", "team"],
      message: /guide does not support --owner/,
    },
    {
      argv: ["guide", "skill", "extra"],
      message: /unexpected positional argument "extra"/,
    },
    {
      argv: ["guide", "skill", "--format", "markdown"],
      message: /--format must be either prompt or json/,
    },
    {
      argv: ["guide", "skill", "--interactive"],
      message: /Unknown option '--interactive'/,
    },
  ];

  for (const fixture of cases) {
    const result = await capture(() => main(fixture.argv));
    assert.equal(result.code, 2, fixture.argv.join(" "));
    assert.equal(result.stdout, "", fixture.argv.join(" "));
    assert.match(result.stderr, fixture.message, fixture.argv.join(" "));
    assert.match(result.stderr, /renma guide --help/);
  }
});

test("guide help and global help document the Skill topic", async () => {
  const commandHelp = await capture(() => main(["guide", "--help"]));
  const globalHelp = await capture(() => main(["--help"]));

  assert.equal(commandHelp.code, 0);
  assert.match(commandHelp.stdout, /renma guide <topic>/);
  assert.match(commandHelp.stdout, /renma guide skill --format json/);
  assert.match(commandHelp.stdout, /skill is the only supported topic/i);
  assert.doesNotMatch(commandHelp.stdout, /--interactive/);
  assert.match(
    globalHelp.stdout,
    /guide\s+What is the smallest justified asset graph/,
  );
  assert.match(globalHelp.stdout, /Start here: new skill\s+renma guide skill/s);
  const existingWorkflow = globalHelp.stdout.slice(
    globalHelp.stdout.indexOf("Start here: existing repository"),
    globalHelp.stdout.indexOf("Start here: new skill"),
  );
  assert.match(
    existingWorkflow,
    /existing repository\s+renma scan \. --fail-on high/s,
  );
  assert.match(
    existingWorkflow,
    /guide skill only when intentionally reconsidering asset boundaries/,
  );
  assert.ok(
    existingWorkflow.indexOf("renma scan . --fail-on high") <
      existingWorkflow.indexOf("renma guide skill"),
  );
});

test("generic guide, help, and scaffold projections are platform-neutral", async () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-guide-neutral-"));
  const target = path.join(root, "skills", "demo", "SKILL.md");
  const outputs = [
    JSON.stringify(guidance),
    renderSkillGuidePrompt(guidance),
    renderSkillGuideJson(guidance),
    (await capture(() => main(["--help"]))).stdout,
    (await capture(() => main(["guide", "--help"]))).stdout,
    (await capture(() => main(["guide", "skill"]))).stdout,
    (await capture(() => main(["guide", "skill", "--format", "json"]))).stdout,
    (
      await capture(() =>
        main([
          "scaffold",
          "skill",
          target,
          "--owner",
          "team",
          "--format",
          "prompt",
        ]),
      )
    ).stdout,
  ];

  for (const output of outputs) {
    assert.doesNotMatch(output, /\bCodex\b|skill-creator/i);
  }
});

test("guide skill works in an empty directory and creates or edits no files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-guide-empty-"));
  const cliPath = path.join(process.cwd(), "dist-test", "src", "index.js");
  const before = await readdir(root);
  const result = await execFileAsync(
    process.execPath,
    [cliPath, "guide", "skill"],
    {
      cwd: root,
    },
  );
  const after = await readdir(root);

  assert.match(result.stdout, /smallest non-redundant Renma asset graph/);
  assert.equal(result.stderr, "");
  assert.deepEqual(before, []);
  assert.deepEqual(after, before);
});

async function capture(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}
