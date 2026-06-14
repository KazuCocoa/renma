import path from "node:path";
import type { Evidence, Finding, ParsedDocument, ScanConfig, Severity } from "./types.js";

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

export function runRules(documents: ParsedDocument[], config: ScanConfig): Finding[] {
  const findings = documents.flatMap((document) => [
    ...secretFindings(document),
    ...commandFindings(document),
    ...shapeFindings(document),
    ...profileFindings(document),
    ...evalFindings(document, config),
    ...evalTaskFindings(document)
  ]);

  findings.push(...skillCoverageFindings(documents));
  findings.push(...contextOrchestrationFindings(documents));
  findings.push(...evalTaskReferenceFindings(documents));
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

function evalFindings(document: ParsedDocument, config: ScanConfig): Finding[] {
  if (document.artifact.kind !== "eval") return [];
  const text = document.artifact.content.toLowerCase();
  const findings: Finding[] = evalShapeFindings(document);
  findings.push(...evalExecutorFindings(document, config));

  if (!/refusal|confirmation|permission/.test(text)) {
    findings.push(documentFinding(document, "EVAL-MISSING-SAFETY-CASE", "Eval manifest lacks a refusal or confirmation safety case", "eval", "medium", "Add an eval that proves destructive or privileged work requires confirmation."));
  }

  if (!/missing|credential|host|failure/.test(text)) {
    findings.push(documentFinding(document, "EVAL-MISSING-FAILURE-CASE", "Eval manifest lacks a missing-context or failure case", "eval", "low", "Add an eval for missing credentials, unavailable tools, or unspecified targets."));
  }

  return findings;
}

function evalExecutorFindings(document: ParsedDocument, config: ScanConfig): Finding[] {
  const executor = extractScalar(document.artifact.content, "executor");
  if (!executor) return [];

  const normalized = executor.toLowerCase();
  const expected = config.evalExecutor.toLowerCase();
  if (normalized === expected || normalized === "mock") return [];

  if (normalized.includes("copilot")) {
    return [
      documentFinding(document, "EVAL-COPILOT-EXECUTOR", "Eval manifest still uses a Copilot executor", "eval", "medium", `Use executor: ${config.evalExecutor}, or set RENMA_EVAL_EXECUTOR when this repository intentionally targets another runner.`)
    ];
  }

  return [
    documentFinding(document, "EVAL-UNEXPECTED-EXECUTOR", "Eval manifest uses a different executor than configured", "eval", "low", `Use executor: ${config.evalExecutor}, or set eval_executor / RENMA_EVAL_EXECUTOR to the intended runner.`)
  ];
}

function evalShapeFindings(document: ParsedDocument): Finding[] {
  const content = document.artifact.content;
  const ext = path.extname(document.artifact.path).toLowerCase();

  if (ext === ".json") {
    return jsonEvalShapeFindings(document, content);
  }

  return yamlEvalShapeFindings(document, content);
}

function jsonEvalShapeFindings(document: ParsedDocument, content: string): Finding[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return [
      documentFinding(document, "EVAL-MALFORMED-MANIFEST", "Eval manifest is not valid JSON", "eval", "medium", "Fix the eval manifest so it can be parsed before Waza or another eval runner consumes it.")
    ];
  }

  if (!isRecord(value) || !Array.isArray(value.tasks) || !value.tasks.every((task) => typeof task === "string" && task.trim().length > 0)) {
    return [
      documentFinding(document, "EVAL-MALFORMED-MANIFEST", "Eval manifest does not declare a Waza-style tasks list", "eval", "medium", "Use a top-level tasks array such as tasks: [\"tasks/*.yaml\"] or YAML list entries.")
    ];
  }

  return malformedRegexMatchValues(value)
    ? [documentFinding(document, "EVAL-MALFORMED-GRADER", "Eval grader has malformed regex_match parameters", "eval", "medium", "Set regex_match to a list of regex strings, matching Waza grader schema expectations.")]
    : [];
}

