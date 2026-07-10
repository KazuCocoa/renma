import { existsSync } from "node:fs";
import path from "node:path";
import type { Catalog, CatalogEntry, Dependency } from "./model.js";
import {
  addDaysIsoDate,
  isIsoDate,
  parseDayDuration,
  todayIsoDate,
} from "./freshness.js";
import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import { runRuleRegistry, type Rule } from "./rule-engine.js";
import type {
  Evidence,
  Finding,
  MetadataValue,
  ParsedDocument,
  ScanConfig,
  Severity,
} from "./types.js";

type FindingDetails = Partial<
  Pick<
    Finding,
    | "whyItMatters"
    | "constraints"
    | "verificationSteps"
    | "llmHint"
    | "riskClass"
    | "details"
  >
>;

interface RuleOptions {
  evaluationDate?: Date | string;
}

const SECRET_PATTERN =
  /\b(?:password|passwd|token|api[_-]?key|secret|credential|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{8,})/i;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/;
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
const REQUIRED_INPUTS_PATTERN =
  /\b(?:required inputs?|inputs|input requirements?|required information|prerequisites?|required context|required files|required permissions?|permission requirements?|environment requirements?|before running,\s*provide|before you begin,\s*provide|the user must provide|needs the following|target files|permissions required|environment required)\b|\brequires:/;
const COMPLETION_CRITERIA_PATTERN =
  /\b(?:completion criteria|completion checklist|success criteria|success requirements|done criteria|done when|definition of done|acceptance criteria|deliverables?|final response|final answer|expected outcomes?|expected results?|expected output|required output|output requirements?|report should include|patch should include|when complete|workflow is complete|the workflow is complete after|task is complete|counts as complete|completion requirements?|stop when|do not finish until)\b/;
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
export function runRules(
  documents: ParsedDocument[],
  config: ScanConfig,
  catalog?: Catalog,
  options: RuleOptions = {},
): Finding[] {
  const findings = runRuleRegistry(
    documents,
    rulesForEvaluationDate(evaluationDay(options.evaluationDate)),
    catalog,
    config,
  );
  return findings.sort((a, b) => {
    const byPath = a.evidence.path.localeCompare(b.evidence.path);
    if (byPath !== 0) return byPath;
    return a.evidence.startLine - b.evidence.startLine;
  });
}

function rulesForEvaluationDate(evaluationDate: string): Rule[] {
  return [
    {
      id: "strict-layout-policy",
      run: (context) =>
        strictLayoutPolicyFindings(
          context.documents,
          context.config,
          context.catalog,
        ),
    },
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
        documents.flatMap((document) =>
          supportSharedContextCandidateFindings(document),
        ),
    },
    {
      id: "context-path-non-semantic",
      run: ({ documents }) =>
        documents.flatMap((document) =>
          contextPathNonSemanticFindings(document),
        ),
    },
    {
      id: "skill-context-reference-not-declared",
      run: ({ documents }) =>
        documents.flatMap((document) =>
          skillContextReferenceNotDeclaredFindings(document),
        ),
    },
    {
      id: "skill-references-superseded-asset",
      run: ({ documents }) => skillReferencesSupersededAssetFindings(documents),
    },
    {
      id: "asset-references-superseded-asset",
      run: ({ documents }) => assetReferencesSupersededAssetFindings(documents),
    },
    {
      id: "catalog-declared-reference-governance",
      run: ({ catalog }) =>
        catalogDeclaredReferenceGovernanceFindings(catalog, evaluationDate),
    },
  ];
}

