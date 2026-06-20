import path from "node:path";
import { runRuleRegistry, type Rule } from "./rule-engine.js";
import type { Evidence, Finding, ParsedDocument, Severity } from "./types.js";

type FindingDetails = Partial<
  Pick<
    Finding,
    "whyItMatters" | "constraints" | "verificationSteps" | "llmHint"
  >
>;

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
const REUSABLE_CONTEXT_MIN_LINES = 24;
const REUSABLE_CONTEXT_MIN_TOKENS = 180;
const REUSABLE_CONTEXT_MIN_SIGNALS = 3;
const SUPPORT_SHARED_CONTEXT_MIN_LINES = 18;
const SUPPORT_SHARED_CONTEXT_MIN_TOKENS = 140;
const SUPPORT_SHARED_CONTEXT_MIN_HEADINGS = 2;
const SUPPORT_SHARED_CONTEXT_MIN_PHRASES = 2;
const REUSABLE_CONTEXT_HEADING_PATTERNS: Array<[RegExp, string]> = [
  [/\bsetup\b/i, "Setup"],
  [/\binstallation\b/i, "Installation"],
  [/\bconfiguration\b/i, "Configuration"],
  [/\benvironment\b/i, "Environment"],
  [/\bprerequisites?\b/i, "Prerequisites"],
  [/\bplatform\b/i, "Platform"],
  [/\btroubleshooting\b/i, "Troubleshooting"],
  [/\bknown issues?\b/i, "Known Issues"],
  [/\blimitations?\b/i, "Limitations"],
  [/\bbest practices?\b/i, "Best Practices"],
  [/\btesting heuristics?\b/i, "Testing Heuristics"],
  [/\btest strategy\b/i, "Test Strategy"],
  [/\bverification\b/i, "Verification"],
  [/\bexamples?\b/i, "Examples"],
  [/\bedge cases?\b/i, "Edge Cases"],
  [/\brisks?\b/i, "Risks"],
  [/\bdomain rules?\b/i, "Domain Rules"],
  [/\bfailure modes?\b/i, "Failure Modes"],
  [/\bflaky tests?\b/i, "Flaky Tests"],
];
const REUSABLE_CONTEXT_PHRASE_PATTERNS: Array<[RegExp, string]> = [
  [/\buse this when\b/i, "use this when"],
  [/\bknown issue\b/i, "known issue"],
  [/\blimitation\b/i, "limitation"],
  [/\btroubleshooting\b/i, "troubleshooting"],
  [/\bflaky\b/i, "flaky"],
  [/\bretry\b/i, "retry"],
  [/\bplatform-specific\b/i, "platform-specific"],
  [/\bedge case\b/i, "edge case"],
  [/\brisk\b/i, "risk"],
  [/\bheuristic\b/i, "heuristic"],
  [/\bbest practice\b/i, "best practice"],
  [/\bdo not\b/i, "do not"],
  [/\bavoid\b/i, "avoid"],
  [/\balways\b/i, "always"],
  [/\bnever\b/i, "never"],
];

const SUPPORT_SHARED_CONTEXT_HEADING_PATTERNS: Array<[RegExp, string]> = [
  ...REUSABLE_CONTEXT_HEADING_PATTERNS,
  [/\bdecision logic\b/i, "Decision Logic"],
  [/\bsafety notes?\b/i, "Safety Notes"],
  [/\bvalidation\b/i, "Validation"],
  [/\boperating model\b/i, "Operating Model"],
  [/\bpolicy\b/i, "Policy"],
  [/\bguidelines?\b/i, "Guidelines"],
  [/\bprocedures?\b/i, "Procedure"],
  [/\bchecklist\b/i, "Checklist"],
  [/\bcompatibility\b/i, "Compatibility"],
  [/\bconstraints?\b/i, "Constraints"],
];

