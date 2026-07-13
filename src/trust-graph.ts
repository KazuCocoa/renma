import { createHash } from "node:crypto";
import {
  normalizeDependencyReference,
  resolveDependencyTarget,
} from "./dependency-resolution.js";
import {
  effectiveAssetOwner,
  type Asset,
  type Catalog,
  type Dependency,
} from "./model.js";
import type {
  EffectiveSecurityPolicyEvidence,
  SecurityPolicyAssetEvidence,
} from "./security-policy-inventory.js";
import type { Diagnostic, Evidence, Finding, RiskClass } from "./types.js";

export type TrustGraphSchemaVersion = "renma.trustGraph.v2";

export type TrustGraphNodeType =
  | "asset"
  | "owner"
  | "lifecycle_status"
  | "security_profile"
  | "effective_policy"
  | "diagnostic";

export type TrustGraphEdgeType =
  | "owned_by"
  | "has_lifecycle_status"
  | "declares_dependency"
  | "references"
  | "owns_local_resource"
  | "statically_references"
  | "inherits_owner"
  | "selects_security_profile"
  | "inherits_policy"
  | "has_effective_policy"
  | "has_diagnostic";

export type TrustGraphFindingSource = "finding" | "diagnostic";
export type TrustGraphFindingSeverity =
  | Finding["severity"]
  | Diagnostic["severity"];

export interface TrustGraphSummary {
  assetCount: number;
  nodeCount: number;
  edgeCount: number;
  findingCount: number;
  nodeTypeCounts: Record<TrustGraphNodeType, number>;
  edgeTypeCounts: Record<TrustGraphEdgeType, number>;
  findingSeverityCounts: Record<TrustGraphFindingSeverity, number>;
  riskClassCounts: Record<RiskClass | "unclassified", number>;
}

export interface TrustGraphNode {
  id: string;
  type: TrustGraphNodeType;
  label: string;
  properties?: Record<string, unknown>;
  evidence?: Evidence[];
}

export interface TrustGraphEdge {
  id: string;
  from: string;
  to: string;
  type: TrustGraphEdgeType;
  properties?: Record<string, unknown>;
  evidence?: Evidence[];
}

export interface TrustGraphFinding {
  source: TrustGraphFindingSource;
  severity: TrustGraphFindingSeverity;
  message: string;
  path?: string;
  code?: string;
  id?: string;
  title?: string;
  riskClass?: RiskClass;
  evidence?: Evidence;
}

export interface TrustGraph {
  schemaVersion: TrustGraphSchemaVersion;
  summary: TrustGraphSummary;
  nodes: TrustGraphNode[];
  edges: TrustGraphEdge[];
  findings: TrustGraphFinding[];
}

export interface TrustGraphInput {
  catalog: Catalog;
  findings?: Finding[];
  diagnostics?: Diagnostic[];
  securityPolicies?: SecurityPolicyAssetEvidence[];
}

const NODE_TYPES: TrustGraphNodeType[] = [
  "asset",
  "owner",
  "lifecycle_status",
  "security_profile",
  "effective_policy",
  "diagnostic",
];

const EDGE_TYPES: TrustGraphEdgeType[] = [
  "owned_by",
  "has_lifecycle_status",
  "declares_dependency",
  "references",
  "owns_local_resource",
  "statically_references",
  "inherits_owner",
  "selects_security_profile",
  "inherits_policy",
  "has_effective_policy",
  "has_diagnostic",
];

const FINDING_SEVERITIES: TrustGraphFindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "error",
  "warning",
  "info",
];

const RISK_CLASSES: Array<RiskClass | "unclassified"> = [
  "violation",
  "suspicious",
  "advisory",
  "unclassified",
];

