import {
  analyzeDestinations,
  analyzeDestinationsFromProjection,
  destinationsForIntent,
  isNetworkInstruction,
  isUploadInstruction,
} from "./association.js";
import { classifyDestinationCandidates } from "./candidates.js";
import type {
  DestinationAnalysis,
  LogicalShellCommand,
  NetworkDestination,
  ShellProjection,
} from "./types.js";

export {
  analyzeDestinations,
  analyzeDestinationsFromProjection,
  isNetworkInstruction,
  isUploadInstruction,
};
export { classifyDestinationCandidates };
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

export function associatedNetworkDestinations(
  input: string,
): NetworkDestination[] {
  return networkDestinations(analyzeDestinations(input));
}

export function associatedUploadDestinations(
  input: string,
): NetworkDestination[] {
  return uploadDestinations(analyzeDestinations(input));
}
