import {
  resolveShellExecutableWords,
  shellCommandWordTokens,
  type ShellExecutableResolution,
} from "./shell-command.js";
import { tokenizeBoundedShell, type ShellToken } from "./shell.js";
import {
  activeShellContinuation,
  projectShellContinuations,
} from "../security-destination/logical-shell.js";

export type BoundedGeneratedScriptExecution = {
  path: string;
  shellText: string;
  producerSpan: Readonly<{ start: number; end: number }>;
  consumerSpan: Readonly<{ start: number; end: number }>;
};

type Segment = {
  start: number;
  end: number;
  boundaryAfter?: string;
  text: string;
};

type StaticPath = {
  absolute: boolean;
  key: string;
};

type StaticOutput = {
  shellText: string;
  byteLength: number;
  producerSpan: { start: number; end: number };
};

type GeneratedFiles = Map<string, StaticOutput[]>;

export const MAX_GENERATED_SCRIPT_BYTES = 64 * 1024;
export const MAX_GENERATED_SCRIPT_COMMANDS = 256;
export const MAX_TRACKED_GENERATED_FILES = 64;
export const MAX_GENERATED_SCRIPT_EXECUTIONS = 64;
export const MAX_GENERATED_SCRIPT_ALTERNATIVES = 8;

type FileWrite = {
  mode: "append" | "overwrite";
  path: StaticPath;
};

type BoundedShellEffects = {
  cwdMayChange: boolean;
  exactMutatedPaths: Set<string>;
  unknownFileMutation: boolean;
};

type ParsedSegment = {
  resolution: ShellExecutableResolution;
  stdoutRedirected: boolean;
  stdoutWrite?: FileWrite;
  redirectionEffects: BoundedShellEffects;
  wordTokens: ShellToken[];
  words: string[];
};

type TeeSummary = {
  effects: BoundedShellEffects;
  writes: FileWrite[];
};

const COMMAND_BOUNDARIES = new Set([";", "|", "||", "&&", "&"]);
const OUTPUT_REDIRECTION_OPERATORS = new Set([">", ">>", "&>"]);
const SHELL_EXECUTABLES = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);
const PROVEN_NON_MUTATING_EXECUTABLES = new Set([
  ":",
  "[",
  "cat",
  "echo",
  "false",
  "printf",
  "pwd",
  "test",
  "true",
]);

/**
 * Correlate only statically reconstructed shell text written to an exact path
 * and consumed later in the same bounded shell input. Facts survive only
 * modeled non-mutating operations and are invalidated by bounded file or cwd
 * effects. No filesystem state, variables, symlinks, or cross-input flow is
 * resolved.
 */
