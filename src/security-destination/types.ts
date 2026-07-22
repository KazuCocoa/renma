export type SourceSpan = {
  /** Offset relative to DestinationAnalysis.input, not the containing artifact. */
  startOffset: number;
  /** Exclusive offset relative to DestinationAnalysis.input. */
  endOffset: number;
  /** One-based absolute artifact line, anchored by sourceBaseLine. */
  startLine?: number;
  /** One-based absolute artifact line, anchored by sourceBaseLine. */
  endLine?: number;
};

export type LogicalShellCommand = {
  input: string;
  shellProjection: ShellProjection;
  memberLineIndexes: number[];
  sourceLines: string[];
};

export type NetworkDestination = {
  raw: string;
  host: string;
  path: string;
};

export type DestinationCandidateKind =
  | "explicit-url"
  | "network-share"
  | "bare-host"
  | "ambiguous-dotted-token"
  | "local-path"
  | "local-filename"
  | "renma-asset-id"
  | "command-file-argument"
  | "unsupported-host";

export type DestinationCandidate = {
  raw: string;
  start: number;
  end: number;
  kind: DestinationCandidateKind;
  explicitTransport?: "http" | "https" | "protocol-relative";
  destination?: NetworkDestination;
};

export type DestinationEvaluation =
  | { kind: "evaluated" }
  | {
      kind: "not-evaluated";
      reason:
        | "unsupported-host"
        | "unsupported-shell-syntax"
        | "ambiguous-token";
    };

export type OperationalDestination = {
  intent: "network" | "upload";
  candidateKind: DestinationCandidateKind;
  actionKind:
    | "explicit-transport"
    | "direct-action"
    | "prepositional-action"
    | "curl-transfer"
    | "list-continuation";
  tool?: "curl" | "wget" | "prose";
  destination?: NetworkDestination;
  candidateSpan: SourceSpan;
  commandSpan?: SourceSpan;
  transferSpan?: SourceSpan;
  evaluation: DestinationEvaluation;
};

export type ShellProjection = {
  projection: string;
  sourceOffsetByProjectionOffset: number[];
  sourceLineByProjectionOffset: number[];
  /** One-based line number in the containing artifact for input offset zero. */
  sourceBaseLine: number;
};

export type DestinationAnalysis = ShellProjection & {
  /** Original bounded source before shell continuations are projected away. */
  input: string;
  candidates: DestinationCandidate[];
  maskedProjection: string;
  operationalDestinations: OperationalDestination[];
};
