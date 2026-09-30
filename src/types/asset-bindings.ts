export interface AssetBindingFile {
  readonly path: string;
  /** Original UTF-8 bytes, including any BOM and CRLF. Invalid UTF-8 is rejected. */
  readonly bytes: Uint8Array;
}
export type BindingAssetKind = "skill" | "context" | "context_lens";
export type BindingRelationshipKind =
  | "requires_context"
  | "optional_context"
  | "requires_lens"
  | "optional_lens"
  | "requires_skill"
  | "optional_skill"
  | "applies_to";
export interface AssetBindingLocation {
  path: string;
  sha256: string;
  /** Half-open UTF-16 code-unit offsets in the original decoded file. */
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  raw: string;
}
export interface AssetBindingIdentity {
  path: string;
  kind: string;
  id: string | null;
  version: string | null;
  evidence: AssetBindingLocation;
  idEvidence: AssetBindingLocation;
  versionEvidence: AssetBindingLocation;
}
export interface AssetBindingRelationship {
  relationship: BindingRelationshipKind;
  target: string;
  declarationIndex: number;
  targetKind: BindingAssetKind;
  sourceValid: boolean;
  evidence: AssetBindingLocation;
}
export interface AssetBindingReference {
  alias: string;
  evidence: AssetBindingLocation;
  /** Only present for supported inline link destinations. */
  destination?: AssetBindingLocation;
}
export interface AssetBindingDiagnostic {
  code: string;
  message: string;
  evidence: AssetBindingLocation;
  entryIndex?: number;
  phase: "declaration" | "local-satisfaction";
}
export interface NormalizedAssetBinding {
  /** Declaration is valid and the local identity/kind/optional-release comparison matched; never verifies Git provenance. */
  satisfied?: boolean;
  alias: string;
  target: string;
  /** Exact declared release, when supplied. At least version or ref is required. */
  version?: string;
  /** Declared Git ref; never looked up or compared with a local release. */
  ref?: string;
  /** Externally supplied resolution evidence; Renma does not verify the revision. */
  resolved?: { commit: string };
  entryIndex: number;
  evidence: AssetBindingLocation;
  relationships: AssetBindingRelationship[];
  declarationValid: boolean;
  satisfaction: AssetBindingSatisfaction;
}
export interface AssetBindingSatisfaction {
  /** Local identity/kind and optional release comparison; refs and commits are not verified. */
  status:
    | "matched"
    | "missing"
    | "ambiguous"
    | "kind-mismatch"
    | "target-version-invalid"
    | "version-mismatch";
  candidates: AssetBindingIdentity[];
}
export interface AssetBindingDocument {
  identity: AssetBindingIdentity;
  relationships: AssetBindingRelationship[];
  bindings: NormalizedAssetBinding[];
  references: AssetBindingReference[];
  diagnostics: AssetBindingDiagnostic[];
  declarationValid: boolean;
}
export interface AssetBindingReport {
  schemaVersion: "renma.asset-bindings.v1";
  offsetUnit: "utf16-code-unit";
  documents: AssetBindingDocument[];
}