function evaluationDay(value: Date | string | undefined): string {
  if (value === undefined) return todayIsoDate();
  if (value instanceof Date) return todayIsoDate(value);
  if (isIsoDate(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid internal evaluation date: ${value}`);
  }
  return todayIsoDate(parsed);
}

function catalogDeclaredReferenceGovernanceFindings(
  catalog: Catalog | undefined,
  today: string,
): Finding[] {
  if (!catalog) return [];

  const resolver = createCatalogReferenceResolver(catalog.entries);
  const findings: Finding[] = [
    ...duplicateAssetIdFindings(catalog.entries),
    ...unknownReferenceFindings(catalog.dependencies, resolver),
    ...referenceDeprecatedAssetFindings(catalog.dependencies, resolver),
    ...orphanedContextAssetFindings(
      catalog.entries,
      catalog.dependencies,
      resolver,
    ),
    ...orphanedContextLensFindings(catalog.entries, resolver),
    ...contextLensAppliesToInactiveContextFindings(
      catalog.dependencies,
      resolver,
    ),
    ...freshnessGovernanceFindings(catalog.entries, today),
  ];

  return findings;
}

function freshnessGovernanceFindings(
  entries: CatalogEntry[],
  today = todayIsoDate(),
): Finding[] {
  return entries
    .filter((entry) => entry.kind === "context" || entry.kind === "skill")
    .flatMap((entry) => [
      ...expiredAssetFindings(entry, today),
      ...reviewOverdueAssetFindings(entry, today),
    ]);
}

function expiredAssetFindings(entry: CatalogEntry, today: string): Finding[] {
  const expiresAt = entry.metadata.expiresAt;
  if (!expiresAt || !isIsoDate(expiresAt) || expiresAt >= today) return [];

  return [
    {
      id: DIAGNOSTIC_IDS.MAINT_ASSET_EXPIRED,
      title: "Asset freshness metadata is expired",
      category: "maintenance",
      severity: "medium",
      confidence: "high",
      evidence: metadataFieldFindingEvidence(
        entry,
        "expires_at",
        `expires_at: ${expiresAt}`,
      ),
      whyItMatters:
        "Freshness metadata is a human review contract. Expired assets may contain guidance that has not been intentionally revalidated for current use.",
      remediation:
        "Review the asset with a human owner, then update expires_at, last_reviewed_at, review_cycle, status, or dependent references as appropriate.",
      constraints: [
        "Do not infer freshness from file modification time.",
        "Do not introduce runtime context selection.",
        "Do not create prompt packages.",
      ],
      verificationSteps: [
        "Run renma scan.",
        "Run renma catalog.",
        "Confirm the freshness metadata reflects human review.",
      ],
      llmHint: `Review ${entry.sourcePath} for stale assumptions, then update explicit freshness metadata only after human review.`,
    },
  ];
}

function reviewOverdueAssetFindings(
  entry: CatalogEntry,
  today: string,
): Finding[] {
  const lastReviewedAt = entry.metadata.lastReviewedAt;
  const reviewCycle = entry.metadata.reviewCycle;
  if (!lastReviewedAt || !reviewCycle) return [];
  if (!isIsoDate(lastReviewedAt)) return [];
  const cycleDays = parseDayDuration(reviewCycle);
  if (cycleDays === undefined) return [];

  const dueAt = addDaysIsoDate(lastReviewedAt, cycleDays);
  if (dueAt >= today) return [];

  return [
    {
      id: DIAGNOSTIC_IDS.MAINT_ASSET_REVIEW_OVERDUE,
      title: "Asset freshness review is overdue",
      category: "maintenance",
      severity: "medium",
      confidence: "high",
      evidence: metadataFieldFindingEvidence(
        entry,
        "last_reviewed_at",
        `last_reviewed_at: ${lastReviewedAt}; review_cycle: ${reviewCycle}`,
      ),
      whyItMatters:
        "Review cycles make human freshness expectations explicit. Overdue assets may no longer match current product, policy, or workflow behavior.",
      remediation:
        "Review the asset with a human owner, then update last_reviewed_at or review_cycle if the guidance is still current.",
      constraints: [
        "Do not infer freshness from Git history or file modification time.",
        "Do not introduce runtime context selection.",
        "Do not create prompt packages.",
      ],
      verificationSteps: [
        "Run renma scan.",
        "Run renma catalog.",
        "Confirm the next review date is not overdue.",
      ],
      llmHint: `The next review date for ${entry.sourcePath} was ${dueAt}. Revalidate the asset before updating freshness metadata.`,
    },
  ];
}

function duplicateAssetIdFindings(entries: CatalogEntry[]): Finding[] {
  const entriesById = new Map<string, CatalogEntry[]>();

  for (const entry of entries) {
    entriesById.set(entry.id, [...(entriesById.get(entry.id) ?? []), entry]);
  }

  return [...entriesById.entries()].flatMap(([assetId, duplicates]) => {
    if (duplicates.length < 2) return [];
    const paths = duplicates.map((entry) => entry.sourcePath).sort();

    return duplicates.map((entry) => ({
      id: DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID,
      title: "Duplicate asset id",
      category: "maintenance",
      severity: "medium",
      confidence: "high",
      evidence: metadataFieldFindingEvidence(
        entry,
        "id",
        `Duplicate asset id: ${assetId}`,
      ),
      whyItMatters:
        "Asset ids make skills, contexts, and support assets referenceable across the repository. Duplicate ids make dependency validation, ownership, and agent-readable cataloging ambiguous.",
      remediation:
        "Give each asset a unique stable id. If the assets represent the same source-of-truth knowledge, merge or deprecate one of them. If they are distinct, rename one id to reflect its actual scope.",
      constraints: [
        "Do not introduce runtime context resolution.",
        "Do not create prompt packages.",
        "Do not make Renma call an LLM.",
        "Do not automatically rewrite ids during scan.",
        "Update declared references through a reviewable patch after renaming an id.",
      ],
      verificationSteps: [
        "Run renma scan.",
        "Run renma catalog.",
        "Run any project-specific validation checks that apply to this repository.",
        "Confirm each asset id is unique and references still point to the intended asset.",
      ],
      llmHint: `Find all assets with id "${assetId}", compare their scope and metadata, and propose a merge/deprecation path or unique replacement ids. Duplicate paths: ${paths.join(", ")}`,
      details: {
        assetId,
        duplicatePaths: paths,
        sourcePath: entry.sourcePath,
      },
    }));
  });
}

function unknownReferenceFindings(
  dependencies: Dependency[],
  resolver: CatalogReferenceResolver,
): Finding[] {
  return dependencies.flatMap((dependency) => {
    if (resolver.resolve(dependency.to)) return [];

    return [
      {
        id: DIAGNOSTIC_IDS.META_UNKNOWN_REFERENCE,
        title: "Declared reference does not resolve to a known asset",
        category: "maintenance",
        severity: "medium",
        confidence: "high",
        evidence:
          dependency.evidence ??
          metadataFindingEvidence(
            dependency.sourcePath,
            `Unresolved ${dependency.kind} reference: ${dependency.to}`,
          ),
        whyItMatters:
          "Declared references make repository relationships visible to catalog, graph, and validation reports. Unknown references make skills and context assets harder for humans and agents to trust.",
        remediation:
          "Fix the reference so it points to an existing asset id or repository-relative path, or remove it if the relationship is no longer needed.",
        constraints: [
          "Do not select runtime context.",
          "Do not assemble prompt packages.",
          "Do not infer missing dependencies with an LLM during scan.",
          "Only validate declared repository relationships.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run renma catalog.",
          "Confirm declared references resolve to known assets.",
        ],
        llmHint: `Search the repository for the intended asset by nearby filename, title, id, or path. Update or remove unresolved ${dependency.kind} reference "${dependency.to}" declared by "${dependency.from}".`,
        details: {
          source: dependency.from,
          target: dependency.to,
          referenceKind: dependency.kind,
          sourcePath: dependency.sourcePath,
        },
      },
    ];
  });
}

function referenceDeprecatedAssetFindings(
  dependencies: Dependency[],
  resolver: CatalogReferenceResolver,
): Finding[] {
  return dependencies.flatMap((dependency) => {
    const target = resolver.resolve(dependency.to);
    if (!target) return [];
    const source = resolver.resolve(dependency.from);
    if (
      dependency.kind === "applies_to" &&
      source?.kind === "context_lens" &&
      target.kind === "context"
    ) {
      return [];
    }
    if (
      target.metadata.status !== "deprecated" &&
      target.metadata.status !== "archived"
    ) {
      return [];
    }

    return [
      {
        id: DIAGNOSTIC_IDS.MAINT_REFERENCE_DEPRECATED_ASSET,
        title: "Declared reference targets a deprecated or archived asset",
        category: "maintenance",
        severity: "medium",
        confidence: "high",
        evidence:
          dependency.evidence ??
          metadataFindingEvidence(
            dependency.sourcePath,
            `Reference to ${target.metadata.status} asset: ${dependency.to}`,
          ),
        whyItMatters:
          "Declared references to deprecated or archived assets can keep old knowledge in active repository paths. If a canonical replacement exists, assets should usually reference that replacement directly.",
        remediation:
          "Update the declared reference to point to the canonical replacement if one exists, or document why the deprecated or archived asset is still intentionally referenced.",
        constraints: [
          "Do not introduce runtime context resolution.",
          "Do not create prompt packages.",
          "Do not automatically rewrite references during scan.",
          "Preserve compatibility shims when they are intentionally needed.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run renma catalog.",
          "Confirm active assets do not declare dependencies on deprecated or archived assets unless intentionally documented.",
        ],
        llmHint: `Inspect "${target.sourcePath}" for superseded_by or canonical context metadata. If a canonical replacement exists, update ${dependency.kind} reference "${dependency.to}" declared by "${dependency.from}". If not, decide whether the reference should remain and document why.`,
        details: {
          source: dependency.from,
          target: dependency.to,
          referenceKind: dependency.kind,
          sourcePath: dependency.sourcePath,
          targetPath: target.sourcePath,
          targetStatus: target.metadata.status,
        },
      },
    ];
  });
}

function orphanedContextLensFindings(
  entries: CatalogEntry[],
  resolver: CatalogReferenceResolver,
): Finding[] {
  const referencedLensPaths = new Set<string>();

  for (const entry of entries) {
    if (entry.kind !== "skill") continue;
    for (const reference of [...entry.requiredLens, ...entry.optionalLens]) {
      const target = resolver.resolve(reference);
      if (target?.kind === "context_lens") {
        referencedLensPaths.add(target.sourcePath);
      }
    }
  }

  return entries.flatMap((entry) => {
    if (entry.kind !== "context_lens") return [];
    if (!isActiveAsset(entry)) return [];
    if (referencedLensPaths.has(entry.sourcePath)) return [];

    return [
      {
        id: DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_LENS,
        title: "Context lens is not referenced by any skill",
        category: "maintenance",
        severity: "low",
        confidence: "medium",
        evidence: metadataFindingEvidence(
          entry.sourcePath,
          "Active context lens has no incoming requires_lens or optional_lens references from skills.",
        ),
        whyItMatters:
          "Context lenses are easier to review when a skill declares how the purpose-oriented interpretation is used. An unreferenced active lens may be newly created, intentionally staged, or stale.",
        remediation:
          "If the lens should be used, reference it from a skill with requires_lens or optional_lens. If it is not ready or no longer needed, update its lifecycle status after review.",
        constraints: [
          "Do not make Renma select runtime lenses.",
          "Do not rank or retrieve lenses semantically.",
          "Do not assemble prompts or inject context.",
          "Treat this as repository governance only.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run renma catalog.",
          "Run renma graph focused on the lens or owning skill.",
        ],
        llmHint: `Search for skills that should declare "${entry.id}" in requires_lens or optional_lens. Do not add runtime selection logic or prompt assembly.`,
        details: {
          assetId: entry.id,
          sourcePath: entry.sourcePath,
          assetKind: entry.kind,
        },
      },
    ];
  });
}

function contextLensAppliesToInactiveContextFindings(
  dependencies: Dependency[],
  resolver: CatalogReferenceResolver,
): Finding[] {
  return dependencies.flatMap((dependency) => {
    if (dependency.kind !== "applies_to") return [];

    const source = resolver.resolve(dependency.from);
    const target = resolver.resolve(dependency.to);
    if (source?.kind !== "context_lens" || target?.kind !== "context") {
      return [];
    }
    if (!isActiveAsset(source) || isActiveAsset(target)) return [];

    return [
      {
        id: DIAGNOSTIC_IDS.MAINT_CONTEXT_LENS_APPLIES_TO_INACTIVE_CONTEXT,
        title: "Context lens applies to an inactive context asset",
        category: "maintenance",
        severity: "low",
        confidence: "high",
        evidence:
          dependency.evidence ??
          metadataFindingEvidence(
            dependency.sourcePath,
            `Context lens applies_to inactive context: ${dependency.to}`,
          ),
        whyItMatters:
          "A lens that interprets deprecated or archived context may keep stale knowledge connected to active skills. The relationship can still be intentional, but it should be easy to review.",
        remediation:
          "Point applies_to at the active replacement context when one exists, or mark the lens lifecycle appropriately if it only applies to archived knowledge.",
        constraints: [
          "Do not infer a replacement context with an LLM.",
          "Do not make Renma select runtime lenses.",
          "Do not assemble prompts or inject context.",
          "Keep the check deterministic and relationship-based.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run renma catalog.",
          "Inspect the lens and applied context lifecycle metadata.",
        ],
        llmHint: `Inspect "${target.sourcePath}" for superseded_by or replacement guidance. Update the applies_to reference in "${source.sourcePath}" only if a reviewed replacement exists.`,
        details: {
          source: dependency.from,
          target: dependency.to,
          referenceKind: dependency.kind,
          sourcePath: dependency.sourcePath,
          targetPath: target.sourcePath,
          targetStatus: target.metadata.status,
        },
      },
    ];
  });
}

function orphanedContextAssetFindings(
  entries: CatalogEntry[],
  dependencies: Dependency[],
  resolver: CatalogReferenceResolver,
): Finding[] {
  const referencedPaths = new Set<string>();

  for (const dependency of dependencies) {
    const target = resolver.resolve(dependency.to);
    const source = resolver.resolve(dependency.from);
    if (!target) continue;
    if (source?.sourcePath === target.sourcePath) continue;
    referencedPaths.add(target.sourcePath);
  }

  return entries.flatMap((entry) => {
    if (!isFirstClassSharedContext(entry)) return [];
    if (
      entry.metadata.status === "deprecated" ||
      entry.metadata.status === "archived"
    ) {
      return [];
    }
    if (referencedPaths.has(entry.sourcePath)) return [];

    return [
      {
        id: DIAGNOSTIC_IDS.MAINT_ORPHANED_CONTEXT_ASSET,
        title: "Shared context asset is not referenced by other assets",
        category: "maintenance",
        severity: "low",
        confidence: "medium",
        evidence: metadataFindingEvidence(
          entry.sourcePath,
          "Shared context asset has no incoming declared references.",
        ),
        whyItMatters:
          "Shared context assets are most valuable when discoverable and connected to skills, other contexts, or repository guidance. Orphaned context assets may be unused, newly created but not wired in, or missing declared references.",
        remediation:
          "If the context is intended to be used, reference it from the relevant skill or context metadata. If it is obsolete, deprecate or archive it. If it is intentionally standalone, document its intended discovery path.",
        constraints: [
          "Do not delete context assets automatically.",
          "Do not require every context asset to be referenced immediately.",
          "Do not make Renma decide runtime context selection.",
          "Use this as a repository maintenance advisory.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run renma catalog.",
          "Confirm context is referenced, intentionally standalone, deprecated, or archived.",
        ],
        llmHint: `Search the repository for related skills, contexts, filenames, headings, or domain terms for "${entry.sourcePath}". If this context should be used, add a declared reference from the appropriate skill or context. If obsolete, propose a deprecation or archive patch.`,
        details: {
          assetId: entry.id,
          sourcePath: entry.sourcePath,
          assetKind: entry.kind,
        },
      },
    ];
  });
}

function isActiveAsset(entry: CatalogEntry): boolean {
  return (
    entry.metadata.status !== "deprecated" &&
    entry.metadata.status !== "archived"
  );
}

interface CatalogReferenceResolver {
  resolve(reference: string): CatalogEntry | undefined;
}

function createCatalogReferenceResolver(
  entries: CatalogEntry[],
): CatalogReferenceResolver {
  const byId = new Map<string, CatalogEntry>();
  const byPath = new Map<string, CatalogEntry>();

  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
    const normalizedPath = normalizeReference(entry.sourcePath);
    if (!byPath.has(normalizedPath)) byPath.set(normalizedPath, entry);
  }

  return {
    resolve(reference: string): CatalogEntry | undefined {
      return byId.get(reference) ?? byPath.get(normalizeReference(reference));
    },
  };
}

function normalizeReference(reference: string): string {
  return reference.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isFirstClassSharedContext(entry: CatalogEntry): boolean {
  return (
    entry.kind === "context" &&
    (entry.sourcePath.startsWith("contexts/") ||
      entry.sourcePath.startsWith("context/"))
  );
}

function metadataFindingEvidence(path: string, snippet: string): Evidence {
  return {
    path,
    startLine: 1,
    endLine: 1,
    snippet,
  };
}

function metadataFieldFindingEvidence(
  entry: CatalogEntry,
  fieldKey: string,
  fallbackSnippet: string,
): Evidence {
  const field = entry.metadataFields[fieldKey];
  if (field) {
    return {
      path: field.path,
      startLine: field.startLine,
      endLine: field.endLine,
      snippet: field.raw,
    };
  }

  return metadataFindingEvidence(entry.sourcePath, fallbackSnippet);
}

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
        DIAGNOSTIC_IDS.SEC_PRIVATE_KEY,
        "Private key material appears in repository text",
        "safety",
        "critical",
        document,
        "Remove the key, rotate it if real, and keep only setup instructions or placeholders.",
        { riskClass: "violation" },
      );
    }
    if (SECRET_PATTERN.test(line) && !isPlaceholder(line)) {
      return finding(
        DIAGNOSTIC_IDS.SEC_LITERAL_SECRET,
        "Literal credential-like value appears in repository text",
        "safety",
        "high",
        document,
        "Move secrets to user-approved inputs or a secret manager, and keep only placeholders in repository files.",
        { riskClass: "violation" },
      );
    }
    return undefined;
  });
}

function commandFindings(document: ParsedDocument): Finding[] {
  return matchingLineFindings(document, (line) => {
    if (isSuppressed(line)) return undefined;
    if (REMOTE_PATTERN.test(line)) {
      return finding(
        DIAGNOSTIC_IDS.SEC_REMOTE_DEFAULT,
        "Remote command example uses unsafe default",
        "safety",
        "medium",
        document,
        "Avoid production placeholders, insecure transport flags, and pipe-to-shell patterns unless paired with verification and confirmation.",
        { riskClass: "suspicious" },
      );
    }
    if (ENV_COPY_PATTERN.test(line)) {
      return finding(
        DIAGNOSTIC_IDS.SEC_ENV_COPY,
        "Command may pass broad environment into subprocess execution",
        "safety",
        "medium",
        document,
        "Pass only required environment variables to subprocesses and avoid forwarding secrets by default.",
        { riskClass: "suspicious" },
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
        DIAGNOSTIC_IDS.QUAL_MISSING_DESCRIPTION,
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
        DIAGNOSTIC_IDS.QUAL_SHORT_DESCRIPTION,
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
        DIAGNOSTIC_IDS.QUAL_SKILL_TOKEN_BUDGET,
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
        DIAGNOSTIC_IDS.QUAL_USER_LOCAL_PATHS,
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
        DIAGNOSTIC_IDS.QUAL_MISSING_NEGATIVE_ROUTING,
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
        DIAGNOSTIC_IDS.QUAL_MISSING_ROUTING_CLARITY,
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
        DIAGNOSTIC_IDS.QUAL_MISSING_EXAMPLES,
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
        DIAGNOSTIC_IDS.QUAL_MISSING_PREFLIGHT,
        "Skill lacks a preflight step",
        "quality",
        "medium",
        "Add a preflight section that captures environment, permissions, target files, and assumptions before acting.",
      ),
    );
  }

  if (
    document.artifact.kind === "skill" &&
    !REQUIRED_INPUTS_PATTERN.test(text)
  ) {
    findings.push(
      documentFinding(
        document,
        DIAGNOSTIC_IDS.QUAL_MISSING_REQUIRED_INPUTS,
        "Skill does not state required inputs",
        "quality",
        "medium",
        "Add a Required inputs or Prerequisites section that states the user-provided inputs, target files, repository state, permissions, credentials, or environment assumptions needed before the workflow can start.",
        {
          whyItMatters:
            "Agents need explicit input requirements before starting a workflow. Missing required inputs can cause the agent to guess targets, assume permissions, or start without enough repository context.",
          constraints: [
            "Do not infer runtime context.",
            "Do not assemble prompt packages.",
            "Do not require optional context selection.",
            "Do not make Renma decide whether the workflow can run for the current task.",
            "Keep the skill as a static workflow entrypoint.",
          ],
          verificationSteps: [
            "Run renma scan.",
            "Run renma readiness.",
            "Confirm each skill entrypoint either documents required inputs or explicitly states that no special inputs are required.",
          ],
          llmHint:
            "Add a concise Required inputs or Prerequisites section to this SKILL.md. State user-provided inputs, target files, repository state, permissions, credentials, and environment assumptions needed before the workflow starts. Do not add runtime context selection or prompt assembly behavior.",
        },
      ),
    );
  }

  if (
    document.artifact.kind === "skill" &&
    !COMPLETION_CRITERIA_PATTERN.test(text)
  ) {
    findings.push(
      documentFinding(
        document,
        DIAGNOSTIC_IDS.QUAL_MISSING_COMPLETION_CRITERIA,
        "Skill does not state completion criteria",
        "quality",
        "medium",
        "Add a Completion criteria, Success requirements, Deliverables, or Final response section that states the observable outputs or conditions that mean the workflow is complete.",
        {
          whyItMatters:
            "Agents need explicit completion criteria before finishing a workflow. Missing completion criteria can cause incomplete delivery, unnecessary follow-up work, or inconsistent final responses.",
          constraints: [
            "Do not infer runtime context.",
            "Do not assemble prompt packages.",
            "Do not require optional context selection.",
            "Do not make Renma decide task-specific success at runtime.",
            "Keep the skill as a static workflow entrypoint.",
          ],
          verificationSteps: [
            "Run renma scan.",
            "Run renma readiness.",
            "Confirm each skill workflow entrypoint documents completion criteria.",
          ],
          llmHint:
            "Add a concise Completion criteria, Success requirements, Deliverables, or Final response section to this SKILL.md. State the observable outputs, checks, or final-response conditions that mean the workflow is complete. Do not add runtime context selection or prompt assembly behavior.",
        },
      ),
    );
  }

  if (!/verify|validation|test|confirm result|expected output/.test(text)) {
    findings.push(
      documentFinding(
        document,
        DIAGNOSTIC_IDS.QUAL_MISSING_VERIFICATION,
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
        DIAGNOSTIC_IDS.QUAL_LOW_HEADING_DENSITY,
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
    id: DIAGNOSTIC_IDS.MAINT_SKILL_REUSABLE_CONTEXT_CANDIDATE,
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
      id: DIAGNOSTIC_IDS.MAINT_SUPPORT_ASSET_SHARED_CONTEXT_CANDIDATE,
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
      id: DIAGNOSTIC_IDS.MAINT_CONTEXT_PATH_NON_SEMANTIC,
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

function skillContextReferenceNotDeclaredFindings(
  document: ParsedDocument,
): Finding[] {
  if (document.artifact.kind !== "skill") return [];

  const declaredContexts = new Set(
    listMetadataValue(document.metadata.requires_context),
  );
  const bodyLineIndexes = markdownBodyLineIndexes(document);
  const matches = new Map<string, { line: number; text: string }>();

  for (const index of bodyLineIndexes) {
    const line = document.lines[index] ?? "";
    for (const match of line.matchAll(/\bcontexts?\/[^\s`)'"]+\.md\b/gu)) {
      const referencedPath = match[0];
      if (!matches.has(referencedPath)) {
        matches.set(referencedPath, {
          line: index + 1,
          text: line.trim(),
        });
      }
    }
  }

  return [...matches.entries()]
    .filter(([referencedPath]) => !declaredContexts.has(referencedPath))
    .map(([referencedPath, match]) => ({
      id: DIAGNOSTIC_IDS.MAINT_SKILL_CONTEXT_REFERENCE_NOT_DECLARED,
      title: "Skill references a shared context without declaring it",
      category: "maintenance",
      severity: "low",
      confidence: "high",
      evidence: evidence(document, match.line, match.text),
      whyItMatters:
        "Declared context references make skill/context relationships visible to catalog, graph, and validation reports. If a skill only mentions a context in prose, humans may see the dependency but repository tooling cannot validate it.",
      remediation:
        "Add the referenced shared context asset to the skill metadata using requires_context, or remove the prose reference if it is no longer needed.",
      constraints: [
        "Do not select runtime context.",
        "Do not assemble prompt packages.",
        "Do not make Renma decide which context a task should use.",
        "Only declare repository relationships that the skill already references or intentionally depends on.",
      ],
      verificationSteps: [
        "Run renma scan.",
        "Run renma catalog.",
        "Confirm the skill/context relationship appears in metadata and catalog output.",
      ],
      llmHint: `Find context paths mentioned in the skill body and add them to requires_context using the metadata syntax currently supported by Renma. Missing declaration: ${referencedPath}`,
      details: {
        source: metadataText(document.metadata.id) ?? document.artifact.path,
        target: referencedPath,
        referenceKind: "requires_context",
        sourcePath: document.artifact.path,
      },
    }));
}