export function buildTrustGraph(input: TrustGraphInput): TrustGraph {
  const nodes = new Map<string, TrustGraphNode>();
  const edges = new Map<string, TrustGraphEdge>();
  const assets = stableAssets(input.catalog.assets);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const assetsByPath = new Map(
    assets.map((asset) => [
      normalizeDependencyReference(asset.sourcePath),
      asset,
    ]),
  );

  for (const asset of assets) {
    addNode(nodes, assetNode(asset));
    const owner = effectiveAssetOwner(asset);
    if (owner) {
      const ownerNodeId = ownerNode(owner).id;
      addNode(nodes, ownerNode(owner));
      const inheritedOwnerAsset =
        asset.ownership.source === "inherited" && asset.ownership.inheritedFrom
          ? assetsByPath.get(
              normalizeDependencyReference(
                asset.ownership.inheritedFrom.sourcePath,
              ),
            )
          : undefined;
      addEdge(edges, {
        from: assetNodeId(asset),
        to: ownerNodeId,
        type: "owned_by",
        properties: {
          ownershipSource: asset.ownership.source,
          ...(asset.ownership.source === "inherited" &&
          asset.ownership.inheritedFrom
            ? { inheritedFrom: asset.ownership.inheritedFrom }
            : {}),
        },
        evidence: inheritedOwnerAsset
          ? metadataEvidence(inheritedOwnerAsset, "owner")
          : metadataEvidence(asset, "owner"),
      });
    }
    if (asset.metadata.status) {
      const lifecycleNodeId = lifecycleStatusNode(asset.metadata.status).id;
      addNode(nodes, lifecycleStatusNode(asset.metadata.status));
      addEdge(edges, {
        from: assetNodeId(asset),
        to: lifecycleNodeId,
        type: "has_lifecycle_status",
        evidence: metadataEvidence(asset, "status"),
      });
    }
  }

  for (const dependency of stableDependencies(input.catalog.dependencies)) {
    const source = assetsById.get(dependency.from);
    const target = resolveDependencyTarget(dependency, assets);
    if (!source || !target) continue;
    addEdge(edges, {
      from: assetNodeId(source),
      to: assetNodeId(target),
      type: trustEdgeTypeForDependency(dependency),
      properties: {
        dependencyKind: dependency.kind,
        declaredTarget: dependency.to,
        ...(dependency.kind === "inherits_owner" ||
        dependency.kind === "inherits_policy"
          ? {
              inheritedFrom: {
                id: target.id,
                sourcePath: target.sourcePath,
              },
            }
          : {}),
      },
      evidence: dependency.evidence ? [dependency.evidence] : [],
    });
  }

  for (const policy of input.securityPolicies ?? []) {
    const asset = assetsByPath.get(normalizeDependencyReference(policy.path));
    if (!asset) continue;
    const inheritedAsset = policy.inheritedFrom
      ? assetsByPath.get(
          normalizeDependencyReference(policy.inheritedFrom.sourcePath),
        )
      : undefined;
    addPolicyEvidence(
      nodes,
      edges,
      asset,
      inheritedAsset
        ? {
            ...policy,
            inheritedFrom: {
              id: inheritedAsset.id,
              sourcePath: inheritedAsset.sourcePath,
            },
          }
        : policy,
    );
  }

  const findings = stableTrustGraphFindings(
    (input.findings ?? []).map(findingToTrustGraphFinding),
    (input.diagnostics ?? []).map(diagnosticToTrustGraphFinding),
  );
  for (const finding of findings) {
    const diagnostic = diagnosticNode(finding);
    addNode(nodes, diagnostic);
    const asset = finding.path
      ? assetsByPath.get(normalizeDependencyReference(finding.path))
      : undefined;
    if (asset) {
      addEdge(edges, {
        from: assetNodeId(asset),
        to: diagnostic.id,
        type: "has_diagnostic",
        evidence: finding.evidence ? [finding.evidence] : [],
      });
    }
  }

  const sortedNodes = [...nodes.values()].sort(compareNodes);
  const sortedEdges = [...edges.values()].sort(compareEdges);
  const graph: TrustGraph = {
    schemaVersion: "renma.trustGraph.v2",
    summary: summarizeTrustGraph(
      assets.length,
      sortedNodes,
      sortedEdges,
      findings,
    ),
    nodes: sortedNodes,
    edges: sortedEdges,
    findings,
  };
  return graph;
}

