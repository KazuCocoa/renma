import {
  analyzeDestinations,
  destinationsForIntent,
  isNetworkInstruction,
  isUploadInstruction,
} from "./association.js";
import { classifyDestinationCandidates } from "./candidates.js";
import type { DestinationAnalysis, NetworkDestination } from "./types.js";

export { analyzeDestinations, isNetworkInstruction, isUploadInstruction };
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
  SourceSpan,
} from "./types.js";

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