function skillReferencesSupersededAssetFindings(
  documents: ParsedDocument[],
): Finding[] {
  const skillsByPath = new Map(
    documents
      .filter((document) => document.artifact.kind === "skill")
      .map((document) => [document.artifact.path, document]),
  );

  return documents.flatMap((document) => {
    if (!isSkillLocalReference(document)) return [];

    const canonicalTargets = sharedContextTargets(document);
    const supersededStatus =
      metadataText(document.metadata.status) === "deprecated" ||
      metadataText(document.metadata.status) === "archived";
    if (!supersededStatus && canonicalTargets.length === 0) return [];
    if (canonicalTargets.length === 0) return [];

    const skillPath = parentSkillPath(document.artifact.path);
    if (!skillPath) return [];

    const skill = skillsByPath.get(skillPath);
    if (!skill) return [];

    const referencedFrom = skillReferenceLine(skill, document.artifact.path);
    if (!referencedFrom) return [];

    const canonicalTargetList = canonicalTargets
      .map((target) => `- ${target}`)
      .join("\n");
    const snippet = [
      `Deprecated local support file: ${document.artifact.path}`,
      "Superseded by:",
      canonicalTargetList,
      `Referenced from: ${skill.artifact.path}`,
      referencedFrom.text,
    ].join("\n");

    return [
      {
        id: DIAGNOSTIC_IDS.MAINT_SKILL_REFERENCES_SUPERSEDED_ASSET,
        title: "Skill references a superseded local support asset",
        category: "maintenance",
        severity: "low",
        confidence: "medium",
        evidence: evidence(skill, referencedFrom.line, snippet),
        whyItMatters:
          "Deprecated or superseded local support files can be useful as compatibility shims, but keeping them in a primary reading path may hide the canonical shared context asset from humans and agents. Shared context assets should be the visible source of truth when reusable knowledge has been promoted to contexts/.",
        remediation:
          "Update the skill to reference the canonical shared context asset directly, or keep the deprecated local support file only as a clearly documented compatibility shim. If the local file still contains unique skill-specific guidance, reduce it to that local guidance and point to the shared context for reusable knowledge.",
        constraints: [
          "Do not introduce runtime context resolution.",
          "Do not create prompt packages.",
          "Do not make Renma call an LLM.",
          "Do not automatically move or delete files during scan.",
          "Preserve compatibility shims if they are still needed.",
          "Preserve unique skill-local guidance if it is not reusable shared context.",
          "Update declared context references when pointing the skill directly at shared contexts.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run renma catalog.",
          "Run project-specific validation checks that apply to this repository.",
          "Confirm the skill points to canonical shared context assets directly, or any deprecated local support file is clearly only a compatibility shim.",
        ],
        llmHint:
          "Inspect the deprecated local support file and its superseded_by or canonical_context metadata. If the shared context asset is now canonical, update skill guidance and metadata to reference the shared context directly. Keep the local reference only if it contains truly local notes or is intentionally preserved as a compatibility shim.",
        details: {
          source: metadataText(skill.metadata.id) ?? skill.artifact.path,
          target: metadataText(document.metadata.id) ?? document.artifact.path,
          referenceKind: "body_reference",
          sourcePath: skill.artifact.path,
          targetPath: document.artifact.path,
          targetStatus: metadataText(document.metadata.status),
          replacementTargets: canonicalTargets,
        },
      },
    ];
  });
}

