import type { Artifact, Finding, Severity } from "./types.js";

interface RuleMetadata {
  id: string;
  title: string;
  whyItMatters: string;
  remediation: string;
  llmHint: string;
}

interface Detection {
  metadata: RuleMetadata;
  severity: Severity;
  confidence: Finding["confidence"];
  line: number;
  snippet: string;
}

const constraints = [
  "Do not remove legitimate setup steps solely because this finding exists.",
  "Preserve required platform-specific setup instructions.",
  "Prefer pinning, scoping, confirmation, and recovery guidance over deleting operational detail.",
];

const verificationSteps = [
  "Review the reported command or instruction.",
  "Add version pinning, checksum verification, confirmation, scoping, or recovery steps as appropriate.",
  "Run `renma scan` again.",
];

const remoteScriptMetadata: RuleMetadata = {
  id: "SEC-UNPINNED-REMOTE-SCRIPT",
  title: "Remote script execution without pinning or inspection",
  whyItMatters:
    "Agent-facing instructions that pipe remote code directly into a shell can cause unreviewed code execution.",
  remediation:
    "Download the script first, inspect it, pin the source/version/checksum, and run it only after human approval.",
  llmHint:
    "Replace one-line remote shell execution with download, checksum/version pinning, inspection, and explicit human approval steps.",
};

const unpinnedDependencyMetadata: RuleMetadata = {
  id: "SEC-UNPINNED-DEPENDENCY-INSTALL",
  title: "Dependency install without a version pin",
  whyItMatters:
    "Agent-facing install instructions that resolve the latest package can change behavior between runs and pull unreviewed code.",
  remediation:
    "Pin package versions or document why the latest version is intentionally required.",
  llmHint:
    "Prefer explicit package versions, image tags, or a written reason why latest is required.",
};

const privilegedCommandMetadata: RuleMetadata = {
  id: "SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD",
  title: "Privileged command without nearby guardrails",
  whyItMatters:
    "Privileged commands in reusable instructions can alter system state broadly when copied by an agent without confirmation or rollback guidance.",
  remediation:
    "Add explicit scope, confirmation, and rollback/verification instructions before privileged commands.",
  llmHint:
    "Keep the setup step if it is required, but add confirmation, path scope, backup or rollback, and verification language nearby.",
};

const predictableTempMetadata: RuleMetadata = {
  id: "SEC-PREDICTABLE-TEMP-PATH",
  title: "Predictable temporary path in operational instructions",
  whyItMatters:
    "Predictable temporary paths can expose sensitive files or collide with existing files when reused by agents or scripts.",
  remediation:
    "Use `mktemp` or a workspace-scoped temporary directory, and avoid predictable paths for sensitive data.",
  llmHint:
    "Use mktemp or a repository-scoped temporary path, especially for tokens, credentials, signing material, or auth files.",
};

const credentialArgMetadata: RuleMetadata = {
  id: "SEC-CREDENTIAL-IN-COMMAND-ARG",
  title: "Credential-like value embedded in a command argument",
  whyItMatters:
    "Credentials in command arguments or reusable headers can leak through shell history, process listings, logs, or copied instructions.",
  remediation:
    "Use environment variables, secret managers, or interactive prompts. Avoid putting credentials directly in command arguments or reusable instructions.",
  llmHint:
    "Move literal secrets out of command arguments and into environment variables, secret managers, or interactive prompts.",
};

const guardWords = [
  "confirm",
  "ask the user",
  "approval",
  "dry run",
  "backup",
  "restore",
  "rollback",
  "revert",
  "scope",
  "only this path",
  "verify",
];

const sensitiveTempWords = [
  "token",
  "secret",
  "password",
  "credential",
  "key",
  "cert",
  "certificate",
  "profile",
  "provisioning",
  "signing",
  "auth",
];

const commandStarters = [
  "bash",
  "brew",
  "chmod",
  "chown",
  "curl",
  "docker",
  "npm",
  "pip",
  "pip3",
  "sh",
  "sudo",
  "wget",
];

export function securityDiagnosticFindings(artifacts: Artifact[]): Finding[] {
  return artifacts
    .flatMap((artifact) => securityFindingsForArtifact(artifact))
    .sort(compareDiagnostics);
}

function securityFindingsForArtifact(artifact: Artifact): Finding[] {
  const lines = artifact.content.split(/\r?\n/);
  const findings: Finding[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    const context = nearbyContext(lines, index);
    const operational = inFence || looksOperational(trimmed);
    const detections = [
      ...detectRemoteScript(trimmed, operational),
      ...detectUnpinnedDependency(trimmed, operational),
      ...detectPrivilegedCommand(trimmed, context, operational),
      ...detectPredictableTempPath(trimmed, context, operational),
      ...detectCredentialArgument(trimmed, operational),
    ];

    for (const detection of detections) {
      findings.push(
        toFinding(artifact.path, { ...detection, line: index + 1 }),
      );
    }
  }

  return findings;
}