function trustEdgeTypeForDependency(
  dependency: Dependency,
): TrustGraphEdgeType {
  if (dependency.kind === "references") return "references";
  if (
    dependency.kind === "owns_local_resource" ||
    dependency.kind === "statically_references" ||
    dependency.kind === "inherits_owner" ||
    dependency.kind === "inherits_policy"
  ) {
    return dependency.kind;
  }
  return "declares_dependency";
}

function addPolicyEvidence(
  nodes: Map<string, TrustGraphNode>,
  edges: Map<string, TrustGraphEdge>,
  asset: Asset,
  policy: SecurityPolicyAssetEvidence,
): void {
  if (policy.selectedSecurityProfile) {
    const profile = securityProfileNode(policy.selectedSecurityProfile);
    addNode(nodes, profile);
    addEdge(edges, {
      from: assetNodeId(asset),
      to: profile.id,
      type: "selects_security_profile",
      properties: {
        profileResolution: policy.profileResolution,
        profileChain: policy.profileChain,
      },
      evidence: policy.evidence.selectedSecurityProfile
        ? [policy.evidence.selectedSecurityProfile]
        : [],
    });
  }

  if (!policy.hasEffectivePolicy) return;

  for (let index = 1; index < policy.profileChain.length; index += 1) {
    const childProfile = policy.profileChain[index];
    const parentProfile = policy.profileChain[index - 1];
    if (!childProfile || !parentProfile) continue;
    const child = securityProfileNode(childProfile);
    const parent = securityProfileNode(parentProfile);
    addNode(nodes, child);
    addNode(nodes, parent);
    addEdge(edges, {
      from: child.id,
      to: parent.id,
      type: "inherits_policy",
    });
  }

  const effective = effectivePolicyNode(policy.effectivePolicy);
  addNode(nodes, effective);
  addEdge(edges, {
    from: assetNodeId(asset),
    to: effective.id,
    type: "has_effective_policy",
    properties: {
      hasLocalPolicyMetadata: policy.hasLocalPolicyMetadata,
      policySource: policy.policySource,
      ...(policy.inheritedFrom ? { inheritedFrom: policy.inheritedFrom } : {}),
    },
    evidence: policy.evidence.policyFields,
  });
}

function assetNode(asset: Asset): TrustGraphNode {
  return {
    id: assetNodeId(asset),
    type: "asset",
    label: asset.id,
    properties: {
      assetId: asset.id,
      kind: asset.kind,
      sourcePath: asset.sourcePath,
      contentHash: asset.contentHash,
      sizeBytes: asset.sizeBytes,
      contentClassification: asset.contentClassification,
      markdownParserEligible: asset.markdownParserEligible,
      tags: asset.metadata.tags,
      ownership: asset.ownership,
      ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    },
    evidence: [
      {
        path: asset.sourcePath,
        startLine: 1,
        endLine: 1,
        snippet: asset.id,
      },
    ],
  };
}

function ownerNode(owner: string): TrustGraphNode {
  return {
    id: `owner:${owner}`,
    type: "owner",
    label: owner,
  };
}

function lifecycleStatusNode(status: string): TrustGraphNode {
  return {
    id: `lifecycle_status:${status}`,
    type: "lifecycle_status",
    label: status,
  };
}

function securityProfileNode(profile: string): TrustGraphNode {
  return {
    id: `security_profile:${profile}`,
    type: "security_profile",
    label: profile,
  };
}

function effectivePolicyNode(
  policy: EffectiveSecurityPolicyEvidence,
): TrustGraphNode {
  return {
    id: `effective_policy:${policy.fingerprint}`,
    type: "effective_policy",
    label: policy.fingerprint,
    properties: {
      fingerprint: policy.fingerprint,
      allowedData: policy.allowedData,
      forbiddenInputs: policy.forbiddenInputs,
      networkAllowed: policy.networkAllowed,
      externalUploadAllowed: policy.externalUploadAllowed,
      secretsAllowed: policy.secretsAllowed,
      humanApprovalRequired: policy.humanApprovalRequired,
      approvedNetworkDestinations: policy.approvedNetworkDestinations,
      approvedUploadDestinations: policy.approvedUploadDestinations,
      disallowedCommands: policy.disallowedCommands,
    },
  };
}

