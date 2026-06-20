import path from "node:path";
import { runRuleRegistry, type Rule } from "./rule-engine.js";
import type { Evidence, Finding, ParsedDocument, Severity } from "./types.js";

const SECRET_PATTERN =
  /\b(?:password|passwd|token|api[_-]?key|secret|credential|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{8,})/i;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/;
const DESTRUCTIVE_PATTERN =
  /\b(?:rm\s+-rf|mkfs|dd\s+if=|chmod\s+-R\s+777|chown\s+-R|sudo\s+(?:rm|dd|mkfs|chmod|chown)|git\s+clean\s+-fdx|docker\s+system\s+prune)\b/i;
const REMOTE_PATTERN =
  /\b(?:curl|wget)\b.*(?:\|\s*(?:sh|bash)|\b(?:example\.com|prod|production|--insecure|-k)\b)|\b(?:ssh|scp)\b.*\b(?:example\.com|prod|production|root@|--insecure|-k|StrictHostKeyChecking=no|UserKnownHostsFile=\/dev\/null)\b/i;
const ENV_COPY_PATTERN =
  /\b(?:process\.env|env)\b.*\b(?:spawn|exec|execFile|system|subprocess|child_process)\b|\b(?:spawn|exec|execFile|system|subprocess|child_process)\b.*\b(?:process\.env|env)\b/i;
const USER_LOCAL_PATH_PATTERN =
  /(?:^|[^a-z0-9_])(?:\/Users\/[^\s/\\]+|\/home\/[^\s/\\]+|[A-Za-z]:\\Users\\[^\s\\]+)(?:\/|$)/iu;

const SKILL_TOKEN_LIMIT = 500;
const DESCRIPTION_MIN_CHARS = 150;
const CONTEXT_TOKEN_LIMITS = {
  context: 1200,
  profile: 500,
  reference: 800,
  example: 800,
} as const;

/** Run all deterministic rules and return findings in stable source order. */
export function runRules(documents: ParsedDocument[]): Finding[] {
  const findings = runRuleRegistry(documents, RULES);
  return findings.sort((a, b) => {
    const byPath = a.evidence.path.localeCompare(b.evidence.path);
    if (byPath !== 0) return byPath;
    return a.evidence.startLine - b.evidence.startLine;
  });
}

const RULES: Rule[] = [
  {
    id: "security",
    run: ({ documents }) =>
      documents.flatMap((document) => [
        ...secretFindings(document),
        ...commandFindings(document),
      ]),
  },
  {
    id: "shape",
    run: ({ documents }) =>
      documents.flatMap((document) => [
        ...shapeFindings(document),
        ...contextBudgetFindings(document),
        ...profileFindings(document),
      ]),
  },
  {
    id: "skill-local-support-reachability",
    run: ({ documents }) => skillLocalSupportReachabilityFindings(documents),
  },
];

/** Return whether a severity is at least as severe as a configured threshold. */
export function severityMeets(value: Severity, threshold: Severity): boolean {
  const order: Record<Severity, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };
  return order[value] >= order[threshold];
}

function secretFindings(document: ParsedDocument): Finding[] {
  return matchingLineFindings(document, (line) => {
    if (PRIVATE_KEY_PATTERN.test(line)) {
      return finding(
        "SEC-PRIVATE-KEY",
        "Private key material appears in repository text",
        "safety",
        "critical",
        document,
        "Remove the key, rotate it if real, and keep only setup instructions or placeholders.",
      );
    }
    if (SECRET_PATTERN.test(line) && !isPlaceholder(line)) {
      return finding(
        "SEC-LITERAL-SECRET",
        "Literal credential-like value appears in repository text",
        "safety",
        "high",
        document,
        "Move secrets to user-approved inputs or a secret manager, and keep only placeholders in repository files.",
      );
    }
    return undefined;
  });
}

