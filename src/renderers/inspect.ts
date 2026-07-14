import type { ContextLensSummary } from "../context-lens.js";
import type { RepositoryClassificationPathResolution } from "../discovery.js";
import type {
  InspectAssetSummary,
  InspectOutline,
  InspectRelationship,
} from "../commands/inspect.js";
import type {
  AssetClassificationEvidence,
  AssetGovernanceEvidence,
} from "../types.js";

// Rendering must preserve the collected evidence instead of reinterpreting it.
export function renderTextOutline(outline: InspectOutline): string {
  const lines = [
    `Path: ${outline.path}`,
    `Lines: ${outline.lineCount}`,
    `Bytes: ${outline.bytes}`,
    `Frontmatter: ${outline.frontmatterRange ?? "none"}`,
    "",
    "Repository boundary:",
    ...renderRepositoryBoundary(outline.repositoryBoundary),
    "",
    "Classification:",
    ...renderClassification(outline.classification),
    "",
    "Governance:",
    ...renderGovernance(outline.governance),
    ...(outline.asset
      ? ["", "Asset:", ...renderAssetSummary(outline.asset)]
      : []),
    "",
    "Context Lens:",
    ...renderContextLensSummary(outline.contextLens),
    "",
    "Headings:",
    ...outline.headings.flatMap((heading) => [
      `- ${"#".repeat(heading.depth)} ${heading.text} ${heading.range}`,
      ...heading.preview.map((line) => `  ${line}`),
    ]),
    "",
    "Code fences:",
    ...outline.codeFences.map(
      (fence) => `- ${fence.range} ${fence.language || "(no language)"}`,
    ),
    "",
    "Links:",
    ...outline.links.map((link) => `- L${link.line}: ${link.target}`),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function renderRepositoryBoundary(
  boundary: RepositoryClassificationPathResolution,
): string[] {
  if (boundary.state === "resolved") {
    return [
      `- State: ${boundary.state}`,
      `- Source: ${boundary.source}`,
      `- Root: ${boundary.root}`,
      `- Relative path: ${boundary.relativePath}`,
    ];
  }
  return [
    `- State: ${boundary.state}`,
    `- Reason code: ${boundary.reasonCode}`,
    `- Reason: ${boundary.reason}`,
    `- Candidate roots: ${boundary.candidateRoots.join(", ") || "(none)"}`,
  ];
}

function renderClassification(
  classification: AssetClassificationEvidence,
): string[] {
  return [
    `- Kind: ${classification.kind}`,
    `- Scope: ${classification.scope}`,
    `- Matched rule: ${classification.matchedRule}`,
    `- Reason code: ${classification.reasonCode}`,
    ...(classification.recognizedRoot
      ? [`- Recognized root: ${classification.recognizedRoot}`]
      : []),
    ...(classification.parentAssetPath
      ? [`- Parent asset: ${classification.parentAssetPath}`]
      : []),
    ...(classification.parentAssetCandidatePath
      ? [
          `- Parent candidate: ${classification.parentAssetCandidatePath}`,
          `- Parent resolution: ${classification.parentResolution ?? "structural-candidate"}`,
        ]
      : []),
    ...(classification.parentAssetCandidates?.length
      ? [
          `- Parent candidates: ${classification.parentAssetCandidates.join(", ")}`,
        ]
      : []),
    ...(classification.supportDirectory
      ? [`- Support directory: ${classification.supportDirectory}`]
      : []),
    ...(classification.ignoredNestedSegments?.length
      ? [
          `- Ignored nested segments: ${classification.ignoredNestedSegments.join(", ")}`,
        ]
      : []),
    `- Reason: ${classification.reason}`,
    ...(classification.competingRules?.flatMap((competing) => [
      `- Competing rule: ${competing.rule} (${competing.reasonCode})`,
      `  ${competing.reason}`,
    ]) ?? []),
  ];
}

function renderGovernance(
  governance: AssetGovernanceEvidence | null,
): string[] {
  if (!governance) return ["- Unresolved: target is not a catalog entry."];
  const inheritedOwner = governance.ownership.inheritedFrom?.sourcePath;
  return [
    `- Declared owner: ${governance.ownership.declaredOwner ?? "(none)"}`,
    `- Effective owner: ${governance.ownership.effectiveOwner ?? "(unowned)"}`,
    `- Ownership source: ${governance.ownership.source}`,
    ...(inheritedOwner
      ? [`- Ownership inherited from: ${inheritedOwner}`]
      : []),
    `- Policy source: ${governance.policySource ?? "missing"}`,
    ...(governance.policyInheritedFrom
      ? [`- Policy inherited from: ${governance.policyInheritedFrom}`]
      : []),
    `- Metadata state: ${governance.metadataState ?? "missing"}`,
  ];
}

function renderContextLensSummary(contextLens: ContextLensSummary): string[] {
  return [
    `- Enabled: ${contextLens.enabled ? "yes" : "no"}`,
    `- Detected: ${contextLens.detected ? "yes" : "no"}`,
    `- Lenses: ${contextLens.validLensCount}/${contextLens.totalLensCount} valid (${contextLens.invalidLensCount} invalid)`,
    `- Diagnostics: error ${contextLens.diagnosticCounts.error}, warning ${contextLens.diagnosticCounts.warning}, info ${contextLens.diagnosticCounts.info}`,
    `- Representative diagnostic: ${contextLens.representativeDiagnosticCode ?? "(none)"}`,
    `- Definition paths: ${list(contextLens.definitionPaths)}`,
    `- Target references: ${list(contextLens.targetReferences)}`,
  ];
}

function renderAssetSummary(asset: InspectAssetSummary): string[] {
  return [
    `- ID: ${asset.id}`,
    `- Kind: ${asset.kind}`,
    ...(asset.owner ? [`- Owner: ${asset.owner}`] : []),
    ...(asset.status ? [`- Status: ${asset.status}`] : []),
    `- Tags: ${list(asset.tags)}`,
    ...(asset.kind === "context_lens"
      ? [
          ...(asset.purpose ? [`- Purpose: ${asset.purpose}`] : []),
          `- Applies to: ${list(asset.appliesTo)}`,
          `- Focus: ${list(asset.focus)}`,
          `- Expected outputs: ${list(asset.expectedOutputs)}`,
        ]
      : []),
    "",
    "Relationships:",
    "- Inbound dependents:",
    ...relationshipLines(asset.inboundDependents),
    "- Outbound dependencies:",
    ...relationshipLines(asset.outboundDependencies),
    ...(asset.relationshipChains.length > 0
      ? [
          "- Relationship chains:",
          ...asset.relationshipChains.map(
            (chain) =>
              `  - ${chain.skill} -> ${chain.lens} -> ${chain.context}`,
          ),
        ]
      : []),
  ];
}

function relationshipLines(relationships: InspectRelationship[]): string[] {
  if (relationships.length === 0) return ["  - (none)"];
  return relationships.map(
    (relationship) =>
      `  - ${relationship.from} ${relationship.kind} -> ${relationship.to}`,
  );
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}
