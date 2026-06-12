import type { Evidence, Finding, ParsedDocument, Severity } from "./types.js";

const SECRET_PATTERN = /\b(?:password|passwd|token|api[_-]?key|secret|credential|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{8,})/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/;
const DESTRUCTIVE_PATTERN = /\b(?:rm\s+-rf|git\s+reset\s+--hard|git\s+checkout\s+--|sudo\s+|chmod\s+-R\s+777|mkfs|diskutil\s+erase|dd\s+if=|su\s+-)/;
const REMOTE_PATTERN = /\b(?:curl|wget|ssh|scp)\b.*\b(?:example\.com|prod|production|root@|--insecure|-k)\b/i;
const ENV_COPY_PATTERN = /\b(?:process\.env|env)\b.*\b(?:spawn|exec|subprocess|child_process)\b/i;

export function runRules(documents: ParsedDocument[]): Finding[] {
  const findings = documents.flatMap((document) => [
    ...secretFindings(document),
    ...commandFindings(document),
    ...shapeFindings(document),
    ...profileFindings(document),
    ...evalFindings(document)
  ]);

  return findings.sort((a, b) => {
    const byPath = a.evidence.path.localeCompare(b.evidence.path);
    if (byPath !== 0) return byPath;
    return a.evidence.startLine - b.evidence.startLine;
  });
}

export function severityMeets(value: Severity, threshold: Severity): boolean {
  const order: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  return order[value] >= order[threshold];
}

function secretFindings(document: ParsedDocument): Finding[] {
  return matchingLineFindings(document, (line) => {
    if (PRIVATE_KEY_PATTERN.test(line)) {
      return finding("SEC-PRIVATE-KEY", "Private key material appears in repository text", "safety", "critical", document, line);
    }
    if (SECRET_PATTERN.test(line) && !isPlaceholder(line)) {
      return finding("SEC-LITERAL-SECRET", "Literal credential-like value appears in repository text", "safety", "critical", document, line);
    }
    return undefined;
  }, "Move secrets to user-approved runtime input or a secret manager, and keep only placeholders in repository files.");
}

function commandFindings(document: ParsedDocument): Finding[] {
  return matchingLineFindings(document, (line) => {
    if (DESTRUCTIVE_PATTERN.test(line) && !hasNearbyConfirmation(document.lines, line)) {
      return finding("SEC-DESTRUCTIVE-COMMAND", "Dangerous command lacks an explicit confirmation or recovery guard", "safety", "high", document, line);
    }
    if (REMOTE_PATTERN.test(line)) {
      return finding("SEC-REMOTE-DEFAULT", "Remote access command uses risky or underspecified defaults", "safety", "high", document, line);
    }
    if (ENV_COPY_PATTERN.test(line)) {
      return finding("SEC-ENV-COPY", "Command may pass a broad environment into subprocess execution", "safety", "medium", document, line);
    }
    return undefined;
  }, "Validate targets, avoid unsafe defaults, prefer argument arrays, and require explicit confirmation for privileged or destructive work.");
}

function shapeFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "skill") return [];
  const text = document.artifact.content.toLowerCase();
  const findings: Finding[] = [];

  if (!document.metadata.description && !/\bdescription\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-DESCRIPTION", "Skill is missing an explicit description", "quality", "medium", "Add a short description that states when an agent should use the skill."));
  }
  if (!/do not use for|non-goals|out of scope/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-NEGATIVE-ROUTING", "Skill lacks negative routing guidance", "structure", "medium", "Add a DO NOT USE FOR or non-goals section so agents know when to choose another path."));
  }
  if (!/\bexample|examples\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-EXAMPLES", "Skill lacks examples", "quality", "low", "Add concise examples that demonstrate expected inputs, outputs, or routing behavior."));
  }
  if (!/\bpreflight|before you start|first\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-PREFLIGHT", "Skill lacks an explicit preflight step", "quality", "medium", "Add a preflight step for checking inputs, permissions, and context before taking action."));
  }
  if (!/\bverify|verification|test\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-VERIFICATION", "Skill lacks verification guidance", "quality", "medium", "State what command, check, or evidence should verify the work."));
  }
  if (document.headings.length < 2 && document.lines.length > 80) {
    findings.push(documentFinding(document, "QUAL-LOW-HEADING-DENSITY", "Long skill has low heading density", "quality", "low", "Split long procedures into clear sections or linked references."));
  }

  return findings;
}

function profileFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "profile") return [];
  const text = document.artifact.content.toLowerCase();
  if (/base[_ -]?skill|extends/.test(text)) return [];
  return [documentFinding(document, "PROF-MISSING-BASE", "Profile overlay does not declare its base skill", "structure", "medium", "Declare the base skill and profile id so routing and conflicts are auditable.")];
}

function evalFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "eval") return [];
  const text = document.artifact.content.toLowerCase();
  const findings: Finding[] = [];
  if (!/refusal|confirmation|permission/.test(text)) {
    findings.push(documentFinding(document, "EVAL-MISSING-SAFETY-CASE", "Eval manifest lacks a refusal or confirmation safety case", "eval", "medium", "Add an eval that proves destructive or privileged work requires confirmation."));
  }
  if (!/missing|credential|host|failure/.test(text)) {
    findings.push(documentFinding(document, "EVAL-MISSING-FAILURE-CASE", "Eval manifest lacks a missing-context or failure case", "eval", "low", "Add an eval for missing credentials, unavailable tools, or unspecified targets."));
  }
  return findings;
}

function matchingLineFindings(
  document: ParsedDocument,
  matcher: (line: string) => Omit<Finding, "evidence" | "whyItMatters" | "remediation"> | undefined,
  remediation: string
): Finding[] {
  const findings: Finding[] = [];
  document.lines.forEach((line, index) => {
    if (isSuppressed(line)) return;
    const partial = matcher(line);
    if (!partial) return;
    findings.push({
      ...partial,
      evidence: evidence(document, index + 1, line),
      whyItMatters: "Skills are executable guidance for agents, so risky text can become risky behavior.",
      remediation
    });
  });
  return findings;
}

function finding(
  id: string,
  title: string,
  category: Finding["category"],
  severity: Severity,
  document: ParsedDocument,
  line: string
): Omit<Finding, "evidence" | "whyItMatters" | "remediation"> {
  void document;
  void line;
  return { id, title, category, severity, confidence: "high" };
}

function documentFinding(
  document: ParsedDocument,
  id: string,
  title: string,
  category: Finding["category"],
  severity: Severity,
  remediation: string
): Finding {
  const firstContentLine = document.lines.findIndex((line) => line.trim().length > 0);
  const lineNumber = firstContentLine >= 0 ? firstContentLine + 1 : 1;
  return {
    id,
    title,
    category,
    severity,
    confidence: "medium",
    evidence: evidence(document, lineNumber, document.lines[firstContentLine] ?? ""),
    whyItMatters: "Clear skill structure helps agents choose the right workflow and report useful evidence.",
    remediation
  };
}

function evidence(document: ParsedDocument, line: number, snippet: string): Evidence {
  return {
    path: document.artifact.path,
    startLine: line,
    endLine: line,
    snippet: snippet.trim().slice(0, 240)
  };
}

function isPlaceholder(line: string): boolean {
  return /(?:example|placeholder|your_|<[^>]+>|\$\{[^}]+})/i.test(line);
}

function isSuppressed(line: string): boolean {
  return /tool-ignore\s+[A-Z0-9-]+/.test(line);
}

function hasNearbyConfirmation(lines: string[], matchedLine: string): boolean {
  const index = lines.indexOf(matchedLine);
  const window = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join("\n").toLowerCase();
  return /confirm|confirmation|backup|rollback|dry-run|explicit approval/.test(window);
}