export function boundedGeneratedScriptExecutions(
  input: string,
): readonly BoundedGeneratedScriptExecution[] {
  const tokenization = tokenizeBoundedShell(input);
  if (!tokenization.supported) return [];

  const segments = commandSegments(input, tokenization.tokens);
  let files: GeneratedFiles = new Map();
  const executions: BoundedGeneratedScriptExecution[] = [];
  let pipelineOutput: StaticOutput | undefined;
  let operandEntry = cloneFiles(files);
  let operandEffects = emptyEffects();
  let pendingOrSuccess: GeneratedFiles | undefined;

  for (const [index, segment] of segments.entries()) {
    const receivesPipeline = segments[index - 1]?.boundaryAfter === "|";
    if (!receivesPipeline) {
      pipelineOutput = undefined;
      operandEntry = cloneFiles(files);
      operandEffects = emptyEffects();
    }

    const parsed = parseSegment(segment.text);
    if (parsed === undefined) {
      const effects = unknownEffects();
      applyInvalidations(files, effects);
      mergeEffects(operandEffects, effects);
      pipelineOutput = undefined;
      const successfulFiles = cloneFiles(files);
      files = branchExitFiles(
        files,
        operandEntry,
        operandEffects,
        segment.boundaryAfter,
      );
      if (segment.boundaryAfter === "||") {
        pendingOrSuccess =
          pendingOrSuccess === undefined
            ? successfulFiles
            : mergeMayFiles(pendingOrSuccess, successfulFiles);
      } else if (pendingOrSuccess !== undefined) {
        files = mergeMayFiles(pendingOrSuccess, files);
        pendingOrSuccess = undefined;
      }
      continue;
    }

    const produced = staticLiteralOutput(parsed, segment);
    const successfulRedirectionEffects = effectsPreservingKnownAppends(
      parsed.redirectionEffects,
      parsed.stdoutWrite === undefined ? [] : [parsed.stdoutWrite],
      produced,
    );
    applyInvalidations(files, successfulRedirectionEffects);
    mergeEffects(operandEffects, parsed.redirectionEffects);

    const tee = teeSummary(parsed);
    if (tee !== undefined) {
      applyInvalidations(
        files,
        effectsPreservingKnownAppends(tee.effects, tee.writes, pipelineOutput),
      );
      mergeEffects(operandEffects, tee.effects);
    }

    if (!receivesPipeline) {
      const consumerPath = staticScriptConsumerPath(parsed);
      const outputs =
        consumerPath === undefined ? undefined : files.get(consumerPath.key);
      if (consumerPath !== undefined && outputs !== undefined) {
        for (const output of outputs) {
          if (executions.length >= MAX_GENERATED_SCRIPT_EXECUTIONS) break;
          executions.push({
            path: consumerPath.key,
            shellText: output.shellText,
            producerSpan: Object.freeze({ ...output.producerSpan }),
            consumerSpan: Object.freeze({
              start: segment.start,
              end: segment.end,
            }),
          });
        }
      }
    }

    if (tee === undefined) {
      const effects = commandEffects(parsed);
      applyInvalidations(files, effects);
      mergeEffects(operandEffects, effects);
    }

    if (produced !== undefined) {
      if (!parsed.stdoutRedirected) {
        pipelineOutput = produced;
      } else {
        if (parsed.stdoutWrite !== undefined) {
          applyFileWrite(files, parsed.stdoutWrite, produced);
        }
        pipelineOutput = undefined;
      }
    } else if (receivesPipeline && tee !== undefined) {
      for (const write of tee.writes) {
        applyFileWrite(files, write, pipelineOutput);
      }
      if (parsed.stdoutRedirected) {
        if (parsed.stdoutWrite !== undefined) {
          applyFileWrite(files, parsed.stdoutWrite, pipelineOutput);
        }
        pipelineOutput = undefined;
      }
    } else if (
      receivesPipeline &&
      pipelineOutput !== undefined &&
      isBareCatCommand(parsed) &&
      !parsed.stdoutRedirected
    ) {
      // A bare cat preserves the proven literal pipeline bytes.
    } else {
      pipelineOutput = undefined;
    }

    const successfulFiles = cloneFiles(files);
    files = branchExitFiles(
      files,
      operandEntry,
      operandEffects,
      segment.boundaryAfter,
    );
    if (segment.boundaryAfter === "||") {
      pendingOrSuccess =
        pendingOrSuccess === undefined
          ? successfulFiles
          : mergeMayFiles(pendingOrSuccess, successfulFiles);
    } else if (pendingOrSuccess !== undefined) {
      files = mergeMayFiles(pendingOrSuccess, files);
      pendingOrSuccess = undefined;
    }
  }

  return Object.freeze(executions.map((execution) => Object.freeze(execution)));
}

/** Project reconstructed bytes into independently classifiable shell commands. */
export function generatedLogicalShellCommands(shellText: string): string[] {
  if (utf8ByteLength(shellText) > MAX_GENERATED_SCRIPT_BYTES) {
    return [];
  }
  const physicalLines = shellText.split(/\r?\n/u);
  const commands: string[] = [];
  let index = 0;

  while (index < physicalLines.length) {
    const first = physicalLines[index] ?? "";
    if (first.trim().length === 0 || first.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }

    const lines = [first];
    let quote: "'" | '"' | undefined;
    let cursor = index;
    while (cursor < physicalLines.length) {
      const continuation = activeShellContinuation(
        physicalLines[cursor] ?? "",
        quote,
      );
      if (!continuation.active || cursor + 1 >= physicalLines.length) break;
      quote = continuation.quote;
      cursor += 1;
      lines.push(physicalLines[cursor] ?? "");
    }

    const projection = projectShellContinuations(
      lines.join("\n"),
    ).projection.trim();
    if (projection.length > 0) {
      const tokenization = tokenizeBoundedShell(projection);
      if (
        !tokenization.supported ||
        tokenization.tokens.some(
          ({ kind, value }) =>
            kind === "operator" && (value === "<<" || value === "<<-"),
        )
      ) {
        return [];
      }
      if (commands.length >= MAX_GENERATED_SCRIPT_COMMANDS) break;
      commands.push(projection);
    }
    index = cursor + 1;
  }

  return commands;
}

