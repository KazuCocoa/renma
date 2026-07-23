import { CONTEXT_LENS_DIAGNOSTIC_CODES } from "./context-lens.js";
import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import type {
  Diagnostic,
  DiagnosticLocation,
  DiagnosticV2,
  Finding,
  RepairConstraint,
  ReviewBundle,
  VerificationStep,
} from "./types/diagnostics.js";

type BundleSeed = {
  key: string;
  kind: string;
  label?: string;
};

const RESERVED_DETAIL_KEYS = new Set(["diagnosticId", "source"]);
const GUIDANCE_ONLY_DIAGNOSTIC_CODES = new Set([
  "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR",
  "LAYOUT-SKILL-ENTRYPOINT-UNDER-RESERVED-SUPPORT-DIR",
]);

/** Convert legacy diagnostics and findings into the LLM-actionable v2 shape. */
export function createDiagnosticsV2(input: {
  findings: Finding[];
  diagnostics: Diagnostic[];
}): DiagnosticV2[] {
  return [
    ...input.findings.map(findingToDiagnosticV2),
    ...input.diagnostics.map(rawDiagnosticToDiagnosticV2),
  ].sort(compareDiagnosticsV2);
}

/** Build deterministic review bundles from LLM-actionable diagnostics. */
export function createReviewBundles(
  diagnostics: DiagnosticV2[],
): ReviewBundle[] {
  const groups = new Map<
    string,
    { seed: BundleSeed; diagnostics: DiagnosticV2[] }
  >();

  for (const diagnostic of diagnostics) {
    const seed = reviewBundleSeed(diagnostic);
    groups.set(seed.key, {
      seed,
      diagnostics: [...(groups.get(seed.key)?.diagnostics ?? []), diagnostic],
    });
  }

  return [...groups.values()]
    .map(({ seed, diagnostics: groupedDiagnostics }) =>
      reviewBundle(seed, groupedDiagnostics),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function findingToDiagnosticV2(finding: Finding, index: number): DiagnosticV2 {
  const code = finding.id;
  const diagnosticId = diagnosticIdFor(
    code,
    locationFromEvidence(finding.evidence),
    index,
  );
  return compactDiagnostic({
    version: 2,
    code,
    severity: severityFromFinding(finding),
    message: finding.title,
    repairPolicy: "preserve_semantics",
    location: locationFromEvidence(finding.evidence),
    repairConstraints: repairConstraintsForFinding(finding),
    verificationSteps: verificationStepsForFinding(finding),
    llmHint: llmHintForFinding(finding),
    details: diagnosticDetails("finding", diagnosticId, finding.details, {
      findingSeverity: finding.severity,
      category: finding.category,
      confidence: finding.confidence,
      riskClass: finding.riskClass,
      remediation: finding.remediation,
      whyItMatters: finding.whyItMatters,
      legacyConstraints: finding.constraints,
    }),
  });
}

function rawDiagnosticToDiagnosticV2(
  diagnostic: Diagnostic,
  index: number,
): DiagnosticV2 {
  const code = diagnostic.code ?? inferredDiagnosticCode(diagnostic);
  const location = locationFromDiagnostic(diagnostic);
  const diagnosticId = diagnosticIdFor(code, location, index);
  const guidanceOnly = isGuidanceOnlyDiagnostic(code);
  return compactDiagnostic({
    version: 2,
    code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    repairPolicy: guidanceOnly ? undefined : "preserve_semantics",
    location,
    repairConstraints: guidanceOnly
      ? undefined
      : repairConstraintsForDiagnostic(code, diagnostic),
    verificationSteps: guidanceOnly
      ? undefined
      : verificationStepsForDiagnostic(code, diagnostic),
    llmHint: llmHintForDiagnostic(code, diagnostic),
    details: diagnosticDetails("diagnostic", diagnosticId, diagnostic.details),
  });
}

function isGuidanceOnlyDiagnostic(code: string): boolean {
  return GUIDANCE_ONLY_DIAGNOSTIC_CODES.has(code);
}

function repairConstraintsForFinding(finding: Finding): RepairConstraint[] {
  return uniqueConstraints([
    ...semanticRepairConstraints(),
    ...specificRepairConstraints(finding.id),
    ...(finding.repairConstraints ?? []),
    ...constraintTextsToRepairConstraints(finding.constraints ?? []),
  ]);
}

function repairConstraintsForDiagnostic(
  code: string,
  diagnostic: Diagnostic,
): RepairConstraint[] {
  return uniqueConstraints([
    ...semanticRepairConstraints(),
    ...specificRepairConstraints(code),
    ...(diagnostic.repairConstraints ?? []),
  ]);
}

function semanticRepairConstraints(): RepairConstraint[] {
  return [
    {
      kind: "must_preserve",
      text: "Fix the underlying semantic issue, not just the warning count. Update the asset so it accurately represents the real dependencies, references, network requirements, and runtime behavior.",
    },
    {
      kind: "must_not_change",
      text: "Do not remove, weaken, relocate, or bypass declarations only to make the diagnostic disappear.",
    },
  ];
}

function specificRepairConstraints(code: string): RepairConstraint[] {
  if (code === DIAGNOSTIC_IDS.SEC_UNAPPROVED_NETWORK_DESTINATION) {
    return [
      {
        kind: "must_preserve",
        text: "Enumerate the actual required domains in approved_network_destinations or the applicable profile/repository security config.",
      },
      {
        kind: "must_not_change",
        text: "Do not remove the network requirement, move the declaration elsewhere, or use broad wildcards only to silence this warning.",
      },
      {
        kind: "must_not_change",
        text: "Do not replace specific domains with broad wildcards unless the source documentation explicitly supports that exact scope.",
      },
      {
        kind: "requires_human_decision",
        text: "If the required domains are unknown, keep the issue visible and add a TODO with supporting references instead of guessing.",
      },
    ];
  }

  if (
    code === DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID ||
    code === CONTEXT_LENS_DIAGNOSTIC_CODES.DUPLICATE_ID
  ) {
    return [
      {
        kind: "must_preserve",
        text: "Preserve existing references where possible and update only references affected by the chosen canonical id.",
      },
      {
        kind: "must_not_change",
        text: "Do not rename every duplicate blindly; identify the canonical asset or ask for review when intent is ambiguous.",
      },
      {
        kind: "requires_human_decision",
        text: "Choose whether duplicates represent the same source of truth, a deprecated copy, or distinct assets before renaming.",
      },
      {
        kind: "allowed_change",
        text: "Rename the non-canonical asset id and update declared references that pointed to it.",
      },
    ];
  }

  if (
    code === DIAGNOSTIC_IDS.META_UNKNOWN_REFERENCE ||
    code === DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY ||
    code === CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_FOUND ||
    code === DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED
  ) {
    return [
      {
        kind: "must_not_change",
        text: "Do not create a fake asset or dependency just to satisfy validation.",
      },
      {
        kind: "must_preserve",
        text: "Preserve the source asset's intended relationship when correcting the target.",
      },
      {
        kind: "allowed_change",
        text: "Correct the reference, add the missing asset only when clear source material exists, or remove the relationship if it is stale.",
      },
      {
        kind: "requires_human_decision",
        text: "Ask for review when the intended target cannot be inferred from repository evidence.",
      },
    ];
  }

  if (code === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_ASSET) {
    return [
      {
        kind: "must_not_change",
        text: "Do not delete the context asset automatically.",
      },
      {
        kind: "must_preserve",
        text: "Preserve asset content and metadata until ownership and intended reuse are reviewed.",
      },
      {
        kind: "allowed_change",
        text: "Attach the asset to a relevant skill or context, deprecate/archive it after review, or document that it is intentionally standalone.",
      },
      {
        kind: "requires_human_decision",
        text: "Confirm whether the asset is unused, newly staged, or missing declared references before removing or archiving it.",
      },
    ];
  }

  if (code === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_LENS) {
    return [
      {
        kind: "must_not_change",
        text: "Do not add runtime lens selection or prompt assembly to make the lens appear used.",
      },
      {
        kind: "must_preserve",
        text: "Preserve the lens purpose and applies_to relationship while reviewing reachability.",
      },
      {
        kind: "allowed_change",
        text: "Reference the lens from an appropriate skill, mark it inactive after review, or document why it is intentionally staged.",
      },
      {
        kind: "requires_human_decision",
        text: "Confirm whether an unreferenced active lens is staged, stale, or missing skill metadata.",
      },
    ];
  }

  if (
    code === DIAGNOSTIC_IDS.MAINT_REFERENCE_DEPRECATED_ASSET ||
    code === DIAGNOSTIC_IDS.META_INACTIVE_DEPENDENCY ||
    code === DIAGNOSTIC_IDS.MAINT_CONTEXT_LENS_APPLIES_TO_INACTIVE_CONTEXT ||
    code === DIAGNOSTIC_IDS.MAINT_SKILL_REFERENCES_SUPERSEDED_ASSET ||
    code === DIAGNOSTIC_IDS.MAINT_ASSET_REFERENCES_SUPERSEDED_ASSET
  ) {
    return [
      {
        kind: "must_preserve",
        text: "Preserve the source asset's intent and any compatibility guidance while retargeting references.",
      },
      {
        kind: "must_not_change",
        text: "Do not remove deprecated or archived assets unless repository policy and human review allow it.",
      },
      {
        kind: "allowed_change",
        text: "Retarget the reference to a reviewed replacement when superseded_by or canonical metadata provides one.",
      },
      {
        kind: "requires_human_decision",
        text: "Keep the reference and document the reason when no reviewed replacement exists.",
      },
    ];
  }

  if (
    code === DIAGNOSTIC_IDS.META_MISSING_ID ||
    code === CONTEXT_LENS_DIAGNOSTIC_CODES.MISSING_REQUIRED_FIELD
  ) {
    return [
      {
        kind: "must_preserve",
        text: "Preserve the asset body and existing metadata while adding the missing governance field.",
      },
      {
        kind: "allowed_change",
        text: "Add the smallest metadata field needed to satisfy the declared schema.",
      },
      {
        kind: "requires_human_decision",
        text: "Do not invent ownership, purpose, or usage boundaries when repository evidence is unclear.",
      },
    ];
  }

  if (code.startsWith("SEC-")) {
    return [
      {
        kind: "must_preserve",
        text: "Preserve the intended workflow only where it can remain policy-compliant.",
      },
      {
        kind: "must_not_change",
        text: "Do not weaken security policy, approval, redaction, destination, or secret-handling constraints to silence the finding.",
      },
      {
        kind: "risk",
        text: "Treat security repairs as review-sensitive when network access, uploads, credentials, secrets, or destructive commands are involved.",
      },
    ];
  }

  if (code === CONTEXT_LENS_DIAGNOSTIC_CODES.DEPRECATED_FIELD) {
    return [
      {
        kind: "must_preserve",
        text: "Preserve the deprecated field value when moving it to the replacement field.",
      },
      {
        kind: "allowed_change",
        text: "Rename the deprecated field to the supported Context Lens field.",
      },
    ];
  }

  if (code === CONTEXT_LENS_DIAGNOSTIC_CODES.PATH_NORMALIZATION_MISMATCH) {
    return [
      {
        kind: "must_preserve",
        text: "Preserve the target relationship while normalizing the path spelling.",
      },
      {
        kind: "allowed_change",
        text: "Replace the target path with the normalized repository-relative path reported by Renma.",
      },
    ];
  }

  return [
    {
      kind: "must_preserve",
      text: "Preserve existing repository semantics and reviewable evidence while making the smallest repair.",
    },
    {
      kind: "must_not_change",
      text: "Do not introduce runtime context selection, prompt assembly, or hidden scan-time rewrites.",
    },
  ];
}

function constraintTextsToRepairConstraints(
  constraints: string[],
): RepairConstraint[] {
  return constraints.map((text) => ({
    kind: repairConstraintKindForText(text),
    text,
  }));
}

function repairConstraintKindForText(text: string): RepairConstraint["kind"] {
  const normalized = text.toLowerCase();
  if (/\b(do not|don't|must not|never)\b/.test(normalized)) {
    return "must_not_change";
  }
  if (/\b(preserve|keep|retain|maintain)\b/.test(normalized)) {
    return "must_preserve";
  }
  if (
    /\b(human|owner|review|approval|confirm|decide|ambiguous)\b/.test(
      normalized,
    )
  ) {
    return "requires_human_decision";
  }
  if (
    /\b(risk|risky|danger|unsafe|secret|credential|destructive)\b/.test(
      normalized,
    )
  ) {
    return "risk";
  }
  return "allowed_change";
}

function verificationStepsForFinding(finding: Finding): VerificationStep[] {
  const steps = finding.verificationStepsV2 ?? [
    ...(finding.verificationSteps ?? []).map((step) =>
      verificationStepFromText(step, finding.id),
    ),
  ];
  return steps.length > 0
    ? uniqueVerificationSteps(steps)
    : defaultVerificationSteps(finding.id);
}

function verificationStepsForDiagnostic(
  code: string,
  diagnostic: Diagnostic,
): VerificationStep[] {
  if (diagnostic.verificationSteps && diagnostic.verificationSteps.length > 0) {
    return uniqueVerificationSteps(diagnostic.verificationSteps);
  }
  return defaultVerificationSteps(code);
}

function defaultVerificationSteps(code: string): VerificationStep[] {
  return [
    {
      text: "Run Renma scan again and confirm this diagnostic no longer appears.",
      command: "renma scan",
      expected: `No diagnostics with code ${code} are reported.`,
    },
  ];
}

function verificationStepFromText(
  text: string,
  code: string,
): VerificationStep {
  const normalized = text.toLowerCase();
  if (normalized.startsWith("run renma scan")) {
    return {
      text,
      command: "renma scan",
      expected: `No diagnostics with code ${code} are reported.`,
    };
  }
  if (normalized.startsWith("run renma catalog")) {
    return {
      text,
      command: "renma catalog",
      expected: "Catalog output resolves relevant assets and dependencies.",
    };
  }
  if (normalized.startsWith("run renma readiness")) {
    return {
      text,
      command: "renma readiness",
      expected: "Readiness checks reflect the repaired repository state.",
    };
  }
  if (normalized.startsWith("run renma graph")) {
    return {
      text,
      command: "renma graph",
      expected: "Graph output shows the repaired relationships.",
    };
  }
  if (normalized.startsWith("run npm test")) {
    return {
      text,
      command: "npm test",
      expected: "The test suite passes.",
    };
  }
  return { text };
}

function llmHintForFinding(finding: Finding): string {
  if (finding.llmHint) return finding.llmHint;
  if (finding.id === DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID) {
    return "Rename only the non-canonical duplicate id, then update references that pointed to it.";
  }
  if (
    finding.id === DIAGNOSTIC_IDS.META_UNKNOWN_REFERENCE ||
    finding.id === DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY
  ) {
    return "Check whether this reference is a typo before adding a new asset.";
  }
  if (finding.id === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_ASSET) {
    return "Do not delete this orphaned asset automatically; first determine whether it is intentionally standalone.";
  }
  return "Use the evidence, repair constraints, and verification steps to make the smallest reviewable patch.";
}

function llmHintForDiagnostic(code: string, diagnostic: Diagnostic): string {
  if (diagnostic.llmHint) return diagnostic.llmHint;
  if (code === CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_FOUND) {
    return "Check whether the applies_to value is a typo before adding a new context asset.";
  }
  if (code === CONTEXT_LENS_DIAGNOSTIC_CODES.DUPLICATE_ID) {
    return "Rename only the non-canonical lens id and update any skill references that pointed to it.";
  }
  if (code === "SUPPRESSION-EXPIRED") {
    return "Review the finding again, then either fix it or renew the suppression with an explicit audit reason.";
  }
  return "Use the diagnostic evidence and keep the repair limited to the reported repository fact.";
}

function reviewBundleSeed(diagnostic: DiagnosticV2): BundleSeed {
  if (
    diagnostic.code === DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID ||
    diagnostic.code === CONTEXT_LENS_DIAGNOSTIC_CODES.DUPLICATE_ID
  ) {
    const label = extractedAssetId(diagnostic) ?? "unknown";
    return {
      key: `duplicate-id:${label}`,
      kind: "duplicate-id",
      label,
    };
  }

  if (
    diagnostic.code === DIAGNOSTIC_IDS.META_UNKNOWN_REFERENCE ||
    diagnostic.code === DIAGNOSTIC_IDS.META_UNKNOWN_DEPENDENCY ||
    diagnostic.code === CONTEXT_LENS_DIAGNOSTIC_CODES.TARGET_NOT_FOUND ||
    diagnostic.code === DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED
  ) {
    const label = affectedSource(diagnostic);
    return {
      key: `unknown-reference:${label}`,
      kind: "unknown-reference",
      label,
    };
  }

  if (diagnostic.code === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_ASSET) {
    return {
      key: "orphaned-context-assets",
      kind: "orphaned-context-assets",
    };
  }

  if (diagnostic.code === DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_LENS) {
    return {
      key: "orphaned-context-lenses",
      kind: "orphaned-context-lenses",
    };
  }

  if (isReferenceOrDependencyCode(diagnostic.code)) {
    const label = affectedSource(diagnostic);
    return {
      key: `dependency-review:${label}`,
      kind: "dependency-review",
      label,
    };
  }

  const label = affectedSource(diagnostic);
  return {
    key: `code-review:${diagnostic.code}:${label}`,
    kind: "code-review",
    label,
  };
}

function reviewBundle(
  seed: BundleSeed,
  diagnostics: DiagnosticV2[],
): ReviewBundle {
  const sortedDiagnostics = [...diagnostics].sort(compareDiagnosticsV2);
  const affectedFiles = stableUnique(
    sortedDiagnostics.flatMap((diagnostic) => filesForDiagnostic(diagnostic)),
  );
  const affectedAssets = stableUnique(
    [
      seed.label && seed.kind === "duplicate-id" ? seed.label : undefined,
      ...sortedDiagnostics.flatMap(extractAssets),
    ].filter((asset): asset is string => asset !== undefined),
  );
  const diagnosticCodes = stableUnique(
    sortedDiagnostics.map((diagnostic) => diagnostic.code),
  );
  const diagnosticIds = stableUnique(
    sortedDiagnostics
      .map((diagnostic) => diagnostic.details?.diagnosticId)
      .filter((id): id is string => typeof id === "string"),
  );

  return compactBundle({
    id: bundleId(seed.key),
    title: bundleTitle(seed, sortedDiagnostics),
    summary: bundleSummary(seed, sortedDiagnostics),
    severity: aggregateSeverity(sortedDiagnostics),
    diagnosticCodes,
    diagnosticIds,
    affectedAssets,
    affectedFiles,
    suggestedReviewOrder: reviewOrder(seed, affectedFiles, affectedAssets),
    llmHint: bundleLlmHint(seed),
  });
}

function bundleTitle(seed: BundleSeed, diagnostics: DiagnosticV2[]): string {
  if (seed.kind === "duplicate-id") {
    return `Duplicate id review: ${seed.label}`;
  }
  if (seed.kind === "unknown-reference") {
    return `Unresolved reference review: ${seed.label}`;
  }
  if (seed.kind === "orphaned-context-assets") {
    return "Orphaned shared context assets";
  }
  if (seed.kind === "orphaned-context-lenses") {
    return "Orphaned context lenses";
  }
  if (seed.kind === "dependency-review") {
    return `Dependency/reference review: ${seed.label}`;
  }
  return `${diagnostics[0]?.code ?? "Diagnostic"} review`;
}

function bundleSummary(seed: BundleSeed, diagnostics: DiagnosticV2[]): string {
  const count = diagnostics.length;
  if (seed.kind === "duplicate-id") {
    return `${count} diagnostics report the same declared id and should be reviewed together before renaming or merging assets.`;
  }
  if (seed.kind === "unknown-reference") {
    return `${count} unresolved reference diagnostics share a source and should be repaired as one dependency decision.`;
  }
  if (seed.kind === "orphaned-context-assets") {
    return `${count} active shared context assets have no incoming declared references.`;
  }
  if (seed.kind === "orphaned-context-lenses") {
    return `${count} active context lenses are not referenced by skills.`;
  }
  if (seed.kind === "dependency-review") {
    return `${count} dependency or reference diagnostics affect the same source.`;
  }
  return `${count} diagnostics share the same code and source.`;
}

function bundleLlmHint(seed: BundleSeed): string {
  if (seed.kind === "duplicate-id") {
    return "Pick one canonical asset id before editing references; do not rename every duplicate in one blind pass.";
  }
  if (seed.kind === "unknown-reference") {
    return "Look for typos, renamed files, or missing declared assets before adding anything new.";
  }
  if (seed.kind === "orphaned-context-assets") {
    return "Review whether each context is intentionally standalone, missing a reference, or ready to deprecate; do not delete automatically.";
  }
  if (seed.kind === "orphaned-context-lenses") {
    return "Connect intended lenses through skill metadata or mark stale lenses inactive after review; do not add runtime selection logic.";
  }
  if (seed.kind === "dependency-review") {
    return "Repair related references in one patch so catalog and graph output remain consistent.";
  }
  return "Review these diagnostics together and make the smallest patch that satisfies their shared evidence.";
}

const REFERENCE_OR_DEPENDENCY_CODES = new Set<string>([
  DIAGNOSTIC_IDS.MAINT_REFERENCE_DEPRECATED_ASSET,
  DIAGNOSTIC_IDS.META_INACTIVE_DEPENDENCY,
  DIAGNOSTIC_IDS.MAINT_CONTEXT_LENS_APPLIES_TO_INACTIVE_CONTEXT,
  DIAGNOSTIC_IDS.MAINT_SKILL_CONTEXT_REFERENCE_NOT_DECLARED,
  DIAGNOSTIC_IDS.MAINT_SKILL_REFERENCES_SUPERSEDED_ASSET,
  DIAGNOSTIC_IDS.MAINT_ASSET_REFERENCES_SUPERSEDED_ASSET,
  DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL,
  DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_NON_TOOLS,
  DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_SKILL_SCRIPTS,
]);

function isReferenceOrDependencyCode(code: string): boolean {
  return REFERENCE_OR_DEPENDENCY_CODES.has(code);
}

function severityFromFinding(finding: Finding): DiagnosticV2["severity"] {
  return finding.severity === "critical" || finding.severity === "high"
    ? "error"
    : "warning";
}

function aggregateSeverity(
  diagnostics: DiagnosticV2[],
): DiagnosticV2["severity"] {
  return diagnostics.reduce(
    (current, diagnostic) =>
      severityRank(diagnostic.severity) > severityRank(current)
        ? diagnostic.severity
        : current,
    "info" as DiagnosticV2["severity"],
  );
}

function severityRank(severity: DiagnosticV2["severity"]): number {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function locationFromEvidence(
  evidence: Finding["evidence"],
): DiagnosticLocation {
  return {
    path: evidence.path,
    startLine: evidence.startLine,
    endLine: evidence.endLine,
    snippet: evidence.snippet,
  };
}

function locationFromDiagnostic(
  diagnostic: Diagnostic,
): DiagnosticLocation | undefined {
  if (diagnostic.evidence) return locationFromEvidence(diagnostic.evidence);
  if (!diagnostic.path) return undefined;
  return { path: diagnostic.path };
}

function inferredDiagnosticCode(diagnostic: Diagnostic): string {
  if (/Could not evaluate glob/i.test(diagnostic.message)) {
    return "DISCOVERY-GLOB-EVALUATION-FAILED";
  }
  if (/Skipping symbolic link/i.test(diagnostic.message)) {
    return "DISCOVERY-SYMLINK-SKIPPED";
  }
  if (
    /Skipping file larger than max_file_size_bytes/i.test(diagnostic.message)
  ) {
    return "DISCOVERY-FILE-TOO-LARGE";
  }
  if (/Could not read file/i.test(diagnostic.message)) {
    return "DISCOVERY-FILE-READ-FAILED";
  }
  if (/Suppression for .+ expired/i.test(diagnostic.message)) {
    return "SUPPRESSION-EXPIRED";
  }
  return "RENMA-DIAGNOSTIC";
}

function diagnosticIdFor(
  code: string,
  location: DiagnosticLocation | undefined,
  index: number,
): string {
  const pathPart = location?.path ?? "global";
  const linePart = location?.startLine ?? 0;
  return `${code}@${pathPart}:L${linePart}#${index}`;
}

function diagnosticDetails(
  source: "finding" | "diagnostic",
  diagnosticId: string,
  facts: Record<string, unknown> | undefined,
  compatibility: Record<string, unknown> = {},
): Record<string, unknown> {
  const factRecord = facts ? compactRecord(facts) : {};
  const safeFlatFacts = Object.fromEntries(
    Object.entries(factRecord).filter(
      ([key]) => !RESERVED_DETAIL_KEYS.has(key),
    ),
  );
  return compactRecord({
    ...safeFlatFacts,
    ...compatibility,
    diagnosticId,
    source,
    facts: Object.keys(factRecord).length > 0 ? factRecord : undefined,
  });
}

function detailString(
  diagnostic: DiagnosticV2,
  key: string,
): string | undefined {
  const factValue = detailFacts(diagnostic)?.[key];
  if (typeof factValue === "string" && factValue.length > 0) {
    return factValue;
  }
  if (RESERVED_DETAIL_KEYS.has(key)) return undefined;
  const value = diagnostic.details?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function detailStringArray(diagnostic: DiagnosticV2, key: string): string[] {
  const values = [detailFacts(diagnostic)?.[key], diagnostic.details?.[key]];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    return value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  }
  return [];
}

function detailFacts(
  diagnostic: DiagnosticV2,
): Record<string, unknown> | undefined {
  const facts = diagnostic.details?.facts;
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    return undefined;
  }
  return facts as Record<string, unknown>;
}

function extractedAssetId(diagnostic: DiagnosticV2): string | undefined {
  const structuredId =
    detailString(diagnostic, "assetId") ?? detailString(diagnostic, "lensId");
  if (structuredId) return structuredId;

  const sources = [
    diagnostic.message,
    diagnostic.location?.snippet,
    diagnostic.llmHint,
  ].filter((source): source is string => source !== undefined);
  for (const source of sources) {
    const duplicateSnippet = source.match(/Duplicate asset id:\s*([^\n]+)/i);
    if (duplicateSnippet?.[1]) return duplicateSnippet[1].trim();
    const quotedId = source.match(/\bid\s+"([^"]+)"/i);
    if (quotedId?.[1]) return quotedId[1].trim();
  }
  return undefined;
}

function affectedSource(diagnostic: DiagnosticV2): string {
  const structuredSource =
    detailString(diagnostic, "sourcePath") ??
    detailString(diagnostic, "source");
  if (structuredSource) return structuredSource;

  const declaredBy = diagnostic.llmHint?.match(/declared by "([^"]+)"/i)?.[1];
  if (declaredBy) return declaredBy;
  return diagnostic.location?.path ?? "global";
}

function filesForDiagnostic(diagnostic: DiagnosticV2): string[] {
  const cycleSkills = detailRecordArray(diagnostic, "cycleSkills");
  const cycleRoutes = detailRecordArray(diagnostic, "cycleRoutes");
  return [
    diagnostic.location?.path,
    detailString(diagnostic, "sourcePath"),
    detailString(diagnostic, "targetPath"),
    ...detailStringArray(diagnostic, "duplicatePaths"),
    ...cycleSkills.map(recordSourcePath),
    ...cycleRoutes.flatMap((route) => [
      recordString(route, "sourcePath"),
      recordString(route, "targetPath"),
    ]),
    ...(diagnostic.relatedLocations ?? []).map((location) => location.path),
  ].filter((pathValue): pathValue is string => pathValue !== undefined);
}

function extractAssets(diagnostic: DiagnosticV2): string[] {
  const structured = stableUnique(
    [
      detailString(diagnostic, "assetId"),
      detailString(diagnostic, "lensId"),
      detailString(diagnostic, "source"),
      detailString(diagnostic, "target"),
      ...detailStringArray(diagnostic, "cycleSkillIds"),
      ...detailStringArray(diagnostic, "replacementTargets"),
    ].filter((value): value is string => value !== undefined),
  );
  if (structured.length > 0) return structured;

  const sources = [
    diagnostic.message,
    diagnostic.location?.snippet,
    diagnostic.llmHint,
  ].filter((source): source is string => source !== undefined);
  const assets = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/"([^"]+)"/g)) {
      const value = match[1]?.trim();
      if (value && looksAssetLike(value)) assets.add(value);
    }
    const duplicateId = source.match(/Duplicate asset id:\s*([^\n]+)/i)?.[1];
    if (duplicateId) assets.add(duplicateId.trim());
  }
  return [...assets];
}

