import {
  classifyDestinationCandidates,
  maskDestinationCandidates,
} from "./candidates.js";
import {
  projectShellContinuations,
  projectionSpanToSourceSpan,
  unquotedCurlNextSpans,
  unquotedShellSeparatorSpans,
} from "./logical-shell.js";
import type {
  DestinationAnalysis,
  DestinationCandidate,
  NetworkDestination,
  OperationalDestination,
  ShellProjection,
} from "./types.js";

type OffsetSpan = { start: number; end: number };
type Association = Pick<
  OperationalDestination,
  "actionKind" | "tool" | "commandSpan" | "transferSpan"
>;

const DIRECT_AMBIGUOUS_NETWORK_TARGET_PREFIX_RE =
  /\b(?:get|post|put|curl|wget)\b[^.;,!?]{0,160}$/i;
const DIRECT_BARE_NETWORK_TARGET_PREFIX_RE =
  /\b(?:get|post|put|curl|wget|fetch|download)\b[^.;,!?]{0,160}$/i;
const PREPOSITIONAL_NETWORK_TARGET_PREFIX_RE =
  /\b(?:fetch|download)\s+from\s*$|\b(?:upload|send|attach|submit|push|publish|copy)\b[^.;,!?]{0,100}\bto\s*$|\b(?:share|sync)\b[^.;,!?]{0,100}\bwith\s*$/i;
const DIRECT_UPLOAD_TARGET_PREFIX_RE = /\b(?:post|put)\b[^.;,!?]{0,160}$/i;
const PREPOSITIONAL_UPLOAD_TARGET_PREFIX_RE =
  /\b(?:upload|send|attach|submit|push|publish|copy)\b[^.;,!?]{0,100}\bto\s*$|\b(?:share|sync)\b[^.;,!?]{0,100}\bwith\s*$/i;
const CURL_UPLOAD_DATA_OPTION_RE =
  /(?:^|\s)(?:-(?:d|F|T)|--(?:data(?:-ascii|-binary|-raw|-urlencode)?|form(?:-string)?|upload-file)(?=\s|=|$))/;
const CURL_UPLOAD_METHOD_RE =
  /(?:^|\s)-X(?:\s+|=)?(?:POST|PUT|post|put)(?=\s|$)/;
const CLAUSE_BOUNDARY_RE =
  /\b(?:and|then)\b(?=\s+(?:(?:fetch|download|upload|send|share|attach|submit|sync|push|publish|copy|document|explain|describe|record|note|inspect|review|compare|get|post|put|curl|wget|run|validate|read|use)\b|then\b))|[;,]|[.!?](?=\s|$)/gi;
const CLEAR_NETWORK_INSTRUCTION_RE = /\b(?:curl|wget|http|https|webhook)\b/i;
const EXPLICIT_NETWORK_TARGET_RE =
  /\b(?:fetch|get|send|sync|push|upload|download|post|put)\b[^.;!?]{0,100}\b(?:external|remote|network|internet|webhook|api endpoint|server)\b/i;
const EXTERNAL_UPLOAD_RE =
  /\b(upload|send|post|share|attach|submit|sync|push|publish)\b.*\b(external|remote|third[- ]party|pastebin|gist|slack|discord|s3|gcs|cloud|storage|bucket|drive|dropbox|notion|jira|github)\b|\b(post|put)\b.*https?:\/\//i;
const CLOUD_UPLOAD_RE =
  /\b(upload|sync|copy|send|push|publish)\b.*\b(s3|gcs|cloud storage|bucket|drive|dropbox|box|onedrive|blob storage|azure storage|storage)\b/i;

export function analyzeDestinations(input: string): DestinationAnalysis {
  const shellProjection = projectShellContinuations(input);
  return analyzeDestinationsFromProjection(input, shellProjection);
}

export function analyzeDestinationsFromProjection(
  originalInput: string,
  shellProjection: ShellProjection,
): DestinationAnalysis {
  validateShellProjection(originalInput, shellProjection);
  const candidates = classifyDestinationCandidates(shellProjection.projection);
  const maskedProjection = maskDestinationCandidates(
    shellProjection.projection,
    candidates,
  );
  const context = {
    input: originalInput,
    shellProjection,
    candidates,
    maskedProjection,
    clauses: destinationClauseSpans(shellProjection.projection, candidates),
  };
  return {
    input: originalInput,
    ...shellProjection,
    candidates,
    maskedProjection,
    operationalDestinations: [
      ...associatedOperationalDestinations(context, "network"),
      ...associatedOperationalDestinations(context, "upload"),
    ],
  };
}

function validateShellProjection(
  input: string,
  shellProjection: ShellProjection,
): void {
  if (
    shellProjection.sourceOffsetByProjectionOffset.length !==
      shellProjection.projection.length ||
    shellProjection.sourceLineByProjectionOffset.length !==
      shellProjection.projection.length
  ) {
    throw new RangeError("Shell projection mappings must match its length");
  }
  if (
    shellProjection.sourceOffsetByProjectionOffset.some(
      (offset) => offset < 0 || offset >= input.length,
    )
  ) {
    throw new RangeError(
      "Shell projection offset falls outside original input",
    );
  }
}