function commandSegments(
  input: string,
  tokens: readonly ShellToken[],
): Segment[] {
  const segments: Segment[] = [];
  let start = 0;

  for (const token of tokens) {
    if (token.kind !== "operator" || !COMMAND_BOUNDARIES.has(token.value)) {
      continue;
    }
    segments.push({
      start,
      end: token.start,
      boundaryAfter: token.value,
      text: input.slice(start, token.start),
    });
    start = token.end;
  }
  segments.push({
    start,
    end: input.length,
    text: input.slice(start),
  });
  return segments;
}

function parseSegment(segment: string): ParsedSegment | undefined {
  const wordTokens = shellCommandWordTokens(segment);
  const tokenization = tokenizeBoundedShell(segment);
  if (wordTokens === undefined || !tokenization.supported) return undefined;

  const words = wordTokens.map(({ value }) => value);
  const resolution = resolveShellExecutableWords(words);
  const redirectionEffects = emptyEffects();
  let stdoutRedirected = false;
  let stdoutWrite: FileWrite | undefined;

  for (const [index, token] of tokenization.tokens.entries()) {
    if (
      token.kind !== "operator" ||
      !OUTPUT_REDIRECTION_OPERATORS.has(token.value)
    ) {
      continue;
    }
    const target = tokenization.tokens[index + 1];
    if (target?.kind !== "word") {
      redirectionEffects.unknownFileMutation = true;
      continue;
    }
    const previous = tokenization.tokens[index - 1];
    const descriptor =
      previous?.kind === "word" &&
      /^\d+$/u.test(previous.value) &&
      previous.end === token.start
        ? Number(previous.value)
        : undefined;
    const path = normalizedStaticPath(target);
    if (path === undefined) {
      redirectionEffects.unknownFileMutation = true;
    } else {
      redirectionEffects.exactMutatedPaths.add(path.key);
    }
    const redirectsStdout =
      token.value === "&>" || descriptor === undefined || descriptor === 1;
    if (redirectsStdout) {
      stdoutRedirected = true;
      stdoutWrite =
        path === undefined
          ? undefined
          : {
              mode: token.value === ">>" ? "append" : "overwrite",
              path,
            };
    }
  }

  return {
    resolution,
    stdoutRedirected,
    ...(stdoutWrite === undefined ? {} : { stdoutWrite }),
    redirectionEffects,
    wordTokens,
    words,
  };
}

function staticLiteralOutput(
  parsed: ParsedSegment,
  segment: Segment,
): StaticOutput | undefined {
  if (!parsed.resolution.executionProven) return undefined;
  const { effectiveExecutable, effectiveIndex } = parsed.resolution;
  const args = parsed.wordTokens.slice(effectiveIndex + 1);
  let shellText: string | undefined;

  if (effectiveExecutable === "echo") shellText = staticEchoOutput(args);
  else if (effectiveExecutable === "printf")
    shellText = staticPrintfOutput(args);
  if (shellText === undefined) return undefined;

  return {
    shellText,
    byteLength: utf8ByteLength(shellText),
    producerSpan: { start: segment.start, end: segment.end },
  };
}

function staticEchoOutput(args: readonly ShellToken[]): string | undefined {
  let index = 0;
  if (args[index]?.value === "-n") index += 1;
  if ((args[index]?.value ?? "").startsWith("-")) return undefined;
  const values = args.slice(index).map(staticWordValue);
  if (values.some((value) => value === undefined)) return undefined;
  return `${values.join(" ")}${index === 0 ? "\n" : ""}`;
}