function isSkillLocalReference(document: ParsedDocument): boolean {
  return (
    document.artifact.kind === "reference" &&
    /^skills\/[^/]+\/references\/.+\.md$/u.test(document.artifact.path)
  );
}

function sharedContextTargets(document: ParsedDocument): string[] {
  return [
    ...listMetadataValue(document.metadata.superseded_by),
    ...listMetadataValue(document.metadata.canonical_context),
  ].filter(
    (target, index, targets) =>
      /^contexts?\//u.test(target) && targets.indexOf(target) === index,
  );
}

function parentSkillPath(referencePath: string): string | undefined {
  const segments = referencePath.split("/");
  if (segments.length < 4 || segments[0] !== "skills") return undefined;
  return `skills/${segments[1]}/SKILL.md`;
}

function skillReferenceLine(
  skill: ParsedDocument,
  referencePath: string,
): { line: number; text: string } | undefined {
  const skillDir = path.posix.dirname(skill.artifact.path);
  const relativePath = path.posix.relative(skillDir, referencePath);
  const referencedTokens = [referencePath, relativePath];

  for (const index of markdownBodyLineIndexes(skill)) {
    const line = skill.lines[index] ?? "";
    if (referencedTokens.some((token) => line.includes(token))) {
      return { line: index + 1, text: line.trim() };
    }
  }

  return undefined;
}