function detailRecordArray(
  diagnostic: DiagnosticV2,
  key: string,
): Array<Record<string, unknown>> {
  const values = [detailFacts(diagnostic)?.[key], diagnostic.details?.[key]];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    return value.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  }
  return [];
}

function recordString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordSourcePath(record: Record<string, unknown>): string | undefined {
  return recordString(record, "sourcePath");
}

function looksAssetLike(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes(".") ||
    value.startsWith("context") ||
    value.startsWith("lens") ||
    value.startsWith("skill")
  );
}

function reviewOrder(
  seed: BundleSeed,
  affectedFiles: string[],
  affectedAssets: string[],
): string[] {
  if (seed.kind === "duplicate-id") {
    return [
      ...affectedFiles.map(
        (file) => `Inspect duplicate declaration in ${file}`,
      ),
      "Choose canonical id before editing references.",
      "Update references and rerun Renma scan.",
    ];
  }
  if (seed.kind === "unknown-reference" || seed.kind === "dependency-review") {
    return [
      ...affectedFiles.map((file) => `Inspect declared references in ${file}`),
      ...affectedAssets.map((asset) => `Resolve intended target ${asset}`),
      "Rerun Renma catalog or graph to verify relationships.",
    ];
  }
  return [
    ...affectedFiles.map((file) => `Inspect ${file}`),
    "Apply the repair constraints before editing.",
    "Rerun Renma scan.",
  ];
}