function staticPrintfOutput(args: readonly ShellToken[]): string | undefined {
  const index = args[0]?.value === "--" ? 1 : 0;
  if ((args[index]?.value ?? "").startsWith("-")) return undefined;
  const format = args[index];
  if (format === undefined) return undefined;
  const staticFormat = staticWordValue(format);
  const values = args.slice(index + 1).map(staticWordValue);
  if (
    staticFormat === undefined ||
    values.some((value) => value === undefined)
  ) {
    return undefined;
  }
  return renderStaticPrintf(staticFormat, values as string[]);
}

function renderStaticPrintf(
  format: string,
  values: readonly string[],
): string | undefined {
  let output = "";
  let outputBytes = 0;
  let valueIndex = 0;
  let repeats = 0;
  const append = (addition: string): boolean => {
    outputBytes += utf8ByteLength(addition);
    if (outputBytes > MAX_GENERATED_SCRIPT_BYTES) return false;
    output += addition;
    return true;
  };

  do {
    let conversions = 0;
    for (let index = 0; index < format.length; index += 1) {
      const character = format[index] ?? "";
      if (character === "%") {
        const next = format[index + 1];
        if (next === "%") {
          if (!append("%")) return undefined;
          index += 1;
          continue;
        }
        if (next !== "s") return undefined;
        if (!append(values[valueIndex] ?? "")) return undefined;
        valueIndex += 1;
        conversions += 1;
        index += 1;
        continue;
      }
      if (character !== "\\") {
        if (!append(character)) return undefined;
        continue;
      }
      const escape = staticPrintfEscape(format, index);
      if (escape === undefined) return undefined;
      if (!append(escape.value)) return undefined;
      index = escape.end - 1;
    }
    repeats += 1;
    if (conversions === 0) break;
  } while (valueIndex < values.length && repeats <= values.length);

  return output;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function staticPrintfEscape(
  format: string,
  start: number,
): { value: string; end: number } | undefined {
  const next = format[start + 1];
  const common: Readonly<Record<string, string>> = {
    "\\": "\\",
    a: "\u0007",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  };
  if (next !== undefined && common[next] !== undefined) {
    return { value: common[next], end: start + 2 };
  }
  const octal = /^0[0-7]{1,3}/u.exec(format.slice(start + 1))?.[0];
  if (octal !== undefined) {
    return {
      value: String.fromCodePoint(Number.parseInt(octal.slice(1), 8)),
      end: start + 1 + octal.length,
    };
  }
  const hex = /^x[0-9A-Fa-f]{1,2}/u.exec(format.slice(start + 1))?.[0];
  if (hex !== undefined) {
    return {
      value: String.fromCodePoint(Number.parseInt(hex.slice(1), 16)),
      end: start + 1 + hex.length,
    };
  }
  return undefined;
}

function teeSummary(parsed: ParsedSegment): TeeSummary | undefined {
  if (
    !parsed.resolution.executionProven ||
    parsed.resolution.effectiveExecutable !== "tee"
  ) {
    return undefined;
  }
  const effects = emptyEffects();
  const writes: FileWrite[] = [];
  let mode: FileWrite["mode"] = "overwrite";
  let options = true;
  let supported = true;

  for (const token of parsed.wordTokens.slice(
    parsed.resolution.effectiveIndex + 1,
  )) {
    const value = staticWordValue(token);
    if (value === undefined) {
      effects.unknownFileMutation = true;
      continue;
    }
    if (options && value === "--") {
      options = false;
      continue;
    }
    if (options && (value === "-a" || value === "--append")) {
      mode = "append";
      continue;
    }
    if (
      options &&
      (value === "-i" ||
        value === "--ignore-interrupts" ||
        value === "-p" ||
        value === "--output-error")
    ) {
      continue;
    }
    if (options && value.startsWith("-")) {
      effects.unknownFileMutation = true;
      supported = false;
      continue;
    }
    options = false;
    const path = normalizeStaticPath(value);
    if (path === undefined) {
      effects.unknownFileMutation = true;
      continue;
    }
    effects.exactMutatedPaths.add(path.key);
    writes.push({ mode, path });
  }
  return { effects, writes: supported ? writes : [] };
}

function staticScriptConsumerPath(
  parsed: ParsedSegment,
): StaticPath | undefined {
  const {
    effectiveExecutable,
    effectiveIndex,
    executionCwdMayChange,
    executionRootMayChange,
    executionProven,
  } = parsed.resolution;
  if (!executionProven) return undefined;
  if (
    effectiveExecutable === undefined ||
    (!SHELL_EXECUTABLES.has(effectiveExecutable) &&
      effectiveExecutable !== "source" &&
      effectiveExecutable !== ".")
  ) {
    return undefined;
  }
  if (
    (effectiveExecutable === "source" || effectiveExecutable === ".") &&
    !canInvokeCurrentShellBuiltin(parsed.resolution)
  ) {
    return undefined;
  }

  let index = effectiveIndex + 1;
  if (parsed.words[index] === "--") index += 1;
  else if ((parsed.words[index] ?? "").startsWith("-")) return undefined;
  const token = parsed.wordTokens[index];
  if (token === undefined) return undefined;
  const path = normalizedStaticPath(token);
  if (
    path === undefined ||
    (!path.absolute && executionCwdMayChange) ||
    (path.absolute && executionRootMayChange) ||
    ((effectiveExecutable === "source" || effectiveExecutable === ".") &&
      !token.value.includes("/"))
  ) {
    return undefined;
  }
  return path;
}

function commandEffects(parsed: ParsedSegment): BoundedShellEffects {
  if (
    !parsed.resolution.executionProven ||
    parsed.resolution.executionCwdMayChange ||
    parsed.resolution.executionRootMayChange
  ) {
    return unknownEffects();
  }
  const executable = parsed.resolution.effectiveExecutable;
  if (executable === undefined) return unknownEffects();
  if (PROVEN_NON_MUTATING_EXECUTABLES.has(executable)) return emptyEffects();
  if (
    (executable === "cd" || executable === "pushd" || executable === "popd") &&
    canInvokeCurrentShellBuiltin(parsed.resolution)
  ) {
    return { ...emptyEffects(), cwdMayChange: true };
  }

  const operands = parsed.wordTokens.slice(
    parsed.resolution.effectiveIndex + 1,
  );
  if (executable === "cp" || executable === "install") {
    return twoOperandMutationEffects(operands, false);
  }
  if (executable === "mv") return twoOperandMutationEffects(operands, true);
  if (executable === "rm" || executable === "unlink") {
    return removalEffects(operands, executable === "unlink");
  }
  if (executable === "truncate") return truncateEffects(operands);
  if (executable === "sed") return inPlaceSedEffects(operands);
  return unknownEffects();
}

function twoOperandMutationEffects(
  tokens: readonly ShellToken[],
  mutatesSource: boolean,
): BoundedShellEffects {
  const values = tokens[0]?.value === "--" ? tokens.slice(1) : tokens;
  if (
    values.length !== 2 ||
    values.some(({ value }) => value.startsWith("-"))
  ) {
    return unknownEffects();
  }
  const paths = values.map(normalizedStaticPath);
  if (paths.some((path) => path === undefined)) return unknownEffects();
  return effectsForPaths(
    mutatesSource
      ? (paths as StaticPath[])
      : [(paths as StaticPath[])[1] as StaticPath],
  );
}

function removalEffects(
  tokens: readonly ShellToken[],
  exactlyOne: boolean,
): BoundedShellEffects {
  let options = true;
  const paths: StaticPath[] = [];
  for (const token of tokens) {
    const value = staticWordValue(token);
    if (value === undefined) return unknownEffects();
    if (options && value === "--") {
      options = false;
      continue;
    }
    if (options && value.startsWith("-")) continue;
    options = false;
    const path = normalizeStaticPath(value);
    if (path === undefined) return unknownEffects();
    paths.push(path);
  }
  if (paths.length === 0 || (exactlyOne && paths.length !== 1)) {
    return unknownEffects();
  }
  return effectsForPaths(paths);
}

function truncateEffects(tokens: readonly ShellToken[]): BoundedShellEffects {
  const paths: StaticPath[] = [];
  let index = 0;
  while (index < tokens.length) {
    const value = staticWordValue(tokens[index] as ShellToken);
    if (value === undefined) return unknownEffects();
    if (value === "--") {
      index += 1;
      break;
    }
    if (
      value === "-s" ||
      value === "--size" ||
      value === "-r" ||
      value === "--reference"
    ) {
      index += 2;
      continue;
    }
    if (value.startsWith("--size=") || value.startsWith("--reference=")) {
      index += 1;
      continue;
    }
    if (value.startsWith("-")) return unknownEffects();
    break;
  }
  for (; index < tokens.length; index += 1) {
    const path = normalizedStaticPath(tokens[index] as ShellToken);
    if (path === undefined) return unknownEffects();
    paths.push(path);
  }
  return paths.length === 0 ? unknownEffects() : effectsForPaths(paths);
}

function inPlaceSedEffects(tokens: readonly ShellToken[]): BoundedShellEffects {
  let inPlace = false;
  let scriptSuppliedByOption = false;
  let index = 0;
  for (; index < tokens.length; index += 1) {
    const value = staticWordValue(tokens[index] as ShellToken);
    if (value === undefined) return unknownEffects();
    if (value === "--") {
      index += 1;
      break;
    }
    if (
      value === "-i" ||
      value === "--in-place" ||
      /^-i.+/u.test(value) ||
      value.startsWith("--in-place=")
    ) {
      inPlace = true;
      continue;
    }
    if (
      value === "-e" ||
      value === "--expression" ||
      value === "-f" ||
      value === "--file"
    ) {
      scriptSuppliedByOption = true;
      index += 1;
      if (index >= tokens.length) return unknownEffects();
      continue;
    }
    if (value.startsWith("-")) return unknownEffects();
    break;
  }
  if (!inPlace) return emptyEffects();
  if (!scriptSuppliedByOption) index += 1;
  const paths: StaticPath[] = [];
  for (; index < tokens.length; index += 1) {
    const path = normalizedStaticPath(tokens[index] as ShellToken);
    if (path === undefined) return unknownEffects();
    paths.push(path);
  }
  return paths.length === 0 ? unknownEffects() : effectsForPaths(paths);
}

function canInvokeCurrentShellBuiltin(
  resolution: ShellExecutableResolution,
): boolean {
  return !resolution.sudo && !resolution.wrappers.includes("env");
}

function isBareCatCommand(parsed: ParsedSegment): boolean {
  return (
    parsed.resolution.effectiveExecutable === "cat" &&
    parsed.words.length === parsed.resolution.effectiveIndex + 1
  );
}

function normalizedStaticPath(token: ShellToken): StaticPath | undefined {
  const value = staticWordValue(token);
  return value === undefined ? undefined : normalizeStaticPath(value);
}

function normalizeStaticPath(value: string): StaticPath | undefined {
  if (
    value.length === 0 ||
    value === "." ||
    value.endsWith("/") ||
    value.startsWith("-") ||
    value.startsWith("~") ||
    value.includes("\0")
  ) {
    return undefined;
  }
  const absolute = value.startsWith("/");
  const components: string[] = [];
  for (const component of value.split("/")) {
    if (component === "..") return undefined;
    if (component.length === 0 || component === ".") continue;
    components.push(component);
  }
  const key = `${absolute ? "/" : ""}${components.join("/")}`;
  return key.length === 0 || key === "/" ? undefined : { absolute, key };
}

function staticWordValue(token: ShellToken): string | undefined {
  if (token.commandSubstitution || token.processSubstitution) return undefined;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < token.raw.length; index += 1) {
    const character = token.raw[index] ?? "";
    if (quote === "'") {
      if (character === "'") quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = undefined;
        continue;
      }
      if (character === "$" || character === "`") return undefined;
      if (character === "\\") index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (
      character === "$" ||
      character === "`" ||
      character === "*" ||
      character === "?" ||
      character === "[" ||
      character === "{" ||
      (character === "~" && index === 0)
    ) {
      return undefined;
    }
  }
  return quote === undefined ? token.value : undefined;
}

