import path from "node:path";
import type { Evidence, Finding, ParsedDocument, Severity } from "./types.js";

const SECRET_PATTERN =
  /\b(?:password|passwd|token|api[_-]?key|secret|credential|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{8,})/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/;
const DESTRUCTIVE_PATTERN =
  /\b(?:rm\s+-rf|git\s+reset\s+--hard|git\s+checkout\s+--|sudo\b|chmod\s+(?:-R\s+)?777|chown\s+-R|mkfs|diskutil\s+erase|dd\s+if=|su\s+-|docker\s+system\s+prune|kubectl\s+delete)\b/i;
const REMOTE_PATTERN =
  /\b(?:curl|wget)\b.*(?:\|\s*(?:sh|bash)|\b(?:example\.com|prod|production|--insecure|-k)\b)|\b(?:ssh|scp)\b.*\b(?:example\.com|prod|production|root@|--insecure|-k|StrictHostKeyChecking=no|UserKnownHostsFile=\/dev\/null)\b/i;
const ENV_COPY_PATTERN =
  /\b(?:process\.env|env|printenv)\b.*\b(?:spawn|exec|subprocess|child_process|xargs|sh|bash)\b|\b[A-Z_]+=\$[A-Z_]+\b.*(?:node|python|bash|sh)\b/i;

const SKILL_TOKEN_LIMIT = 500;
const DESCRIPTION_MIN_CHARS = 150;

export function runRules(documents: ParsedDocument[]): Finding[] {
  const findings = documents.flatMap((document) => [
    ...secretFindings(document),
    ...commandFindings(document),
    ...shapeFindings(document),
    ...profileFindings(document),
    ...evalFindings(document)
  ]);

  findings.push(...skillCoverageFindings(documents));
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
    if (isPlaceholder(line) || isSuppressed(line)) return undefined;
    if (PRIVATE_KEY_PATTERN.test(line)) {
      return finding("SEC-PRIVATE-KEY", "Private key material appears in repository text", "safety", "critical", document, line);
    }
    if (SECRET_PATTERN.test(line)) {
      return finding("SEC-LITERAL-SECRET", "Literal credential-like value appears in repository text", "safety", "critical", document, line);
    }
    return undefined;
  }, "Move secrets to user-approved runtime input or a secret manager, and keep only placeholders in repository files.");
}

function commandFindings(document: ParsedDocument): Finding[] {
  return matchingLineFindings(document, (line) => {
    if (isSuppressed(line)) return undefined;
    if (DESTRUCTIVE_PATTERN.test(line) && !hasNearbyConfirmation(document.lines, line)) {
      return finding("SEC-DESTRUCTIVE-COMMAND", "Dangerous command lacks an explicit confirmation or recovery guard", "safety", "high", document, line);
    }
    if (REMOTE_PATTERN.test(line)) {
      return finding("SEC-REMOTE-DEFAULT", "Remote access command uses risky or underspecified defaults", "safety", "high", document, line);
    }
    if (ENV_COPY_PATTERN.test(line)) {
      return finding("SEC-ENV-COPY", "Command may pass broad environment into subprocess execution", "safety", "medium", document, line);
    }
    return undefined;
  }, "Validate targets, avoid unsafe defaults, prefer argument arrays, and require explicit confirmation for privileged or destructive work.");
}

function shapeFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "skill") return [];

  const findings: Finding[] = [];
  const text = document.artifact.content.toLowerCase();
  const tokenCount = approximateTokenCount(document.artifact.content);
  const description = document.metadata.description ?? "";

  if (!description && !/\bdescription\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-DESCRIPTION", "Skill is missing an explicit description", "quality", "medium", "Add a short description that states when an agent should use the skill."));
  } else if (description.length > 0 && description.length < DESCRIPTION_MIN_CHARS) {
    findings.push(documentFinding(document, "QUAL-SHORT-DESCRIPTION", "Skill description is too short for routing clarity", "quality", "low", `Expand the frontmatter description to at least ${DESCRIPTION_MIN_CHARS} characters with clear usage and routing guidance.`));
  }

  if (tokenCount > SKILL_TOKEN_LIMIT) {
    findings.push(documentFinding(document, "QUAL-SKILL-TOKEN-BUDGET", "Skill entrypoint exceeds token budget", "quality", "medium", `Keep SKILL.md under about ${SKILL_TOKEN_LIMIT} tokens by moving detailed procedures, command catalogs, and troubleshooting tables into references/.`));
  }

  if (!/do not use for|non-goals|out of scope/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-NEGATIVE-ROUTING", "Skill lacks negative routing guidance", "structure", "medium", "Add a DO NOT USE FOR or non-goals section so agents know when to choose another path."));
  }

  if (!/\butility skill\b|\binvokes\b|\bfor single operations\b|\bwhen to use\b|\buse this skill\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-ROUTING-CLARITY", "Skill lacks explicit routing clarity", "structure", "low", "Add concise routing language such as when to use the skill, whether it invokes other skills, or whether it is a utility skill for single operations."));
  }

  if (!/\bexample|examples\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-EXAMPLES", "Skill lacks examples", "quality", "low", "Add concise examples that demonstrate expected inputs, outputs, or routing behavior."));
  }

  if (!/\bpreflight|before you start|first\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-PREFLIGHT", "Skill lacks an explicit preflight step", "quality", "medium", "Add a preflight step that captures environment, permissions, target files, and assumptions before acting."));
  }

  if (!/\bverify|verification|test\b/.test(text)) {
    findings.push(documentFinding(document, "QUAL-MISSING-VERIFICATION", "Skill lacks verification guidance", "quality", "medium", "State what command, check, or evidence verifies the work."));
  }

  if (document.lines.length > 120 && document.headings.length < 4) {
    findings.push(documentFinding(document, "QUAL-LOW-HEADING-DENSITY", "Long skill has low heading density", "quality", "low", "Split long guidance into clear sections or move detailed material into references/."));
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

function skillCoverageFindings(documents: ParsedDocument[]): Finding[] {
  const evalPaths = new Set(documents.filter((document) => document.artifact.kind === "eval").map((document) => document.artifact.path));
  const skills = documents.filter((document) => document.artifact.kind === "skill");

  return skills.flatMap((skill) => {
    const directory = path.posix.dirname(skill.artifact.path);
    const skillName = path.posix.basename(directory);
    const covered = [
      path.posix.join("evals", skillName, "eval.yaml"),
      path.posix.join("evals", skillName, "eval.yml"),
      path.posix.join("evals", skillName, "eval.json"),
      path.posix.join(directory, "eval.yaml"),
      path.posix.join(directory, "eval.yml"),
      path.posix.join(directory, "eval.json"),
      path.posix.join(directory, "evals", "eval.yaml"),
      path.posix.join(directory, "evals", "eval.yml"),
      path.posix.join(directory, "evals", "eval.json")
    ].some((candidate) => evalPaths.has(candidate));

    if (covered) return [];
    return [documentFinding(skill, "EVAL-MISSING-SKILL-COVERAGE", "Skill has no eval coverage", "eval", "low", "Add eval coverage under top-level evals/<skill-name>/eval.yaml so behavior can be regression-tested without loading eval prompts during normal skill use.")];
  });
}

function matchingLineFindings(
  document: ParsedDocument,
  matcher: (line: string) => Omit<Finding, "evidence" | "remediation" | "whyItMatters"> | undefined,
  remediation: string
): Finding[] {
  const findings: Finding[] = [];
  document.lines.forEach((line, index) => {
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
): Omit<Finding, "evidence" | "remediation" | "whyItMatters"> {
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

function approximateTokenCount(text: string): number {
  const matches = text.match(/[A-Za-z0-9_./+=-]+|[^\sA-Za-z0-9_./+=-]/g);
  return matches?.length ?? 0;
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
  return /confirm|confirmation|backup|rollback|dry-run|explicit (?:approval|request|requested|permission)|explicitly request(?:s|ed)?/.test(window);
}