function detectRemoteScript(line: string, operational: boolean): Detection[] {
  if (!operational) return [];

  const directPipe =
    /\b(curl|wget)\b[^\n|]*(https?:\/\/\S+)[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b/i.test(
      line,
    );
  const processSubstitution =
    /\b(ba)?sh\s*<\(\s*(curl|wget)\b[^\n)]*https?:\/\/\S+/i.test(line);

  if (!directPipe && !processSubstitution) return [];

  return [
    {
      metadata: remoteScriptMetadata,
      severity: directPipe ? "high" : "medium",
      confidence: "high",
      line: 0,
      snippet: line,
    },
  ];
}

function detectUnpinnedDependency(
  line: string,
  operational: boolean,
): Detection[] {
  if (!operational) return [];

  const detections: Detection[] = [];
  const npm = line.match(/\bnpm\s+(?:install|i)\s+([^\n#]+)/i);
  if (npm) {
    const args = splitCommandArgs(npm[1] ?? "");
    const globalInstall = args.includes("-g") || args.includes("--global");
    const packages = args.filter((arg) => isPackageToken(arg) && arg !== "-g");
    const unpinned = packages.find((arg) => !isPinnedNpmPackage(arg));
    if (unpinned) {
      detections.push({
        metadata: unpinnedDependencyMetadata,
        severity: globalInstall ? "medium" : "low",
        confidence: "medium",
        line: 0,
        snippet: line,
      });
    }
  }

  const pip = line.match(/\bpip3?\s+install\s+([^\n#]+)/i);
  if (pip) {
    const packages = splitCommandArgs(pip[1] ?? "").filter(isPackageToken);
    const unpinned = packages.find((arg) => !/[<>=~!]=/.test(arg));
    if (unpinned) {
      detections.push({
        metadata: unpinnedDependencyMetadata,
        severity: "low",
        confidence: "medium",
        line: 0,
        snippet: line,
      });
    }
  }

  const brew = line.match(/\bbrew\s+install\s+([^\n#]+)/i);
  if (brew) {
    const packages = splitCommandArgs(brew[1] ?? "").filter(isPackageToken);
    if (packages.length > 0) {
      detections.push({
        metadata: unpinnedDependencyMetadata,
        severity: "low",
        confidence: "medium",
        line: 0,
        snippet: line,
      });
    }
  }

  if (/\bdocker\s+(pull|run)\b[^\n#]*\S+:latest\b/i.test(line)) {
    detections.push({
      metadata: unpinnedDependencyMetadata,
      severity: "medium",
      confidence: "high",
      line: 0,
      snippet: line,
    });
  }

  if (/\bcurl\b[^\n#]*https?:\/\/\S*\/latest(?:\/|\b|\S*)/i.test(line)) {
    detections.push({
      metadata: unpinnedDependencyMetadata,
      severity: "low",
      confidence: "medium",
      line: 0,
      snippet: line,
    });
  }

  return detections;
}

function detectPrivilegedCommand(
  line: string,
  context: string,
  operational: boolean,
): Detection[] {
  if (!operational) return [];

  const hasPrivilegedCommand =
    /\bsudo\s+(npm|rm|chmod|chown|sh|bash|curl|wget)\b/i.test(line) ||
    /\bchmod\s+-R\s+777\b/i.test(line) ||
    /\bchown\s+-R\b/i.test(line);

  if (!hasPrivilegedCommand || hasGuardrail(context)) return [];

  return [
    {
      metadata: privilegedCommandMetadata,
      severity: "medium",
      confidence: "medium",
      line: 0,
      snippet: line,
    },
  ];
}

function detectPredictableTempPath(
  line: string,
  context: string,
  operational: boolean,
): Detection[] {
  if (!operational || !/\/tmp\/[A-Za-z0-9._/-]+/.test(line)) return [];

  const sensitive = sensitiveTempWords.some((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(context),
  );

  return [
    {
      metadata: predictableTempMetadata,
      severity: sensitive ? "medium" : "low",
      confidence: sensitive ? "high" : "medium",
      line: 0,
      snippet: line,
    },
  ];
}

function detectCredentialArgument(
  line: string,
  operational: boolean,
): Detection[] {
  if (!operational) return [];

  const detections: Detection[] = [];
  const optionMatch = line.match(
    /\B--(?:password|token)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i,
  );
  const optionValue = optionMatch?.[1] ?? optionMatch?.[2] ?? optionMatch?.[3];
  if (optionValue && !isSafePlaceholder(optionValue)) {
    detections.push({
      metadata: credentialArgMetadata,
      severity: "high",
      confidence: "high",
      line: 0,
      snippet: line,
    });
  } else if (optionValue) {
    detections.push({
      metadata: credentialArgMetadata,
      severity: "medium",
      confidence: "medium",
      line: 0,
      snippet: line,
    });
  }

  const basicAuthMatch = line.match(
    /\s-u\s+(?:"([^"]+)"|'([^']+)'|(\S+:\S+))/i,
  );
  const basicAuthValue =
    basicAuthMatch?.[1] ?? basicAuthMatch?.[2] ?? basicAuthMatch?.[3];
  if (basicAuthValue && basicAuthValue.includes(":")) {
    detections.push({
      metadata: credentialArgMetadata,
      severity: isSafePlaceholder(basicAuthValue) ? "medium" : "high",
      confidence: isSafePlaceholder(basicAuthValue) ? "medium" : "high",
      line: 0,
      snippet: line,
    });
  }

  const bearerMatch = line.match(
    /Authorization:\s*Bearer\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i,
  );
  const bearerValue = bearerMatch?.[1] ?? bearerMatch?.[2] ?? bearerMatch?.[3];
  if (bearerValue && !isSafePlaceholder(bearerValue)) {
    detections.push({
      metadata: credentialArgMetadata,
      severity: bearerValue === "..." ? "medium" : "high",
      confidence: bearerValue === "..." ? "medium" : "high",
      line: 0,
      snippet: line,
    });
  } else if (bearerValue) {
    detections.push({
      metadata: credentialArgMetadata,
      severity: "medium",
      confidence: "medium",
      line: 0,
      snippet: line,
    });
  }

  return dedupeDetections(detections);
}

function toFinding(path: string, detection: Detection): Finding {
  return {
    ...detection.metadata,
    category: "safety",
    severity: detection.severity,
    confidence: detection.confidence,
    evidence: {
      path,
      startLine: detection.line,
      endLine: detection.line,
      snippet: detection.snippet,
    },
    constraints,
    verificationSteps,
    llmHint: detection.metadata.llmHint,
  };
}

function nearbyContext(lines: string[], index: number): string {
  const start = Math.max(0, index - 3);
  const end = Math.min(lines.length, index + 4);
  return lines.slice(start, end).join("\n").toLowerCase();
}

function looksOperational(line: string): boolean {
  if (line.length === 0) return false;
  if (line.startsWith("$ ")) return true;
  if (
    /[|<>]/.test(line) &&
    /\b(curl|wget|bash|sh|tmp|Authorization)\b/i.test(line)
  ) {
    return true;
  }
  return commandStarters.some((command) =>
    new RegExp(`^(?:[-*]\\s+)?${command}\\b`, "i").test(line),
  );
}

function splitCommandArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((arg) => arg.replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function isPackageToken(arg: string): boolean {
  return (
    !arg.startsWith("-") && !arg.includes("/") && arg !== "." && arg !== ".."
  );
}

function isPinnedNpmPackage(arg: string): boolean {
  if (arg.startsWith("@")) {
    const lastAt = arg.lastIndexOf("@");
    return lastAt > 0 && lastAt < arg.length - 1;
  }
  return /@\d/.test(arg);
}

function hasGuardrail(context: string): boolean {
  return guardWords.some((word) => context.includes(word));
}

function isSafePlaceholder(value: string): boolean {
  const normalized = value.trim().replace(/[",]$/g, "");
  return (
    normalized.startsWith("$") ||
    /^<[^>]+>$/.test(normalized) ||
    /^YOUR_[A-Z0-9_]+$/.test(normalized) ||
    /^REDACTED$/i.test(normalized) ||
    /^\*+$/.test(normalized)
  );
}

function dedupeDetections(detections: Detection[]): Detection[] {
  const seen = new Set<string>();
  return detections.filter((detection) => {
    const key = `${detection.metadata.id}:${detection.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareDiagnostics(a: Finding, b: Finding): number {
  const aPath = a.evidence.path;
  const bPath = b.evidence.path;
  if (aPath !== bPath) return aPath.localeCompare(bPath);

  const aLine = a.evidence.startLine;
  const bLine = b.evidence.startLine;
  if (aLine !== bLine) return aLine - bLine;

  return a.id.localeCompare(b.id);
}