function branchExitFiles(
  successFiles: GeneratedFiles,
  entryFiles: ReadonlyMap<string, readonly StaticOutput[]>,
  effects: BoundedShellEffects,
  boundary: string | undefined,
): GeneratedFiles {
  if (boundary !== "||" && boundary !== "&") return successFiles;
  const branchFiles = cloneFiles(entryFiles);
  applyInvalidations(branchFiles, effects);
  return branchFiles;
}

function applyInvalidations(
  files: GeneratedFiles,
  effects: BoundedShellEffects,
): void {
  if (effects.unknownFileMutation) files.clear();
  else {
    for (const path of effects.exactMutatedPaths) {
      files.delete(path);
      const descendantPrefix = `${path.replace(/\/$/u, "")}/`;
      for (const trackedPath of files.keys()) {
        if (trackedPath.startsWith(descendantPrefix)) files.delete(trackedPath);
      }
    }
  }
  if (effects.cwdMayChange) {
    for (const path of files.keys()) {
      if (!path.startsWith("/")) files.delete(path);
    }
  }
}

function applyFileWrite(
  files: GeneratedFiles,
  write: FileWrite,
  output: StaticOutput | undefined,
): void {
  if (output === undefined) {
    files.delete(write.path.key);
    return;
  }
  if (write.mode === "overwrite") {
    if (
      !files.has(write.path.key) &&
      files.size >= MAX_TRACKED_GENERATED_FILES
    ) {
      return;
    }
    files.set(write.path.key, [output]);
    return;
  }
  const existing = files.get(write.path.key);
  if (existing === undefined) return;
  const appended = existing.flatMap((candidate) => {
    const byteLength = candidate.byteLength + output.byteLength;
    if (byteLength > MAX_GENERATED_SCRIPT_BYTES) return [];
    return [
      {
        shellText: candidate.shellText + output.shellText,
        byteLength,
        producerSpan: {
          start: candidate.producerSpan.start,
          end: output.producerSpan.end,
        },
      },
    ];
  });
  if (appended.length === 0) {
    files.delete(write.path.key);
    return;
  }
  files.set(
    write.path.key,
    appended.slice(0, MAX_GENERATED_SCRIPT_ALTERNATIVES),
  );
}

