import {
  type DestinationAnalysis,
  type ShellProjection,
} from "../security-destination/index.js";
import { projectionSpanToSourceSpan } from "../security-destination/logical-shell.js";
import type { ShellToken } from "./shell.js";
import type {
  SensitiveSinkAnalysis,
  SensitiveSinkKind,
  SensitiveSourceAnalysis,
  SensitiveSourceKind,
} from "./types.js";

type SensitiveClassification = {
  sources: SensitiveSourceAnalysis[];
  sinks: SensitiveSinkAnalysis[];
  supported: boolean;
  fallbackReasons: string[];
};

type CandidatePattern = {
  kind: SensitiveSourceKind;
  pattern: RegExp;
  capture: number;
};

const ENVIRONMENT_API_RE =
  /\bprocess\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["']([^"']+)["']\s*\])/gu;
const SOURCE_PATTERNS: readonly CandidatePattern[] = [
  {
    kind: "environment-file",
    pattern: /(^|[/\s"'`(])(\.env(?:\.[A-Za-z0-9_-]+)?)(?=\b|$)/giu,
    capture: 2,
  },
  {
    kind: "private-key-file",
    pattern:
      /(^|[/\s"'`(])((?:\.?ssh\/)?id_(?:rsa|dsa|ecdsa|ed25519))(?:\b|$)/giu,
    capture: 2,
  },
  {
    kind: "certificate-or-signing-file",
    pattern:
      /(^|[\s"'`(])([^\s"'`()]*(?:\.(?:p12|pfx|pem|key|p8|mobileprovision)))(?=\b|$)/giu,
    capture: 2,
  },
  {
    kind: "cloud-credential-file",
    pattern:
      /(^|[/\s"'`(])((?:\.aws\/credentials|\.kube\/config|kubeconfig|credentials\.json|service-account(?:\.json)?))(?=\b|$)/giu,
    capture: 2,
  },
  {
    kind: "credential-store",
    pattern: /\b(credential (?:directory|folder|store))\b/giu,
    capture: 1,
  },
  {
    kind: "other-sensitive-file",
    pattern: /(^|[/\s"'`(])((?:secrets?\.(?:json|ya?ml|toml|env)))(?=\b|$)/giu,
    capture: 2,
  },
];
const SHELL_LANGUAGE_RE = /^(?:bash|sh|shell|zsh)$/i;
const JAVASCRIPT_LANGUAGE_RE =
  /^(?:javascript|js|jsx|mjs|cjs|typescript|ts|tsx)$/i;
const SOURCE_PRODUCING_COMMAND_RE = /^(?:cat|base64|openssl|security)$/i;
const PROMPT_SINK_RE =
  /\b(copy|paste|attach|include|load|send|provide|put)\b.{0,100}\b(prompt|agent context|context|tool input|request|message)\b/i;
const STDOUT_OR_LOG_RE =
  /\b(print|console\.log|logger|log|dump|echo|output to stdout|write to stdout)\b/i;
const EXTERNAL_DISCLOSURE_RE = /\b(upload|attach|send|share|post|publish)\b/i;
const NEGATED_DISCLOSURE_RE =
  /\b(never|do\s+not|don't|avoid|exclude|skip|omit|must\s+not)\b.{0,80}\b(print|log|dump|echo|output|attach|include|upload|send|share|paste)\b/i;

export function classifySensitiveData(
  input: string,
  tokens: readonly ShellToken[],
  shellProjection: ShellProjection,
  sourceLength: number,
  language: string | undefined,
  destinationAnalysis: DestinationAnalysis,
): SensitiveClassification {
  const sources = classifySources(input, tokens, shellProjection, sourceLength);
  const sinks = classifySinks(
    input,
    tokens,
    shellProjection,
    sourceLength,
    sources,
    destinationAnalysis,
  );
  const fallbackReasons: string[] = [];

  if (hasUnsupportedShellSyntax(input, tokens, language)) {
    fallbackReasons.push("unsupported-shell-syntax");
  }
  if (
    language !== undefined &&
    JAVASCRIPT_LANGUAGE_RE.test(language) &&
    sources.some(({ kind }) => kind !== "environment-variable-api") &&
    !isBoundedJavaScriptSensitiveRead(input)
  ) {
    fallbackReasons.push("unsupported-javascript-data-flow");
  }
  if (
    tokens.some(({ kind, value }) => kind === "operator" && value === "|") &&
    !isSupportedSensitivePipeline(tokens)
  ) {
    fallbackReasons.push("unsupported-pipeline");
  }

  return {
    sources,
    sinks,
    supported: fallbackReasons.length === 0,
    fallbackReasons,
  };
}

function classifySources(
  input: string,
  tokens: readonly ShellToken[],
  shellProjection: ShellProjection,
  sourceLength: number,
): SensitiveSourceAnalysis[] {
  const sources: SensitiveSourceAnalysis[] = [];
  for (const match of input.matchAll(ENVIRONMENT_API_RE)) {
    addSourceMatch(
      sources,
      "environment-variable-api",
      match,
      0,
      shellProjection,
      sourceLength,
    );
  }
  for (const { kind, pattern, capture } of SOURCE_PATTERNS) {
    for (const match of input.matchAll(pattern)) {
      addSourceMatch(
        sources,
        kind,
        match,
        capture,
        shellProjection,
        sourceLength,
      );
    }
  }

  for (const inferred of inferredSensitiveShellSources(tokens)) {
    sources.push({
      kind: inferred.kind,
      raw: inferred.token.raw,
      sourceSpan: projectionSpanToSourceSpan(
        { start: inferred.token.start, end: inferred.token.end },
        shellProjection,
        sourceLength,
      ),
    });
  }
  return dedupeSources(sources);
}

function addSourceMatch(
  target: SensitiveSourceAnalysis[],
  kind: SensitiveSourceKind,
  match: RegExpMatchArray,
  capture: number,
  shellProjection: ShellProjection,
  sourceLength: number,
): void {
  const raw = match[capture];
  if (raw === undefined || match.index === undefined) return;
  const withinMatch = match[0].indexOf(raw);
  const start = match.index + Math.max(0, withinMatch);
  target.push({
    kind,
    raw,
    sourceSpan: projectionSpanToSourceSpan(
      { start, end: start + raw.length },
      shellProjection,
      sourceLength,
    ),
  });
}

function inferredSensitiveShellSources(tokens: readonly ShellToken[]): Array<{
  kind: SensitiveSourceKind;
  token: ShellToken;
}> {
  const inferred: Array<{
    kind: SensitiveSourceKind;
    token: ShellToken;
  }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "word") continue;
    const lower = token.value.toLowerCase();
    if (lower === "security" && tokens[index + 1]?.value === "cms") {
      const inputFlag = tokens.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          candidate.kind === "word" &&
          candidate.value === "-i",
      );
      const input = tokens[inputFlag + 1];
      if (input?.kind === "word") {
        inferred.push({
          kind: "certificate-or-signing-file",
          token: input,
        });
      }
    }
    if (
      sensitiveVariableKind(token.value) !== undefined &&
      isSourcePosition(tokens, index)
    ) {
      inferred.push({
        kind: sensitiveVariableKind(token.value) ?? "other-sensitive-file",
        token,
      });
    }
  }
  return inferred;
}

function sensitiveVariableKind(value: string): SensitiveSourceKind | undefined {
  if (!/\$(?:\{)?[A-Za-z_][A-Za-z0-9_]*(?:\})?/u.test(value)) {
    return undefined;
  }
  if (
    /(?:^|[_${])(PROFILE|PROVISION|CERT|SIGNING)[A-Za-z0-9_]*_PATH\b/i.test(
      value,
    )
  ) {
    return "certificate-or-signing-file";
  }
  if (/(?:^|[_${])(?:PRIVATE_?KEY|SSH_?KEY)[A-Za-z0-9_]*_PATH\b/i.test(value)) {
    return "private-key-file";
  }
  if (/(?:^|[_${])(?:CREDENTIAL|SECRET)[A-Za-z0-9_]*_PATH\b/i.test(value)) {
    return "other-sensitive-file";
  }
  return undefined;
}

function isSourcePosition(
  tokens: readonly ShellToken[],
  index: number,
): boolean {
  const previous = tokens[index - 1];
  if (
    previous?.kind === "word" &&
    /^(?:-i|--in|--input|--upload-file|-T)$/i.test(previous.value)
  ) {
    return true;
  }
  if (tokens[index]?.value.startsWith("@")) return true;
  const command = tokens
    .slice(0, index)
    .findLast(({ kind }) => kind === "word");
  return (
    command !== undefined && SOURCE_PRODUCING_COMMAND_RE.test(command.value)
  );
}

function classifySinks(
  input: string,
  tokens: readonly ShellToken[],
  shellProjection: ShellProjection,
  sourceLength: number,
  sources: readonly SensitiveSourceAnalysis[],
  destinationAnalysis: DestinationAnalysis,
): SensitiveSinkAnalysis[] {
  if (sources.length === 0) return [];
  const sinks: SensitiveSinkAnalysis[] = [];

  for (const destination of destinationAnalysis.operationalDestinations) {
    const kind: SensitiveSinkKind =
      destination.intent === "upload" ? "external-upload" : "network";
    const span =
      destination.transferSpan ??
      destination.commandSpan ??
      destination.candidateSpan;
    sinks.push({
      kind,
      raw:
        destination.destination?.raw ??
        input.slice(span.startOffset, span.endOffset),
      sourceSpan: span,
    });
  }
  if (!NEGATED_DISCLOSURE_RE.test(input)) {
    addPatternSink(
      sinks,
      "prompt-or-context",
      input,
      PROMPT_SINK_RE,
      shellProjection,
      sourceLength,
    );
    addPatternSink(
      sinks,
      "stdout-or-log",
      input,
      STDOUT_OR_LOG_RE,
      shellProjection,
      sourceLength,
    );
    addPatternSink(
      sinks,
      "external-upload",
      input,
      EXTERNAL_DISCLOSURE_RE,
      shellProjection,
      sourceLength,
    );
  }

  const redirections = outputRedirections(tokens);
  for (const redirection of redirections) {
    const target = redirection.target;
    const span = projectionSpanToSourceSpan(
      { start: target.start, end: target.end },
      shellProjection,
      sourceLength,
    );
    sinks.push({
      kind: /\.(?:log|out)(?:\b|$)/i.test(target.value)
        ? "stdout-or-log"
        : "local-file",
      raw: target.raw,
      sourceSpan: span,
    });
  }

  const pipeIndex = tokens.findIndex(
    ({ kind, value }) => kind === "operator" && value === "|",
  );
  if (pipeIndex >= 0) {
    const consumer = tokens[pipeIndex + 1];
    sinks.push({
      kind:
        consumer?.kind === "word" &&
        /^(?:cat|tee|logger)$/i.test(consumer.value)
          ? "stdout-or-log"
          : "unknown",
      raw: consumer?.raw ?? "|",
      ...(consumer === undefined
        ? {}
        : {
            sourceSpan: projectionSpanToSourceSpan(
              { start: consumer.start, end: consumer.end },
              shellProjection,
              sourceLength,
            ),
          }),
    });
  }

  if (
    pipeIndex < 0 &&
    hasUnredirectedSourceProducingSegment(tokens) &&
    !sinks.some(({ kind }) =>
      ["external-upload", "network", "prompt-or-context"].includes(kind),
    )
  ) {
    sinks.push({ kind: "stdout-or-log", raw: "stdout" });
  }

  if (sinks.length === 0) {
    const copyDestination = localCopyDestination(tokens);
    if (copyDestination !== undefined) {
      sinks.push({
        kind: "local-file",
        raw: copyDestination.raw,
        sourceSpan: projectionSpanToSourceSpan(
          { start: copyDestination.start, end: copyDestination.end },
          shellProjection,
          sourceLength,
        ),
      });
    } else {
      sinks.push({ kind: "unknown", raw: "unclassified sink" });
    }
  }
  return dedupeSinks(sinks);
}

function addPatternSink(
  sinks: SensitiveSinkAnalysis[],
  kind: SensitiveSinkKind,
  input: string,
  pattern: RegExp,
  shellProjection: ShellProjection,
  sourceLength: number,
): void {
  const match = input.match(pattern);
  if (match?.index === undefined) return;
  sinks.push({
    kind,
    raw: match[0],
    sourceSpan: projectionSpanToSourceSpan(
      { start: match.index, end: match.index + match[0].length },
      shellProjection,
      sourceLength,
    ),
  });
}

function outputRedirections(
  tokens: readonly ShellToken[],
): Array<{ operator: ShellToken; target: ShellToken }> {
  const redirections: Array<{ operator: ShellToken; target: ShellToken }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const operator = tokens[index];
    if (
      operator?.kind !== "operator" ||
      (operator.value !== ">" && operator.value !== ">>")
    ) {
      continue;
    }
    const descriptor = tokens[index - 1];
    if (
      descriptor?.kind === "word" &&
      descriptor.value === "2" &&
      descriptor.end === operator.start
    ) {
      continue;
    }
    const target = tokens[index + 1];
    if (target?.kind === "word") redirections.push({ operator, target });
  }
  return redirections;
}

function localCopyDestination(
  tokens: readonly ShellToken[],
): ShellToken | undefined {
  const commandIndex = tokens.findIndex(
    ({ kind, value }) => kind === "word" && /^(?:cp|mv)$/i.test(value),
  );
  if (commandIndex < 0) return undefined;
  const argumentsAfter = tokens
    .slice(commandIndex + 1)
    .filter((token) => token.kind === "word" && !token.value.startsWith("-"));
  return argumentsAfter.length >= 2
    ? argumentsAfter[argumentsAfter.length - 1]
    : undefined;
}

function hasUnredirectedSourceProducingSegment(
  tokens: readonly ShellToken[],
): boolean {
  let segmentStart = 0;
  for (let index = 0; index <= tokens.length; index += 1) {
    const token = tokens[index];
    const boundary =
      token === undefined ||
      (token.kind === "operator" &&
        (token.value === "&&" || token.value === ";"));
    if (!boundary) continue;
    const segment = tokens.slice(segmentStart, index);
    const sourceProducing = segment.some(
      ({ kind, value }) =>
        kind === "word" && SOURCE_PRODUCING_COMMAND_RE.test(value),
    );
    const outputRedirected = outputRedirections(segment).length > 0;
    if (sourceProducing && !outputRedirected) return true;
    segmentStart = index + 1;
  }
  return false;
}

function hasUnsupportedShellSyntax(
  input: string,
  tokens: readonly ShellToken[],
  language: string | undefined,
): boolean {
  const shellLike =
    language === undefined ||
    SHELL_LANGUAGE_RE.test(language) ||
    tokens.some(
      ({ kind, value }) =>
        kind === "word" &&
        /^(?:npm|pnpm|yarn|curl|cat|cp|mv|base64|openssl|security)$/i.test(
          value,
        ),
    );
  if (!shellLike) return false;
  return (
    /(?:\$\(|<\(|>\(|`)/u.test(input) ||
    tokens.some(
      ({ kind, value }) =>
        kind === "operator" &&
        (value === "<<" || value === "||" || value === "&" || value === "&>"),
    ) ||
    tokens.some(
      ({ kind, value }) =>
        kind === "operator" &&
        (value === ">" || value === ">>") &&
        !hasRedirectionTarget(tokens, value),
    )
  );
}

function hasRedirectionTarget(
  tokens: readonly ShellToken[],
  operatorValue: string,
): boolean {
  return tokens.some(
    (token, index) =>
      token.kind === "operator" &&
      token.value === operatorValue &&
      tokens[index + 1]?.kind === "word",
  );
}

function isSupportedSensitivePipeline(tokens: readonly ShellToken[]): boolean {
  const pipes = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token.kind === "operator" && token.value === "|");
  if (pipes.length !== 1) return false;
  const pipe = pipes[0];
  if (pipe === undefined) return false;
  const consumer = tokens[pipe.index + 1];
  return (
    consumer?.kind === "word" && /^(?:cat|tee|logger)$/i.test(consumer.value)
  );
}

function isBoundedJavaScriptSensitiveRead(input: string): boolean {
  return /\breadFileSync\s*\(\s*["'][^"']+["']\s*(?:,\s*["'][^"']+["']\s*)?\)/u.test(
    input,
  );
}

function dedupeSources(
  sources: readonly SensitiveSourceAnalysis[],
): SensitiveSourceAnalysis[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.kind}:${source.sourceSpan.startOffset}:${source.sourceSpan.endOffset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeSinks(
  sinks: readonly SensitiveSinkAnalysis[],
): SensitiveSinkAnalysis[] {
  const seen = new Set<string>();
  return sinks.filter((sink) => {
    const key = `${sink.kind}:${sink.sourceSpan?.startOffset ?? -1}:${sink.sourceSpan?.endOffset ?? -1}:${sink.raw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
