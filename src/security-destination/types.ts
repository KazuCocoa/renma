export type SourceSpan = {
  startOffset: number;
  endOffset: number;
  startLine?: number;
  endLine?: number;
};

export type LogicalShellCommand = {
  projection: string;
  sourceLineByOffset: number[];
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
};

export type DestinationAnalysis = ShellProjection & {
  input: string;
  candidates: DestinationCandidate[];
  maskedProjection: string;
  operationalDestinations: OperationalDestination[];
};
