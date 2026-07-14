import type { ContextLensSummary } from "../context-lens.js";
import type { RepositoryClassificationPathResolution } from "../discovery.js";
import type { AssetKind, AssetStatus } from "../model.js";
import type {
  AssetClassificationEvidence,
  AssetGovernanceEvidence,
} from "../types.js";

/** Neutral DTO shared by inspect orchestration and rendering. */
export interface InspectOutline {
  path: string;
  bytes: number;
  lineCount: number;
  frontmatterRange: null | string;
  repositoryBoundary: RepositoryClassificationPathResolution;
  classification: AssetClassificationEvidence;
  governance: AssetGovernanceEvidence | null;
  asset: InspectAssetSummary | null;
  contextLens: ContextLensSummary;
  headings: Array<{
    depth: number;
    line: number;
    range: string;
    text: string;
    preview: string[];
  }>;
  codeFences: Array<{
    endLine: number;
    language: string;
    range: string;
    startLine: number;
  }>;
  links: Array<{
    line: number;
    target: string;
  }>;
}

export interface InspectAssetSummary {
  id: string;
  kind: AssetKind;
  owner?: string;
  status?: AssetStatus;
  tags: string[];
  purpose?: string;
  appliesTo: string[];
  focus: string[];
  expectedOutputs: string[];
  inboundDependents: InspectRelationship[];
  outboundDependencies: InspectRelationship[];
  relationshipChains: InspectRelationshipChain[];
}

export interface InspectRelationship {
  from: string;
  to: string;
  kind: string;
  sourcePath: string;
  resolved: boolean;
  targetId?: string;
  targetKind?: AssetKind;
  targetPath?: string;
}

export interface InspectRelationshipChain {
  skill: string;
  lens: string;
  context: string;
}

export interface InspectSlice {
  path: string;
  range: string;
  text: string;
}