function yamlEvalShapeFindings(document: ParsedDocument, content: string): Finding[] {
  const findings: Finding[] = [];
  const tasksLine = content.match(/^tasks:[^\S\r\n]*(.*)$/m);

  if (!tasksLine) {
    findings.push(documentFinding(document, "EVAL-MALFORMED-MANIFEST", "Eval manifest does not declare a Waza-style tasks list", "eval", "medium", "Use top-level tasks entries that point at task YAML files, for example tasks/*.yaml."));
  } else {
    const inlineValue = tasksLine[1]?.trim() ?? "";
    const hasListBlock = /^tasks:[^\S\r\n]*$/m.test(content) && /^tasks:[^\S\r\n]*$[\s\S]*?^[^\S\r\n]*-[^\S\r\n]+\S/m.test(content);
    const hasInlineList = /^\[[^\]]+\]$/.test(inlineValue);
    if (inlineValue !== "" && !hasInlineList || inlineValue === "" && !hasListBlock) {
      findings.push(documentFinding(document, "EVAL-MALFORMED-MANIFEST", "Eval manifest tasks field is not a list", "eval", "medium", "Make tasks a YAML list of task file globs, matching Waza eval.yaml shape."));
    }
  }

  if (/^[^\S\r\n]*(?:-[^\S\r\n]*)?regex_match:[^\S\r\n]*(?!$|\[|-)/m.test(content)) {
    findings.push(documentFinding(document, "EVAL-MALFORMED-GRADER", "Eval grader has malformed regex_match parameters", "eval", "medium", "Set regex_match to a YAML list of regex strings, not a scalar value."));
  }

  return findings;
}

function evalTaskFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "eval_task") return [];

  const content = document.artifact.content;
  const ext = path.extname(document.artifact.path).toLowerCase();
  if (ext === ".json") {
    return jsonEvalTaskFindings(document, content);
  }

  return yamlEvalTaskFindings(document, content);
}

function jsonEvalTaskFindings(document: ParsedDocument, content: string): Finding[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return [
      documentFinding(document, "EVAL-TASK-MALFORMED", "Eval task file is not valid JSON", "eval", "medium", "Fix the task file so the eval runner can parse it.")
    ];
  }

  if (!isRecord(value)) {
    return [
      documentFinding(document, "EVAL-TASK-MALFORMED", "Eval task file is not an object", "eval", "medium", "Make the task file a single task object with id, name, and prompt or prompt_file.")
    ];
  }

  const findings: Finding[] = [];
  if (!hasNonEmptyString(value, "prompt") && !hasNonEmptyString(value, "prompt_file")) {
    findings.push(documentFinding(document, "EVAL-TASK-MISSING-PROMPT", "Eval task lacks prompt or prompt_file", "eval", "medium", "Add prompt or prompt_file so the eval runner has a scenario to execute."));
  }
  if (!hasNonEmptyString(value, "id") || !hasNonEmptyString(value, "name")) {
    findings.push(documentFinding(document, "EVAL-TASK-MISSING-IDENTITY", "Eval task lacks id or name", "eval", "low", "Add stable id and name fields so task results are readable and comparable."));
  }
  if (hasMalformedStringList(value, "output_contains") || hasMalformedStringList(value, "output_not_contains")) {
    findings.push(documentFinding(document, "EVAL-TASK-MALFORMED-ASSERTIONS", "Eval task assertion fields are not string lists", "eval", "medium", "Make output_contains and output_not_contains arrays of strings."));
  }

  return findings;
}

function yamlEvalTaskFindings(document: ParsedDocument, content: string): Finding[] {
  const findings: Finding[] = [];
  if (!extractScalar(content, "prompt") && !extractScalar(content, "prompt_file")) {
    findings.push(documentFinding(document, "EVAL-TASK-MISSING-PROMPT", "Eval task lacks prompt or prompt_file", "eval", "medium", "Add prompt or prompt_file so the eval runner has a scenario to execute."));
  }
  if (!extractScalar(content, "id") || !extractScalar(content, "name")) {
    findings.push(documentFinding(document, "EVAL-TASK-MISSING-IDENTITY", "Eval task lacks id or name", "eval", "low", "Add stable id and name fields so task results are readable and comparable."));
  }
  if (yamlScalarListField(content, "output_contains") || yamlScalarListField(content, "output_not_contains")) {
    findings.push(documentFinding(document, "EVAL-TASK-MALFORMED-ASSERTIONS", "Eval task assertion fields are not string lists", "eval", "medium", "Make output_contains and output_not_contains YAML lists of strings."));
  }

  return findings;
}