function commandFindings(document: ParsedDocument): Finding[] {
  return matchingLineFindings(document, (line) => {
    if (isSuppressed(line)) return undefined;
    if (
      DESTRUCTIVE_PATTERN.test(line) &&
      !hasNearbyConfirmation(document.lines, line)
    ) {
      return finding(
        "SEC-DESTRUCTIVE-COMMAND",
        "Dangerous command lacks explicit confirmation or recovery guard",
        "safety",
        "high",
        document,
        "Require explicit user confirmation, add dry-run/backup guidance, and describe rollback or verification.",
      );
    }
    if (REMOTE_PATTERN.test(line)) {
      return finding(
        "SEC-REMOTE-DEFAULT",
        "Remote command example uses unsafe default",
        "safety",
        "medium",
        document,
        "Avoid production placeholders, insecure transport flags, and pipe-to-shell patterns unless paired with verification and confirmation.",
      );
    }
    if (ENV_COPY_PATTERN.test(line)) {
      return finding(
        "SEC-ENV-COPY",
        "Command may pass broad environment into subprocess execution",
        "safety",
        "medium",
        document,
        "Pass only required environment variables to subprocesses and avoid forwarding secrets by default.",
      );
    }
    return undefined;
  });
}

function shapeFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "skill" && document.artifact.kind !== "agent")
    return [];

  const text = document.artifact.content.toLowerCase();
  const findings: Finding[] = [];
  const description = document.metadata.description ?? "";
  const tokenCount = approximateTokenCount(document.artifact.content);

  if (!description) {
    findings.push(
      documentFinding(
        document,
        "QUAL-MISSING-DESCRIPTION",
        "Skill is missing an explicit description",
        "quality",
        "medium",
        "Add frontmatter description so agents can route to the skill intentionally.",
      ),
    );
  } else if (
    document.artifact.kind === "skill" &&
    description.length < DESCRIPTION_MIN_CHARS
  ) {
    findings.push(
      documentFinding(
        document,
        "QUAL-SHORT-DESCRIPTION",
        "Skill description is too short for routing clarity",
        "quality",
        "low",
        `Expand frontmatter description to at least ${DESCRIPTION_MIN_CHARS} characters with usage routing guidance.`,
      ),
    );
  }

  if (document.artifact.kind === "skill" && tokenCount > SKILL_TOKEN_LIMIT) {
    findings.push(
      documentFinding(
        document,
        "QUAL-SKILL-TOKEN-BUDGET",
        "Skill entrypoint exceeds token budget",
        "quality",
        "medium",
        `Keep SKILL.md under about ${SKILL_TOKEN_LIMIT} tokens as a compact router. Move detailed procedures into reference files, but preserve them losslessly in ordered parts when needed. Do not delete, summarize, or merge away procedural steps. SKILL.md should route to every required reference or index without embedding the full procedure.`,
      ),
    );
  }

  if (
    document.artifact.kind === "skill" &&
    USER_LOCAL_PATH_PATTERN.test(text)
  ) {
    findings.push(
      documentFinding(
        document,
        "QUAL-USER-LOCAL-PATHS",
        "Skill uses hardcoded user home paths in instructions",
        "quality",
        "medium",
        "Use repo-relative or environment-agnostic paths in skill instructions. If a local path is unavoidable, parameterize it and avoid hardcoding a user-specific home directory such as `/Users/alice/...` or `/home/alice/...`.",
      ),
    );
  }

  if (!/do not use for|non-goals|out of scope/.test(text)) {
    findings.push(
      documentFinding(
        document,
        "QUAL-MISSING-NEGATIVE-ROUTING",
        "Skill lacks negative routing guidance",
        "structure",
        "medium",
        "Add a DO NOT USE FOR or non-goals section so agents know when to choose another path.",
      ),
    );
  }

  if (
    !/use this skill|when to use|trigger|routing|context route|mixin/.test(text)
  ) {
    findings.push(
      documentFinding(
        document,
        "QUAL-MISSING-ROUTING-CLARITY",
        "Skill lacks routing clarity",
        "quality",
        "low",
        "Add concise routing language: when to use the skill, whether it invokes other skills, or whether it is a utility skill for single operations.",
      ),
    );
  }

  if (!/example|input|output/.test(text)) {
    findings.push(
      documentFinding(
        document,
        "QUAL-MISSING-EXAMPLES",
        "Skill lacks examples",
        "quality",
        "low",
        "Add examples that show representative inputs, outputs, or behavior.",
      ),
    );
  }

  if (
    !/preflight|before you begin|first check|prerequisite|context/.test(text)
  ) {
    findings.push(
      documentFinding(
        document,
        "QUAL-MISSING-PREFLIGHT",
        "Skill lacks a preflight step",
        "quality",
        "medium",
        "Add a preflight section that captures environment, permissions, target files, and assumptions before acting.",
      ),
    );
  }

  if (!/verify|validation|test|confirm result|expected output/.test(text)) {
    findings.push(
      documentFinding(
        document,
        "QUAL-MISSING-VERIFICATION",
        "Skill lacks verification guidance",
        "quality",
        "medium",
        "State how to verify success with a command, check, or observable result.",
      ),
    );
  }

  if (
    document.headings.length < 2 &&
    document.artifact.content.split(/\s+/).length > 120
  ) {
    findings.push(
      documentFinding(
        document,
        "QUAL-LOW-HEADING-DENSITY",
        "Long instruction file has few headings",
        "structure",
        "low",
        "Split long prose into task-oriented headings so agents can navigate it reliably.",
      ),
    );
  }

  return findings;
}

