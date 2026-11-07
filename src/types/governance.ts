import type { Evidence } from "./diagnostics.js";
import type { MetadataFieldEvidence } from "./metadata.js";

/** Declared and effective ownership with explicit provenance. */
export interface AssetOwnership {
  declaredOwner: string | null;
  effectiveOwner: string | null;
  source: "declared" | "inherited" | "unowned" | "ambiguous";
  candidates?: {
    id: string;
    sourcePath: string;
    declaredOwner: string | null;
    references: Evidence[];
    ownerEvidence?: MetadataFieldEvidence;
  }[];
  inheritedFrom?: {
    id: string;
    sourcePath: string;
  };
}

/** Governance provenance kept separate from path classification evidence. */
export interface AssetGovernanceEvidence {
  ownership: AssetOwnership;
  policySource?: "declared" | "inherited" | "missing";
  policyInheritedFrom?: string;
  metadataState?: "declared" | "partial" | "missing" | "not-required";
}
