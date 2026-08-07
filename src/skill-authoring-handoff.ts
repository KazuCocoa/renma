import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeAgentSkillDirectoryName } from "./agent-skills.js";
import { CliUserError } from "./cli-errors.js";
import {
  classifyRepositorySkillEntrypointPath,
  normalizeAssetRepositoryRelativePath,
  repositoryClassificationPath,
} from "./discovery.js";

export const SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION =
  "renma.skill-authoring-handoff.v1" as const;

export type SkillAuthoringSourceStatus =
  "provided" | "consulted" | "designated_unconsulted";
export type SkillAuthoringDecisionState =
  "confirmed" | "proposed" | "unresolved";
export type RuntimeUnknownBehavior = "ask" | "report" | "defer" | "stop";
export type SupportingAssetKind = "context" | "context_lens";
export type SupportingAssetDisposition = "reuse" | "create";
export type SupportingAssetRelationship = "required" | "optional";
export type SkillAuthoringResource = "references" | "scripts" | "assets";

export interface SkillAuthoringCurrentUnderstanding {
  confirmed: string[];
  proposed: string[];
  unresolved: string[];
}

export interface SkillAuthoringProgression {
  blocking: string[];
  reversibleDefaults: string[];
  deferred: string[];
}

export interface SkillAuthoringContract {
  recurringTask: string;
  expectedResult: string;
  requiredInputs: string[];
  completionCriteria: string[];
  failureBehavior: string[];
  useWhen: string[];
  doNotUseWhen: string[];
}

export interface SkillAuthoringSkillAsset {
  path: string;
  id: string;
  title: string;
  owner: string;
  tags: string[];
  resources: SkillAuthoringResource[];
  requiresContext: string[];
  optionalContext: string[];
  requiresLens: string[];
  optionalLens: string[];
}

export interface SkillAuthoringSupportingAsset {
  kind: SupportingAssetKind;
  id: string;
  path: string;
  disposition: SupportingAssetDisposition;
  relationship: SupportingAssetRelationship;
  justification: string;
}

export interface SkillAuthoringSourceAuthority {
  source: string;
  status: SkillAuthoringSourceStatus;
  authority?: string;
  evidence?: string[];
}

export interface SkillAuthoringSecurityDecision {
  decision: string;
  state: SkillAuthoringDecisionState;
  rationale?: string;
}

export interface SkillAuthoringRuntimeUnknownHandling {
  unknown: string;
  behavior: RuntimeUnknownBehavior;
  condition?: string;
}

export interface SkillAuthoringHandoff {
  schemaVersion: typeof SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION;
  topic: "skill";
  currentUnderstanding: SkillAuthoringCurrentUnderstanding;
  progression: SkillAuthoringProgression;
  skillContract: SkillAuthoringContract;
  assetGraph: {
    skill: SkillAuthoringSkillAsset;
    supportingAssets: SkillAuthoringSupportingAsset[];
  };
  sourceAuthorities: SkillAuthoringSourceAuthority[];
  securityDecisions: SkillAuthoringSecurityDecision[];
  runtimeUnknownHandling: SkillAuthoringRuntimeUnknownHandling[];
}