type AssociationContext = {
  input: string;
  shellProjection: ShellProjection;
  candidates: DestinationCandidate[];
  maskedProjection: string;
  clauses: OffsetSpan[];
};

function associatedOperationalDestinations(
  context: AssociationContext,
  intent: "network" | "upload",
): OperationalDestination[] {
  const associated: OperationalDestination[] = [];
  let previousCandidate: DestinationCandidate | undefined;
  let previousAssociated = false;

  for (const candidate of context.candidates) {
    const canRepresentDestination =
      candidate.destination !== undefined ||
      candidate.explicitTransport !== undefined;
    const clause = context.clauses.find(
      (span) => span.start <= candidate.start && candidate.start < span.end,
    );
    let association: Association | undefined;
    if (canRepresentDestination && clause !== undefined) {
      association =
        intent === "network"
          ? networkDestinationAssociation(context, candidate, clause)
          : uploadDestinationAssociation(context, candidate, clause);
      if (
        association === undefined &&
        previousAssociated &&
        previousCandidate !== undefined &&
        isDestinationListContinuation(
          context.shellProjection.projection,
          previousCandidate,
          candidate,
        )
      ) {
        association = { actionKind: "list-continuation", tool: "prose" };
      }
    }

    if (association !== undefined) {
      associated.push({
        intent,
        candidateKind: candidate.kind,
        actionKind: association.actionKind,
        ...(association.tool === undefined ? {} : { tool: association.tool }),
        ...(candidate.destination === undefined
          ? {}
          : { destination: candidate.destination }),
        candidateSpan: sourceSpan(
          { start: candidate.start, end: candidate.end },
          context,
        ),
        ...(association.commandSpan === undefined
          ? {}
          : { commandSpan: association.commandSpan }),
        ...(association.transferSpan === undefined
          ? {}
          : { transferSpan: association.transferSpan }),
        evaluation:
          candidate.destination === undefined
            ? { kind: "not-evaluated", reason: "unsupported-host" }
            : { kind: "evaluated" },
      });
    }
    previousCandidate = candidate;
    previousAssociated = association !== undefined;
  }

  return associated;
}

function networkDestinationAssociation(
  context: AssociationContext,
  candidate: DestinationCandidate,
  clause: OffsetSpan,
): Association | undefined {
  if (
    candidate.explicitTransport !== undefined ||
    candidate.kind === "network-share"
  ) {
    return { actionKind: "explicit-transport", tool: "prose" };
  }
  if (candidate.destination === undefined) return undefined;
  const prefix = associationPrefix(context.maskedProjection, candidate, clause);
  if (candidate.kind === "bare-host") {
    if (DIRECT_BARE_NETWORK_TARGET_PREFIX_RE.test(prefix)) {
      return { actionKind: "direct-action", tool: networkTool(prefix) };
    }
    if (PREPOSITIONAL_NETWORK_TARGET_PREFIX_RE.test(prefix)) {
      return { actionKind: "prepositional-action", tool: "prose" };
    }
  }
  if (candidate.kind === "ambiguous-dotted-token") {
    if (DIRECT_AMBIGUOUS_NETWORK_TARGET_PREFIX_RE.test(prefix)) {
      return { actionKind: "direct-action", tool: networkTool(prefix) };
    }
    if (PREPOSITIONAL_NETWORK_TARGET_PREFIX_RE.test(prefix)) {
      return { actionKind: "prepositional-action", tool: "prose" };
    }
  }
  return undefined;
}

function uploadDestinationAssociation(
  context: AssociationContext,
  candidate: DestinationCandidate,
  clause: OffsetSpan,
): Association | undefined {
  const curlAssociation = curlUploadAssociation(context, candidate, clause);
  if (curlAssociation !== undefined) {
    return curlAssociation.associated ? curlAssociation.association : undefined;
  }
  const prefix = associationPrefix(context.maskedProjection, candidate, clause);
  if (DIRECT_UPLOAD_TARGET_PREFIX_RE.test(prefix)) {
    return { actionKind: "direct-action", tool: "prose" };
  }
  if (PREPOSITIONAL_UPLOAD_TARGET_PREFIX_RE.test(prefix)) {
    return { actionKind: "prepositional-action", tool: "prose" };
  }
  return undefined;
}