function diagnosticNode(finding: TrustGraphFinding): TrustGraphNode {
  const id = diagnosticNodeId(finding);
  return {
    id,
    type: "diagnostic",
    label: finding.id ?? finding.code ?? finding.message,
    properties: {
      source: finding.source,
      severity: finding.severity,
      message: finding.message,
      ...(finding.id ? { id: finding.id } : {}),
      ...(finding.code ? { code: finding.code } : {}),
      ...(finding.title ? { title: finding.title } : {}),
      ...(finding.riskClass ? { riskClass: finding.riskClass } : {}),
      ...(finding.path ? { path: finding.path } : {}),
    },
    evidence: finding.evidence ? [finding.evidence] : [],
  };
}

function assetNodeId(asset: Asset): string {
  // Trust Graph keeps asset IDs logical. Duplicate-id diagnostics preserve
  // per-source evidence when multiple catalog assets share the same id.
  return `asset:${asset.id}`;
}

function addNode(
  nodes: Map<string, TrustGraphNode>,
  node: TrustGraphNode,
): void {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, {
      ...node,
      ...(node.evidence ? { evidence: stableEvidence(node.evidence) } : {}),
    });
    return;
  }

  if (node.evidence && node.evidence.length > 0) {
    nodes.set(node.id, {
      ...existing,
      evidence: stableEvidence([
        ...(existing.evidence ?? []),
        ...node.evidence,
      ]),
    });
  }
}

function addEdge(
  edges: Map<string, TrustGraphEdge>,
  edge: Omit<TrustGraphEdge, "id">,
): void {
  const id = edgeId(edge);
  const existing = edges.get(id);
  const next: TrustGraphEdge = {
    id,
    ...edge,
    ...(edge.evidence ? { evidence: stableEvidence(edge.evidence) } : {}),
  };
  if (!existing) {
    edges.set(id, next);
    return;
  }
  if (edge.evidence && edge.evidence.length > 0) {
    edges.set(id, {
      ...existing,
      evidence: stableEvidence([
        ...(existing.evidence ?? []),
        ...edge.evidence,
      ]),
    });
  }
}

function edgeId(edge: Omit<TrustGraphEdge, "id">): string {
  return `edge:${shortHash(
    JSON.stringify([
      edge.from,
      edge.type,
      edge.to,
      edge.properties ?? {},
      edge.evidence?.map(evidenceKey) ?? [],
    ]),
  )}`;
}