function assetReferencesSupersededAssetFindings(
  documents: ParsedDocument[],
): Finding[] {
  const supersededAssets = documents
    .map((document) => ({
      document,
      canonicalTargets: sharedContextTargets(document),
    }))
    .filter(
      ({ document, canonicalTargets }) =>
        metadataText(document.metadata.status) === "deprecated" ||
        metadataText(document.metadata.status) === "archived" ||
        canonicalTargets.length > 0,
    )
    .filter(({ canonicalTargets }) => canonicalTargets.length > 0);

  return documents.flatMap((referencingDocument) => {
    if (referencingDocument.artifact.kind === "skill") return [];

    return supersededAssets.flatMap(({ document, canonicalTargets }) => {
      if (document.artifact.path === referencingDocument.artifact.path) {
        return [];
      }

      const reference = assetReferenceLine(
        referencingDocument,
        document.artifact.path,
      );
      if (!reference) return [];

      const canonicalTargetList = canonicalTargets
        .map((target) => `- ${target}`)
        .join("\n");
      const snippet = [
        `Referencing asset: ${referencingDocument.artifact.path}`,
        `Referenced superseded asset: ${document.artifact.path}`,
        "Superseded by:",
        canonicalTargetList,
        reference.text,
      ].join("\n");

      return [
        {
          id: DIAGNOSTIC_IDS.MAINT_ASSET_REFERENCES_SUPERSEDED_ASSET,
          title: "Asset references a superseded support file",
          category: "maintenance",
          severity: "low",
          confidence: "medium",
          evidence: evidence(referencingDocument, reference.line, snippet),
          whyItMatters:
            "Deprecated or superseded support files may remain as compatibility shims, but assets that keep referencing them can hide the canonical shared context asset from humans and agents. Once reusable knowledge has been promoted to contexts/, repository assets should usually reference the canonical context directly.",
          remediation:
            "Update this asset to reference the canonical shared context asset directly, or keep the superseded reference only if it is intentionally needed as a compatibility shim. If the deprecated file still contains unique local guidance, preserve that local guidance and point reusable knowledge to the canonical context.",
          constraints: [
            "Do not introduce runtime context resolution.",
            "Do not create prompt packages.",
            "Do not make Renma call an LLM.",
            "Do not automatically move or rewrite files during scan.",
            "Preserve compatibility shims if they are intentionally needed.",
            "Preserve unique local guidance not reusable shared context.",
            "Update references through a reviewable human or calling-agent patch.",
          ],
          verificationSteps: [
            "Run renma scan.",
            "Run renma catalog.",
            "Run project-specific validation checks that apply to this repository.",
            "Confirm referencing asset now points to the canonical shared context asset, or documents why the superseded shim is still needed.",
          ],
          llmHint:
            "Inspect the referenced deprecated asset and its superseded_by or canonical context metadata. If the canonical shared context is the intended source of truth, update this asset to reference that context directly. Keep the superseded file only when it serves a deliberate compatibility or migration role.",
          details: {
            source:
              metadataText(referencingDocument.metadata.id) ??
              referencingDocument.artifact.path,
            target:
              metadataText(document.metadata.id) ?? document.artifact.path,
            referenceKind: "body_reference",
            sourcePath: referencingDocument.artifact.path,
            targetPath: document.artifact.path,
            targetStatus: metadataText(document.metadata.status),
            replacementTargets: canonicalTargets,
          },
        },
      ];
    });
  });
}