function contextBudgetFindings(document: ParsedDocument): Finding[] {
  if (
    document.artifact.kind !== "context" &&
    document.artifact.kind !== "profile" &&
    document.artifact.kind !== "reference" &&
    document.artifact.kind !== "example"
  ) {
    return [];
  }

  const limit = CONTEXT_TOKEN_LIMITS[document.artifact.kind];
  const tokenCount = approximateTokenCount(document.artifact.content);
  if (tokenCount <= limit) return [];

  return [
    documentFinding(
      document,
      "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
      "Support asset exceeds token guidance",
      "quality",
      "low",
      `Keep ${document.artifact.kind} assets under about ${limit} tokens where practical. If a file is too large, run \`renma suggest-semantic-split ${document.artifact.path}\` to get a semantic split proposal, then split it losslessly into meaning-based ordered part files. Do not delete, summarize, or merge away procedural steps. The parent file or SKILL.md should reference every part in order, and the split should preserve the original procedure text exactly. Verify by reconstructing the parts and comparing them to the original content before accepting the fix.`,
    ),
  ];
}

function profileFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "profile") return [];
  const text = document.artifact.content.toLowerCase();
  if (/base[_ -]?skill|extends/.test(text)) return [];
  return [
    documentFinding(
      document,
      "PROF-MISSING-BASE",
      "Profile overlay does not declare its base skill",
      "structure",
      "medium",
      "Declare the base skill or compatibility target so routing conflicts are auditable.",
    ),
  ];
}

function skillLocalSupportReachabilityFindings(
  documents: ParsedDocument[],
): Finding[] {
  const skills = documents.filter(
    (document) => document.artifact.kind === "skill",
  );
  return skills.flatMap((skill) => {
    const skillDir = path.posix.dirname(skill.artifact.path);
    const localSupportDocs = documents.filter(
      (document) =>
        ["profile", "reference", "example"].includes(document.artifact.kind) &&
        document.artifact.path.startsWith(`${skillDir}/`),
    );
    if (localSupportDocs.length === 0) return [];

    const findings: Finding[] = [];
    const text = skill.artifact.content.toLowerCase();
    const hasLocalSupportGuidance =
      /support file|local support|context route|context map|mixin|profiles?\/|references?\/|examples?\/|load .*?(?:profile|reference|example)|reference .*?(?:profile|reference|example)/.test(
        text,
      );
    if (!hasLocalSupportGuidance) {
      findings.push(
        documentFinding(
          skill,
          "SUPPORT-MISSING-REACHABILITY-GUIDANCE",
          "Skill has local support files but no reachability guidance",
          "structure",
          "medium",
          "Add local support file reachability guidance so the top-level skill declares when profiles, references, examples, or scripts are reachable. If support content was split into ordered parts, reference the index or all parts in order. Preserve original concrete steps. Do not delete, summarize, or merge away procedural steps.",
        ),
      );
    }

    const reachableLocalSupportPaths = reachableLocalSupportDocuments(
      skill,
      localSupportDocs,
    );
    for (const document of localSupportDocs) {
      if (!reachableLocalSupportPaths.has(document.artifact.path)) {
        findings.push(
          documentFinding(
            document,
            localSupportUnreachableRuleId(document.artifact.kind),
            "Local support file is not reachable from the skill",
            "structure",
            "low",
            "Reference this local support file from SKILL.md or from a referenced parent support file with clear reachability guidance. If this file is a split part, ensure the parent skill references the index or all ordered parts so preserved details remain reachable. Do not delete, summarize, or merge away procedural steps just to satisfy the check.",
          ),
        );
      }
    }

    return findings;
  });
}

