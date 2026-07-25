import { analyzeDestinationsFromProjection } from "../security-destination/index.js";
import { projectShellContinuations } from "../security-destination/logical-shell.js";
import { classifyDependencyInstalls } from "./dependency-install.js";
import { explicitNoDisclosureGuards } from "./guards.js";
import { classifySensitiveData } from "./sensitive-data.js";
import { tokenizeBoundedShell } from "./shell.js";
import type {
  DependencyInstallAnalysis,
  SecurityCommandAnalysis,
  SecurityCommandInput,
  SensitiveSinkAnalysis,
  SensitiveSourceAnalysis,
} from "./types.js";

export function analyzeSecurityCommand(
  input: SecurityCommandInput,
): SecurityCommandAnalysis {
  const source = {
    ...input.source,
    lines: Object.freeze([...input.source.lines]),
  };
  const guards = (input.guards ?? []).map((guard) => ({ ...guard }));
  const shellProjection =
    input.destinationAnalysis === undefined
      ? projectShellContinuations(source.text, source.startLine)
      : {
          projection: input.destinationAnalysis.projection,
          sourceOffsetByProjectionOffset:
            input.destinationAnalysis.sourceOffsetByProjectionOffset,
          sourceLineByProjectionOffset:
            input.destinationAnalysis.sourceLineByProjectionOffset,
          sourceBaseLine: input.destinationAnalysis.sourceBaseLine,
        };
  const destinationAnalysis =
    input.destinationAnalysis ??
    analyzeDestinationsFromProjection(source.text, shellProjection);
  const tokenization = tokenizeBoundedShell(shellProjection.projection);
  const dependencies = classifyDependencyInstalls(
    tokenization.tokens,
    shellProjection.projection,
    shellProjection,
    source.text.length,
    guards,
  );
  const sensitive = classifySensitiveData(
    shellProjection.projection,
    tokenization.tokens,
    shellProjection,
    source.text.length,
    source.language,
    destinationAnalysis,
  );
  const noDisclosureGuards = explicitNoDisclosureGuards(guards);
  const support =
    tokenization.supported && dependencies.supported && sensitive.supported
      ? "supported"
      : "fallback-required";
  const fallbackReasons = [
    ...(tokenization.supported ? [] : ["unsupported-tokenization"]),
    ...(dependencies.supported ? [] : ["unsupported-dependency-command"]),
    ...sensitive.fallbackReasons,
  ];
  const localOnlySensitiveOperation =
    support === "supported" &&
    sensitive.sources.some(({ kind }) => kind !== "environment-variable-api") &&
    sensitive.sinks.length > 0 &&
    sensitive.sinks.every(({ kind }) => kind === "local-file") &&
    noDisclosureGuards.length > 0;

  return Object.freeze({
    source: Object.freeze(source),
    ...(source.language === undefined ? {} : { language: source.language }),
    guards: Object.freeze(guards.map((guard) => Object.freeze(guard))),
    dependencyInstalls: freezeDependencies(dependencies.installs),
    sensitiveSources: freezeSources(sensitive.sources),
    sinks: freezeSinks(sensitive.sinks),
    destinationAnalysis,
    npmStyleInstallCommand: dependencies.npmStyleInstallCommand,
    noDisclosureGuards: Object.freeze(
      noDisclosureGuards.map((guard) => Object.freeze({ ...guard })),
    ),
    localOnlySensitiveOperation,
    support,
    fallbackReasons: Object.freeze([...new Set(fallbackReasons)]),
  });
}

function freezeDependencies(
  dependencies: readonly DependencyInstallAnalysis[],
): readonly Readonly<DependencyInstallAnalysis>[] {
  return Object.freeze(
    dependencies.map((dependency) =>
      Object.freeze({
        ...dependency,
        variableNames: Object.freeze([...dependency.variableNames]),
        sourceSpan: Object.freeze({ ...dependency.sourceSpan }),
      }),
    ),
  );
}

function freezeSources(
  sources: readonly SensitiveSourceAnalysis[],
): readonly Readonly<SensitiveSourceAnalysis>[] {
  return Object.freeze(
    sources.map((source) =>
      Object.freeze({
        ...source,
        sourceSpan: Object.freeze({ ...source.sourceSpan }),
      }),
    ),
  );
}

function freezeSinks(
  sinks: readonly SensitiveSinkAnalysis[],
): readonly Readonly<SensitiveSinkAnalysis>[] {
  return Object.freeze(
    sinks.map((sink) =>
      Object.freeze({
        ...sink,
        ...(sink.sourceSpan === undefined
          ? {}
          : { sourceSpan: Object.freeze({ ...sink.sourceSpan }) }),
      }),
    ),
  );
}