function assetReferenceLine(
  referencingDocument: ParsedDocument,
  targetPath: string,
): { line: number; text: string } | undefined {
  const referencingDir = path.posix.dirname(referencingDocument.artifact.path);
  const relativePath = path.posix.relative(referencingDir, targetPath);
  const referencedTokens = uniqueStrings([
    targetPath,
    relativePath,
    skillRelativePath(referencingDocument.artifact.path, targetPath),
  ]).filter(Boolean);

  for (const index of markdownBodyLineIndexes(referencingDocument)) {
    const line = referencingDocument.lines[index] ?? "";
    if (referencedTokens.some((token) => line.includes(token))) {
      return { line: index + 1, text: line.trim() };
    }
  }

  return undefined;
}

function skillRelativePath(
  referencingPath: string,
  targetPath: string,
): string | undefined {
  const referencingSegments = referencingPath.split("/");
  const targetSegments = targetPath.split("/");
  if (
    referencingSegments[0] !== "skills" ||
    targetSegments[0] !== "skills" ||
    referencingSegments[1] !== targetSegments[1]
  ) {
    return undefined;
  }

  return targetSegments.slice(2).join("/");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return values.filter(
    (value, index): value is string =>
      Boolean(value) && values.indexOf(value) === index,
  );
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
      DIAGNOSTIC_IDS.QUAL_SUPPORT_ASSET_TOKEN_BUDGET,
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
      DIAGNOSTIC_IDS.PROF_MISSING_BASE,
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
          DIAGNOSTIC_IDS.SUPPORT_MISSING_REACHABILITY_GUIDANCE,
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

function listMetadataValue(value: MetadataValue | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value))
    return value.map((item) => item.trim()).filter(Boolean);
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function metadataText(value: MetadataValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
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

function strictLayoutPolicyFindings(
  documents: ParsedDocument[],
  config: ScanConfig,
  catalog?: Catalog,
): Finding[] {
  const findings: Finding[] = [];
  const root = repositoryRoot(documents);
  const paths = new Set(documents.map((document) => document.artifact.path));

  for (const document of documents) {
    findings.push(...disallowedSkillAssetFindings(document, config));
    findings.push(...thinSkillLayoutFindings(document));
    findings.push(...helperCommandFindings(document, root, paths, config));
    findings.push(...layoutConsistencyFindings(document));
    findings.push(...contextRootFindings(document));
    findings.push(...helperRootFindings(document));
  }

  if (catalog) {
    findings.push(...declaredDependencyLayoutFindings(catalog, paths, root));
  }

  return findings;
}

function disallowedSkillAssetFindings(
  document: ParsedDocument,
  config: ScanConfig,
): Finding[] {
  const match = document.artifact.path.match(
    /^skills\/([^/]+)\/(references|profiles|examples|scripts)\/(.+)$/,
  );
  if (!match) return [];

  const [, skillName = "", assetRoot = "", rest = ""] = match;
  const target = canonicalSkillAssetTarget(config, skillName, assetRoot, rest);
  return [
    documentFinding(
      document,
      DIAGNOSTIC_IDS.LAYOUT_DISALLOWED_SKILL_ASSET,
      `Disallowed skill-local ${assetRoot} asset`,
      "structure",
      assetRoot === "scripts" ? "medium" : "low",
      `Move this file to \`${target}\` and update every repo-local reference to the new canonical path.`,
      {
        whyItMatters:
          "Strict layout keeps skills as thin entrypoints, shared context under contexts/, and executable helpers under tools/ so agents can migrate repositories deterministically.",
        verificationSteps: [
          `Move ${document.artifact.path} to ${target}.`,
          "Run renma scan and renma readiness again.",
        ],
        llmHint: `Move ${document.artifact.path} to ${target}, then rewrite references from the old path to the new path. Do not leave a compatibility shim unless another Renma finding requires it.`,
      },
    ),
  ];
}

function canonicalSkillAssetTarget(
  config: ScanConfig,
  skillName: string,
  assetRoot: string,
  rest: string,
): string {
  const workflow = canonicalWorkflowName(config, skillName);
  if (assetRoot === "scripts")
    return helperAssetPath(config, workflow, `scripts/${rest}`);
  return contextAssetPath(config, workflow, `${assetRoot}/${rest}`);
}

function canonicalWorkflowName(config: ScanConfig, skillName: string): string {
  return config.layout.workflowAliases[skillName] ?? skillName;
}

function thinSkillLayoutFindings(document: ParsedDocument): Finding[] {
  if (!isCanonicalSkillEntrypoint(document.artifact.path)) return [];

  const findings: Finding[] = [];
  const wordCount = words(document.artifact.content).length;
  const procedureSignals = [
    /^#{2,}\s+(procedure|steps?|install|configure|troubleshoot|diagnose|setup)\b/im,
    /\b(step\s+\d+|first,|next,|finally)\b/i,
  ];

  if (
    wordCount > 450 ||
    procedureSignals.some((pattern) => pattern.test(document.artifact.content))
  ) {
    findings.push(
      documentFinding(
        document,
        DIAGNOSTIC_IDS.LAYOUT_SKILL_NOT_THIN,
        "Skill entrypoint contains procedure content",
        "structure",
        wordCount > 700 ? "medium" : "low",
        "Move reusable procedure content into contexts/** and keep SKILL.md as a concise router that points to the required context assets.",
        {
          whyItMatters:
            "Strict layout expects skills/*/SKILL.md to route agents, not own canonical references, profiles, examples, scripts, or detailed procedures.",
          verificationSteps: [
            "Confirm SKILL.md contains routing guidance and required context references only.",
            "Run renma readiness and check layout.skills_thin.",
          ],
          llmHint:
            "Extract long procedure sections into contexts/**, add requires_context or optional_context references, and keep SKILL.md focused on when to use or not use the skill.",
        },
      ),
    );
  }

  const command = firstExecutableCommand(document);
  if (command) {
    findings.push(
      findingAt(
        document,
        DIAGNOSTIC_IDS.LAYOUT_SKILL_EXECUTABLE_COMMAND,
        "Skill entrypoint contains executable command",
        "structure",
        "low",
        command.line,
        command.command,
        "Move executable setup commands into contexts/** procedures or tools/** helper documentation, and keep SKILL.md as a router.",
        {
          whyItMatters:
            "Executable setup commands in SKILL.md make the entrypoint procedural and harder to migrate to the strict three-root layout.",
          verificationSteps: [
            "Move the command guidance to a context/reference/procedure.",
            "If the command invokes a helper script, ensure it points under tools/**.",
          ],
        },
      ),
    );
  }

  return findings;
}

function helperCommandFindings(
  document: ParsedDocument,
  root: string | undefined,
  paths: Set<string>,
  config: ScanConfig,
): Finding[] {
  const findings: Finding[] = [];

  for (const command of executableCommands(document)) {
    const scriptPath = helperScriptPath(command.command);
    if (!scriptPath) continue;

    if (/^skills\/[^/]+\/scripts\//.test(scriptPath)) {
      findings.push(
        findingAt(
          document,
          DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_SKILL_SCRIPTS,
          "Helper command points to skill-local scripts",
          "structure",
          "medium",
          command.line,
          command.command,
          `Move the helper script to \`${canonicalHelperTarget(config, scriptPath)}\` and update this command to use the tools/** path.`,
          {
            whyItMatters:
              "Strict layout keeps executable helper assets under tools/**, not under skills/**.",
            verificationSteps: [
              `Confirm ${canonicalHelperTarget(config, scriptPath)} exists.`,
              "Run renma scan and renma readiness again.",
            ],
          },
        ),
      );
      continue;
    }

    if (scriptPath.includes("/scripts/") && !scriptPath.startsWith("tools/")) {
      findings.push(
        findingAt(
          document,
          DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_NON_TOOLS,
          "Helper command does not use tools root",
          "structure",
          "low",
          command.line,
          command.command,
          "Update helper script commands to reference scripts under tools/**.",
          {
            whyItMatters:
              "Helper commands should resolve to non-context helper assets in tools/** so contexts remain LLM-readable guidance.",
          },
        ),
      );
      continue;
    }

    if (
      scriptPath.startsWith("tools/") &&
      !paths.has(scriptPath) &&
      !(root && existsSync(path.join(root, scriptPath)))
    ) {
      findings.push(
        findingAt(
          document,
          DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED,
          "Helper command target does not resolve",
          "structure",
          "medium",
          command.line,
          command.command,
          `Create \`${scriptPath}\` or update this command to the correct tools/** helper path.`,
          {
            whyItMatters:
              "Agents need helper commands in markdown procedures to resolve deterministically before running them.",
          },
        ),
      );
    }
  }

  return findings;
}

function layoutConsistencyFindings(document: ParsedDocument): Finding[] {
  if (
    document.artifact.path !== "README.md" &&
    document.artifact.path !== "AGENTS.md"
  )
    return [];

  const text = document.artifact.content;
  const findings: Finding[] = [];
  const stalePatterns = [
    {
      pattern: /copy-paste prompt templates/i,
      message:
        "Replace copy-paste prompt template wording with execution rules, routing guidance, workflow sections, or actual template assets.",
    },
    {
      pattern: /Each skill includes a self-improvement prompt/i,
      message:
        "Describe self-improvement prompts as loaded context/reference/procedure workflow prompts instead of SKILL.md-only content.",
    },
    {
      pattern: /skills\/[^/\s`]+\/(?:references|profiles|examples|scripts)\//,
      message:
        "Update docs to point to canonical contexts/** assets or tools/** helper scripts instead of skill-local support directories.",
    },
    {
      pattern: /\]\(contexts\/tools\//,
      message:
        "Use backtick repo-root paths for contexts/tools/... references instead of file-relative Markdown links.",
    },
  ];

  for (const stale of stalePatterns) {
    const match = text.match(stale.pattern);
    if (!match) continue;
    const line = lineForOffset(text, match.index ?? 0);
    findings.push(
      findingAt(
        document,
        DIAGNOSTIC_IDS.DOCS_LAYOUT_INCONSISTENT,
        "Repository docs describe a non-canonical layout",
        "maintenance",
        "low",
        line,
        lineText(document, line),
        stale.message,
        {
          whyItMatters:
            "README.md and AGENTS.md should teach agents the same strict three-root layout that Renma enforces.",
          verificationSteps: [
            "Update README.md and AGENTS.md to mention skills/, contexts/, and tools/ canonical roots.",
            "Run renma scan again.",
          ],
        },
      ),
    );
  }

  return findings;
}

function contextRootFindings(document: ParsedDocument): Finding[] {
  if (document.artifact.path.startsWith("context/")) {
    return [
      documentFinding(
        document,
        DIAGNOSTIC_IDS.LAYOUT_CONTEXT_LEGACY_ROOT,
        "Context asset uses legacy context/ root",
        "structure",
        "low",
        "Move canonical LLM-readable context assets under contexts/**.",
        {
          whyItMatters:
            "The strict repository layout uses contexts/**/*.md as canonical LLM-readable context assets.",
        },
      ),
    ];
  }
  return [];
}

function helperRootFindings(document: ParsedDocument): Finding[] {
  if (
    document.artifact.path.includes("/scripts/") &&
    !document.artifact.path.startsWith("tools/")
  ) {
    return [
      documentFinding(
        document,
        DIAGNOSTIC_IDS.LAYOUT_HELPER_NON_TOOLS,
        "Helper script is outside tools root",
        "structure",
        "medium",
        "Move non-context helper assets under tools/** and update command references.",
        {
          whyItMatters:
            "The strict repository layout reserves tools/** for executable and non-context helper assets.",
        },
      ),
    ];
  }
  return [];
}

function declaredDependencyLayoutFindings(
  catalog: Catalog,
  paths: Set<string>,
  root: string | undefined,
): Finding[] {
  const findings: Finding[] = [];

  for (const dependency of catalog.dependencies) {
    const target = dependency.to;
    if (!isRepoPathLike(target)) continue;
    if (!paths.has(target) && !(root && existsSync(path.join(root, target)))) {
      continue;
    }
    if (
      target.startsWith("contexts/") ||
      target.startsWith("skills/") ||
      target.startsWith("tools/")
    ) {
      continue;
    }
    const source = catalog.assets.find((asset) => asset.id === dependency.from);
    if (!source) continue;
    findings.push({
      id: DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL,
      title: "Declared context path is not under canonical roots",
      category: "structure",
      severity: "low",
      confidence: "medium",
      evidence: metadataFindingEvidence(source.sourcePath, target),
      whyItMatters:
        "Declared context references should resolve through canonical contexts/**, skills/**, or tools/** repo paths.",
      remediation:
        "Rewrite declared requires_context or optional_context values to canonical repo-root paths.",
      verificationSteps: ["Run renma graph and confirm all edges resolve."],
      details: {
        source: dependency.from,
        target: dependency.to,
        referenceKind: dependency.kind,
        sourcePath: source.sourcePath,
      },
    });
  }

  return findings;
}

function executableCommands(document: ParsedDocument): Array<{
  command: string;
  line: number;
}> {
  return document.codeFences.flatMap((fence) =>
    fence.content
      .split(/\r?\n/)
      .map((line, index) => ({
        command: line.trim(),
        line: fence.startLine + index + 1,
      }))
      .filter(({ command }) =>
        /^(node|bash|sh|python|python3)\s+/.test(command),
      ),
  );
}

function firstExecutableCommand(
  document: ParsedDocument,
): { command: string; line: number } | undefined {
  return executableCommands(document)[0];
}

function helperScriptPath(command: string): string | undefined {
  const parts = command.split(/\s+/).slice(1);
  return parts.find((part) =>
    /(?:^|\/)scripts\/.+\.(?:mjs|js|cjs|sh|bash|py)$/.test(part),
  );
}

function canonicalHelperTarget(config: ScanConfig, scriptPath: string): string {
  const parts = scriptPath.split("/");
  const skillName = parts[1] ?? "unknown";
  const rest = parts.slice(3).join("/");
  const workflow = canonicalWorkflowName(config, skillName);
  return helperAssetPath(config, workflow, `scripts/${rest}`);
}

function contextAssetPath(
  config: ScanConfig,
  workflow: string,
  rest: string,
): string {
  const namespace = config.layout.toolNamespace;
  if (namespace) return `contexts/tools/${namespace}/${workflow}/${rest}`;
  return `contexts/${workflow}/${rest}`;
}

function helperAssetPath(
  config: ScanConfig,
  workflow: string,
  rest: string,
): string {
  const namespace = config.layout.toolNamespace;
  if (namespace) return `tools/${namespace}/${workflow}/${rest}`;
  return `tools/${workflow}/${rest}`;
}

function isCanonicalSkillEntrypoint(pathValue: string): boolean {
  return /^skills\/[^/]+\/SKILL\.md$/.test(pathValue);
}

function repositoryRoot(documents: ParsedDocument[]): string | undefined {
  const document = documents[0];
  if (!document) return undefined;
  return document.artifact.absolutePath.slice(
    0,
    document.artifact.absolutePath.length - document.artifact.path.length,
  );
}

function findingAt(
  document: ParsedDocument,
  id: string,
  title: string,
  category: Finding["category"],
  severity: Severity,
  line: number,
  snippet: string,
  remediation: string,
  details: FindingDetails = {},
): Finding {
  return {
    ...finding(id, title, category, severity, document, remediation, details),
    evidence: evidence(document, line, snippet),
    remediation,
  };
}

function lineForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function lineText(document: ParsedDocument, line: number): string {
  return document.lines[line - 1] ?? "";
}

function isRepoPathLike(value: string): boolean {
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value);
}

function words(text: string): string[] {
  return text.match(/[A-Za-z0-9_./+=-]+|[^\sA-Za-z0-9_./+=-]/g) ?? [];
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
    ...(details.riskClass ? { riskClass: details.riskClass } : {}),
    ...(details.details ? { details: details.details } : {}),
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
    ...(details.riskClass ? { riskClass: details.riskClass } : {}),
    ...(details.details ? { details: details.details } : {}),
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
  if (kind === "profile") return DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_PROFILE;
  if (kind === "example") return DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_EXAMPLE;
  return DIAGNOSTIC_IDS.SUPPORT_UNREACHABLE_REFERENCE;
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
