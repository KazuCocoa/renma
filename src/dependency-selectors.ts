export type DependencyEcosystem = "npm" | "pypi";

export type DependencySelectorKind =
  | "exact"
  | "bare"
  | "dist-tag"
  | "range"
  | "wildcard"
  | "variable"
  | "direct-reference"
  | "indirect-file"
  | "unknown";

export interface DependencySelectorAnalysis {
  ecosystem: DependencyEcosystem;
  packageName?: string;
  normalizedPackageName?: string;
  reference: string;
  selector: string;
  normalizedSelector: string;
  selectorKind: DependencySelectorKind;
  normalizedReference: string;
}

export interface FloatingDependencyAllowance {
  raw: string;
  normalized: string;
}

const NPM_PACKAGE_NAME_RE = /^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/u;
const NPM_PRERELEASE_IDENTIFIER = String.raw`(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const NPM_BUILD_IDENTIFIER = String.raw`[0-9A-Za-z-]+`;
const NPM_EXACT_VERSION_RE = new RegExp(
  String.raw`^(?:v|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-${NPM_PRERELEASE_IDENTIFIER}(?:\.${NPM_PRERELEASE_IDENTIFIER})*)?(?:\+${NPM_BUILD_IDENTIFIER}(?:\.${NPM_BUILD_IDENTIFIER})*)?$`,
  "u",
);
const PYTHON_PROJECT_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/u;
const PYTHON_EXTRA_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const PYTHON_PEP440_EXACT_VERSION_RE =
  /^v?(?:\d+!)?\d+(?:\.\d+)*(?:[._-]?(?:a|b|c|rc|alpha|beta|pre|preview)[._-]?\d*)?(?:(?:-\d+)|(?:[._-]?(?:post|rev|r)[._-]?\d*))?(?:[._-]?dev[._-]?\d*)?(?:\+[0-9A-Za-z]+(?:[._-][0-9A-Za-z]+)*)?$/iu;
const PYTHON_PEP440_WILDCARD_PREFIX_RE = /^v?(?:\d+!)?\d+(?:\.\d+)*$/iu;
const PYTHON_NORMALIZED_SPECIFIER_LIST_RE =
  /^(?:===|==|~=|!=|<=|>=|<|>)[^\s,]+(?:,(?:===|==|~=|!=|<=|>=|<|>)[^\s,]+)+$/u;
const PYTHON_NORMALIZED_SINGLE_SPECIFIER_RE =
  /^(?:===|==|~=|!=|<=|>=|<|>)[^\s,]+$/u;

export function classifyNpmSelector(
  reference: string,
): DependencySelectorAnalysis {
  const parsed = npmPackageNameAndSelector(reference);
  if (parsed === undefined || !NPM_PACKAGE_NAME_RE.test(parsed.packageName)) {
    return unsupportedSelector(
      "npm",
      reference,
      isDirectReference(reference) ? "direct-reference" : "unknown",
    );
  }

  const packageName = parsed.packageName;
  const normalizedPackageName = packageName.toLowerCase();
  const selector = parsed.selector;
  const selectorKind = npmSelectorKind(selector);
  return {
    ecosystem: "npm",
    packageName,
    normalizedPackageName,
    reference,
    selector,
    normalizedSelector: selector,
    selectorKind,
    normalizedReference:
      selector.length === 0
        ? normalizedPackageName
        : `${normalizedPackageName}${parsed.explicitAt ? "@" : ""}${selector}`,
  };
}

export function classifyPythonSelector(
  reference: string,
): DependencySelectorAnalysis {
  if (isDirectReference(reference)) {
    return unsupportedSelector("pypi", reference, "direct-reference");
  }
  if (reference.includes("$")) {
    const variableName = PYTHON_PROJECT_NAME_RE.exec(reference)?.[0];
    if (variableName === undefined || reference.startsWith("$")) {
      return unsupportedSelector("pypi", reference, "variable");
    }
  }

  const parsed = parsePythonRequirement(reference);
  if (parsed === undefined) {
    return unsupportedSelector(
      "pypi",
      reference,
      reference.includes("$") ? "variable" : "unknown",
    );
  }

  const { packageName, normalizedExtras, selector, normalizedSelector } =
    parsed;
  const normalizedPackageName = normalizePythonProjectName(packageName);
  const selectorKind = pythonSelectorKind(normalizedSelector);
  return {
    ecosystem: "pypi",
    packageName,
    normalizedPackageName,
    reference,
    selector,
    normalizedSelector,
    selectorKind,
    normalizedReference: `${normalizedPackageName}${normalizedExtras}${normalizedSelector}`,
  };
}

interface ParsedPythonRequirement {
  packageName: string;
  normalizedExtras: string;
  selector: string;
  normalizedSelector: string;
}

function parsePythonRequirement(
  reference: string,
): ParsedPythonRequirement | undefined {
  const nameMatch = PYTHON_PROJECT_NAME_RE.exec(reference);
  if (!nameMatch) {
    return undefined;
  }

  const packageName = nameMatch[0];
  let cursor = packageName.length;
  let extrasCursor = cursor;
  while (/[ \t]/u.test(reference[extrasCursor] ?? "")) {
    extrasCursor += 1;
  }

  let normalizedExtras = "";
  if (reference[extrasCursor] === "[") {
    const extrasEnd = reference.indexOf("]", extrasCursor + 1);
    if (extrasEnd === -1) {
      return undefined;
    }
    const extras = reference
      .slice(extrasCursor + 1, extrasEnd)
      .split(",")
      .map(trimHorizontalWhitespace);
    if (
      extras.length === 0 ||
      extras.some((extra) => !PYTHON_EXTRA_NAME_RE.test(extra))
    ) {
      return undefined;
    }
    normalizedExtras = `[${extras
      .map((extra) => extra.toLowerCase())
      .join(",")}]`;
    cursor = extrasEnd + 1;
  }

  const selector = reference.slice(cursor);
  return {
    packageName,
    normalizedExtras,
    selector,
    normalizedSelector: normalizePythonSpecifierList(selector) ?? selector,
  };
}

function normalizePythonSpecifierList(selector: string): string | undefined {
  const trimmed = trimHorizontalWhitespace(selector);
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.startsWith("@") || trimmed.includes(";")) {
    return undefined;
  }

  const normalizedClauses: string[] = [];
  for (const clause of selector.split(",")) {
    const match = /^[ \t]*(===|==|~=|!=|<=|>=|<|>)[ \t]*([^\s,]+)[ \t]*$/u.exec(
      clause,
    );
    if (!match?.[1] || !match[2]) {
      return undefined;
    }
    normalizedClauses.push(`${match[1]}${match[2]}`);
  }
  return normalizedClauses.join(",");
}

function trimHorizontalWhitespace(value: string): string {
  return value.replace(/^[ \t]+|[ \t]+$/gu, "");
}

export function parseFloatingDependencyAllowance(
  raw: string,
): FloatingDependencyAllowance | undefined {
  const trimmed = raw.trim();
  const colonAt = trimmed.indexOf(":");
  if (colonAt <= 0) return undefined;
  const ecosystem = trimmed.slice(0, colonAt);
  const reference = trimmed.slice(colonAt + 1);
  const parsed =
    ecosystem === "npm"
      ? classifyNpmSelector(reference)
      : ecosystem === "pypi"
        ? classifyPythonSelector(reference)
        : undefined;
  if (
    parsed === undefined ||
    parsed.packageName === undefined ||
    parsed.normalizedPackageName === undefined ||
    !isAllowableFloatingKind(parsed.selectorKind)
  ) {
    return undefined;
  }
  return {
    raw,
    normalized: `${parsed.ecosystem}:${parsed.normalizedReference}`,
  };
}

export function normalizePythonProjectName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/gu, "-");
}

function npmPackageNameAndSelector(
  reference: string,
): { packageName: string; selector: string; explicitAt: boolean } | undefined {
  if (reference.startsWith("@")) {
    const slash = reference.indexOf("/");
    if (slash <= 1) return undefined;
    const selectorAt = reference.indexOf("@", slash + 1);
    return selectorAt < 0
      ? { packageName: reference, selector: "", explicitAt: false }
      : {
          packageName: reference.slice(0, selectorAt),
          selector: reference.slice(selectorAt + 1),
          explicitAt: true,
        };
  }

  const selectorAt = reference.indexOf("@");
  if (selectorAt > 0) {
    return {
      packageName: reference.slice(0, selectorAt),
      selector: reference.slice(selectorAt + 1),
      explicitAt: true,
    };
  }
  if (selectorAt === 0) return undefined;

  const comparatorAt = reference.search(/[<>=~^]/u);
  return comparatorAt > 0
    ? {
        packageName: reference.slice(0, comparatorAt),
        selector: reference.slice(comparatorAt),
        explicitAt: false,
      }
    : { packageName: reference, selector: "", explicitAt: false };
}

function npmSelectorKind(selector: string): DependencySelectorKind {
  if (selector.length === 0) return "bare";
  if (selector.includes("$")) return "variable";
  if (isDirectReference(selector)) return "direct-reference";
  if (NPM_EXACT_VERSION_RE.test(selector)) return "exact";
  if (
    selector.includes("*") ||
    /(?:^|[.\s-])[xX](?:$|[.\s-])/u.test(selector)
  ) {
    return "wildcard";
  }
  if (
    /^(?:v?\d+)(?:\.\d+)?$/u.test(selector) ||
    /^(?:[~^]|[<>]=?|=)|\|\||\s+-\s|\s/u.test(selector)
  ) {
    return "range";
  }
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(selector)) {
    return "dist-tag";
  }
  return "unknown";
}

function pythonSelectorKind(selector: string): DependencySelectorKind {
  if (selector.length === 0) return "bare";
  if (selector.includes("$")) return "variable";
  if (
    selector.trimStart().startsWith("@") ||
    selector.includes(";") ||
    isDirectReference(selector)
  ) {
    return "direct-reference";
  }
  if (PYTHON_NORMALIZED_SPECIFIER_LIST_RE.test(selector)) {
    return "range";
  }

  const arbitraryEquality = /^===([^\s,;]+)$/u.exec(selector);
  if (arbitraryEquality?.[1]) {
    return "exact";
  }

  const equality = /^==(.+)$/u.exec(selector);
  if (equality?.[1]) {
    if (equality[1].endsWith(".*")) {
      return PYTHON_PEP440_WILDCARD_PREFIX_RE.test(equality[1].slice(0, -2))
        ? "wildcard"
        : "unknown";
    }
    return PYTHON_PEP440_EXACT_VERSION_RE.test(equality[1])
      ? "exact"
      : "unknown";
  }

  const exclusion = /^!=(.+)$/u.exec(selector);
  if (exclusion?.[1]?.endsWith(".*")) {
    return PYTHON_PEP440_WILDCARD_PREFIX_RE.test(exclusion[1].slice(0, -2))
      ? "wildcard"
      : "unknown";
  }
  if (selector.includes("*")) return "unknown";
  if (
    PYTHON_NORMALIZED_SINGLE_SPECIFIER_RE.test(selector) &&
    /^(?:~=|!=|<=|>=|<|>)/u.test(selector)
  ) {
    return "range";
  }
  return "unknown";
}

function unsupportedSelector(
  ecosystem: DependencyEcosystem,
  reference: string,
  selectorKind: DependencySelectorKind,
): DependencySelectorAnalysis {
  return {
    ecosystem,
    reference,
    selector: reference,
    normalizedSelector: reference,
    selectorKind,
    normalizedReference: reference,
  };
}

function isAllowableFloatingKind(kind: DependencySelectorKind): boolean {
  return (
    kind === "bare" ||
    kind === "dist-tag" ||
    kind === "range" ||
    kind === "wildcard"
  );
}

function isDirectReference(value: string): boolean {
  return (
    /^(?:https?:|git(?:\+[A-Za-z]+)?:|git@|github:|gitlab:|bitbucket:|npm:|file:|link:|workspace:)/iu.test(
      value,
    ) ||
    /^(?:\.{0,2}\/|\/|~\/)/u.test(value) ||
    /\.(?:tgz|tar\.gz|whl|zip)(?:[#?].*)?$/iu.test(value)
  );
}