const SUPPORT_SHARED_CONTEXT_PHRASE_PATTERNS: Array<[RegExp, string]> = [
  [/\bmust\b/i, "must"],
  [/\bshould\b/i, "should"],
  [/\balways\b/i, "always"],
  [/\bnever\b/i, "never"],
  [/\bavoid\b/i, "avoid"],
  [/\bprefer\b/i, "prefer"],
  [/\bdo not\b/i, "do not"],
  [/\brequired\b/i, "required"],
  [/\brecommended\b/i, "recommended"],
  [/\bknown issue\b/i, "known issue"],
  [/\blimitation\b/i, "limitation"],
  [/\bfailure mode\b/i, "failure mode"],
  [/\btroubleshooting\b/i, "troubleshooting"],
  [/\bedge case\b/i, "edge case"],
  [/\brisk\b/i, "risk"],
  [/\bbest practice\b/i, "best practice"],
  [/\bvalidate\b/i, "validate"],
  [/\bverify\b/i, "verify"],
];
const NON_SEMANTIC_CONTEXT_PATH_SEGMENTS = new Set([
  "promoted",
  "generated",
  "split",
  "migrated",
  "migration",
  "new",
  "old",
  "tmp",
  "temp",
  "draft",
  "drafts",
  "wip",
  "misc",
  "miscellaneous",
  "todo",
  "review",
  "staging",
  "candidate",
  "candidates",
]);
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
  {
    id: "support-asset-shared-context-candidate",
    run: ({ documents }) =>
      documents.flatMap((document) => supportSharedContextCandidateFindings(document)),
  },
  {
    id: "context-path-non-semantic",
    run: ({ documents }) =>
      documents.flatMap((document) => contextPathNonSemanticFindings(document)),
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

  const reusableContextFinding = reusableContextCandidateFinding(
    document,
    tokenCount,
  );
  if (reusableContextFinding) findings.push(reusableContextFinding);

  if (document.artifact.kind === "skill" && tokenCount > SKILL_TOKEN_LIMIT) {
    findings.push(
      documentFinding(
        document,
        "QUAL-SKILL-TOKEN-BUDGET",
        "Skill entrypoint exceeds token budget",
        "quality",
        "medium",
        `Keep SKILL.md under about ${SKILL_TOKEN_LIMIT} tokens as a compact usage guide. Move detailed procedures into reference files, but preserve them losslessly in ordered parts when needed. Do not delete, summarize, or merge away procedural steps. SKILL.md should reference every required support file or index without embedding the full procedure.`,
        {
          whyItMatters:
            "Large skills can mix LLM-facing usage guidance with reusable domain knowledge. Skills should remain concise routing contracts and usage guides, while reusable QA heuristics, domain rules, and tool guidance live in independently owned shared context assets.",
          constraints: [
            "Do not introduce runtime context resolution.",
            "Do not create prompt packages.",
            "Do not make Renma responsible for selecting context.",
            "Preserve the skill as an LLM-facing entrypoint / usage guide.",
            "Give extracted context assets stable metadata such as id, owner, and status.",
          ],
          verificationSteps: [
            "Run renma scan.",
            "Run any project-specific validation checks that apply to this repository.",
            "Confirm the skill is shorter and extracted knowledge is represented as shared context assets.",
          ],
          llmHint:
            "If this skill mixes reusable knowledge with usage guidance, split reusable knowledge into first-class context assets under contexts/ and update the skill metadata or text to reference them.",
        },
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

function reusableContextCandidateFinding(
  document: ParsedDocument,
  tokenCount: number,
): Finding | undefined {
  if (document.artifact.kind !== "skill") return undefined;
  if (
    document.lines.length < REUSABLE_CONTEXT_MIN_LINES &&
    tokenCount < REUSABLE_CONTEXT_MIN_TOKENS
  )
    return undefined;

  const headingMatches = document.headings.flatMap((heading) =>
    REUSABLE_CONTEXT_HEADING_PATTERNS.filter(([pattern]) =>
      pattern.test(heading.text),
    ).map(([, label]) => ({
      label,
      line: heading.line,
      text: heading.text,
    })),
  );

  const phraseMatches = REUSABLE_CONTEXT_PHRASE_PATTERNS.flatMap(
    ([pattern, label]) => {
      const lineIndex = document.lines.findIndex((line) => pattern.test(line));
      if (lineIndex < 0) return [];
      return [
        {
          label,
          line: lineIndex + 1,
          text: document.lines[lineIndex]?.trim() ?? label,
        },
      ];
    },
  );

  const headingLabels = [
    ...new Set(headingMatches.map((match) => match.label)),
  ];
  const phraseLabels = [...new Set(phraseMatches.map((match) => match.label))];
  const signalCount = new Set([...headingLabels, ...phraseLabels]).size;
  if (signalCount < REUSABLE_CONTEXT_MIN_SIGNALS) return undefined;

  const evidenceLine =
    headingMatches[0]?.line ??
    phraseMatches[0]?.line ??
    Math.max(1, document.lines.findIndex((line) => line.trim().length > 0) + 1);
  const evidenceParts = [
    headingLabels.length > 0
      ? `Detected reusable-knowledge headings: ${headingLabels
          .slice(0, 5)
          .join(" - ")}`
      : undefined,
    phraseLabels.length > 0
      ? `Detected reusable-knowledge phrases: ${phraseLabels
          .slice(0, 5)
          .join(" - ")}`
      : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    id: "MAINT-SKILL-REUSABLE-CONTEXT-CANDIDATE",
    title: "Skill may contain reusable context worth extracting",
    category: "maintenance",
    severity: "low",
    confidence: "medium",
    evidence: evidence(document, evidenceLine, evidenceParts.join("; ")),
    whyItMatters:
      "Reusable setup notes, troubleshooting, platform guidance, testing heuristics, or domain rules are easier to own, review, and reuse when they live in shared context assets instead of only inside one skill.",
    remediation:
      "Review the matched headings and phrases. If they describe reusable knowledge, extract that knowledge into first-class shared context assets under contexts/ and keep SKILL.md as a concise LLM-facing usage guide.",
    constraints: [
      "Do not make Renma select runtime context.",
      "Do not assemble prompt packages.",
      "Do not automatically rewrite or split skills.",
      "Preserve SKILL.md as the routing contract / usage guide.",
      "Give extracted context assets stable metadata such as id, owner, and status.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the advisory is resolved or intentionally accepted after reusable knowledge is represented as shared context assets.",
    ],
    llmHint:
      "Look for reusable setup, troubleshooting, platform, testing, or domain guidance in this skill. If reusable, move it into owned contexts/ assets and update the skill to reference those assets without adding runtime context selection.",
  };
}

function supportSharedContextCandidateFindings(
  document: ParsedDocument,
): Finding[] {
  if (document.artifact.kind !== "reference") return [];
  if (!/^skills\/[^/]+\/references\/.+\.md$/u.test(document.artifact.path)) {
    return [];
  }

  const tokenCount = approximateTokenCount(document.artifact.content);
  if (
    document.lines.length < SUPPORT_SHARED_CONTEXT_MIN_LINES &&
    tokenCount < SUPPORT_SHARED_CONTEXT_MIN_TOKENS
  ) {
    return [];
  }

  const contentLineIndexes = markdownBodyLineIndexes(document);
  const headingMatches = SUPPORT_SHARED_CONTEXT_HEADING_PATTERNS.flatMap(
    ([pattern, label]) => {
      const lineIndex = contentLineIndexes.find((index) => {
        const line = document.lines[index] ?? "";
        const match = line.match(/^#{1,6}\s+(.+)$/u);
        return match ? pattern.test(match[1] ?? "") : false;
      });
      if (lineIndex === undefined) return [];
      return [
        {
          label,
          line: lineIndex + 1,
          text: document.lines[lineIndex]?.trim() ?? label,
          type: "heading",
        },
      ];
    },
  );

  const phraseMatches = SUPPORT_SHARED_CONTEXT_PHRASE_PATTERNS.flatMap(
    ([pattern, label]) => {
      const lineIndex = contentLineIndexes.find((index) =>
        pattern.test(document.lines[index] ?? ""),
      );
      if (lineIndex === undefined) return [];
      return [
        {
          label,
          line: lineIndex + 1,
          text: document.lines[lineIndex]?.trim() ?? label,
          type: "phrase",
        },
      ];
    },
  );

  const sourceSignals = [...headingMatches, ...phraseMatches];
  if (
    headingMatches.length < SUPPORT_SHARED_CONTEXT_MIN_HEADINGS ||
    phraseMatches.length < SUPPORT_SHARED_CONTEXT_MIN_PHRASES
  ) {
    return [];
  }

  const evidenceMatches = sourceSignals
    .slice(0, 12)
    .sort((a, b) => a.line - b.line);
  const evidenceLine = evidenceMatches[0]?.line ?? 1;
  const evidenceSnippet = [
    "Detected source-of-truth headings:",
    ...headingMatches.slice(0, 8).map((match) => `- ${match.label}`),
    "Detected reusable guidance phrases:",
    ...phraseMatches.slice(0, 8).map((match) => `- ${match.label}`),
    "Evidence lines:",
    ...[...sourceSignals]
      .sort((a, b) => a.line - b.line)
      .slice(0, 8)
      .map(
        (match) =>
          `- ${match.type}: ${match.label} (line ${match.line}) ${match.text}`,
      ),
  ].join("\n");

  return [
    {
      id: "MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE",
      title: "Skill-local support file may be a shared context candidate",
      category: "maintenance",
      severity: "low",
      confidence: "medium",
      evidence: evidence(document, evidenceLine, evidenceSnippet),
      whyItMatters:
        "Skill-local references are useful for local support, but reusable source-of-truth knowledge is easier to own, review, and reuse when represented as a first-class shared context asset under contexts/. Large support files with setup, decision logic, troubleshooting, validation, constraints, or policy-like guidance may be useful beyond one skill.",
      remediation:
        "Review this support file and decide whether reusable knowledge should be promoted to a shared context asset under contexts/. Keep only skill-specific reading order, local notes, or one-off examples under skills/*/references/. Update declared context references after any promotion.",
      constraints: [
        "Do not introduce runtime context resolution.",
        "Do not create prompt packages.",
        "Do not make Renma call an LLM.",
        "Do not move files automatically as part of scan.",
        "Do not delete or summarize procedural details.",
        "Preserve skill-local references when they are truly local to one skill.",
        "Give promoted context assets stable metadata such as id, owner, and status.",
      ],
      verificationSteps: [
        "Run renma scan.",
        "Run renma catalog.",
        "Run any project-specific validation checks that apply to this repository.",
        "Confirm reusable source-of-truth knowledge lives in contexts/ and skill-local references only contain local support guidance.",
      ],
      llmHint:
        "Search the repository for similar headings, filenames, repeated procedures, commands, constraints, or overlapping guidance. If this support file appears reusable, propose a first-class context asset under contexts/, move the reusable details without losing information, keep truly local notes in the skill directory, and update declared context references.",
    },
  ];
}

function contextPathNonSemanticFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.kind !== "context") return [];

  const segments = document.artifact.path.split("/");
  const root = segments[0];
  if (root !== "context" && root !== "contexts") return [];

  const suspiciousSegment = segments
    .slice(1, -1)
    .find((segment) =>
      NON_SEMANTIC_CONTEXT_PATH_SEGMENTS.has(segment.toLowerCase()),
    );
  if (!suspiciousSegment) return [];

  return [
    {
      id: "MAINT-CONTEXT-PATH-NON-SEMANTIC",
      title: "Context asset path appears process-oriented rather than semantic",
      category: "maintenance",
      severity: "low",
      confidence: "high",
      evidence: evidence(
        document,
        1,
        `Path segment "${suspiciousSegment}" appears process-oriented. Consider a semantic context path.`,
      ),
      whyItMatters:
        "Shared context assets should be discoverable by their meaning, ownership, domain, tool, team, or policy scope. Process-state folders such as promoted, generated, or drafts describe how a file was created rather than what knowledge it owns, which makes the repository harder for humans and agents to navigate over time.",
      remediation:
        "Move this context asset to a semantic path that reflects its source-of-truth scope. Prefer paths such as contexts/tools/<tool>/..., contexts/domain/<domain>/..., contexts/testing/..., contexts/teams/<team>/..., or contexts/policies/.... Update any declared context references after moving the file.",
      constraints: [
        "Do not introduce runtime context resolution.",
        "Do not create prompt packages.",
        "Do not make Renma call an LLM.",
        "Do not move files automatically as part of scan.",
        "Preserve the context content and metadata.",
        "Update references only through a reviewable human or calling-agent patch.",
        "Temporary staging folders are acceptable outside final contexts/ paths, but final shared context assets should use semantic paths.",
      ],
      verificationSteps: [
        "Run renma scan.",
        "Run renma catalog.",
        "Run project-specific validation checks that apply to this repository.",
        "Confirm the context asset now lives under a semantic path and declared references still point to it correctly.",
      ],
      llmHint:
        "Infer semantic scope from context title, headings, metadata, and references. Propose a path based on meaning, ownership, or reuse domain, such as contexts/tools/<tool>/..., contexts/domain/<domain>/..., contexts/testing/..., contexts/teams/<team>/..., or contexts/policies/.... Avoid final folders named after migration state such as promoted or generated.",
    },
  ];
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
      {
        whyItMatters:
          "Oversized support assets are harder for humans and LLM coding agents to review safely. Shared context and local support files should stay modular enough that ownership, scope, and static references remain clear.",
        constraints: [
          "Do not introduce runtime context resolution.",
          "Do not create prompt packages.",
          "Preserve concrete procedural steps losslessly.",
          "Keep static references from the parent file or SKILL.md to every split part.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run the repository-specific validation or test command, if one exists.",
          "Confirm the finding is resolved or reduced and every split part remains reachable.",
        ],
        llmHint:
          "Split oversized support content into meaning-based ordered part files, keep the original procedure text intact, and update static references so Renma can validate reachability.",
      },
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
          {
            whyItMatters:
              "Local support files should be statically discoverable from the skill so humans and LLM coding agents can tell which repository evidence belongs to the skill without relying on runtime context selection.",
            constraints: [
              "Do not introduce runtime context resolution.",
              "Do not make Renma responsible for selecting context.",
              "Use static repository references from SKILL.md to local support files or their index.",
              "Preserve original concrete steps and support content.",
            ],
            verificationSteps: [
              "Run renma scan.",
              "Run any project-specific validation checks that apply to this repository.",
              "Confirm each local profile, reference, or example is reachable from SKILL.md or from a referenced parent support file.",
            ],
            llmHint:
              "Add concise reachability guidance in SKILL.md that references local profiles, references, examples, or ordered support indexes without adding runtime routing behavior.",
          },
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
            {
              whyItMatters:
                "Unreachable local support files can drift outside review and be missed by humans or LLM coding agents. Reachability should be static repository evidence, not runtime context assembly.",
              constraints: [
                "Do not introduce runtime context resolution.",
                "Do not delete or summarize support content just to satisfy the check.",
                "Preserve ordered split parts and concrete procedural details.",
                "Use SKILL.md or a referenced parent support file for static reachability.",
              ],
              verificationSteps: [
                "Run renma scan.",
                "Run any project-specific validation checks that apply to this repository.",
                "Confirm this support file is no longer reported as unreachable.",
              ],
              llmHint:
                "Update SKILL.md or a referenced support index to mention this file by path, basename, or clear title so the static reachability graph can find it.",
            },
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
      if (
        possibleRouters.some((router) => referencesDocument(router, document))
      ) {
        reachable.add(document.artifact.path);
        changed = true;
      }
    }
  }

  return reachable;
}

function referencesDocument(
  source: ParsedDocument,
  target: ParsedDocument,
): boolean {
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

function markdownBodyLineIndexes(document: ParsedDocument): number[] {
  if (document.lines[0]?.trim() !== "---") {
    return document.lines.map((_, index) => index);
  }

  const frontmatterEnd = document.lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  const bodyStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
  return document.lines
    .map((_, index) => index)
    .filter((index) => index >= bodyStart);
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
  details: FindingDetails = {},
): Omit<Finding, "evidence" | "remediation"> & { remediation: string } {
  return {
    id,
    title,
    category,
    severity,
    confidence: "high",
    whyItMatters:
      details.whyItMatters ??
      "Skills and repository instructions are loaded into agent context, so risky or unclear text can become risky behavior.",
    remediation,
    ...(details.constraints ? { constraints: details.constraints } : {}),
    ...(details.verificationSteps
      ? { verificationSteps: details.verificationSteps }
      : {}),
    ...(details.llmHint ? { llmHint: details.llmHint } : {}),
  };
}

function documentFinding(
  document: ParsedDocument,
  id: string,
  title: string,
  category: Finding["category"],
  severity: Severity,
  remediation: string,
  details: FindingDetails = {},
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
      details.whyItMatters ??
      "Clear skill structure helps agents choose the right workflow and report useful evidence.",
    remediation,
    ...(details.constraints ? { constraints: details.constraints } : {}),
    ...(details.verificationSteps
      ? { verificationSteps: details.verificationSteps }
      : {}),
    ...(details.llmHint ? { llmHint: details.llmHint } : {}),
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