function diagnosticNodeId(finding: TrustGraphFinding): string {
  return `diagnostic:${shortHash(
    JSON.stringify([
      finding.source,
      finding.id ?? finding.code ?? "",
      finding.severity,
      finding.path ?? "",
      finding.evidence?.startLine ?? 0,
      finding.evidence?.endLine ?? 0,
      finding.message,
    ]),
  )}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function metadataEvidence(asset: Asset, field: string): Evidence[] {
  const evidence = asset.metadataFields[field];
  if (!evidence) return [];
  return [
    {
      path: evidence.path,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      snippet: evidence.raw,
    },
  ];
}

function findingToTrustGraphFinding(finding: Finding): TrustGraphFinding {
  return {
    source: "finding",
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    message: finding.title,
    path: finding.evidence.path,
    evidence: finding.evidence,
    ...(finding.riskClass ? { riskClass: finding.riskClass } : {}),
  };
}

function diagnosticToTrustGraphFinding(
  diagnostic: Diagnostic,
): TrustGraphFinding {
  const diagnosticPath = diagnostic.path ?? diagnostic.evidence?.path;
  return {
    source: "diagnostic",
    ...(diagnostic.code ? { code: diagnostic.code } : {}),
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnosticPath ? { path: diagnosticPath } : {}),
    ...(diagnostic.evidence ? { evidence: diagnostic.evidence } : {}),
  };
}

function stableTrustGraphFindings(
  findings: TrustGraphFinding[],
  diagnostics: TrustGraphFinding[],
): TrustGraphFinding[] {
  return [...findings, ...diagnostics].sort((left, right) => {
    const byPath = (left.path ?? "").localeCompare(right.path ?? "");
    if (byPath !== 0) return byPath;
    const byLine =
      (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0);
    if (byLine !== 0) return byLine;
    const bySeverity =
      FINDING_SEVERITIES.indexOf(left.severity) -
      FINDING_SEVERITIES.indexOf(right.severity);
    if (bySeverity !== 0) return bySeverity;
    return (
      (left.id ?? left.code ?? "").localeCompare(
        right.id ?? right.code ?? "",
      ) || left.message.localeCompare(right.message)
    );
  });
}

function summarizeTrustGraph(
  assetCount: number,
  nodes: TrustGraphNode[],
  edges: TrustGraphEdge[],
  findings: TrustGraphFinding[],
): TrustGraphSummary {
  const nodeTypeCounts = zeroCounts(NODE_TYPES);
  const edgeTypeCounts = zeroCounts(EDGE_TYPES);
  const findingSeverityCounts = zeroCounts(FINDING_SEVERITIES);
  const riskClassCounts = zeroCounts(RISK_CLASSES);

  for (const node of nodes) nodeTypeCounts[node.type] += 1;
  for (const edge of edges) edgeTypeCounts[edge.type] += 1;
  for (const finding of findings) {
    findingSeverityCounts[finding.severity] += 1;
    riskClassCounts[finding.riskClass ?? "unclassified"] += 1;
  }

  return {
    assetCount,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    findingCount: findings.length,
    nodeTypeCounts,
    edgeTypeCounts,
    findingSeverityCounts,
    riskClassCounts,
  };
}

function zeroCounts<const T extends string>(
  values: readonly T[],
): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<
    T,
    number
  >;
}

function stableAssets(assets: Asset[]): Asset[] {
  return [...assets].sort((left, right) => {
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) return byKind;
    const byPath = left.sourcePath.localeCompare(right.sourcePath);
    if (byPath !== 0) return byPath;
    return left.id.localeCompare(right.id);
  });
}

function stableDependencies(dependencies: Dependency[]): Dependency[] {
  return [...dependencies].sort((left, right) => {
    const byFrom = left.from.localeCompare(right.from);
    if (byFrom !== 0) return byFrom;
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) return byKind;
    const byTo = left.to.localeCompare(right.to);
    if (byTo !== 0) return byTo;
    return left.sourcePath.localeCompare(right.sourcePath);
  });
}

function stableEvidence(evidence: Evidence[]): Evidence[] {
  const evidenceByKey = new Map(
    evidence.map((item) => [evidenceKey(item), item]),
  );
  return [...evidenceByKey.values()].sort((left, right) => {
    const byPath = left.path.localeCompare(right.path);
    if (byPath !== 0) return byPath;
    const byStart = left.startLine - right.startLine;
    if (byStart !== 0) return byStart;
    const byEnd = left.endLine - right.endLine;
    if (byEnd !== 0) return byEnd;
    return left.snippet.localeCompare(right.snippet);
  });
}

function evidenceKey(evidence: Evidence): string {
  return [
    evidence.path,
    evidence.startLine,
    evidence.endLine,
    evidence.snippet,
  ].join("\0");
}

function compareNodes(left: TrustGraphNode, right: TrustGraphNode): number {
  const byType = NODE_TYPES.indexOf(left.type) - NODE_TYPES.indexOf(right.type);
  if (byType !== 0) return byType;
  return left.id.localeCompare(right.id);
}

function compareEdges(left: TrustGraphEdge, right: TrustGraphEdge): number {
  const byFrom = left.from.localeCompare(right.from);
  if (byFrom !== 0) return byFrom;
  const byType = EDGE_TYPES.indexOf(left.type) - EDGE_TYPES.indexOf(right.type);
  if (byType !== 0) return byType;
  const byTo = left.to.localeCompare(right.to);
  if (byTo !== 0) return byTo;
  return left.id.localeCompare(right.id);
}