function evalTaskReferenceFindings(documents: ParsedDocument[]): Finding[] {
  const taskPaths = documents.filter((document) => document.artifact.kind === "eval_task").map((document) => document.artifact.path);
  return documents.filter((document) => document.artifact.kind === "eval").flatMap((document) => {
    const patterns = extractTaskPatterns(document);
    if (patterns.length === 0) return [];

    const base = path.posix.dirname(document.artifact.path);
    return patterns.flatMap((pattern) => {
      const resolvedPattern = path.posix.normalize(path.posix.join(base, pattern));
      const matches = taskPaths.some((taskPath) => globMatch(resolvedPattern, taskPath));
      return matches
        ? []
        : [documentFinding(document, "EVAL-TASKS-NOT-FOUND", "Eval manifest tasks entry does not match any scanned task file", "eval", "medium", `Create task files matching ${pattern}, or update tasks to point at existing files.`)];
    });
  });
}

function contextOrchestrationFindings(documents: ParsedDocument[]): Finding[] {
  const skills = documents.filter((document) => document.artifact.kind === "skill");
  return skills.flatMap((skill) => {
    const skillDir = path.posix.dirname(skill.artifact.path);
    const contextDocs = documents.filter((document) =>
      ["profile", "reference", "example"].includes(document.artifact.kind) &&
      document.artifact.path.startsWith(`${skillDir}/`)
    );
    if (contextDocs.length === 0) return [];

    const findings: Finding[] = [];
    const text = skill.artifact.content.toLowerCase();
    const hasContextRouting = /context selection|context map|mixin|profiles?\/|references?\/|examples?\/|load .*?(?:profile|reference|example)|select .*?(?:profile|reference|example)/.test(text);
    if (!hasContextRouting) {
      findings.push(documentFinding(skill, "CTX-MISSING-ROUTING-MAP", "Skill has context files but no routing map", "structure", "medium", "Add context-selection guidance so the top-level skill tells the LLM when to load profiles, references, examples, or scripts."));
    }

    for (const document of contextDocs) {
      const name = path.posix.basename(document.artifact.path, path.posix.extname(document.artifact.path));
      const routedByPath = skill.artifact.content.includes(document.artifact.path);
      const routedByName = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(skill.artifact.content);
      if (!routedByPath && !routedByName) {
        findings.push(documentFinding(document, contextUnusedRuleId(document.artifact.kind), "Context file is not routed from the skill", "structure", "low", "Reference this context from SKILL.md or a context map with clear when-to-load guidance."));
      }
    }

    return findings;
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string" && value[key].trim().length > 0;
}

function hasMalformedStringList(value: Record<string, unknown>, key: string): boolean {
  return value[key] !== undefined && (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string" && item.trim().length > 0));
}

function malformedRegexMatchValues(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => malformedRegexMatchValues(item));
  if (!isRecord(value)) return false;

  for (const [key, child] of Object.entries(value)) {
    if (key === "regex_match") {
      return !Array.isArray(child) || !child.every((item) => typeof item === "string" && item.trim().length > 0);
    }
    if (malformedRegexMatchValues(child)) return true;
  }

  return false;
}

function contextUnusedRuleId(kind: ParsedDocument["artifact"]["kind"]): string {
  if (kind === "profile") return "CTX-UNUSED-PROFILE";
  if (kind === "example") return "CTX-UNUSED-EXAMPLE";
  return "CTX-UNUSED-REFERENCE";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractScalar(content: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^[^\\S\\r\\n]*(?:-[^\\S\\r\\n]*)?${escapedKey}:[^\\S\\r\\n]*(.+)$`, "m"));
  const value = match?.[1]?.trim();
  if (!value || value === "[]" || value === "{}") return undefined;
  return unquote(value);
}

function extractTaskPatterns(document: ParsedDocument): string[] {
  const content = document.artifact.content;
  if (path.extname(document.artifact.path).toLowerCase() === ".json") {
    try {
      const value = JSON.parse(content) as unknown;
      return isRecord(value) && Array.isArray(value.tasks)
        ? value.tasks.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }

  return extractYamlStringList(content, "tasks");
}

function extractYamlStringList(content: string, key: string): string[] {
  const inline = extractScalar(content, key);
  if (inline?.startsWith("[") && inline.endsWith("]")) {
    return inline
      .slice(1, -1)
      .split(",")
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^[^\\S\\r\\n]*${escapedKey}:[^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)(?=^[^\\S\\r\\n]*[A-Za-z0-9_-]+:|\\s*$)`, "m"));
  if (!match) return [];
  return (match[1] ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^[^\S\r\n]*-[^\S\r\n]+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item))
    .map(unquote);
}

function yamlScalarListField(content: string, key: string): boolean {
  const value = extractScalar(content, key);
  return value !== undefined && !value.startsWith("[");
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(value);
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
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