function mergeMayFiles(
  first: ReadonlyMap<string, readonly StaticOutput[]>,
  second: ReadonlyMap<string, readonly StaticOutput[]>,
): GeneratedFiles {
  const merged = cloneFiles(first);
  for (const [path, outputs] of second) {
    const existing = merged.get(path);
    if (existing === undefined) {
      if (merged.size >= MAX_TRACKED_GENERATED_FILES) continue;
      merged.set(path, outputs.slice(0, MAX_GENERATED_SCRIPT_ALTERNATIVES));
    } else {
      const alternatives = [...existing];
      for (const output of outputs) {
        if (
          alternatives.some(({ shellText }) => shellText === output.shellText)
        ) {
          continue;
        }
        if (alternatives.length >= MAX_GENERATED_SCRIPT_ALTERNATIVES) break;
        alternatives.push(output);
      }
      merged.set(path, alternatives);
    }
  }
  return merged;
}

function effectsPreservingKnownAppends(
  effects: BoundedShellEffects,
  writes: readonly FileWrite[],
  output: StaticOutput | undefined,
): BoundedShellEffects {
  if (output === undefined || !writes.some(({ mode }) => mode === "append")) {
    return effects;
  }
  const exactMutatedPaths = new Set(effects.exactMutatedPaths);
  for (const write of writes) {
    if (write.mode === "append") exactMutatedPaths.delete(write.path.key);
  }
  return { ...effects, exactMutatedPaths };
}

function effectsForPaths(paths: readonly StaticPath[]): BoundedShellEffects {
  const effects = emptyEffects();
  for (const path of paths) effects.exactMutatedPaths.add(path.key);
  return effects;
}

function emptyEffects(): BoundedShellEffects {
  return {
    cwdMayChange: false,
    exactMutatedPaths: new Set<string>(),
    unknownFileMutation: false,
  };
}

function unknownEffects(): BoundedShellEffects {
  return { ...emptyEffects(), unknownFileMutation: true };
}

function mergeEffects(
  target: BoundedShellEffects,
  source: BoundedShellEffects,
): void {
  target.cwdMayChange ||= source.cwdMayChange;
  target.unknownFileMutation ||= source.unknownFileMutation;
  for (const path of source.exactMutatedPaths) {
    target.exactMutatedPaths.add(path);
  }
}

function cloneFiles(
  files: ReadonlyMap<string, readonly StaticOutput[]>,
): GeneratedFiles {
  return new Map([...files].map(([path, outputs]) => [path, [...outputs]]));
}
