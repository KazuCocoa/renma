import type { AssetBindingDiagnostic } from "./types/asset-bindings.js";
import type {
  CompositionProvenanceEdge,
  DeclaredCompositionReport,
} from "./declared-composition.js";
import type {
  ImpactProvenanceEdge,
  DeclaredImpactReport,
} from "./declared-impact.js";
import { normalizeDependencyReference } from "./dependency-resolution.js";
import type { ExecutableSurfaceDependency } from "./executable-dependency-resolution.js";
import type {
  ExecutableSurfaceInvocation,
  ExecutableSurfaceScope,
} from "./executable-surface-inventory.js";
import type {
  AssetKind,
  AssetStatus,
  DependencyKind,
  DependencyBinding,
} from "./model.js";
import type { AssetOwnership } from "./types/governance.js";
import type { SkillDiscoveryIndex } from "./skill-discovery.js";
import type { Diagnostic } from "./types/diagnostics.js";

type GraphEdgeKind = DependencyKind | "continues_with" | "invokes" | "contains";
export type GraphView =
  | "summary"
  | "workflow"
  | "full"
  | "layered"
  | "composition"
  | "impact"
  | "dependencies"
  | "asset-impact"
  | "discovery"
  | "executable";

export type ExecutableGraphNodeRole =
  "skill" | "repository-script" | "external-executable";

export interface ExecutableGraphProjection {
  focus?: {
    id: string;
    role: ExecutableGraphNodeRole;
    sourcePath: string;
  };
  invocationEvidence: ExecutableSurfaceInvocation[];
  dependencyEvidence: ExecutableSurfaceDependency[];
}

export interface GraphReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  view: GraphView;
  nodeCount: number;
  edgeCount: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  composition?: DeclaredCompositionReport;
  impact?: DeclaredImpactReport;
  discovery?: SkillDiscoveryIndex;
  executable?: ExecutableGraphProjection;
  /** Static closure; edge kinds preserve optional declarations without runtime claims. */
  dependencyTraversal?: {
    focusPath: string;
    direction: "forward" | "reverse";
  };
  diagnostics?: Diagnostic[];
}

export interface GraphNode {
  releaseVersion?: string;
  id: string;
  kind: AssetKind;
  sourcePath: string;
  contentHash?: string;
  sizeBytes?: number;
  contentClassification?: "text" | "binary";
  markdownParserEligible?: boolean;
  ownership: AssetOwnership;
  writableBy?: string[];
  status?: AssetStatus;
  statusReason?: string;
  statusChangedAt?: string;
  tags: string[];
  groupedCount?: number;
  executableRole?: ExecutableGraphNodeRole;
  executableScope?: ExecutableSurfaceScope;
  invokedBySkillCount?: number;
  interpreterHints?: string[];
}

export interface GraphEdge {
  bindings?: DependencyBinding[];
  bindingDiagnostics?: AssetBindingDiagnostic[];
  from: string;
  to: string;
  kind: GraphEdgeKind;
  declaration?: string;
  declarationIndex?: number;
  sourcePath: string;
  evidence?: Diagnostic["evidence"];
  membership?: "required" | "optional";
  dependentMembership?: "required" | "optional";
  resolved: boolean;
  targetId?: string;
  targetKind?: AssetKind;
  targetPath?: string;
  evidenceCount?: number;
}

export function focusedProvenanceTarget<
  T extends { id: string; sourcePath: string },
>(
  edge: CompositionProvenanceEdge | ImpactProvenanceEdge,
  nodes: T[],
): T | undefined {
  return nodes.find(
    (node) =>
      node.id === edge.to &&
      (edge.declaredTarget === edge.to ||
        normalizeDependencyReference(node.sourcePath) ===
          normalizeDependencyReference(edge.declaredTarget)),
  );
}