function curlUploadAssociation(
  context: AssociationContext,
  candidate: DestinationCandidate,
  clause: OffsetSpan,
):
  | { associated: false }
  | { associated: true; association: Association }
  | undefined {
  const command = containingShellCommandSpan(
    context.maskedProjection,
    candidate.start,
    clause,
  );
  const prefix = context.maskedProjection.slice(command.start, candidate.start);
  if (!/\bcurl\b/i.test(prefix)) return undefined;
  const transfer = containingCurlTransferSpan(
    context.maskedProjection,
    candidate.start,
    command,
  );
  const transferProjection = context.maskedProjection.slice(
    transfer.start,
    transfer.end,
  );
  const associated =
    CURL_UPLOAD_DATA_OPTION_RE.test(transferProjection) ||
    CURL_UPLOAD_METHOD_RE.test(transferProjection);
  if (!associated) return { associated: false };
  return {
    associated: true,
    association: {
      actionKind: "curl-transfer",
      tool: "curl",
      commandSpan: sourceSpan(command, context),
      transferSpan: sourceSpan(transfer, context),
    },
  };
}

function sourceSpan(span: OffsetSpan, context: AssociationContext) {
  return projectionSpanToSourceSpan(
    span,
    context.shellProjection,
    context.input.length,
  );
}

function associationPrefix(
  projection: string,
  candidate: DestinationCandidate,
  clause: OffsetSpan,
): string {
  return projection
    .slice(clause.start, candidate.start)
    .replace(/[\s`*_([{'"“‘]+$/gu, "");
}

function networkTool(prefix: string): "curl" | "wget" | "prose" {
  if (/\bcurl\b/i.test(prefix)) return "curl";
  if (/\bwget\b/i.test(prefix)) return "wget";
  return "prose";
}

function destinationClauseSpans(
  line: string,
  candidates: DestinationCandidate[],
): OffsetSpan[] {
  const projection = line.split("");
  for (const candidate of candidates) {
    projection.fill(" ", candidate.start, candidate.end);
    const trailingBoundary = candidate.raw.match(/[;,.!?]+$/u)?.[0] ?? "";
    const boundaryStart = candidate.end - trailingBoundary.length;
    for (let index = boundaryStart; index < candidate.end; index += 1) {
      projection[index] = line[index] ?? " ";
    }
  }
  const prose = projection.join("");
  const spans: OffsetSpan[] = [];
  let start = 0;
  for (const boundary of prose.matchAll(CLAUSE_BOUNDARY_RE)) {
    const end = boundary.index ?? 0;
    spans.push({ start, end });
    start = end + (boundary[0]?.length ?? 0);
  }
  spans.push({ start, end: line.length });
  return spans;
}

function isDestinationListContinuation(
  line: string,
  previous: DestinationCandidate,
  candidate: DestinationCandidate,
): boolean {
  const trailingPunctuation = previous.raw.match(/[),.;:!?]+$/u)?.[0] ?? "";
  if (/[.;:!?]/u.test(trailingPunctuation)) return false;
  const trailingComma = previous.raw.match(/,+$/u)?.[0] ?? "";
  const separator = `${trailingComma}${line.slice(previous.end, candidate.start)}`;
  return (
    /^(?:\s|,|\band\b|\bor\b)+$/iu.test(separator) &&
    /,|\b(?:and|or)\b/iu.test(separator)
  );
}

function containingShellCommandSpan(
  projection: string,
  candidateStart: number,
  clause: OffsetSpan,
): OffsetSpan {
  let start = clause.start;
  for (const separator of unquotedShellSeparatorSpans(projection, clause)) {
    if (separator.end <= candidateStart) {
      start = separator.end;
      continue;
    }
    return { start, end: separator.start };
  }
  return { start, end: clause.end };
}

function containingCurlTransferSpan(
  projection: string,
  candidateStart: number,
  command: OffsetSpan,
): OffsetSpan {
  let start = command.start;
  for (const boundary of unquotedCurlNextSpans(projection, command)) {
    if (boundary.end <= candidateStart) {
      start = boundary.end;
      continue;
    }
    return { start, end: boundary.start };
  }
  return { start, end: command.end };
}

export function destinationsForIntent(
  analysis: DestinationAnalysis,
  intent: "network" | "upload",
): NetworkDestination[] {
  const destinations: NetworkDestination[] = [];
  const seen = new Set<string>();
  for (const operational of analysis.operationalDestinations) {
    if (
      operational.intent !== intent ||
      operational.destination === undefined
    ) {
      continue;
    }
    const key = `${operational.destination.host}${operational.destination.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    destinations.push(operational.destination);
  }
  return destinations;
}

export function isNetworkInstruction(analysis: DestinationAnalysis): boolean {
  if (
    analysis.operationalDestinations.some(
      (destination) => destination.intent === "network",
    )
  ) {
    return true;
  }
  return (
    CLEAR_NETWORK_INSTRUCTION_RE.test(analysis.maskedProjection) ||
    EXPLICIT_NETWORK_TARGET_RE.test(analysis.maskedProjection)
  );
}

export function isUploadInstruction(analysis: DestinationAnalysis): boolean {
  return (
    EXTERNAL_UPLOAD_RE.test(analysis.maskedProjection) ||
    CLOUD_UPLOAD_RE.test(analysis.maskedProjection) ||
    analysis.operationalDestinations.some(
      (destination) => destination.intent === "upload",
    )
  );
}
