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
  String.raw`^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-${NPM_PRERELEASE_IDENTIFIER}(?:\.${NPM_PRERELEASE_IDENTIFIER})*)?(?:\+${NPM_BUILD_IDENTIFIER}(?:\.${NPM_BUILD_IDENTIFIER})*)?$`,
  "u",
);
const PYTHON_PROJECT_RE =
  /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(\[[A-Za-z0-9._,-]+\])?(.*)$/u;

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
    const variableName = PYTHON_PROJECT_RE.exec(reference)?.[1];
    if (variableName === undefined || reference.startsWith("$")) {
      return unsupportedSelector("pypi", reference, "variable");
    }
  }

  const parsed = PYTHON_PROJECT_RE.exec(reference);
  const packageName = parsed?.[1];
  const extras = parsed?.[2] ?? "";
  const selector = parsed?.[3] ?? "";
  if (packageName === undefined) {
    return unsupportedSelector(
      "pypi",
      reference,
      reference.includes("$") ? "variable" : "unknown",
    );
  }

  const normalizedPackageName = normalizePythonProjectName(packageName);
  const normalizedExtras = extras.toLowerCase();
  const selectorKind = pythonSelectorKind(selector);
  return {
    ecosystem: "pypi",
    packageName,
    normalizedPackageName,
    reference,
    selector,
    selectorKind,
    normalizedReference: `${normalizedPackageName}${normalizedExtras}${selector}`,
  };
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
  if (/^(?:==|!=).*\*/u.test(selector)) return "wildcard";
  const equality = /^(===|==)(.+)$/u.exec(selector);
  if (
    equality !== null &&
    equality[2] !== undefined &&
    equality[2].length > 0 &&
    !/[,$;<>~=]/u.test(equality[2])
  ) {
    return "exact";
  }
  if (/(?:~=|!=|<=|>=|<|>|==|===)/u.test(selector)) return "range";
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