function compareDiagnosticsV2(a: DiagnosticV2, b: DiagnosticV2): number {
  const byCode = a.code.localeCompare(b.code);
  if (byCode !== 0) return byCode;
  const byPath = (a.location?.path ?? "").localeCompare(b.location?.path ?? "");
  if (byPath !== 0) return byPath;
  const byLine = (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0);
  if (byLine !== 0) return byLine;
  return a.message.localeCompare(b.message);
}

function uniqueConstraints(
  constraints: RepairConstraint[],
): RepairConstraint[] {
  const seen = new Set<string>();
  const result: RepairConstraint[] = [];
  for (const constraint of constraints) {
    const key = `${constraint.kind}\u0000${constraint.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(constraint);
  }
  return result;
}

function uniqueVerificationSteps(
  steps: VerificationStep[],
): VerificationStep[] {
  const seen = new Set<string>();
  const result: VerificationStep[] = [];
  for (const step of steps) {
    const key = `${step.text}\u0000${step.command ?? ""}\u0000${step.expected ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(step);
  }
  return result;
}

function stableUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function bundleId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.:/-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compactDiagnostic(diagnostic: Record<string, unknown>): DiagnosticV2 {
  return compactRecord(diagnostic) as unknown as DiagnosticV2;
}

function compactBundle(bundle: ReviewBundle): ReviewBundle {
  return compactRecord({
    ...bundle,
    diagnosticIds:
      bundle.diagnosticIds && bundle.diagnosticIds.length > 0
        ? bundle.diagnosticIds
        : undefined,
    affectedAssets:
      bundle.affectedAssets && bundle.affectedAssets.length > 0
        ? bundle.affectedAssets
        : undefined,
    affectedFiles:
      bundle.affectedFiles && bundle.affectedFiles.length > 0
        ? bundle.affectedFiles
        : undefined,
    suggestedReviewOrder:
      bundle.suggestedReviewOrder && bundle.suggestedReviewOrder.length > 0
        ? bundle.suggestedReviewOrder
        : undefined,
  }) as unknown as ReviewBundle;
}

function compactRecord(record: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}
