import { tokenizeBoundedShell, type ShellToken } from "./shell.js";

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
  tokens: ShellToken[];
};

type StaticOutput = {
  shellText: string;
  producerSpan: { start: number; end: number };
};

type FileWrite = {
  mode: "append" | "overwrite";
  path: string;
};

type ParsedSegment = {
  words: ShellToken[];
  stdoutRedirected: boolean;
  stdoutWrite?: FileWrite;
};

const COMMAND_BOUNDARIES = new Set([";", "|", "||", "&&", "&"]);
const SHELL_EXECUTABLES = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);
const PRESENTATION_MARKERS = new Set(["$", ">", "%"]);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/**
 * Correlate only shell text that is statically produced, written to an exact
 * path, and consumed from that same path later in one bounded shell input.
 * This intentionally does not read files, resolve variables, or model general
 * shell data flow.
 */
export function boundedGeneratedScriptExecutions(
  input: string,
): readonly BoundedGeneratedScriptExecution[] {
  const tokenization = tokenizeBoundedShell(input);
  if (!tokenization.supported) return [];

  const segments = commandSegments(input, tokenization.tokens);
  const files = new Map<string, StaticOutput>();
  const executions: BoundedGeneratedScriptExecution[] = [];
  let pipelineOutput: StaticOutput | undefined;

  for (const [index, segment] of segments.entries()) {
    const receivesPipeline = segments[index - 1]?.boundaryAfter === "|";
    if (!receivesPipeline) pipelineOutput = undefined;

    const parsed = parseSegment(segment);
    const produced = staticLiteralOutput(parsed.words, segment);

    if (produced !== undefined) {
      if (!parsed.stdoutRedirected) {
        pipelineOutput = produced;
      } else {
        if (parsed.stdoutWrite !== undefined) {
          applyFileWrite(files, parsed.stdoutWrite, produced);
        }
        pipelineOutput = undefined;
      }
    } else if (receivesPipeline && isTeeCommand(parsed.words)) {
      const teeWrites = teeFileWrites(parsed.words);
      for (const write of teeWrites) {
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
      isBareCatCommand(parsed.words) &&
      !parsed.stdoutRedirected
    ) {
      // A bare cat preserves the proven literal pipeline bytes.
    } else {
      if (parsed.stdoutWrite !== undefined) {
        applyFileWrite(files, parsed.stdoutWrite, undefined);
      }
      pipelineOutput = undefined;
    }

    // Commands in one pipeline are concurrent, so require the consumer to
    // begin a later command separated by a non-pipeline boundary.
    if (!receivesPipeline) {
      const consumerPath = staticScriptConsumerPath(parsed.words);
      const output =
        consumerPath === undefined ? undefined : files.get(consumerPath);
      if (consumerPath !== undefined && output !== undefined) {
        executions.push({
          path: consumerPath,
          shellText: output.shellText,
          producerSpan: Object.freeze({ ...output.producerSpan }),
          consumerSpan: Object.freeze({
            start: segment.start,
            end: segment.end,
          }),
        });
      }
    }
    if (segment.boundaryAfter === "||" || segment.boundaryAfter === "&") {
      files.clear();
    }
  }

  return Object.freeze(executions.map((execution) => Object.freeze(execution)));
}

function commandSegments(
  input: string,
  tokens: readonly ShellToken[],
): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  let memberTokens: ShellToken[] = [];

  for (const token of tokens) {
    if (token.kind !== "operator" || !COMMAND_BOUNDARIES.has(token.value)) {
      memberTokens.push(token);
      continue;
    }
    segments.push({
      start,
      end: token.start,
      boundaryAfter: token.value,
      tokens: memberTokens,
    });
    start = token.end;
    memberTokens = [];
  }
  segments.push({ start, end: input.length, tokens: memberTokens });
  return segments;
}

function parseSegment(segment: Segment): ParsedSegment {
  const words: ShellToken[] = [];
  let stdoutRedirected = false;
  let stdoutWrite: FileWrite | undefined;

  for (let index = 0; index < segment.tokens.length; index += 1) {
    const token = segment.tokens[index];
    if (token?.kind !== "operator") {
      if (token !== undefined) words.push(token);
      continue;
    }

    const target = segment.tokens[index + 1];
    if (target?.kind !== "word") continue;
    const descriptor = words[words.length - 1];
    const explicitDescriptor =
      descriptor !== undefined &&
      /^\d+$/u.test(descriptor.value) &&
      descriptor.end === token.start
        ? Number(descriptor.value)
        : undefined;
    if (explicitDescriptor !== undefined) words.pop();

    if (
      (token.value === ">" || token.value === ">>") &&
      (explicitDescriptor === undefined || explicitDescriptor === 1)
    ) {
      stdoutRedirected = true;
      const path = normalizedStaticPath(target);
      stdoutWrite =
        path === undefined
          ? undefined
          : {
              mode: token.value === ">>" ? "append" : "overwrite",
              path,
            };
    }
    index += 1;
  }

  return {
    words,
    stdoutRedirected,
    ...(stdoutWrite === undefined ? {} : { stdoutWrite }),
  };
}

