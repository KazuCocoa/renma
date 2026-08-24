import {
  analyzeDestinationsFromProjection,
  destinationsForIntent,
} from "./association.js";
import type {
  DestinationAnalysis,
  LogicalShellCommand,
  ShellProjection,
} from "./types.js";

export {
  analyzeDestinations,
  isNetworkInstruction,
  isUploadInstruction,
} from "./association.js";
export { analyzeDestinationsFromProjection };
export { classifyDestinationCandidates } from "./candidates.js";
export {
  logicalShellCommandEvidence,
  logicalShellCommands,
  unquotedCurlNextSpans,
  unquotedShellSeparatorSpans,
} from "./logical-shell.js";
export { unapprovedDestinations } from "./matching.js";
export type {
  DestinationAnalysis,
  DestinationCandidate,
  DestinationCandidateKind,
  DestinationEvaluation,
  LogicalShellCommand,
  NetworkDestination,
  OperationalDestination,
  ResolvedDestinationEvidence,
  ShellProjection,
  SourceSpan,
} from "./types.js";

type ProjectionAnalyzer = (
  originalInput: string,
  shellProjection: ShellProjection,
) => DestinationAnalysis;

export function analyzeLogicalShellCommands(
  commands: readonly LogicalShellCommand[],
  analyzer: ProjectionAnalyzer = analyzeDestinationsFromProjection,
): Map<LogicalShellCommand, DestinationAnalysis> {
  return new Map(
    commands.map((command) => [
      command,
      analyzer(command.input, command.shellProjection),
    ]),
  );
}

export function networkDestinations(analysis: DestinationAnalysis) {
  return destinationsForIntent(analysis, "network");
}

export function uploadDestinations(analysis: DestinationAnalysis) {
  return destinationsForIntent(analysis, "upload");
}