/** Read and validate caller-declared authoring evidence without repository or network access. */
export async function readSkillAuthoringHandoff(
  handoffPath: string,
): Promise<SkillAuthoringHandoff> {
  let source: string;
  try {
    source = await readFile(handoffPath, "utf8");
  } catch (error) {
    throw new CliUserError(
      `Cannot read Skill authoring handoff "${handoffPath}": ${errorMessage(error)}.`,
      { cause: error },
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new CliUserError(
      `Skill authoring handoff "${handoffPath}" is not valid JSON: ${errorMessage(error)}.`,
      { cause: error },
    );
  }
  return validateSkillAuthoringHandoff(input);
}

/** Validate the v1 contract and cross-field consistency of caller-supplied state. */
export function validateSkillAuthoringHandoff(
  input: unknown,
): SkillAuthoringHandoff {
  const root = objectValue(input, "handoff");
  exactKeys(root, "handoff", [
    "schemaVersion",
    "topic",
    "currentUnderstanding",
    "progression",
    "skillContract",
    "assetGraph",
    "sourceAuthorities",
    "securityDecisions",
    "runtimeUnknownHandling",
  ]);

  const schemaVersion = stringValue(root.schemaVersion, "schemaVersion");
  if (schemaVersion !== SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION) {
    throw new CliUserError(
      `Unsupported Skill authoring handoff schemaVersion "${schemaVersion}"; expected "${SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION}".`,
    );
  }
  const topic = stringValue(root.topic, "topic");
  if (topic !== "skill") {
    throw new CliUserError(
      `Skill authoring handoff topic must be "skill"; received "${topic}".`,
    );
  }

  const currentUnderstanding = parseCurrentUnderstanding(
    root.currentUnderstanding,
  );
  const progression = parseProgression(root.progression);
  const skillContract = parseSkillContract(root.skillContract);
  const assetGraph = parseAssetGraph(root.assetGraph);
  const sourceAuthorities = parseObjectArray(
    root.sourceAuthorities,
    "sourceAuthorities",
    parseSourceAuthority,
  );
  const securityDecisions = parseObjectArray(
    root.securityDecisions,
    "securityDecisions",
    parseSecurityDecision,
  );
  const runtimeUnknownHandling = parseObjectArray(
    root.runtimeUnknownHandling,
    "runtimeUnknownHandling",
    parseRuntimeUnknownHandling,
  );

  rejectSetOverlap(
    progression.blocking,
    progression.reversibleDefaults,
    "progression.blocking",
    "progression.reversibleDefaults",
  );
  rejectSetOverlap(
    progression.blocking,
    progression.deferred,
    "progression.blocking",
    "progression.deferred",
  );
  rejectSetOverlap(
    progression.reversibleDefaults,
    progression.deferred,
    "progression.reversibleDefaults",
    "progression.deferred",
  );

  if (progression.blocking.length > 0) {
    throw new CliUserError(
      `Skill authoring handoff still contains ${progression.blocking.length} Blocking decision${progression.blocking.length === 1 ? "" : "s"}. Resolve ${progression.blocking.length === 1 ? "it" : "them"} before scaffolding.`,
    );
  }

  return {
    schemaVersion: SKILL_AUTHORING_HANDOFF_SCHEMA_VERSION,
    topic: "skill",
    currentUnderstanding,
    progression,
    skillContract,
    assetGraph,
    sourceAuthorities,
    securityDecisions,
    runtimeUnknownHandling,
  };
}

/** Require the explicit side-effect target to match the handoff Skill path. */
export function validateSkillAuthoringHandoffTarget(
  handoff: SkillAuthoringHandoff,
  targetPath: string,
): void {
  const requested = requestedRepositorySkillPath(targetPath);
  const declared = normalizeAssetRepositoryRelativePath(
    handoff.assetGraph.skill.path,
  );
  if (!requested || !declared || requested !== declared) {
    throw new CliUserError(
      `Scaffold target "${targetPath}" does not match handoff Skill path "${handoff.assetGraph.skill.path}" after safe path normalization.`,
    );
  }
}

/** Validate canonical Skill identity and semantic asset-graph consistency. */
export function validateSkillAuthoringHandoffIdentityAndGraph(
  handoff: SkillAuthoringHandoff,
): void {
  const { currentUnderstanding, assetGraph } = handoff;
  const { skill, supportingAssets } = assetGraph;
  validateCanonicalSkillPath(skill.path);
  if (skill.owner === "unowned") {
    throw new CliUserError(
      'assetGraph.skill.owner must name an explicit owner; "unowned" is not allowed in a Skill authoring handoff.',
    );
  }
  rejectSetOverlap(
    currentUnderstanding.confirmed,
    currentUnderstanding.proposed,
    "currentUnderstanding.confirmed",
    "currentUnderstanding.proposed",
  );
  rejectSetOverlap(
    currentUnderstanding.confirmed,
    currentUnderstanding.unresolved,
    "currentUnderstanding.confirmed",
    "currentUnderstanding.unresolved",
  );
  rejectSetOverlap(
    currentUnderstanding.proposed,
    currentUnderstanding.unresolved,
    "currentUnderstanding.proposed",
    "currentUnderstanding.unresolved",
  );
  rejectSetOverlap(
    skill.requiresContext,
    skill.optionalContext,
    "assetGraph.skill.requiresContext",
    "assetGraph.skill.optionalContext",
  );
  rejectSetOverlap(
    skill.requiresLens,
    skill.optionalLens,
    "assetGraph.skill.requiresLens",
    "assetGraph.skill.optionalLens",
  );
  rejectDuplicateObjectField(supportingAssets, "id", "supporting asset ID");
  rejectDuplicateObjectField(supportingAssets, "path", "supporting asset path");
  for (const asset of supportingAssets) {
    validateSupportingAssetPath(
      asset.kind,
      asset.path,
      `assetGraph.supportingAssets entry "${asset.id}"`,
    );
    validateSupportingRelationship(skill, asset);
  }
}

function parseCurrentUnderstanding(
  input: unknown,
): SkillAuthoringCurrentUnderstanding {
  const value = objectValue(input, "currentUnderstanding");
  exactKeys(value, "currentUnderstanding", [
    "confirmed",
    "proposed",
    "unresolved",
  ]);
  return {
    confirmed: stringList(value.confirmed, "currentUnderstanding.confirmed"),
    proposed: stringList(value.proposed, "currentUnderstanding.proposed"),
    unresolved: stringList(value.unresolved, "currentUnderstanding.unresolved"),
  };
}

function parseProgression(input: unknown): SkillAuthoringProgression {
  const value = objectValue(input, "progression");
  exactKeys(value, "progression", [
    "blocking",
    "reversibleDefaults",
    "deferred",
  ]);
  return {
    blocking: stringList(value.blocking, "progression.blocking"),
    reversibleDefaults: stringList(
      value.reversibleDefaults,
      "progression.reversibleDefaults",
    ),
    deferred: stringList(value.deferred, "progression.deferred"),
  };
}

function parseSkillContract(input: unknown): SkillAuthoringContract {
  const value = objectValue(input, "skillContract");
  exactKeys(value, "skillContract", [
    "recurringTask",
    "expectedResult",
    "requiredInputs",
    "completionCriteria",
    "failureBehavior",
    "useWhen",
    "doNotUseWhen",
  ]);
  return {
    recurringTask: stringValue(
      value.recurringTask,
      "skillContract.recurringTask",
    ),
    expectedResult: stringValue(
      value.expectedResult,
      "skillContract.expectedResult",
    ),
    requiredInputs: stringList(
      value.requiredInputs,
      "skillContract.requiredInputs",
    ),
    completionCriteria: stringList(
      value.completionCriteria,
      "skillContract.completionCriteria",
    ),
    failureBehavior: stringList(
      value.failureBehavior,
      "skillContract.failureBehavior",
    ),
    useWhen: stringList(value.useWhen, "skillContract.useWhen"),
    doNotUseWhen: stringList(value.doNotUseWhen, "skillContract.doNotUseWhen"),
  };
}

function parseAssetGraph(input: unknown): SkillAuthoringHandoff["assetGraph"] {
  const value = objectValue(input, "assetGraph");
  exactKeys(value, "assetGraph", ["skill", "supportingAssets"]);
  const skill = parseSkillAsset(value.skill);
  const supportingAssets = parseObjectArray(
    value.supportingAssets,
    "assetGraph.supportingAssets",
    parseSupportingAsset,
  );

  return { skill, supportingAssets };
}

function parseSkillAsset(input: unknown): SkillAuthoringSkillAsset {
  const value = objectValue(input, "assetGraph.skill");
  exactKeys(value, "assetGraph.skill", [
    "path",
    "id",
    "title",
    "owner",
    "tags",
    "resources",
    "requiresContext",
    "optionalContext",
    "requiresLens",
    "optionalLens",
  ]);
  const skillPath = stringValue(value.path, "assetGraph.skill.path");
  const owner = stringValue(value.owner, "assetGraph.skill.owner");
  const skill: SkillAuthoringSkillAsset = {
    path: skillPath,
    id: stringValue(value.id, "assetGraph.skill.id"),
    title: stringValue(value.title, "assetGraph.skill.title"),
    owner,
    tags: stringList(value.tags, "assetGraph.skill.tags"),
    resources: enumList(value.resources, "assetGraph.skill.resources", [
      "references",
      "scripts",
      "assets",
    ] as const),
    requiresContext: stringList(
      value.requiresContext,
      "assetGraph.skill.requiresContext",
    ),
    optionalContext: stringList(
      value.optionalContext,
      "assetGraph.skill.optionalContext",
    ),
    requiresLens: stringList(
      value.requiresLens,
      "assetGraph.skill.requiresLens",
    ),
    optionalLens: stringList(
      value.optionalLens,
      "assetGraph.skill.optionalLens",
    ),
  };
  return skill;
}

function parseSupportingAsset(
  input: Record<string, unknown>,
  location: string,
): SkillAuthoringSupportingAsset {
  exactKeys(input, location, [
    "kind",
    "id",
    "path",
    "disposition",
    "relationship",
    "justification",
  ]);
  const kind = enumValue(input.kind, `${location}.kind`, [
    "context",
    "context_lens",
  ] as const);
  const assetPath = stringValue(input.path, `${location}.path`);
  return {
    kind,
    id: stringValue(input.id, `${location}.id`),
    path: assetPath,
    disposition: enumValue(input.disposition, `${location}.disposition`, [
      "reuse",
      "create",
    ] as const),
    relationship: enumValue(input.relationship, `${location}.relationship`, [
      "required",
      "optional",
    ] as const),
    justification: stringValue(
      input.justification,
      `${location}.justification`,
    ),
  };
}

function parseSourceAuthority(
  input: Record<string, unknown>,
  location: string,
): SkillAuthoringSourceAuthority {
  exactKeys(
    input,
    location,
    ["source", "status", "authority", "evidence"],
    ["authority", "evidence"],
  );
  return {
    source: stringValue(input.source, `${location}.source`),
    status: enumValue(input.status, `${location}.status`, [
      "provided",
      "consulted",
      "designated_unconsulted",
    ] as const),
    ...(input.authority === undefined
      ? {}
      : { authority: stringValue(input.authority, `${location}.authority`) }),
    ...(input.evidence === undefined
      ? {}
      : { evidence: stringList(input.evidence, `${location}.evidence`) }),
  };
}

function parseSecurityDecision(
  input: Record<string, unknown>,
  location: string,
): SkillAuthoringSecurityDecision {
  exactKeys(input, location, ["decision", "state", "rationale"], ["rationale"]);
  return {
    decision: stringValue(input.decision, `${location}.decision`),
    state: enumValue(input.state, `${location}.state`, [
      "confirmed",
      "proposed",
      "unresolved",
    ] as const),
    ...(input.rationale === undefined
      ? {}
      : { rationale: stringValue(input.rationale, `${location}.rationale`) }),
  };
}

function parseRuntimeUnknownHandling(
  input: Record<string, unknown>,
  location: string,
): SkillAuthoringRuntimeUnknownHandling {
  exactKeys(
    input,
    location,
    ["unknown", "behavior", "condition"],
    ["condition"],
  );
  return {
    unknown: stringValue(input.unknown, `${location}.unknown`),
    behavior: enumValue(input.behavior, `${location}.behavior`, [
      "ask",
      "report",
      "defer",
      "stop",
    ] as const),
    ...(input.condition === undefined
      ? {}
      : { condition: stringValue(input.condition, `${location}.condition`) }),
  };
}

function validateCanonicalSkillPath(skillPath: string): void {
  const normalized = normalizeAssetRepositoryRelativePath(skillPath);
  if (!normalized) {
    throw new CliUserError(
      "assetGraph.skill.path must be a safe repository-relative canonical Skill path.",
    );
  }
  const classification = classifyRepositorySkillEntrypointPath(normalized);
  if (classification?.kind !== "canonical") {
    throw new CliUserError(
      "assetGraph.skill.path must be canonical under skills/**/SKILL.md or .agents/skills/**/SKILL.md.",
    );
  }
  const directory = path.posix.basename(path.posix.dirname(normalized));
  const name = normalizeAgentSkillDirectoryName(directory);
  if (name.normalized === undefined || name.problems.length > 0) {
    throw new CliUserError(
      `assetGraph.skill.path uses invalid Agent Skills name "${directory}": ${name.problems.join("; ")}.`,
    );
  }
}

function validateSupportingAssetPath(
  kind: SupportingAssetKind,
  assetPath: string,
  location: string,
): void {
  const normalized = normalizeAssetRepositoryRelativePath(assetPath);
  const expectedRoots =
    kind === "context"
      ? (["contexts/", "context/"] as const)
      : (["lenses/", "contexts/", "context/"] as const);
  if (
    !normalized ||
    !expectedRoots.some(
      (root) => normalized.startsWith(root) && normalized !== root.slice(0, -1),
    ) ||
    !normalized.endsWith(".md")
  ) {
    throw new CliUserError(
      `${location}.path must be a safe repository-relative Markdown path under ${expectedRoots.join(" or ")}.`,
    );
  }
}

function validateSupportingRelationship(
  skill: SkillAuthoringSkillAsset,
  asset: SkillAuthoringSupportingAsset,
): void {
  const relationshipSet =
    asset.kind === "context"
      ? asset.relationship === "required"
        ? skill.requiresContext
        : skill.optionalContext
      : asset.relationship === "required"
        ? skill.requiresLens
        : skill.optionalLens;
  if (!relationshipSet.includes(asset.id)) {
    throw new CliUserError(
      `Supporting ${asset.kind} "${asset.id}" is marked ${asset.relationship} but is absent from the matching Skill relationship list.`,
    );
  }
}

function requestedRepositorySkillPath(targetPath: string): string | undefined {
  const boundary = repositoryClassificationPath(targetPath);
  if (boundary.state === "resolved") {
    return normalizeAssetRepositoryRelativePath(boundary.relativePath);
  }
  return normalizeAssetRepositoryRelativePath(targetPath);
}

function objectValue(
  input: unknown,
  location: string,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CliUserError(`${location} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  location: string,
  allowed: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new CliUserError(
      `${location} contains unsupported field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
    );
  }
  const missing = allowed.filter(
    (key) => !optionalSet.has(key) && !Object.hasOwn(input, key),
  );
  if (missing.length > 0) {
    throw new CliUserError(
      `${location} is missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    );
  }
}

function stringValue(input: unknown, location: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new CliUserError(`${location} must be a non-empty string.`);
  }
  return input;
}

function stringList(input: unknown, location: string): string[] {
  if (!Array.isArray(input)) {
    throw new CliUserError(`${location} must be an array of strings.`);
  }
  const values = input.map((value, index) =>
    stringValue(value, `${location}[${index}]`),
  );
  const duplicate = firstDuplicate(values);
  if (duplicate !== undefined) {
    throw new CliUserError(
      `${location} contains duplicate value "${duplicate}".`,
    );
  }
  return values;
}

function enumList<const T extends readonly string[]>(
  input: unknown,
  location: string,
  allowed: T,
): T[number][] {
  if (!Array.isArray(input)) {
    throw new CliUserError(`${location} must be an array.`);
  }
  const values = input.map((value, index) =>
    enumValue(value, `${location}[${index}]`, allowed),
  );
  const duplicate = firstDuplicate(values);
  if (duplicate !== undefined) {
    throw new CliUserError(
      `${location} contains duplicate value "${duplicate}".`,
    );
  }
  return values;
}

function enumValue<const T extends readonly string[]>(
  input: unknown,
  location: string,
  allowed: T,
): T[number] {
  if (typeof input !== "string" || !allowed.includes(input)) {
    throw new CliUserError(
      `${location} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return input as T[number];
}

function parseObjectArray<T>(
  input: unknown,
  location: string,
  parse: (value: Record<string, unknown>, location: string) => T,
): T[] {
  if (!Array.isArray(input)) {
    throw new CliUserError(`${location} must be an array.`);
  }
  return input.map((value, index) =>
    parse(objectValue(value, `${location}[${index}]`), `${location}[${index}]`),
  );
}

function rejectSetOverlap(
  left: readonly string[],
  right: readonly string[],
  leftName: string,
  rightName: string,
): void {
  const rightSet = new Set(right);
  const overlap = left.find((value) => rightSet.has(value));
  if (overlap !== undefined) {
    throw new CliUserError(
      `${leftName} and ${rightName} overlap at "${overlap}".`,
    );
  }
}

function rejectDuplicateObjectField<
  T extends Record<K, string>,
  K extends keyof T,
>(values: readonly T[], field: K, label: string): void {
  const duplicate = firstDuplicate(values.map((value) => value[field]));
  if (duplicate !== undefined) {
    throw new CliUserError(
      `assetGraph.supportingAssets repeats ${label} "${duplicate}".`,
    );
  }
}

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