function reachableLocalSupportDocuments(
  skill: ParsedDocument,
  localSupportDocs: ParsedDocument[],
): Set<string> {
  const reachable = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const document of localSupportDocs) {
      if (reachable.has(document.artifact.path)) continue;
      const possibleRouters = [
        skill,
        ...localSupportDocs.filter((candidate) =>
          reachable.has(candidate.artifact.path),
        ),
      ];
      if (possibleRouters.some((router) => routesTo(router, document))) {
        reachable.add(document.artifact.path);
        changed = true;
      }
    }
  }

  return reachable;
}

function routesTo(source: ParsedDocument, target: ParsedDocument): boolean {
  const name = path.posix.basename(
    target.artifact.path,
    path.posix.extname(target.artifact.path),
  );
  const basename = path.posix.basename(target.artifact.path);
  return (
    source.artifact.content.includes(target.artifact.path) ||
    source.artifact.content.includes(basename) ||
    new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(source.artifact.content)
  );
}

function matchingLineFindings(
  document: ParsedDocument,
  matcher: (line: string) => Omit<Finding, "evidence"> | undefined,
): Finding[] {
  return document.lines.flatMap((line, index) => {
    const partial = matcher(line);
    if (!partial) return [];
    return [
      {
        ...partial,
        evidence: evidence(document, index + 1, line),
        remediation: partial.remediation,
      },
    ];
  });
}

function finding(
  id: string,
  title: string,
  category: Finding["category"],
  severity: Severity,
  document: ParsedDocument,
  remediation: string,
): Omit<Finding, "evidence" | "remediation"> & { remediation: string } {
  return {
    id,
    title,
    category,
    severity,
    confidence: "high",
    whyItMatters:
      "Skills and repository instructions are loaded into agent context, so risky or unclear text can become risky behavior.",
    remediation,
  };
}

function documentFinding(
  document: ParsedDocument,
  id: string,
  title: string,
  category: Finding["category"],
  severity: Severity,
  remediation: string,
): Finding {
  const firstContentLine = document.lines.findIndex(
    (line) => line.trim().length > 0,
  );
  const lineNumber = firstContentLine >= 0 ? firstContentLine + 1 : 1;
  return {
    id,
    title,
    category,
    severity,
    confidence: "medium",
    evidence: evidence(
      document,
      lineNumber,
      document.lines[firstContentLine] ?? "",
    ),
    whyItMatters:
      "Clear skill structure helps agents choose the right workflow and report useful evidence.",
    remediation,
  };
}

function evidence(
  document: ParsedDocument,
  line: number,
  snippet: string,
): Evidence {
  return {
    path: document.artifact.path,
    startLine: line,
    endLine: line,
    snippet: snippet.trim().slice(0, 240),
  };
}

function localSupportUnreachableRuleId(
  kind: ParsedDocument["artifact"]["kind"],
): string {
  if (kind === "profile") return "SUPPORT-UNREACHABLE-PROFILE";
  if (kind === "example") return "SUPPORT-UNREACHABLE-EXAMPLE";
  return "SUPPORT-UNREACHABLE-REFERENCE";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const window = lines
    .slice(Math.max(0, index - 3), Math.min(lines.length, index + 4))
    .join("\n")
    .toLowerCase();
  return /confirm|confirmation|backup|rollback|dry-run|explicit (?:approval|request|requested|permission)|explicitly request(?:s|ed)?/.test(
    window,
  );
}