function staticLiteralOutput(
  words: readonly ShellToken[],
  segment: Segment,
): StaticOutput | undefined {
  const executable = effectiveExecutable(words);
  if (executable === undefined) return undefined;
  const args = words.slice(executable.index + 1);
  let shellText: string | undefined;

  if (executable.name === "echo") shellText = staticEchoOutput(args);
  else if (executable.name === "printf") shellText = staticPrintfOutput(args);
  if (shellText === undefined) return undefined;

  return {
    shellText,
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
  let index = args[0]?.value === "--" ? 1 : 0;
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
  let valueIndex = 0;
  let repeats = 0;

  do {
    let conversions = 0;
    for (let index = 0; index < format.length; index += 1) {
      const character = format[index] ?? "";
      if (character === "%") {
        const next = format[index + 1];
        if (next === "%") {
          output += "%";
          index += 1;
          continue;
        }
        if (next !== "s") return undefined;
        output += values[valueIndex] ?? "";
        valueIndex += 1;
        conversions += 1;
        index += 1;
        continue;
      }
      if (character !== "\\") {
        output += character;
        continue;
      }
      const escape = staticPrintfEscape(format, index);
      if (escape === undefined) return undefined;
      output += escape.value;
      index = escape.end - 1;
    }
    repeats += 1;
    if (conversions === 0) break;
  } while (valueIndex < values.length && repeats <= values.length);

  return output;
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

function teeFileWrites(words: readonly ShellToken[]): FileWrite[] {
  const executable = effectiveExecutable(words);
  if (executable?.name !== "tee") return [];
  let mode: FileWrite["mode"] = "overwrite";
  let options = true;
  const writes: FileWrite[] = [];

  for (const token of words.slice(executable.index + 1)) {
    const value = staticWordValue(token);
    if (value === undefined) continue;
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
    if (options && value.startsWith("-")) return [];
    options = false;
    const path = normalizeStaticPath(value);
    if (path !== undefined) writes.push({ mode, path });
  }
  return writes;
}

function isTeeCommand(words: readonly ShellToken[]): boolean {
  return effectiveExecutable(words)?.name === "tee";
}

function isBareCatCommand(words: readonly ShellToken[]): boolean {
  const executable = effectiveExecutable(words);
  return executable?.name === "cat" && words.length === executable.index + 1;
}

function staticScriptConsumerPath(
  words: readonly ShellToken[],
): string | undefined {
  const executable = effectiveExecutable(words);
  if (executable === undefined) return undefined;
  let index = executable.index + 1;
  if (words[index]?.value === "--") index += 1;
  else if ((words[index]?.value ?? "").startsWith("-")) return undefined;

  if (
    !SHELL_EXECUTABLES.has(executable.name) &&
    executable.name !== "source" &&
    executable.name !== "."
  ) {
    return undefined;
  }
  const path = words[index];
  return path === undefined ? undefined : normalizedStaticPath(path);
}

function effectiveExecutable(
  words: readonly ShellToken[],
): { index: number; name: string } | undefined {
  let index = 0;
  if (PRESENTATION_MARKERS.has(words[index]?.value ?? "")) index += 1;
  while (ASSIGNMENT_RE.test(words[index]?.value ?? "")) index += 1;

  for (const wrapper of ["command", "env"] as const) {
    if (normalizedExecutable(words[index]) !== wrapper) continue;
    index += 1;
    if (words[index]?.value === "--") index += 1;
    if (wrapper === "env") {
      while (ASSIGNMENT_RE.test(words[index]?.value ?? "")) index += 1;
    }
  }

  if (normalizedExecutable(words[index]) === "sudo") {
    index += 1;
    if (words[index]?.value === "--") index += 1;
    else if ((words[index]?.value ?? "").startsWith("-")) return undefined;
  }

  const name = normalizedExecutable(words[index]);
  return name === undefined ? undefined : { index, name };
}

function normalizedExecutable(
  token: ShellToken | undefined,
): string | undefined {
  const value = token === undefined ? undefined : staticWordValue(token);
  if (value === undefined || value.length === 0) return undefined;
  return value.split("/").pop()?.toLowerCase();
}

function normalizedStaticPath(token: ShellToken): string | undefined {
  const value = staticWordValue(token);
  return value === undefined ? undefined : normalizeStaticPath(value);
}

function normalizeStaticPath(value: string): string | undefined {
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
    if (component.length === 0 || component === ".") continue;
    if (component === "..") {
      if (components.length > 0 && components[components.length - 1] !== "..") {
        components.pop();
      } else if (!absolute) {
        components.push(component);
      }
      continue;
    }
    components.push(component);
  }
  const normalized = `${absolute ? "/" : ""}${components.join("/")}`;
  return normalized.length === 0 || normalized === "/" ? undefined : normalized;
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

function applyFileWrite(
  files: Map<string, StaticOutput>,
  write: FileWrite,
  output: StaticOutput | undefined,
): void {
  if (output === undefined) {
    files.delete(write.path);
    return;
  }
  if (write.mode === "overwrite") {
    files.set(write.path, output);
    return;
  }
  const existing = files.get(write.path);
  if (existing === undefined) {
    files.delete(write.path);
    return;
  }
  files.set(write.path, {
    shellText: existing.shellText + output.shellText,
    producerSpan: {
      start: existing.producerSpan.start,
      end: output.producerSpan.end,
    },
  });
}
