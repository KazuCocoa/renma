import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import type { DiagnosticId } from "./diagnostic-ids.js";
import { hiddenUnicodeFindings } from "./hidden-unicode.js";
import {
  classifyNpmSelector,
  classifyPythonSelector,
  type FloatingDependencyAllowance,
} from "./dependency-selectors.js";
import {
  applySecurityConfig,
  effectiveAllowedDataClass,
  effectiveAllowedDataList,
  isSecurityPolicyLine,
  resolveOperationalSecurityPolicy,
  securityProfileChain,
  type CanonicalSecurityMetadataIssue,
  type SecurityPolicy,
  type SecurityProfileChain,
} from "./security-policy.js";
import type { Artifact } from "./types/artifact.js";
import type { Finding, RiskClass } from "./types/diagnostics.js";
import type { ParsedDocument } from "./types/metadata.js";
import type { SecurityConfig } from "./types/configuration.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import { parseDocument } from "./markdown.js";
import { inspectAgentSkill } from "./agent-skills.js";
import {
  ensureMarkdownSyntaxForDocument,
  markdownSourceRange,
  type MarkdownSyntax,
} from "./markdown-syntax.js";
import {
  MarkdownSecurityView,
  type MarkdownSemanticUnit,
} from "./markdown-security-view.js";
import {
  analyzeSecurityCommand,
  hasPositiveDisclosureAction,
  positiveDisclosureActions,
  type SecurityCommandAnalysis,
} from "./security-command/index.js";
import {
  disclosureClauseRangesIntersectingRange,
  disclosureRangeIsExplicitlyProhibited,
} from "./security-command/guards.js";
import {
  analyzeDestinations,
  analyzeLogicalShellCommands,
  isNetworkInstruction,
  isUploadInstruction,
  logicalShellCommandEvidence,
  logicalShellCommands,
  networkDestinations,
  unapprovedDestinations,
  uploadDestinations,
  type DestinationAnalysis,
  type LogicalShellCommand,
  type NetworkDestination,
} from "./security-destination/index.js";
import {
  CLOUD_UPLOAD_ACTION_TERMS,
  CLOUD_UPLOAD_DESTINATION_TERMS,
  EXTERNAL_UPLOAD_ACTION_TERMS,
  EXTERNAL_UPLOAD_DESTINATION_TERMS,
} from "./security-prose-vocabulary.js";
import {
  bodyPolicyStatementGroupFacts,
  type BodyPolicyClauseFacts,
  type BodyPolicyDomain,
} from "./security-body-policy/clause-facts.js";
import { CANONICAL_SKILL_DESCRIPTION_AUTHORING_RULE } from "./types/skill-description.js";

// Preserve the established destination-analysis deep imports while the
// implementation remains owned by security-destination.
export {
  associatedNetworkDestinations,
  associatedUploadDestinations,
  classifyDestinationCandidates,
} from "./security-destination/index.js";
export type {
  DestinationCandidate,
  DestinationCandidateKind,
  NetworkDestination,
} from "./security-destination/index.js";

type SecurityCategory = "quality" | "safety";

type RuleMetadata = {
  id: DiagnosticId;
  category: SecurityCategory;
  title: string;
  whyItMatters: string;
  remediation: string;
  constraints: string[];
  verificationSteps: string[];
  llmHint: string;
  confidence: Finding["confidence"];
  riskClass: RiskClass;
};

type Detection = {
  metadata: RuleMetadata;
  severity: Finding["severity"];
  startLine: number;
  endLine?: number;
  snippet: string;
  dedupeKey?: string;
  details?: Record<string, unknown>;
  semanticEvidenceText?: string;
  semanticEvidenceSource?: "canonical-description";
};

type DetectionEvidence = Pick<Detection, "startLine" | "endLine" | "snippet">;

type PolicyDetectionInput =
  | { scope: "line-local" }
  | {
      scope: "all" | "destination";
      analysis: DestinationAnalysis;
    };

const RULES = {
  missingPolicyMetadata: {
    id: DIAGNOSTIC_IDS.SEC_MISSING_POLICY_METADATA,
    category: "safety",
    title: "Security-sensitive instructions are missing policy metadata",
    whyItMatters:
      "LLM-facing security policy metadata gives humans and agents a deterministic contract for network, upload, and secret-handling instructions.",
    remediation:
      "For Skills, add canonical metadata.renma.* string fields such as renma.network-allowed and renma.approved-network-destinations. For non-Skills, use the existing top-level policy fields.",
    constraints: [
      "Keep the policy deterministic and local to the artifact.",
      "Do not infer approval from prose alone.",
      "Preserve existing repository governance metadata.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the artifact declares the relevant policy fields.",
      "Review the security-sensitive instruction against the declared policy.",
    ],
    llmHint:
      "Add small policy fields that describe whether network access, external uploads, and secret material are allowed. Use canonical metadata.renma.* strings for Skills and top-level fields only for non-Skills.",
    confidence: "medium",
    riskClass: "advisory",
  },
  policyContradiction: {
    id: DIAGNOSTIC_IDS.SEC_POLICY_CONTRADICTION,
    category: "safety",
    title: "Security policy fields contradict each other",
    whyItMatters:
      "Contradictory policy metadata makes deterministic review ambiguous and can cause an agent to follow the less restrictive interpretation.",
    remediation:
      "Make the policy internally consistent, or split the artifact so each instruction set has one clear policy.",
    constraints: [
      "Do not weaken restrictions without human review.",
      "Keep network and upload allowances explicit.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm contradictory policy fields no longer appear together.",
    ],
    llmHint:
      "Resolve the policy by choosing the stricter allowed behavior or by separating instructions into different assets with explicit metadata.",
    confidence: "high",
    riskClass: "violation",
  },
  invalidCanonicalPolicyMetadata: {
    id: DIAGNOSTIC_IDS.SEC_INVALID_CANONICAL_POLICY_METADATA,
    category: "safety",
    title: "Canonical Skill security metadata has an invalid encoding",
    whyItMatters:
      "An invalid local policy declaration must fail closed instead of inheriting a more permissive profile or repository value.",
    remediation:
      "Replace the value only after confirming the intended policy. Do not infer a permissive value from an invalid declaration.",
    constraints: [
      "Do not guess the intended boolean, list, or profile value.",
      "Keep canonical Agent Skills metadata values string-valued.",
      "Preserve the local declaration as blocked until a human confirms the policy.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the canonical field uses the documented exact encoding.",
      "Confirm inherited policy does not broaden the rejected local declaration.",
    ],
    llmHint:
      "Inspect the exact metadata.renma.* evidence and ask for human confirmation of the intended policy before replacing it. Do not guess a permissive value.",
    confidence: "high",
    riskClass: "violation",
  },
  bodyPolicyContradiction: {
    id: DIAGNOSTIC_IDS.SEC_BODY_POLICY_CONTRADICTION,
    category: "safety",
    title: "Security policy metadata contradicts the instruction body",
    whyItMatters:
      "Conflicting body text and policy metadata make deterministic review ambiguous and can cause an agent to follow the less restrictive instruction.",
    remediation:
      "Make the body instructions and security metadata agree, or split them into separate artifacts with explicit policy fields.",
    constraints: [
      "deterministic",
      "uses bounded workflow-scope and prohibition patterns",
      "does not perform general natural-language intent classification",
    ],
    verificationSteps: [
      "Run renma scan and confirm policy fields match the body instructions.",
    ],
    llmHint:
      "Resolve body and metadata conflicts by choosing the stricter behavior or separating conflicting instructions into different assets.",
    confidence: "high",
    riskClass: "violation",
  },
  policyProfileNotFound: {
    id: DIAGNOSTIC_IDS.SEC_POLICY_PROFILE_NOT_FOUND,
    category: "safety",
    title: "Referenced security profile is not configured",
    whyItMatters:
      "A missing security profile makes artifact policy resolution ambiguous and can hide intended network, upload, and secret-handling constraints.",
    remediation:
      "Add the named profile under security.profiles or update the artifact to reference an existing profile.",
    constraints: [
      "Do not silently ignore profile references.",
      "Keep profile names deterministic and repo-local.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the referenced security profile exists in configuration.",
    ],
    llmHint:
      "Use a configured security_profile value, or add the missing profile under security.profiles with explicit policy fields.",
    confidence: "high",
    riskClass: "violation",
  },
  policyProfileCycle: {
    id: DIAGNOSTIC_IDS.SEC_POLICY_PROFILE_CYCLE,
    category: "safety",
    title: "Security profile inheritance cycle detected",
    whyItMatters:
      "Cyclic profile inheritance prevents deterministic policy resolution and can make agents miss stricter inherited restrictions.",
    remediation:
      "Break the profile inheritance cycle so each profile resolves through an acyclic chain.",
    constraints: [
      "Do not resolve cycles by choosing the least restrictive profile.",
      "Keep inherited policy chains short and explicit.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm profile inheritance resolves without revisiting the same profile.",
    ],
    llmHint:
      "Remove or rewrite the cyclic profile reference so the selected security profile has a deterministic parent chain.",
    confidence: "high",
    riskClass: "violation",
  },
  policyOverrideContradiction: {
    id: DIAGNOSTIC_IDS.SEC_POLICY_OVERRIDE_CONTRADICTION,
    category: "safety",
    title: "Security profile conflicts with stricter artifact policy",
    whyItMatters:
      "Profile or repository allowances cannot override artifact-local explicit denials without making the policy contract ambiguous.",
    remediation:
      "Keep the artifact-local denial and remove conflicting inherited allowances, or split the artifact into separately governed instructions.",
    constraints: [
      "Artifact-local explicit denials remain strict.",
      "Do not weaken local restrictions through profile inheritance.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm inherited policy does not contradict explicit artifact denials.",
    ],
    llmHint:
      "Treat explicit false policy fields in the artifact as authoritative and adjust the referenced profile or repo-level security config.",
    confidence: "high",
    riskClass: "violation",
  },
  forbiddenInputInstruction: {
    id: DIAGNOSTIC_IDS.SEC_FORBIDDEN_INPUT_INSTRUCTION,
    category: "safety",
    title: "Instruction requests data forbidden by security profile",
    whyItMatters:
      "Profile-level forbidden inputs define data classes that must not be collected, copied, uploaded, or summarized by LLM-facing instructions.",
    remediation:
      "Remove the forbidden input request or choose a profile whose allowed data contract covers the instruction.",
    constraints: [
      "Do not reinterpret forbidden inputs as allowed data.",
      "Keep profile data-class restrictions explicit.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the artifact no longer instructs agents to handle forbidden inputs.",
    ],
    llmHint:
      "Rewrite the instruction so it avoids profile-forbidden inputs such as secrets, credentials, private keys, or customer data.",
    confidence: "high",
    riskClass: "violation",
  },
  instructionViolatesPolicy: {
    id: DIAGNOSTIC_IDS.SEC_INSTRUCTION_VIOLATES_POLICY,
    category: "safety",
    title: "Instruction appears to violate declared security policy",
    whyItMatters:
      "A deterministic policy denial should override LLM-facing operational instructions that ask for network, upload, or secret handling.",
    remediation:
      "Remove or rewrite the violating instruction, or update the policy only after an explicit human security review.",
    constraints: [
      "Do not silently relax network, upload, or secret restrictions.",
      "Preserve the artifact's intended workflow where it can be made policy-compliant.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm no instruction conflicts with the declared policy.",
    ],
    llmHint:
      "Find the instruction that asks for denied behavior and rewrite it to stay within the artifact's declared security policy.",
    confidence: "high",
    riskClass: "violation",
  },
  missingHumanApprovalGuard: {
    id: DIAGNOSTIC_IDS.SEC_MISSING_HUMAN_APPROVAL_GUARD,
    category: "safety",
    title: "Sensitive external action lacks a human approval guard",
    whyItMatters:
      "Instructions that send data externally should clearly require human confirmation before an agent performs the action.",
    remediation:
      "Add an explicit approval, confirmation, or review guard before external network or upload actions.",
    constraints: [
      "Do not replace approval with vague cautionary language.",
      "Keep the guard close to the sensitive instruction.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the sensitive action is guarded by nearby approval language.",
    ],
    llmHint:
      "Insert an explicit human approval requirement next to upload, POST, cloud sync, or external sharing instructions.",
    confidence: "medium",
    riskClass: "violation",
  },
  sensitiveFileReference: {
    id: DIAGNOSTIC_IDS.SEC_SENSITIVE_FILE_REFERENCE,
    category: "safety",
    title: "Instruction references sensitive file material",
    whyItMatters:
      "Private keys, signing material, credential stores, and environment files need deliberate handling before they are read, copied, or attached to agent context.",
    remediation:
      "Remove unnecessary sensitive file references or add explicit handling rules that prevent disclosure.",
    constraints: [
      "Do not expose file contents in diagnostics.",
      "Keep allowlisted sample paths separate from real secret material.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm sensitive file references are removed, mocked, or protected by policy.",
    ],
    llmHint:
      "Inspect this reference and either replace it with a safe placeholder or add explicit no-disclosure handling instructions.",
    confidence: "high",
    riskClass: "violation",
  },
  secretMaterialInstruction: {
    id: DIAGNOSTIC_IDS.SEC_SECRET_MATERIAL_INSTRUCTION,
    category: "safety",
    title: "Instruction may expose secret material",
    whyItMatters:
      "LLM-facing instructions that copy, print, paste, upload, or summarize secrets can leak credentials even when no literal secret value appears in the repository.",
    remediation:
      "Rewrite the instruction to avoid exposing secret material and require redaction or human review when sensitive files are involved.",
    constraints: [
      "Do not include secret values in the repair.",
      "Prefer safe placeholders and redaction guidance.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm secret material is not requested for printing, copying, uploading, or context inclusion.",
    ],
    llmHint:
      "Rewrite this instruction so secret-bearing files are never copied into prompts, logs, uploads, or diagnostics.",
    confidence: "high",
    riskClass: "violation",
  },
  externalUploadInstruction: {
    id: DIAGNOSTIC_IDS.SEC_EXTERNAL_UPLOAD_INSTRUCTION,
    category: "safety",
    title: "Instruction sends repository data to an external destination",
    whyItMatters:
      "External uploads can disclose proprietary code, logs, credentials, customer data, or unreleased operational details.",
    remediation:
      "Require explicit approval and destination review before uploading or sharing repository data externally.",
    constraints: [
      "Do not assume cloud or pastebin destinations are safe.",
      "Keep approved destinations explicit in policy metadata.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm uploads are either removed or guarded by explicit policy and approval.",
    ],
    llmHint:
      "Add a human approval gate and approved destination metadata, or replace the upload with a local-only workflow.",
    confidence: "high",
    riskClass: "suspicious",
  },
  unapprovedNetworkDestination: {
    id: DIAGNOSTIC_IDS.SEC_UNAPPROVED_NETWORK_DESTINATION,
    category: "safety",
    title: "Instruction references an unapproved network destination",
    whyItMatters:
      "Agents need deterministic destination allowlists when instructions mention external hosts, APIs, or storage services.",
    remediation:
      "Enumerate the actual required domains in approved_network_destinations or the applicable profile/repository security config after review.",
    constraints: [
      "Do not use fuzzy destination matching.",
      "Keep hostnames or URL prefixes explicit.",
      "Do not remove the network requirement, use broad wildcards, or move the declaration elsewhere only to silence this warning.",
      "Do not replace specific domains with broad wildcards unless the source documentation explicitly supports that exact scope.",
      "If the required domains are unknown, keep the issue visible and add a TODO with supporting references instead of guessing.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm every real external destination is represented by a specific approved network destination.",
    ],
    llmHint:
      "Enumerate the actual required domains. Do not remove the network requirement, use broad wildcards, or move the declaration elsewhere only to silence this warning. If the required domains are unknown, keep the issue visible and add a TODO with supporting references instead of guessing.",
    confidence: "high",
    riskClass: "violation",
  },
  unapprovedUploadDestination: {
    id: DIAGNOSTIC_IDS.SEC_UNAPPROVED_UPLOAD_DESTINATION,
    category: "safety",
    title: "Instruction references an unapproved upload destination",
    whyItMatters:
      "Upload destinations need a stricter allowlist because they can receive repository data, logs, credentials, or private context.",
    remediation:
      "Add the destination to security.approvedUploadDomains after review, or remove the upload instruction.",
    constraints: [
      "Do not treat general network approval as upload approval.",
      "Keep upload destinations explicit and deterministic.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm every upload destination is approved or removed.",
    ],
    llmHint:
      "Compare the referenced upload URL or host to security.approvedUploadDomains and either approve it explicitly or remove the instruction.",
    confidence: "high",
    riskClass: "violation",
  },
  bulkDataSharingInstruction: {
    id: DIAGNOSTIC_IDS.SEC_BULK_DATA_SHARING_INSTRUCTION,
    category: "safety",
    title: "Instruction asks to share broad repository or context data",
    whyItMatters:
      "Bulk sharing instructions can leak more information than the task needs and are risky when followed by an LLM agent.",
    remediation:
      "Narrow the instruction to the minimum files, snippets, or sanitized summary needed for review.",
    constraints: [
      "Do not ask an agent to paste entire repositories, logs, or context bundles.",
      "Prefer scoped evidence snippets over bulk data transfer.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm sharing instructions name a bounded, minimal data set.",
    ],
    llmHint:
      "Replace broad sharing language with scoped file paths, limited snippets, and redaction requirements.",
    confidence: "medium",
    riskClass: "suspicious",
  },
  cloudUploadInstruction: {
    id: DIAGNOSTIC_IDS.SEC_CLOUD_UPLOAD_INSTRUCTION,
    category: "safety",
    title: "Instruction uploads data to cloud storage or cloud services",
    whyItMatters:
      "Cloud upload instructions often move repository data outside local review boundaries and should be explicitly approved.",
    remediation:
      "Replace cloud upload with a local artifact, or require explicit approval and approved destination metadata.",
    constraints: [
      "Do not treat generic cloud storage as approved by default.",
      "Keep external upload policy explicit.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm cloud uploads are removed, approved, or guarded.",
    ],
    llmHint:
      "Turn the cloud upload into a local-only output, or add policy metadata and a human approval guard.",
    confidence: "medium",
    riskClass: "suspicious",
  },
  overbroadContextInstruction: {
    id: DIAGNOSTIC_IDS.SEC_OVERBROAD_CONTEXT_INSTRUCTION,
    category: "safety",
    title: "Instruction requests overbroad context collection",
    whyItMatters:
      "Overbroad context collection encourages agents to ingest unnecessary files, logs, or private data before a task requires it.",
    remediation:
      "Scope the instruction to relevant files, folders, or evidence snippets and exclude secret-bearing material.",
    constraints: [
      "Do not introduce runtime context selection.",
      "Keep guidance deterministic and repository-local.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm context instructions are scoped and exclude sensitive material.",
    ],
    llmHint:
      "Replace broad context collection with bounded paths, task-relevant snippets, and explicit exclusions for secrets.",
    confidence: "medium",
    riskClass: "suspicious",
  },
  noRedactionInstruction: {
    id: DIAGNOSTIC_IDS.SEC_NO_REDACTION_INSTRUCTION,
    category: "safety",
    title: "Instruction discourages redaction of sensitive data",
    whyItMatters:
      "Telling agents not to redact data can cause credentials, customer data, or internal details to appear in prompts, logs, or uploads.",
    remediation:
      "Remove the no-redaction instruction and require redaction for secrets, credentials, tokens, personal data, and proprietary values.",
    constraints: [
      "Do not weaken redaction requirements.",
      "Keep examples synthetic where possible.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm instructions require redaction where sensitive data may appear.",
    ],
    llmHint:
      "Replace no-redaction wording with explicit redaction requirements for secrets and sensitive data.",
    confidence: "high",
    riskClass: "violation",
  },
  safeguardBypassInstruction: {
    id: DIAGNOSTIC_IDS.SEC_SAFEGUARD_BYPASS_INSTRUCTION,
    category: "safety",
    title: "Instruction bypasses a security safeguard",
    whyItMatters:
      "Agent-facing instructions that disable checks, weaken policy, skip approval, suppress warnings, or choose a riskier fallback can turn repository guidance into a direct safeguard bypass.",
    remediation:
      "Remove the bypass and require the workflow to stop, report the blocker, and preserve the existing security policy or approval requirement.",
    constraints: [
      "Do not weaken policy, verification, warnings, or approval requirements merely to make a workflow continue or diagnostics pass.",
      "Do not replace required approval with dry-run, backup, rollback, silence, timeout, or post-hoc review.",
      "Keep permission failures fail-closed and report unresolved authority instead of selecting a more dangerous fallback.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the bypass instruction is removed or rewritten as a fail-closed stop and report path.",
      "Confirm the original security policy and approval requirement remain at least as strict.",
    ],
    llmHint:
      "Rewrite the instruction to preserve the safeguard, stop when approval or permission is unavailable, report the blocker, and rerun renma scan without adding a suppression or relaxing policy.",
    confidence: "high",
    riskClass: "violation",
  },
  untrustedContentAsInstruction: {
    id: DIAGNOSTIC_IDS.SEC_UNTRUSTED_CONTENT_AS_INSTRUCTION,
    category: "safety",
    title: "Instruction treats untrusted content as executable guidance",
    whyItMatters:
      "External pages, issue bodies, logs, attachments, downloaded Markdown, and tool output can contain prompt injection or unsafe commands and must remain data until reviewed and validated.",
    remediation:
      "Treat fetched or supplied content as untrusted data, extract only task-relevant facts, and require validation before using any embedded instruction or command.",
    constraints: [
      "Do not execute or follow embedded instructions verbatim.",
      "Preserve provenance and distinguish source content from repository-owned instructions.",
      "Reading, quoting, summarizing, or validating a source is not permission to execute it.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm external or tool-produced content is handled as data rather than authority.",
      "Confirm any retained action comes from reviewed repository guidance or explicit human approval.",
    ],
    llmHint:
      "Replace verbatim-follow or execute-every-command guidance with untrusted-data handling, bounded fact extraction, provenance, validation, and an explicit review gate.",
    confidence: "high",
    riskClass: "violation",
  },
  unboundedExternalSourceTraversal: {
    id: DIAGNOSTIC_IDS.SEC_UNBOUNDED_EXTERNAL_SOURCE_TRAVERSAL,
    category: "safety",
    title: "Recursive external source traversal has no stated boundary",
    whyItMatters:
      "Unbounded traversal of links, issues, attachments, or related pages can expand scope unpredictably, revisit cycles, consume excessive resources, and expose an agent to unrelated or malicious content.",
    remediation:
      "Define source and relevance scope, logical identity and visited handling, depth or count limits, failure stop conditions, and unresolved-scope reporting in the same bounded section.",
    constraints: [
      "Do not make Renma crawl sources or enforce traversal at runtime.",
      "Do not treat one named source read as recursive traversal.",
      "Keep traversal bounds local to the instruction they govern.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm recursive traversal is removed or has explicit local scope and termination boundaries.",
      "Confirm cycles, failures, and unresolved scope have deterministic handling guidance.",
    ],
    llmHint:
      "Bound the recursive source walk in the same section: name allowed sources and relevance, track logical visited identities, cap depth/count/time, stop on failure, and report unresolved scope.",
    confidence: "medium",
    riskClass: "advisory",
  },
  unpinnedRemoteScript: {
    id: DIAGNOSTIC_IDS.SEC_UNPINNED_REMOTE_SCRIPT,
    category: "safety",
    title: "Remote install script is not pinned",
    whyItMatters:
      "Piping a mutable remote script into a shell gives the destination server control over code executed by the agent or developer.",
    remediation:
      "Replace the pipe-to-shell command with a pinned release artifact, checksum verification, or manually reviewed local script.",
    constraints: [
      "Do not execute the remote script during remediation.",
      "Keep install guidance reproducible.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm remote script execution is removed or pinned with verification.",
    ],
    llmHint:
      "Rewrite the install instruction to download a pinned artifact and verify it before execution.",
    confidence: "high",
    riskClass: "suspicious",
  },
  unpinnedDependencyInstall: {
    id: DIAGNOSTIC_IDS.SEC_UNPINNED_DEPENDENCY_INSTALL,
    category: "safety",
    title: "Dependency install is not pinned",
    whyItMatters:
      "Unpinned dependencies make agent setup non-reproducible and can unexpectedly pull compromised or breaking packages.",
    remediation:
      "Use repository evidence and established ecosystem conventions to choose a reviewed exact package selector, a supported Homebrew formula version, or an explicit non-floating container image tag or immutable digest. Use an accepted fail-closed variable form only where Renma structurally supports it; exact asset-local floating-selector allowances apply only to supported npm: or pypi: selectors.",
    constraints: [
      "Check repository evidence and the intended support matrix before selecting a package version, formula version, image tag, or digest; never invent one.",
      "Preserve existing package-manager, Homebrew, and container-image conventions.",
      "Use fail-closed variables only in structurally supported forms, and never use npm/PyPI floating-selector allowances to suppress Homebrew or Docker findings.",
      "Do not claim that uninspected manifests, lockfiles, requirements files, constraints files, or other dependency sources were verified.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm structured npm/PyPI installs use reviewed exact selectors, structurally accepted fail-closed variables, or exact asset-local npm:/pypi: floating-selector approvals.",
      "Confirm Homebrew formulas use a supported versioned formula when repository conventions permit it, and container images use an explicit non-floating tag or immutable digest.",
      "Confirm no value was invented and no uninspected dependency source is described as verified.",
    ],
    llmHint:
      "Check repository evidence first. Use a reviewed ecosystem-specific exact package selector; a supported versioned Homebrew formula where conventions permit; or an explicit non-floating image tag or immutable digest. Use ${NAME:?message} only where Renma structurally supports that variable form, and use asset-local floating allowances only for exact npm: or pypi: selectors. Never invent a package version, formula version, image tag, or digest, or claim uninspected dependency sources were verified.",
    confidence: "medium",
    riskClass: "suspicious",
  },
  privilegedCommandWithoutGuard: {
    id: DIAGNOSTIC_IDS.SEC_PRIVILEGED_COMMAND_WITHOUT_GUARD,
    category: "safety",
    title: "Privileged command lacks a review guard",
    whyItMatters:
      "Privileged commands can modify the host, containers, system package state, or file ownership outside the repository.",
    remediation:
      "Add a human approval or review guard before privileged commands, or replace them with least-privilege alternatives.",
    constraints: [
      "Do not normalize privileged commands as routine setup.",
      "Keep the guard close to the command.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm privileged commands require approval or have been removed.",
    ],
    llmHint:
      "Add an explicit approval requirement before sudo, chmod/chown, docker privileged operations, or system writes.",
    confidence: "medium",
    riskClass: "suspicious",
  },
  canonicalDescriptionHighRiskLiteral: {
    id: DIAGNOSTIC_IDS.QUAL_SKILL_DESCRIPTION_HIGH_RISK_LITERAL,
    category: "quality",
    title: "Canonical Skill description contains a high-risk routing literal",
    whyItMatters:
      "Quoted request examples are non-operational routing evidence, but concrete high-risk payloads in top-level descriptions are easy for generators and reviewers to reuse outside that boundary.",
    remediation: `Replace the literal with semantic routing wording. ${CANONICAL_SKILL_DESCRIPTION_AUTHORING_RULE}`,
    constraints: [
      "Do not reinterpret the quoted literal as an operational instruction solely to raise severity.",
      "Do not automatically rewrite an owner-authored description.",
      "Keep real operational text visible to the existing security diagnostics.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm the description contains capabilities and selection boundaries rather than a concrete high-risk payload.",
      "If exact evidence is necessary, confirm it is in a clearly non-operational Skill body section.",
    ],
    llmHint:
      "Recommend a semantic routing paraphrase without automatically rewriting the description. If the exact dangerous literal must be retained, move it to a clearly non-operational unsafe-example or review-evidence section in the Skill body.",
    confidence: "high",
    riskClass: "advisory",
  },
  destructiveCommand: {
    id: DIAGNOSTIC_IDS.SEC_DESTRUCTIVE_COMMAND,
    category: "safety",
    title: "Destructive command lacks a review guard",
    whyItMatters:
      "Destructive commands in agent-facing guidance can erase files, reset Git state, remove containers, or delete infrastructure when copied or followed by an agent.",
    remediation:
      "Remove the destructive command, replace it with a safer scoped command, or add explicit human approval, dry-run, backup, and rollback guidance.",
    constraints: [
      "Do not normalize destructive commands as routine setup.",
      "Keep any required destructive action narrowly scoped.",
      "Keep approval and recovery guidance close to the command.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm destructive commands are removed or guarded.",
      "Review any remaining command for scope, backup, and rollback guidance.",
    ],
    llmHint:
      "Replace forced deletion, hard reset, clean, prune, or delete commands with safer alternatives, or add explicit approval plus verification and rollback steps.",
    confidence: "high",
    riskClass: "violation",
  },
  dangerousToolInstruction: {
    id: DIAGNOSTIC_IDS.SEC_DANGEROUS_TOOL_INSTRUCTION,
    category: "safety",
    title: "Instruction uses a disallowed tool or command",
    whyItMatters:
      "Repository policy can ban tools that exfiltrate data, open raw sockets, or publish content outside reviewed workflows.",
    remediation:
      "Remove the disallowed command or replace it with an approved, auditable workflow.",
    constraints: [
      "Do not bypass the configured disallowed command list.",
      "Keep any replacement workflow deterministic and reviewable.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm disallowed command instructions have been removed or rewritten.",
    ],
    llmHint:
      "Check security.disallowedCommands and remove instructions that invoke those commands or services.",
    confidence: "high",
    riskClass: "violation",
  },
  credentialInCommandArg: {
    id: DIAGNOSTIC_IDS.SEC_CREDENTIAL_IN_COMMAND_ARG,
    category: "safety",
    title: "Command includes credential material in arguments",
    whyItMatters:
      "Credentials in command arguments can leak through shell history, process lists, logs, diagnostics, or copied instructions.",
    remediation:
      "Move credentials to approved secret storage, environment injection, or an interactive prompt that is not logged.",
    constraints: [
      "Do not preserve literal credential examples.",
      "Use placeholders only when examples are necessary.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm command examples do not include token, password, key, or certificate values.",
    ],
    llmHint:
      "Replace literal credential command arguments with safe placeholders and approved secret handling guidance.",
    confidence: "high",
    riskClass: "violation",
  },
  predictableTempPath: {
    id: DIAGNOSTIC_IDS.SEC_PREDICTABLE_TEMP_PATH,
    category: "safety",
    title: "Instruction uses predictable temporary path for sensitive material",
    whyItMatters:
      "Predictable temporary file paths can expose credentials, profiles, logs, or certificates to accidental reuse or disclosure.",
    remediation:
      "Use a securely created temporary directory or repository-local ignored path with explicit cleanup.",
    constraints: [
      "Do not put sensitive material in shared /tmp paths.",
      "Keep cleanup instructions explicit.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm sensitive temporary paths are randomized, scoped, and cleaned up.",
    ],
    llmHint:
      "Replace predictable /tmp paths for profiles, credentials, certs, logs, or tokens with secure temporary directory handling.",
    confidence: "medium",
    riskClass: "suspicious",
  },
} satisfies Record<string, RuleMetadata>;

const FORBIDDEN_INPUT_ACTION_PATTERN =
  /\b(copy|print|cat|echo|paste|upload|send|share|attach|include|dump|export|log|summari[sz]e|read|collect|provide|load|use)\b/i;
const SAFE_FORBIDDEN_INPUT_PATTERN =
  /\b(do\s+not|don't|never|avoid|exclude|without|redact|remove|omit|strip|skip)\b.{0,80}\b(secret|secrets|credential|credentials|token|password|private key|private keys|\.env|env files?|customer data)\b/i;
const BODY_POLICY_CLOSING_PUNCTUATION_RE = /^[.!?…]+[)"'\]}>*_~`]*/u;

const EXTERNAL_UPLOAD_RE = new RegExp(
  String.raw`\b(${EXTERNAL_UPLOAD_ACTION_TERMS})\b.*\b(${EXTERNAL_UPLOAD_DESTINATION_TERMS})\b|\b(post|put)\b.*https?:\/\/`,
  "i",
);
const CLOUD_UPLOAD_RE = new RegExp(
  String.raw`\b(${CLOUD_UPLOAD_ACTION_TERMS})\b.*\b(${CLOUD_UPLOAD_DESTINATION_TERMS})\b`,
  "i",
);
const BULK_DATA_SOURCE_RE =
  /\b(entire|whole|all|full|complete|raw)\b.{0,100}\b(repo|repository|workspace|codebase|project|context|logs?|files?|history|dataset|environment variables|env vars|process\.env|credentials?|credential (?:directory|folder|store)|secrets?)\b|\b(everything|all files|full logs|full context|entire repo|whole repository|all environment variables|all env vars|credential (?:directory|folder|store))\b/i;
const DATA_DISCLOSURE_ACTION_RE =
  /\b(paste|upload|send|share|attach|submit|publish|post|push|print|log|dump|echo|output|export)\b|\b(includ(?:e|ed|ing)|provid(?:e|ed|ing)|load(?:ed|ing)?)\b.{0,100}\b(prompt|context|request|message|tool input)\b/i;
const UNDISCLOSED_DATA_RE =
  /\b(include|attach|paste|upload|send|share|dump|export|print|collect|provide)\b.*\b(all|entire|full|complete|raw)\b.*\b(environment variables|env vars|env|process\.env|secrets?|credentials?|tokens?)\b/i;
const OVERBROAD_CONTEXT_RE =
  /\b(load|read|include|attach|paste|ingest|collect|provide|send)\b.*\b(entire|whole|all|full|complete|raw)\b.*\b(repo|repository|workspace|codebase|context|logs?|files?)\b/i;
const NO_REDACTION_RE =
  /\b(do not|don't|without|no|never)\b.{0,30}\b(redact|redaction|sanitize|mask|obfuscate)\b|\b(redact|sanitize|mask|obfuscate)\b.{0,30}\b(disabled|false|off)\b/i;
const UNREDACTED_SENSITIVE_DATA_RE =
  /\b(raw|unredacted|unsanitized|unmasked|unfiltered)\b.{0,60}\b(logs?|environment variables|env vars|credentials?|secrets?|tokens?|customer data|personal data|repository|context)\b|\b(logs?|environment variables|env vars|credentials?|secrets?|tokens?|customer data|personal data|repository|context)\b.{0,60}\b(raw|unredacted|unsanitized|unmasked|unfiltered)\b/i;
const PARAGRAPH_DESTINATION_TARGET_RE =
  /\b(?:https?|external|remote|third[- ]party|pastebin|gist|slack|discord|s3|gcs|cloud|storage|bucket|drive|dropbox|notion|jira|github)\b|(?:^|[\s(])(?:[a-z0-9-]+\.)+[a-z]{2,}(?=[/:\s).,]|$)/i;
const BULK_DATA_TARGET_RE =
  /\b(repo|repository|workspace|codebase|project|context|logs?|files?|history|dataset|environment variables|env vars|process\.env|credentials?|credential (?:directory|folder|store)|secrets?)\b/i;
const REDACTION_TARGET_RE =
  /\b(redact|redaction|sanitize|mask|obfuscate|raw|unredacted|unsanitized|unmasked|unfiltered)\b/i;
const APPROVAL_RE =
  /\b(ask|prompt|require|obtain|wait for)\b.{0,50}\b(human|user|owner|maintainer|reviewer|security)?\s*(approval|confirmation|consent|authorization|review)\b|\b(human|user|owner|maintainer|reviewer|security)\b.{0,50}\b(approve|approval|confirm|confirmation|review|consent|authorize|authorization)\b|\bonly\b.{0,20}\b(after|with)\b.{0,40}\b(explicit\s+)?(human|user|owner|maintainer|reviewer|security)?\s*(approval|confirmation|review|authorization)\b|\bdo\s+not\s+run\s+automatically\b.{0,60}\b(human|user|maintainer|review|approval|confirmation)\b/i;
const WEAK_OR_NEGATED_APPROVAL_RE =
  /\b(no approval|approval (?:is )?unavailable|approval is not|approval isn't|approved by default|approval by default|without (?:approval|confirmation|authorization)|automatically approved|safe|run carefully|make sure it works)\b/i;
const RECOVERY_GUARD_RE =
  /\b(create|make|take|keep|verify|confirm|document|check|use|run)\b.{0,40}\b(backup|rollback|roll back|restore|dry[- ]run|revert)\b|\b(backup|rollback|roll back|restore|dry[- ]run|revert)\b.{0,40}\b(first|before|steps?|plan|guidance|confirm|verify|check)\b/i;
const SECRET_WORD_RE =
  /\b(secret|secrets|credential|credentials|token|password|passwd|api key|apikey|private key|ssh key|signing key|certificate|cert|auth)\b/i;
const SECRET_ACTION_RE =
  /\b(copy|print|cat|echo|paste|upload|send|share|attach|include|dump|export|log|summari[sz]e)\b/i;
const SAFE_NEGATION_RE =
  /\b(not|never|avoid|exclude|without|redact|mock|fake|sample|placeholder|dummy)\b.{0,40}\b(secret|secrets|credential|credentials|token|password|private key)\b|\b(secret|secrets|credential|credentials|token|password|private key)\b.{0,40}\b(not|never|avoid|exclude|redact|mock|fake|sample|placeholder|dummy)\b/i;
const DEFENSIVE_ACTION_RE =
  /\b(do\s+not|don't|never|avoid|exclude|skip|omit|forbid|forbidden|disallow|block)\b.{0,80}\b(upload|send|post|put|share|attach|submit|sync|push|publish|copy|paste|include|print|cat|echo|log|dump|curl|wget|pipe|bash|sh|sudo|chmod|chown|rm\s+-|git\s+reset|git\s+clean|delete|install|add)\b/i;
const GUARDED_ACTION_RE =
  /\b(only|unless|after|with|before)\b.{0,80}\b(approval|approved|confirmation|confirm|human review|maintainer review|redact|redacted|redaction|dry[- ]run|backup|rollback)\b|\b(redact|redacted|redaction|approval|approved|confirmation|confirm|human review|maintainer review|dry[- ]run|backup|rollback)\b.{0,80}\b(before|after|upload|send|post|put|share|sudo|rm\s+-|git\s+reset|git\s+clean|delete|install|add)\b/i;
const REMOTE_SCRIPT_RE =
  /\b(curl|wget)\b[^\n]*?(https?:\/\/[^\s|`'")]+)[^\n]*\|\s*(sh|bash|zsh)\b/i;
const PRIVILEGED_COMMAND_RE =
  /\b(sudo|chmod\s+(777|666|\+w|a\+w)|chown\b|docker\s+run\b[^\n]*(--privileged|-v\s+\/|--pid=host)|mount\b|launchctl\b|systemctl\b)\b/i;
const DESTRUCTIVE_COMMAND_RE =
  /\b(rm\s+-[^\n]*[rf][^\n]*|git\s+reset\s+--hard|git\s+clean\s+-[^\n]*[xdf][^\n]*|docker\s+(?:rm|rmi|system\s+prune|volume\s+rm)\b|kubectl\s+delete\b|drop\s+database|truncate\s+table)\b/i;
const CREDENTIAL_ARG_RE =
  /--?(token|password|passwd|secret|credential|api[-_]?key|key|cert|certificate|signing[-_]?key|auth)(=|\s+)(?!<|\$|\{|\[|REDACTED|redacted|xxx|XXX|placeholder|example)[^\s"'`]+/i;
const CREDENTIAL_ARG_ANY_RE =
  /--?(token|password|passwd|secret|credential|api[-_]?key|key|cert|certificate|signing[-_]?key|auth)(=|\s+)[^\s"'`]+/i;
const CREDENTIAL_HEADER_RE =
  /\bAuthorization:\s*Bearer\s+(?!<|\$|\{|\[|REDACTED|redacted|xxx|XXX|placeholder|example)[^\s"'`]+/i;
const PREDICTABLE_TEMP_RE = /\/tmp\/[A-Za-z0-9._/-]+/;
const PREDICTABLE_TEMP_GLOBAL_RE = /\/tmp\/[A-Za-z0-9._/-]+/g;
const SAFEGUARD_BYPASS_PATTERNS = [
  /\b(ignore|bypass|circumvent|skip|omit|disabl(?:e|ing)|deactivat(?:e|ing)|turn off|suppress(?:ed|ing)?)\b.{0,100}\b(security checks?|security policy|security profile|safeguards?|guardrails?|human approval|approval|confirmation|authorization|security warnings?|warnings?|diagnostics?|verification|validation)\b/i,
  /\b(security checks?|security policy|security profile|safeguards?|guardrails?|human approval|approval|confirmation|authorization|security warnings?|warnings?|diagnostics?|verification|validation)\b.{0,100}\b(ignore[ds]?|bypass(?:ed)?|circumvent(?:ed)?|skip(?:ped)?|omit(?:ted)?|disabl(?:e|ed|ing)|deactivat(?:e|ed|ing)|turn(?:ed)? off|suppress(?:ed|ion|ing)?)\b/i,
  /\b(continue|proceed|execute|run|apply|upload|delete|publish)\b.{0,80}\b(without|despite (?:missing|unavailable)|even (?:if|when) (?:there is )?no)\b.{0,60}\b(approval|confirmation|authorization|review|verification)\b/i,
  /\b(if|when)\b.{0,80}\b(approval|confirmation|authorization|review|user response|human response)\b.{0,80}\b(unavailable|missing|cannot be obtained|can't be obtained|times? out|no response)\b.{0,100}\b(continue|proceed|execute|run|apply|upload|delete|publish)\b/i,
  /\b(weaken|relax|lower|loosen|override|change)\b.{0,80}\b(security policy|security profile|policy|restrictions?|rules?)\b.{0,80}\b(pass|silence|clear|avoid)\b.{0,40}\b(diagnostics?|checks?|scan|warnings?)\b/i,
  /\b(obtain|request|record|seek|get|ask for)\b.{0,30}\b(approval|confirmation|authorization|review)\b.{0,40}\b(afterward|later|retroactively|post[- ]hoc|after the (?:action|operation|upload|change))\b|\b(approval|confirmation|authorization|review)\b.{0,30}\b(can|may|will|should)\b.{0,20}\b(obtained|requested|recorded|given)\b.{0,30}\b(afterward|later|retroactively|post[- ]hoc)\b/i,
  /\b(if|when)\b.{0,100}\b(permission|permissions|access)\b.{0,60}\b(denied|unavailable|insufficient|missing)\b.{0,100}\b(fall back|fallback|switch|retry|use)\b.{0,60}\b(sudo|privileged|force|insecure|unsafe|less safe|broader access)\b/i,
  /\b(if|when)\b.{0,100}\b(user|human|owner|reviewer)\b.{0,60}\b(does not|doesn't|fails? to|never)\b.{0,30}\b(respond|reply|confirm|approve)\b.{0,100}\b(automatically|by default|continue|proceed|execute|run|apply|upload|delete|publish)\b/i,
  /\b(add|create|use)\b.{0,24}\b(?:a\s+)?suppression\b.{0,60}\b(pass|silence|clear|avoid)\b.{0,30}\b(diagnostics?|checks?|scan|warnings?|validation)\b/i,
] as const;
const SAFEGUARD_ACTION_PREDICATE_RE =
  /(?<![\p{L}\p{N}_-])(ignore[ds]?|bypass(?:ed)?|circumvent(?:ed)?|skip(?:ped)?|omit(?:ted)?|disabl(?:e|ed|ing)|deactivat(?:e|ed|ing)|turn(?:ed)? off|suppress(?:es|ed|ing)?|continue|proceed|execute|run|apply|upload|delete|publish|weaken|relax|lower|loosen|override|change|obtain(?:ed)?|request(?:ed)?|record(?:ed)?|seek|get|ask for|fall back|fallback|switch|retry|use|add|create|automatically)\b/giu;
const SAFEGUARD_PROHIBITION_RE =
  /\b(do not|don't|never|avoid|must not|should not|prohibit|forbid)\b/giu;
const SAFEGUARD_HARD_SCOPE_BOUNDARY_RE = /[.;:!?—–\n\r]/u;
const SAFEGUARD_GRAMMATICAL_SCOPE_BOUNDARY_RE =
  /\b(?:if|when|unless|although|though|whereas|while|because|but|however|instead|otherwise|then|fallback|fall back)\b/iu;
// A subject followed by a finite auxiliary/copula starts a new clause; a
// trailing `to` in that clause does not make it a dependent purpose complement.
const SAFEGUARD_FINITE_CLAUSE_RE =
  /(?:^|\s)(?:(?:i|you|he|she|it|we|they|this|that|these|those)\b|(?:the|a|an)\s+[\p{L}\p{N}_-]+\b)\s+(?:am|is|are|was|were|be|being|been|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would)\b/iu;
const DIRECT_DEFENSIVE_SEMANTIC_RE =
  /\b(do not|don't|never|avoid|must not|should not|prohibit|forbid)\b.{0,24}\b(ignore|bypass|circumvent|skip|omit|disable|deactivate|turn off|suppress|weaken|relax|continue|proceed|execute|run|apply|follow|obey|adopt|treat)\b/i;
const UNTRUSTED_CONTENT_SOURCE_RE =
  /\b(external (?:page|site|document|source|content|instructions?)|issue body|issue description|logs?|tool output|command output|attachment|downloaded (?:file|markdown|document|instructions?)|fetched (?:page|markdown|document|content|instructions?)|retrieved (?:page|document|content|instructions?))\b/i;
const UNTRUSTED_CONTENT_EXECUTION_RE =
  /\b(execute|run|apply|follow|obey|adopt)\b.{0,80}?\b(every command|all commands?|instructions?|steps?|verbatim|exactly|without review)\b|\b(treat|regard|accept)\b.{0,80}?\b(authoritative|trusted instructions?|commands?|executable guidance)\b|\b(follow|obey|execute|run|apply)\b.{0,50}?\b(it|them|the content|the instructions?)\b.{0,40}?\b(verbatim|exactly|without review)\b/i;
const REVIEW_VOCABULARY_SOURCE = String.raw`(?:review(?:s|ed|ing|ers?)?|validat(?:e|es|ed|ing|ion)|verif(?:y|ies|ied|ying|ication)|inspect(?:s|ed|ing|ion)?|check(?:s|ed|ing)?)`;
const UNTRUSTED_CONTENT_REVIEW_GUARD_RE = new RegExp(
  String.raw`\b${REVIEW_VOCABULARY_SOURCE}\b.{0,80}?\b(before|prior to)\b.{0,60}?\b(execute|executing|run|running|apply|applying|follow|following|obey|obeying|adopt|adopting)\b`,
  "i",
);
const BROAD_REVIEW_GUARD_SCOPE_RE =
  /\b(all|each|every)\b.{0,40}\b(proposed\s+)?(actions?|instructions?|steps?)\b|\bproposed actions?\b/i;
const CONTRADICTORY_REVIEW_ACTION_RE = new RegExp(
  String.raw`\b(regardless of|irrespective of|despite)\b.{0,60}\b${REVIEW_VOCABULARY_SOURCE}\b|\beven (?:if|when)\b.{0,60}\b${REVIEW_VOCABULARY_SOURCE}\b.{0,40}\b(fails?|failed|rejects?|rejected|blocks?|blocked|is negative)\b|\bwithout\b.{0,30}\b${REVIEW_VOCABULARY_SOURCE}\b|\b(ignore|disregard|bypass|skip|omit)\b.{0,50}\b${REVIEW_VOCABULARY_SOURCE}\b`,
  "i",
);
const DIRECT_DEFENSIVE_ACTION_PREFIX_RE =
  /\b(do not|don't|never|avoid|must not|should not|prohibit|forbid)\b.{0,24}$/i;
const RECURSIVE_EXTERNAL_TRAVERSAL_RE =
  /\b(recursive|recursively)\b.{0,100}\b(follow|traverse|crawl|visit|open|fetch|read|inspect)\b.{0,100}\b(external links?|links?|related issues?|attachments?|pages?|sources?|documents?)\b|\b(follow|traverse|crawl|visit|open|fetch|read|inspect)\b.{0,80}\b(external links?|links?|related issues?|attachments?|pages?|sources?|documents?)\b.{0,80}\b(recursive|recursively|repeat|until (?:none|no more|exhausted))\b|\bkeep\b.{0,30}\b(following|traversing|opening|visiting)\b.{0,60}\b(external links?|links?|related issues?|attachments?|pages?|sources?)\b/i;
const TRAVERSAL_BOUNDARY_PATTERNS = [
  /\b(only|restrict|limit|within|same domain|approved domains?|allowlist|named sources?|specified sources?|source scope|destination scope)\b/i,
  /\b(relevant|relevance|applicable|needed for (?:the )?task|task-related)\b/i,
  /\b(visited|already seen|deduplicat|cycle|logical identity)\b/i,
  /\b(max(?:imum)?|at most|up to|depth|hops?|count|number of|time budget|timeout|deadline)\b/i,
  /\b(stop|abort|terminate|fail closed|on failure|if .* fails?|on error)\b/i,
  /\b(report|record|surface|document)\b.{0,40}\b(unresolved|remaining|incomplete|scope|gaps?)\b/i,
] as const;

const SENSITIVE_FILE_PATTERNS = [
  /(^|[/\s"'`(])\.env(?:\b|\.|$)/i,
  /(^|[/\s])id_(rsa|dsa|ecdsa|ed25519)(?:\b|$)/i,
  /(^|[/\s])\.?ssh\/(?:config|id_[A-Za-z0-9_-]+)/i,
  /\.(p12|pfx|pem|key|p8|mobileprovision)(?:\b|$)/i,
  /(^|[/\s])kubeconfig(?:\b|$)/i,
  /(^|[/\s])\.kube\/config(?:\b|$)/i,
  /(^|[/\s])\.aws\/credentials(?:\b|$)/i,
  /(^|[/\s])credentials\.json(?:\b|$)/i,
  /(^|[/\s])service-account(?:\b|\.json|$)/i,
  /\bcredential (?:directory|folder|store)\b/i,
  /(^|[/\s])secrets?\.(json|ya?ml|toml|env)(?:\b|$)/i,
];

const CLOUD_DESTINATION_RE =
  /\b(s3:\/\/|gs:\/\/|az:\/\/|https?:\/\/(?:[^/\s]+\.)?(?:s3|storage|blob|drive|dropbox|box|onedrive|pastebin|gist|slack|discord)[^/\s]*\S*)/i;

type SecurityDiagnosticsConfig = {
  security?: SecurityConfig;
};

interface PreparedLogicalCommandAnalysis {
  readonly commands: readonly LogicalShellCommand[];
  readonly commandByLine: ReadonlyMap<number, LogicalShellCommand>;
  readonly destinationByCommand: ReadonlyMap<
    LogicalShellCommand,
    DestinationAnalysis
  >;
  readonly securityByCommand: ReadonlyMap<
    LogicalShellCommand,
    SecurityCommandAnalysis
  >;
}

interface PreparedSecurityDocumentAnalysis {
  readonly artifact: Artifact;
  readonly parsedPolicy: SecurityPolicy;
  readonly effectivePolicy: SecurityPolicy;
  readonly securityConfig: SecurityConfig | undefined;
  readonly policyIssues: readonly CanonicalSecurityMetadataIssue[];
  readonly sourceLines: readonly string[];
  readonly visibleLines: readonly string[];
  readonly markdownView: MarkdownSecurityView;
  readonly canonicalDescription: CanonicalDescriptionSecurityUnit | undefined;
  readonly scanStart: number;
  readonly logicalCommands: PreparedLogicalCommandAnalysis;
  readonly securityParagraphs: readonly PreparedSecurityParagraphContext[];
  readonly securityParagraphContextByLine: ReadonlyMap<
    number,
    SecurityParagraphLineContext
  >;
}

interface CanonicalDescriptionSecurityUnit {
  readonly text: string;
  readonly evidence: DetectionEvidence;
}

interface SecurityGuardHistory {
  recentHumanApprovalLine: number;
  recentRiskMitigationLine: number;
}

interface SecurityParagraphContext {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly lines: readonly SecurityParagraphSourceLine[];
}

interface SecurityParagraphSourceLine {
  readonly lineIndex: number;
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

interface SecurityParagraphClauseRange {
  readonly start: number;
  readonly end: number;
}

interface PreparedSecurityParagraphContext {
  readonly paragraph: SecurityParagraphContext;
  readonly clauseRanges: readonly SecurityParagraphClauseRange[];
  readonly structurallyEligible: boolean;
}

interface SecurityParagraphClauseContext {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
}

interface SecurityParagraphLineContext {
  readonly preparedParagraph: PreparedSecurityParagraphContext;
  readonly lineStartOffset: number;
  readonly lineEndOffset: number;
  readonly paragraphClause?: SecurityParagraphClauseContext;
}

interface PreparedSecurityParagraphAnalysis {
  readonly paragraphs: readonly PreparedSecurityParagraphContext[];
  readonly contextByLine: ReadonlyMap<number, SecurityParagraphLineContext>;
}

interface SecurityLineContext {
  readonly index: number;
  readonly lineNumber: number;
  readonly line: string;
  readonly paragraphText?: string;
  readonly paragraphLineStartOffset?: number;
  readonly paragraphLineEndOffset?: number;
  readonly paragraphClauseText?: string;
  readonly paragraphClauseContextAvailable: boolean;
  readonly quotedProse: boolean;
  readonly commandLine: boolean;
  readonly evidence: DetectionEvidence;
  readonly hasHumanApprovalGuard: boolean;
  readonly hasCommandRiskGuard: boolean;
  readonly logicalCommand: LogicalShellCommand | undefined;
  readonly logicalCommandStart: boolean;
  readonly logicalDestinationAnalysis: DestinationAnalysis | undefined;
  readonly logicalSecurityAnalysis: SecurityCommandAnalysis | undefined;
  readonly lineSecurityAnalysis: () => SecurityCommandAnalysis;
  readonly lineDestinationAnalysis: () => DestinationAnalysis;
  readonly paragraphClauseDestinationAnalysis: () =>
    DestinationAnalysis | undefined;
}

const paragraphClauseDestinationAnalysisCache = new WeakMap<
  PreparedSecurityParagraphContext,
  Map<string, DestinationAnalysis>
>();

export function securityDiagnosticFindings(
  inputs: Array<Artifact | ParsedDocument>,
  config: SecurityDiagnosticsConfig = {},
): Finding[] {
  return inputs.flatMap((input) => {
    const artifact = "artifact" in input ? input.artifact : input;
    const rawFindings = hiddenUnicodeFindings(artifact);
    const document = "artifact" in input ? input : parseDocument(input);
    return [
      ...rawFindings,
      ...securityFindingsForDocument(document, config.security),
    ];
  });
}

function securityFindingsForDocument(
  document: ParsedDocument,
  securityConfig?: SecurityConfig,
): Finding[] {
  const prepared = prepareSecurityDocumentAnalysis(document, securityConfig);
  if (prepared === undefined) return [];

  const instructionDetections = [
    ...collectCanonicalDescriptionDetections(prepared),
    ...collectSecurityLineDetections(prepared),
    ...collectSemanticInstructionDetections(prepared),
  ];
  const detections: Detection[] = [
    ...collectPolicyPreludeDetections(
      prepared,
      hasPolicyRelevantInstructionSurface(prepared),
    ),
    ...instructionDetections,
    ...policyContradictions(prepared.effectivePolicy),
  ];

  return dedupeDetections(detections).map((detection) =>
    findingFromDetection(prepared.artifact, detection),
  );
}

function prepareSecurityDocumentAnalysis(
  document: ParsedDocument,
  securityConfig?: SecurityConfig,
): PreparedSecurityDocumentAnalysis | undefined {
  const artifact = document.artifact;
  if (
    artifact.kind === "script" ||
    artifact.kind === "asset" ||
    artifact.contentClassification === "binary" ||
    !artifact.markdownParserEligible
  )
    return undefined;

  const policyResolution = resolveOperationalSecurityPolicy(document);
  const parsedPolicy = policyResolution.policy;
  const effectivePolicy = applySecurityConfig(parsedPolicy, securityConfig);
  const sourceLines = artifact.content.split(/\r?\n/);
  const syntax = ensureMarkdownSyntaxForDocument(document);
  if (syntax === undefined) {
    throw new Error(
      "Eligible Markdown document is missing its primary syntax parse",
    );
  }
  const markdownView = new MarkdownSecurityView(syntax);
  const canonicalDescription = canonicalSkillDescriptionSecurityUnit(
    document,
    sourceLines,
  );
  const scanStart = syntax.bodyStartLine - 1;
  const visibleLines = sourceLines.map((_, index) =>
    markdownView.visibleLine(index),
  );
  const logicalCommands = prepareLogicalCommandAnalysis(
    sourceLines,
    visibleLines,
    scanStart,
    markdownView,
    parsedPolicy,
  );
  const securityParagraphAnalysis = prepareSecurityParagraphContexts(
    markdownView,
    syntax,
    logicalCommands.commandByLine,
  );

  return {
    artifact,
    parsedPolicy,
    effectivePolicy,
    securityConfig,
    policyIssues: policyResolution.issues,
    sourceLines,
    visibleLines,
    markdownView,
    canonicalDescription,
    scanStart,
    logicalCommands,
    securityParagraphs: securityParagraphAnalysis.paragraphs,
    securityParagraphContextByLine: securityParagraphAnalysis.contextByLine,
  };
}

function canonicalSkillDescriptionSecurityUnit(
  document: ParsedDocument,
  sourceLines: readonly string[],
): CanonicalDescriptionSecurityUnit | undefined {
  if (document.artifact.kind !== "skill") return undefined;
  const inspection = inspectAgentSkill(document);
  if (
    inspection.validation.format !== "agent-skills" ||
    !inspection.validation.valid ||
    inspection.validation.description === undefined
  ) {
    return undefined;
  }
  const field = inspection.frontmatter.fields.find(
    (candidate) => candidate.key === "description",
  );
  if (field === undefined) return undefined;
  return {
    text: inspection.validation.description,
    evidence: {
      startLine: field.startLine,
      endLine: field.endLine,
      snippet: sourceLines.slice(field.startLine - 1, field.endLine).join("\n"),
    },
  };
}

function prepareSecurityParagraphContexts(
  markdownView: MarkdownSecurityView,
  syntax: MarkdownSyntax,
  logicalCommandByLine: ReadonlyMap<number, LogicalShellCommand>,
): PreparedSecurityParagraphAnalysis {
  const paragraphs: PreparedSecurityParagraphContext[] = [];
  const contextByLine = new Map<number, SecurityParagraphLineContext>();
  const hardBreakLineIndexes = new Set(
    syntax.records.flatMap((record) =>
      record.node.type === "break"
        ? [markdownSourceRange(record.node, syntax.bodyStartLine).startLine - 1]
        : [],
    ),
  );
  for (const unit of markdownView.semanticUnits) {
    if (unit.kind !== "paragraph") continue;
    const normalizedLines = unit.lines
      .map((line, index) => {
        const lineIndex = unit.startLine - 1 + index;
        const hardBreak = hardBreakLineIndexes.has(lineIndex);
        let text = line.trim();
        if (hardBreak && text.endsWith("\\")) {
          text = text.slice(0, -1).trimEnd();
        }
        return { lineIndex, text, hardBreak };
      })
      .filter(({ text }) => Boolean(text));
    const lineStartOffsets: number[] = [];
    const lineEndOffsets: number[] = [];
    let text = "";
    for (const [index, line] of normalizedLines.entries()) {
      const previousLine = normalizedLines[index - 1];
      const separator = text ? (previousLine?.hardBreak ? "\n" : " ") : "";
      const lineStartOffset = text.length + separator.length;
      lineStartOffsets.push(lineStartOffset);
      lineEndOffsets.push(lineStartOffset + line.text.length);
      text += `${separator}${line.text}`;
    }
    if (!text) continue;
    const paragraphLines = normalizedLines.map((line, index) => ({
      lineIndex: line.lineIndex,
      text: line.text,
      startOffset: lineStartOffsets[index] ?? 0,
      endOffset: lineEndOffsets[index] ?? 0,
    }));
    const paragraph: SecurityParagraphContext = {
      startLine: unit.startLine,
      endLine: unit.endLine,
      text,
      lines: paragraphLines,
    };
    const preparedParagraph: PreparedSecurityParagraphContext = {
      paragraph,
      clauseRanges: disclosureClauseRangesIntersectingRange(
        paragraph.text,
        0,
        paragraph.text.length,
      ),
      structurallyEligible: isStructurallyEligibleProseParagraph(
        paragraph,
        markdownView,
        logicalCommandByLine,
      ),
    };
    paragraphs.push(preparedParagraph);
    for (const [index, line] of normalizedLines.entries()) {
      const lineStartOffset = lineStartOffsets[index] ?? 0;
      const lineEndOffset = lineEndOffsets[index] ?? 0;
      const paragraphClause = paragraphClauseIntersectingLine(
        preparedParagraph,
        lineStartOffset,
        lineEndOffset,
      );
      contextByLine.set(line.lineIndex, {
        preparedParagraph,
        lineStartOffset,
        lineEndOffset,
        ...(paragraphClause === undefined ? {} : { paragraphClause }),
      });
    }
  }
  return { paragraphs, contextByLine };
}

function paragraphClauseIntersectingLine(
  preparedParagraph: PreparedSecurityParagraphContext,
  lineStartOffset: number,
  lineEndOffset: number,
): SecurityParagraphClauseContext | undefined {
  const { paragraph, clauseRanges } = preparedParagraph;
  if (paragraph.startLine === paragraph.endLine) {
    return undefined;
  }
  let first: SecurityParagraphClauseRange | undefined;
  let last: SecurityParagraphClauseRange | undefined;
  for (const range of clauseRanges) {
    if (range.start >= lineEndOffset || range.end <= lineStartOffset) continue;
    first ??= range;
    last = range;
  }
  if (first === undefined || last === undefined) return undefined;
  const text = paragraph.text.slice(first.start, last.end);
  if (text === paragraph.text.slice(lineStartOffset, lineEndOffset)) {
    return undefined;
  }
  return {
    startOffset: first.start,
    endOffset: last.end,
    text,
  };
}

function cachedParagraphClauseDestinationAnalysis(
  context: SecurityParagraphLineContext,
): DestinationAnalysis | undefined {
  const clause = context.paragraphClause;
  if (clause === undefined) return undefined;
  let analyses = paragraphClauseDestinationAnalysisCache.get(
    context.preparedParagraph,
  );
  if (analyses === undefined) {
    analyses = new Map();
    paragraphClauseDestinationAnalysisCache.set(
      context.preparedParagraph,
      analyses,
    );
  }
  const key = `${clause.startOffset}:${clause.endOffset}`;
  let analysis = analyses.get(key);
  if (analysis === undefined) {
    analysis = analyzeDestinations(clause.text);
    analyses.set(key, analysis);
  }
  return analysis;
}

function paragraphEvidenceForRange(
  paragraph: SecurityParagraphContext,
  rangeStart: number,
  rangeEnd: number,
): DetectionEvidence | undefined {
  const occupied = paragraph.lines.filter(
    ({ startOffset, endOffset }) =>
      startOffset < rangeEnd && endOffset > rangeStart,
  );
  const first = occupied[0];
  const last = occupied[occupied.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return {
    startLine: first.lineIndex + 1,
    ...(last.lineIndex === first.lineIndex
      ? {}
      : { endLine: last.lineIndex + 1 }),
    snippet: occupied.map(({ text }) => text).join("\n"),
  };
}

function clippedParagraphEvidenceForRange(
  paragraph: SecurityParagraphContext,
  rangeStart: number,
  rangeEnd: number,
): DetectionEvidence | undefined {
  const occupied = paragraph.lines.filter(
    ({ startOffset, endOffset }) =>
      startOffset < rangeEnd && endOffset > rangeStart,
  );
  const first = occupied[0];
  const last = occupied[occupied.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return {
    startLine: first.lineIndex + 1,
    ...(last.lineIndex === first.lineIndex
      ? {}
      : { endLine: last.lineIndex + 1 }),
    snippet: occupied
      .map(({ text, startOffset, endOffset }) =>
        text.slice(
          Math.max(rangeStart, startOffset) - startOffset,
          Math.min(rangeEnd, endOffset) - startOffset,
        ),
      )
      .join("\n"),
  };
}

function isStructurallyEligibleProseParagraph(
  paragraph: SecurityParagraphContext,
  markdownView: MarkdownSecurityView | undefined,
  logicalCommandByLine: ReadonlyMap<number, LogicalShellCommand>,
): boolean {
  return paragraph.lines.every(
    ({ lineIndex, text }) =>
      !(markdownView?.isCodeContentLine(lineIndex) ?? false) &&
      !logicalCommandByLine.has(lineIndex) &&
      !usesCommandSpecificParagraphSemantics(paragraph, text),
  );
}

function usesCommandSpecificParagraphSemantics(
  paragraph: SecurityParagraphContext,
  line: string,
): boolean {
  if (/[.!?](?:["')\]]*)$/u.test(paragraph.text.trim())) return false;
  if (CREDENTIAL_ARG_ANY_RE.test(line) || CREDENTIAL_HEADER_RE.test(line)) {
    return true;
  }
  const commandText = line
    .trim()
    .replace(/^(?:(?:[-*+]|\d+[.)])\s+)?(?:[$>%]\s*)?/u, "");
  const firstWord = /^[a-z][a-z0-9_-]*/u.exec(commandText)?.[0];
  return firstWord !== undefined && isCommandLike(firstWord);
}

function prepareLogicalCommandAnalysis(
  sourceLines: string[],
  visibleLines: string[],
  scanStart: number,
  markdownView: MarkdownSecurityView,
  policy: SecurityPolicy,
): PreparedLogicalCommandAnalysis {
  const instructionLines = visibleLines.map((_, lineIndex) =>
    markdownView.instructionLine(lineIndex),
  );
  const commands = logicalShellCommands(
    sourceLines,
    instructionLines,
    scanStart,
    {
      isLineEligible: (lineIndex) =>
        isLogicalShellLineEligible(
          sourceLines,
          visibleLines,
          lineIndex,
          markdownView,
        ),
      sameBlock: (firstLineIndex, secondLineIndex) =>
        markdownView.sameMarkdownBlock(firstLineIndex, secondLineIndex),
      isCodeContentLine: (lineIndex) =>
        markdownView.isCodeContentLine(lineIndex),
    },
  );
  const destinationByCommand = analyzeLogicalShellCommands(commands);
  const securityByCommand = new Map(
    commands.map((command) => {
      const destinationAnalysis = requireLogicalDestinationAnalysis(
        command,
        destinationByCommand.get(command),
      );
      const startLineIndex = command.memberLineIndexes[0] ?? 0;
      const language = markdownView.languageAt(startLineIndex);
      return [
        command,
        analyzeSecurityCommand({
          source: {
            text: command.input,
            startLine: command.shellProjection.sourceBaseLine,
            endLine:
              (command.memberLineIndexes[
                command.memberLineIndexes.length - 1
              ] ?? startLineIndex) + 1,
            lines: command.sourceLines,
            ...(language === undefined ? {} : { language }),
          },
          guards: markdownView.associatedGuardEvidence(startLineIndex),
          destinationAnalysis,
          allowedFloatingDependencies: policy.allowedFloatingDependencies,
        }),
      ] as const;
    }),
  );
  const commandByLine = new Map<number, LogicalShellCommand>();
  for (const command of commands) {
    for (const lineIndex of command.memberLineIndexes) {
      commandByLine.set(lineIndex, command);
    }
  }

  return {
    commands,
    commandByLine,
    destinationByCommand,
    securityByCommand,
  };
}

function collectPolicyPreludeDetections(
  prepared: PreparedSecurityDocumentAnalysis,
  hasSecuritySensitiveInstructions: boolean,
): Detection[] {
  const {
    artifact,
    parsedPolicy,
    effectivePolicy,
    securityConfig,
    policyIssues,
    markdownView,
  } = prepared;
  const detections: Detection[] = [
    ...invalidCanonicalSecurityDetections(policyIssues),
    ...securityPolicyResolutionDetections(
      parsedPolicy,
      effectivePolicy,
      securityConfig,
      artifact.content,
      artifact.markdownParserEligible,
      markdownView,
      prepared.securityParagraphs,
    ),
  ];
  if (
    (artifact.kind === "skill" || artifact.kind === "context") &&
    hasSecuritySensitiveInstructions &&
    !parsedPolicy.invalidDeclared.has("allowedData") &&
    effectiveAllowedDataClass(effectivePolicy) === undefined &&
    effectiveAllowedDataList(effectivePolicy).length === 0
  ) {
    detections.push({
      metadata: RULES.missingPolicyMetadata,
      severity: "medium",
      startLine: 1,
      snippet: "missing allowed_data policy metadata",
    });
  }

  detections.push(...bodyPolicyContradictionDetections(prepared));

  return detections;
}

function collectSecurityLineDetections(
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  const detections: Detection[] = [];
  const guardHistory: SecurityGuardHistory = {
    recentHumanApprovalLine: 0,
    recentRiskMitigationLine: 0,
  };

  for (
    let index = prepared.scanStart;
    index < prepared.visibleLines.length;
    index += 1
  ) {
    const context = prepareSecurityLineContext(prepared, guardHistory, index);
    if (context === undefined) continue;
    detections.push(...securityLineDetections(prepared, context));
    updateSecurityGuardHistory(guardHistory, context);
  }

  return detections;
}

function prepareSecurityLineContext(
  prepared: PreparedSecurityDocumentAnalysis,
  guardHistory: SecurityGuardHistory,
  index: number,
): SecurityLineContext | undefined {
  const { artifact, sourceLines, visibleLines, markdownView, logicalCommands } =
    prepared;
  const lineNumber = index + 1;
  const line = markdownView.instructionLine(index);
  if (isShellCommentLine(line, index, markdownView)) {
    return undefined;
  }
  if (artifact.markdownParserEligible && isPolicyLine(line)) {
    return undefined;
  }

  const quotedProse =
    markdownView.isBlockQuotedLine(index) &&
    !markdownView.isOperationalBlockQuotedLine(index);
  const hasHumanApprovalGuard =
    hasExplicitHumanApprovalGuard(line) ||
    (guardHistory.recentHumanApprovalLine > 0 &&
      lineNumber - guardHistory.recentHumanApprovalLine <=
        DEFAULT_QUALITY_PROFILE.security.precedingLineFastPath &&
      isPrecedingGuardWithinBoundary(
        visibleLines,
        guardHistory.recentHumanApprovalLine - 1,
        index,
        markdownView,
      )) ||
    hasStructuredGuard(
      visibleLines,
      index,
      hasExplicitHumanApprovalGuard,
      markdownView,
    );
  const hasCommandRiskGuard =
    hasHumanApprovalGuard ||
    hasLocalRiskMitigationGuard(line) ||
    (guardHistory.recentRiskMitigationLine > 0 &&
      lineNumber - guardHistory.recentRiskMitigationLine <=
        DEFAULT_QUALITY_PROFILE.security.precedingLineFastPath &&
      isPrecedingGuardWithinBoundary(
        visibleLines,
        guardHistory.recentRiskMitigationLine - 1,
        index,
        markdownView,
      )) ||
    hasStructuredGuard(
      visibleLines,
      index,
      hasLocalRiskMitigationGuard,
      markdownView,
    );
  const commandLine =
    markdownView.isCodeContentLine(index) ||
    isCommandLike(line) ||
    CREDENTIAL_ARG_ANY_RE.test(line) ||
    CREDENTIAL_HEADER_RE.test(line);
  const evidence: DetectionEvidence = {
    startLine: lineNumber,
    snippet: sourceLines[index] ?? visibleLines[index] ?? line,
  };
  const logicalCommand = logicalCommands.commandByLine.get(index);
  const logicalCommandStart = logicalCommand?.memberLineIndexes[0] === index;
  const logicalDestinationAnalysis =
    logicalCommand === undefined
      ? undefined
      : logicalCommands.destinationByCommand.get(logicalCommand);
  const logicalSecurityAnalysis =
    logicalCommand === undefined
      ? undefined
      : logicalCommands.securityByCommand.get(logicalCommand);
  const securityParagraphContext =
    prepared.securityParagraphContextByLine.get(index);
  const preparedParagraph = securityParagraphContext?.preparedParagraph;
  const paragraphText = preparedParagraph?.paragraph.text;
  const paragraphLineStartOffset = securityParagraphContext?.lineStartOffset;
  const paragraphLineEndOffset = securityParagraphContext?.lineEndOffset;
  const paragraphClauseText = securityParagraphContext?.paragraphClause?.text;
  const paragraphClauseContextAvailable =
    preparedParagraph?.structurallyEligible ?? false;
  let cachedLineSecurityAnalysis: SecurityCommandAnalysis | undefined;
  const lineSecurityAnalysis = (): SecurityCommandAnalysis => {
    const language = markdownView.languageAt(index);
    cachedLineSecurityAnalysis ??= analyzeSecurityCommand({
      source: {
        text: line,
        startLine: lineNumber,
        endLine: lineNumber,
        lines: [line],
        ...(language === undefined ? {} : { language }),
      },
      guards: markdownView.associatedGuardEvidence(index),
      allowedFloatingDependencies:
        prepared.parsedPolicy.allowedFloatingDependencies,
    });
    return cachedLineSecurityAnalysis;
  };
  const lineDestinationAnalysis = (): DestinationAnalysis => {
    return lineSecurityAnalysis().destinationAnalysis;
  };
  const paragraphClauseDestinationAnalysis = ():
    DestinationAnalysis | undefined => {
    return securityParagraphContext === undefined
      ? undefined
      : cachedParagraphClauseDestinationAnalysis(securityParagraphContext);
  };

  return {
    index,
    lineNumber,
    line,
    ...(paragraphText === undefined ? {} : { paragraphText }),
    ...(paragraphLineStartOffset === undefined
      ? {}
      : { paragraphLineStartOffset }),
    ...(paragraphLineEndOffset === undefined ? {} : { paragraphLineEndOffset }),
    ...(paragraphClauseText === undefined ? {} : { paragraphClauseText }),
    paragraphClauseContextAvailable,
    quotedProse,
    commandLine,
    evidence,
    hasHumanApprovalGuard,
    hasCommandRiskGuard,
    logicalCommand,
    logicalCommandStart,
    logicalDestinationAnalysis,
    logicalSecurityAnalysis,
    lineSecurityAnalysis,
    lineDestinationAnalysis,
    paragraphClauseDestinationAnalysis,
  };
}

function securityLineDetections(
  prepared: PreparedSecurityDocumentAnalysis,
  context: SecurityLineContext,
): Detection[] {
  const { effectivePolicy: policy } = prepared;
  const {
    index,
    lineNumber,
    line,
    paragraphText,
    paragraphLineStartOffset,
    paragraphLineEndOffset,
    paragraphClauseText,
    paragraphClauseContextAvailable,
    quotedProse,
    commandLine,
    evidence,
    hasHumanApprovalGuard,
    hasCommandRiskGuard,
    logicalCommand,
    logicalCommandStart,
    logicalDestinationAnalysis,
    logicalSecurityAnalysis,
    lineSecurityAnalysis,
    lineDestinationAnalysis,
    paragraphClauseDestinationAnalysis,
  } = context;
  const detections: Detection[] = [];
  const proseParagraphClauseText =
    logicalCommand === undefined &&
    paragraphClauseContextAvailable &&
    !quotedProse
      ? paragraphClauseText
      : undefined;
  const currentLineDestinationAnalysis =
    logicalCommand === undefined && !quotedProse
      ? lineDestinationAnalysis()
      : undefined;
  const paragraphDestinationAnchor =
    proseParagraphClauseText !== undefined &&
    currentLineDestinationAnalysis !== undefined &&
    lineHasParagraphDestinationTarget(line, currentLineDestinationAnalysis);
  const proseDestinationAnalysis = paragraphDestinationAnchor
    ? (paragraphClauseDestinationAnalysis() ?? currentLineDestinationAnalysis)
    : currentLineDestinationAnalysis;

  if (!quotedProse) {
    if (logicalCommand === undefined) {
      detections.push(
        ...policyDetections(
          line,
          evidence,
          policy,
          hasHumanApprovalGuard,
          {
            scope: "all",
            analysis: proseDestinationAnalysis ?? lineDestinationAnalysis(),
          },
          paragraphText,
          paragraphLineStartOffset,
          paragraphLineEndOffset,
          proseParagraphClauseText,
        ),
      );
    } else {
      detections.push(
        ...policyDetections(line, evidence, policy, hasHumanApprovalGuard, {
          scope: "line-local",
        }),
      );
      if (logicalCommandStart) {
        detections.push(
          ...policyDetections(
            logicalCommand.shellProjection.projection,
            logicalShellCommandEvidence(logicalCommand),
            policy,
            hasHumanApprovalGuard,
            {
              scope: "destination",
              analysis: requireLogicalDestinationAnalysis(
                logicalCommand,
                logicalDestinationAnalysis,
              ),
            },
          ),
        );
      }
    }
    detections.push(...disallowedCommandDetections(line, lineNumber, policy));
    if (logicalCommand === undefined) {
      detections.push(
        ...sensitiveDataDetections(
          line,
          evidence,
          policy,
          lineSecurityAnalysis(),
          paragraphText,
          paragraphLineStartOffset,
          paragraphLineEndOffset,
        ),
      );
    } else if (logicalCommandStart && logicalSecurityAnalysis !== undefined) {
      detections.push(
        ...sensitiveDataDetections(
          logicalCommand.shellProjection.projection,
          logicalShellCommandEvidence(logicalCommand),
          policy,
          logicalSecurityAnalysis,
        ),
      );
    }
    if (logicalCommand === undefined) {
      if (
        !commandLine ||
        policy.declared.size > 0 ||
        (proseDestinationAnalysis !== undefined &&
          isUploadInstruction(proseDestinationAnalysis))
      ) {
        detections.push(
          ...networkAndUploadDetections(
            line,
            evidence,
            policy,
            proseDestinationAnalysis ?? lineDestinationAnalysis(),
            proseParagraphClauseText,
          ),
        );
      }
    } else if (
      logicalCommandStart &&
      (policy.declared.size > 0 ||
        (logicalDestinationAnalysis !== undefined &&
          isUploadInstruction(logicalDestinationAnalysis)))
    ) {
      detections.push(
        ...networkAndUploadDetections(
          logicalCommand.shellProjection.projection,
          logicalShellCommandEvidence(logicalCommand),
          policy,
          requireLogicalDestinationAnalysis(
            logicalCommand,
            logicalDestinationAnalysis,
          ),
        ),
      );
    }
    detections.push(
      ...contextScopeDetections(line, lineNumber, proseParagraphClauseText),
    );
    detections.push(...predictableTempDetections(line, lineNumber));
  }

  if (commandLine && !quotedProse) {
    const operationalBlockquote =
      prepared.markdownView.isOperationalBlockQuotedLine(index);
    if (operationalBlockquote && logicalCommand !== undefined) {
      if (logicalCommandStart) {
        const commandEvidence = logicalShellCommandEvidence(logicalCommand);
        detections.push(
          ...commandDetections(
            logicalCommand.shellProjection.projection,
            lineNumber,
            hasCommandRiskGuard,
            logicalSecurityAnalysis,
          ).map((detection) => ({
            ...detection,
            ...commandEvidence,
          })),
        );
      }
    } else {
      const commandText =
        logicalCommand !== undefined && logicalCommandStart
          ? logicalCommand.shellProjection.projection
          : line;
      const commandRiskDetections = commandDetections(
        commandText,
        lineNumber,
        hasCommandRiskGuard,
        logicalCommand === undefined
          ? lineSecurityAnalysis()
          : logicalCommandStart
            ? logicalSecurityAnalysis
            : undefined,
      );
      detections.push(
        ...(logicalCommand !== undefined && logicalCommandStart
          ? commandRiskDetections.map((detection) => ({
              ...detection,
              ...evidence,
            }))
          : commandRiskDetections),
      );
    }
  }

  return detections;
}

function updateSecurityGuardHistory(
  guardHistory: SecurityGuardHistory,
  context: SecurityLineContext,
): void {
  if (!context.quotedProse && hasExplicitHumanApprovalGuard(context.line)) {
    guardHistory.recentHumanApprovalLine = context.lineNumber;
  }
  if (!context.quotedProse && hasLocalRiskMitigationGuard(context.line)) {
    guardHistory.recentRiskMitigationLine = context.lineNumber;
  }
}

function collectSemanticInstructionDetections(
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  const detections: Detection[] = [];
  for (const unit of prepared.markdownView.semanticUnits) {
    detections.push(
      ...semanticInstructionDetections(unit, prepared.markdownView),
    );
  }
  return detections;
}

function collectCanonicalDescriptionDetections(
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  const description = prepared.canonicalDescription;
  if (description === undefined) return [];
  const { text, evidence } = description;
  const instructionProjection = canonicalDescriptionInstructionProjection(text);
  const detections = [
    ...canonicalDescriptionRoutingLiteralAuthoringDetections(
      text,
      evidence,
      prepared,
    ),
    ...canonicalDescriptionOperationalDetections(
      instructionProjection,
      evidence,
      prepared,
    ),
  ];
  return detections.map((detection) => ({
    ...detection,
    ...evidence,
    semanticEvidenceText: instructionProjection,
    semanticEvidenceSource: "canonical-description" as const,
  }));
}

function canonicalDescriptionOperationalDetections(
  text: string,
  evidence: DetectionEvidence,
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  const destinationAnalysis = analyzeDestinations(text);
  const commandProjection = text
    .replace(/\\\r?\n[ \t]*/gu, " ")
    .replace(/\r?\n/gu, " ");
  const commandAnalysis = analyzeSecurityCommand({
    source: {
      text,
      startLine: evidence.startLine,
      endLine: evidence.endLine ?? evidence.startLine,
      lines: text.split(/\r?\n/u),
    },
    guards: [],
    destinationAnalysis,
    allowedFloatingDependencies:
      prepared.parsedPolicy.allowedFloatingDependencies,
  });
  const hasHumanApprovalGuard = hasExplicitHumanApprovalGuard(text);
  const hasCommandRiskGuard =
    hasHumanApprovalGuard || hasLocalRiskMitigationGuard(text);
  const unit: MarkdownSemanticUnit = {
    kind: "paragraph",
    startLine: evidence.startLine,
    endLine: evidence.endLine ?? evidence.startLine,
    lines: text.split(/\r?\n/u),
  };
  return [
    ...policyDetections(
      text,
      evidence,
      prepared.effectivePolicy,
      hasHumanApprovalGuard,
      { scope: "all", analysis: destinationAnalysis },
    ),
    ...disallowedCommandDetections(
      text,
      evidence.startLine,
      prepared.effectivePolicy,
    ),
    ...canonicalDescriptionSensitiveDataDetections(
      text,
      evidence,
      prepared.effectivePolicy,
      prepared.parsedPolicy.allowedFloatingDependencies,
    ),
    ...networkAndUploadDetections(
      text,
      evidence,
      prepared.effectivePolicy,
      destinationAnalysis,
    ),
    ...contextScopeDetections(text, evidence.startLine),
    ...predictableTempDetections(text, evidence.startLine),
    ...commandDetections(
      commandProjection,
      evidence.startLine,
      hasCommandRiskGuard,
      commandAnalysis,
    ),
    ...semanticInstructionDetections(unit, prepared.markdownView, {
      evidence,
      sectionText: text,
    }),
    ...descriptionForbiddenInputDetections(
      text,
      evidence,
      prepared.effectivePolicy,
    ),
  ];
}

const CANONICAL_DESCRIPTION_ROUTING_LITERAL_RISK_IDS = new Set<DiagnosticId>([
  DIAGNOSTIC_IDS.SEC_BULK_DATA_SHARING_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_CLOUD_UPLOAD_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_CREDENTIAL_IN_COMMAND_ARG,
  DIAGNOSTIC_IDS.SEC_DANGEROUS_TOOL_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_DESTRUCTIVE_COMMAND,
  DIAGNOSTIC_IDS.SEC_EXTERNAL_UPLOAD_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_FORBIDDEN_INPUT_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_INSTRUCTION_VIOLATES_POLICY,
  DIAGNOSTIC_IDS.SEC_MISSING_HUMAN_APPROVAL_GUARD,
  DIAGNOSTIC_IDS.SEC_NO_REDACTION_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_OVERBROAD_CONTEXT_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_PRIVILEGED_COMMAND_WITHOUT_GUARD,
  DIAGNOSTIC_IDS.SEC_SAFEGUARD_BYPASS_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_SECRET_MATERIAL_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_SENSITIVE_FILE_REFERENCE,
  DIAGNOSTIC_IDS.SEC_UNAPPROVED_NETWORK_DESTINATION,
  DIAGNOSTIC_IDS.SEC_UNAPPROVED_UPLOAD_DESTINATION,
  DIAGNOSTIC_IDS.SEC_UNBOUNDED_EXTERNAL_SOURCE_TRAVERSAL,
  DIAGNOSTIC_IDS.SEC_UNPINNED_DEPENDENCY_INSTALL,
  DIAGNOSTIC_IDS.SEC_UNPINNED_REMOTE_SCRIPT,
  DIAGNOSTIC_IDS.SEC_UNTRUSTED_CONTENT_AS_INSTRUCTION,
]);

function canonicalDescriptionRoutingLiteralAuthoringDetections(
  text: string,
  evidence: DetectionEvidence,
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  const underlyingDiagnosticIds = new Set<DiagnosticId>();
  for (const span of canonicalDescriptionRoutingExampleSpans(text)) {
    const literal = text.slice(span.start + 1, span.end - 1).trim();
    if (!literal) continue;
    for (const detection of canonicalDescriptionOperationalDetections(
      literal,
      evidence,
      prepared,
    )) {
      if (
        CANONICAL_DESCRIPTION_ROUTING_LITERAL_RISK_IDS.has(
          detection.metadata.id,
        )
      ) {
        underlyingDiagnosticIds.add(detection.metadata.id);
      }
    }
  }
  if (underlyingDiagnosticIds.size === 0) return [];

  return [
    {
      metadata: RULES.canonicalDescriptionHighRiskLiteral,
      severity: "medium",
      ...evidence,
      dedupeKey: `${RULES.canonicalDescriptionHighRiskLiteral.id}:${evidence.startLine}`,
      details: {
        underlyingDiagnosticIds: [...underlyingDiagnosticIds].sort(),
      },
    },
  ];
}

function canonicalDescriptionSensitiveDataDetections(
  instructionProjection: string,
  evidence: DetectionEvidence,
  policy: SecurityPolicy,
  allowedFloatingDependencies: readonly FloatingDependencyAllowance[],
): Detection[] {
  const ranges = disclosureClauseRangesIntersectingRange(
    instructionProjection,
    0,
    instructionProjection.length,
  );
  const clauses =
    ranges.length === 0
      ? [instructionProjection]
      : ranges.map(({ start, end }) => instructionProjection.slice(start, end));

  return clauses.flatMap((clause) => {
    const destinationAnalysis = analyzeDestinations(clause);
    const analysis = analyzeSecurityCommand({
      source: {
        text: clause,
        startLine: evidence.startLine,
        endLine: evidence.endLine ?? evidence.startLine,
        lines: clause.split(/\r?\n/u),
      },
      guards: [],
      destinationAnalysis,
      allowedFloatingDependencies,
    });
    return fallbackSensitiveDataDetections(clause, evidence, policy, analysis);
  });
}

function canonicalDescriptionInstructionProjection(text: string): string {
  const projected = text.split("");
  for (const span of canonicalDescriptionRoutingExampleSpans(text)) {
    for (let index = span.start; index < span.end; index += 1) {
      projected[index] = " ";
    }
  }

  return projected.join("");
}

const CANONICAL_DESCRIPTION_ROUTING_EXAMPLE_INTRODUCTION_RE =
  /\b(?:use|apply|select|choose|invoke)\b[^.!?\n]{0,100}\brequests?\b[^.!?\n]{0,40}\b(?:such as|including|like)\b/giu;

function canonicalDescriptionRoutingExampleSpans(
  text: string,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const introduction of text.matchAll(
    CANONICAL_DESCRIPTION_ROUTING_EXAMPLE_INTRODUCTION_RE,
  )) {
    if (introduction.index === undefined) continue;
    const sentenceStart = introduction.index + introduction[0].length;
    const sentenceRemainder = text.slice(sentenceStart);
    const sentenceBoundary = sentenceRemainder.search(/[.!?](?:\s|$)/u);
    const sentenceEnd =
      sentenceBoundary === -1 ? text.length : sentenceStart + sentenceBoundary;
    const examples = text.slice(sentenceStart, sentenceEnd);
    for (const span of routingExampleListSpans(examples)) {
      spans.push({
        start: sentenceStart + span.start,
        end: sentenceStart + span.end,
      });
    }
  }
  return spans;
}

function routingExampleListSpans(
  text: string,
): Array<{ start: number; end: number }> {
  const pairedSpans = pairedRoutingExampleSpans(text);
  const first = pairedSpans.find(({ start }) =>
    /^\s*:?\s*$/u.test(text.slice(0, start)),
  );
  if (first === undefined) return [];

  const listSpans = [first];
  for (const span of pairedSpans) {
    if (span.start <= first.start) continue;
    const previous = listSpans[listSpans.length - 1];
    if (
      previous === undefined ||
      !isRoutingExampleListSeparator(text.slice(previous.end, span.start))
    ) {
      break;
    }
    listSpans.push(span);
  }
  return listSpans;
}

function isRoutingExampleListSeparator(text: string): boolean {
  return /^\s*(?:,\s*(?:(?:and|or)\s*)?|(?:and|or)\s+)\s*$/iu.test(text);
}

function pairedRoutingExampleSpans(
  text: string,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const pairedDelimiters = new Map([
    ['"', '"'],
    ["“", "”"],
    ["'", "'"],
    ["‘", "’"],
    ["`", "`"],
  ]);

  for (let start = 0; start < text.length; start += 1) {
    const opener = text[start] ?? "";
    const closer = pairedDelimiters.get(opener);
    if (closer === undefined || !isRoutingExampleSpanOpening(text, start)) {
      continue;
    }
    let end = start + 1;
    for (; end < text.length; end += 1) {
      if (text[end] === "\n" || text[end] === "\r") break;
      if (
        text[end] === closer &&
        isRoutingExampleSpanClosing(text, end, closer)
      ) {
        break;
      }
    }
    if (end >= text.length || text[end] !== closer || end === start + 1) {
      continue;
    }
    spans.push({ start, end: end + 1 });
    start = end;
  }

  return spans;
}

function isRoutingExampleSpanOpening(text: string, index: number): boolean {
  const delimiter = text[index];
  if (delimiter === "'") {
    return (
      !isRoutingExampleWordCharacter(text[index - 1]) &&
      !/^\s$/u.test(text[index + 1] ?? "")
    );
  }
  if (delimiter === "`") {
    return text[index - 1] !== "`" && text[index + 1] !== "`";
  }
  return true;
}

function isRoutingExampleSpanClosing(
  text: string,
  index: number,
  delimiter: string,
): boolean {
  if (delimiter === "'") {
    return (
      !/^\s$/u.test(text[index - 1] ?? "") &&
      !isRoutingExampleWordCharacter(text[index + 1])
    );
  }
  if (delimiter === "`") {
    return text[index - 1] !== "`" && text[index + 1] !== "`";
  }
  return true;
}

function isRoutingExampleWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

function hasPolicyRelevantInstructionSurface(
  prepared: PreparedSecurityDocumentAnalysis,
): boolean {
  const candidates: string[] = [];
  if (prepared.canonicalDescription !== undefined) {
    candidates.push(
      canonicalDescriptionInstructionProjection(
        prepared.canonicalDescription.text,
      ),
    );
  }
  for (const unit of prepared.markdownView.semanticUnits) {
    candidates.push(unit.lines.join("\n"));
  }
  for (const command of prepared.logicalCommands.commands) {
    candidates.push(command.shellProjection.projection);
  }
  for (
    let lineIndex = prepared.scanStart;
    lineIndex < prepared.visibleLines.length;
    lineIndex += 1
  ) {
    if (
      prepared.markdownView.isBlockQuotedLine(lineIndex) &&
      !prepared.markdownView.isOperationalBlockQuotedLine(lineIndex)
    ) {
      continue;
    }
    const line = prepared.markdownView.instructionLine(lineIndex);
    if (
      isPolicyLine(line) ||
      isShellCommentLine(line, lineIndex, prepared.markdownView)
    ) {
      continue;
    }
    candidates.push(line);
  }
  return candidates.some(policyRelevantInstructionText);
}

function policyRelevantInstructionText(text: string): boolean {
  if (!text.trim()) return false;
  const positiveDisclosureActionsForText = positiveDisclosureActions(text);
  const defensiveOnly =
    isDefensiveActionInstruction(text) &&
    positiveDisclosureActionsForText.length === 0 &&
    unsafeSafeguardClause(text) === undefined;
  if (defensiveOnly) return false;

  const destinationAnalysis = analyzeDestinations(text);
  if (
    isNetworkInstruction(destinationAnalysis) ||
    isUploadInstruction(destinationAnalysis)
  ) {
    return true;
  }
  if (
    /\b(?:curl|wget)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add)\b|\b(?:pip3?|python(?:\d+(?:\.\d+)*)?\s+-m\s+pip|uv\s+pip)\s+install\b/i.test(
      text,
    )
  ) {
    return true;
  }

  const sensitiveTarget =
    SECRET_WORD_RE.test(text) || referencesSensitiveFile(text);
  const sensitiveAction =
    /\b(read|collect|copy|print|cat|echo|paste|upload|send|share|attach|include|dump|export|log|load|provide)\b/i.test(
      text,
    );
  if (
    sensitiveTarget &&
    sensitiveAction &&
    !SAFE_FORBIDDEN_INPUT_PATTERN.test(text) &&
    !isSafeSensitiveHandlingInstruction(text)
  ) {
    return true;
  }

  return (
    requiresLineLocalApprovalGuard(text) ||
    unsafeSafeguardClause(text) !== undefined ||
    OVERBROAD_CONTEXT_RE.test(text) ||
    NO_REDACTION_RE.test(text) ||
    (UNREDACTED_SENSITIVE_DATA_RE.test(text) &&
      DATA_DISCLOSURE_ACTION_RE.test(text))
  );
}

function descriptionForbiddenInputDetections(
  text: string,
  evidence: DetectionEvidence,
  policy: SecurityPolicy,
): Detection[] {
  return policy.forbiddenInputs.flatMap((forbiddenInput) => {
    const needle = forbiddenInput.trim();
    if (!needle) return [];
    const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
    if (
      !pattern.test(text) ||
      SAFE_FORBIDDEN_INPUT_PATTERN.test(text) ||
      !FORBIDDEN_INPUT_ACTION_PATTERN.test(text)
    ) {
      return [];
    }
    return [
      {
        metadata: RULES.forbiddenInputInstruction,
        severity: "high" as const,
        ...evidence,
        dedupeKey: `forbidden-input:${needle.toLowerCase()}`,
      },
    ];
  });
}

function requireLogicalDestinationAnalysis(
  command: LogicalShellCommand,
  analysis: DestinationAnalysis | undefined,
): DestinationAnalysis {
  if (analysis !== undefined) return analysis;
  throw new Error(
    `Missing destination analysis for logical command starting on line ${command.shellProjection.sourceBaseLine}`,
  );
}

function isLogicalShellLineEligible(
  sourceLines: string[],
  visibleLines: string[],
  lineIndex: number,
  markdownView: MarkdownSecurityView,
): boolean {
  const source = sourceLines[lineIndex] ?? "";
  const visible = visibleLines[lineIndex] ?? "";
  const operationalBlockQuote =
    markdownView.isOperationalBlockQuotedLine(lineIndex);
  return (
    (source === visible || operationalBlockQuote) &&
    (!markdownView.isBlockQuotedLine(lineIndex) || operationalBlockQuote) &&
    !isPolicyLine(visible) &&
    !isShellCommentLine(visible, lineIndex, markdownView)
  );
}

function disallowedCommandDetections(
  line: string,
  lineNumber: number,
  policy: SecurityPolicy,
): Detection[] {
  const matched = policy.disallowedCommands.find((command) =>
    matchesDisallowedCommand(line, command),
  );
  if (matched === undefined) return [];

  return [
    {
      metadata: RULES.dangerousToolInstruction,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
      dedupeKey: `${RULES.dangerousToolInstruction.id}:${matched.toLowerCase()}:${lineNumber}`,
    },
  ];
}

function bodyPolicyClauseEvidenceSnippet(
  text: string,
  clauseRange: SecurityParagraphClauseRange,
): string {
  const closingPunctuation = BODY_POLICY_CLOSING_PUNCTUATION_RE.exec(
    text.slice(clauseRange.end),
  );
  const end = clauseRange.end + (closingPunctuation?.[0].length ?? 0);
  return text.slice(clauseRange.start, end).trim();
}

function bodyPolicyFactEvidenceRange(
  text: string,
  fact: BodyPolicyClauseFacts,
): SecurityParagraphClauseRange {
  const start = fact.evidenceStart;
  const factEnd = fact.evidenceEnd;
  const closingPunctuation = BODY_POLICY_CLOSING_PUNCTUATION_RE.exec(
    text.slice(factEnd),
  );
  return {
    start,
    end: factEnd + (closingPunctuation?.[0].length ?? 0),
  };
}

function hasEarlierBodyPolicyFact(
  facts: readonly BodyPolicyClauseFacts[],
  fact: BodyPolicyClauseFacts,
): boolean {
  return facts.some(
    (candidate) =>
      candidate.domain === fact.domain &&
      candidate.evidenceStart < fact.evidenceStart,
  );
}

function bodyPolicyStatementFactRanges(
  text: string,
  clauseRanges: readonly SecurityParagraphClauseRange[],
): ReadonlyArray<{
  readonly fact: BodyPolicyClauseFacts;
  readonly range: SecurityParagraphClauseRange;
  readonly clauseRange: SecurityParagraphClauseRange;
  readonly crossesClauseBoundary: boolean;
}> {
  const meaningfulRanges = clauseRanges.filter(
    ({ start, end }) => text.slice(start, end).trim().length > 0,
  );
  return bodyPolicyStatementGroupFacts(text, meaningfulRanges).flatMap(
    (fact) => {
      const clauseRange = meaningfulRanges.find(
        ({ start, end }) =>
          start <= fact.evidenceStart && fact.evidenceStart < end,
      );
      if (clauseRange === undefined) return [];
      return [
        {
          fact,
          range: bodyPolicyFactEvidenceRange(text, fact),
          clauseRange,
          crossesClauseBoundary: fact.evidenceEnd > clauseRange.end,
        },
      ];
    },
  );
}

function bodyPolicyContradictionDetections(
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  const enabledDomains = [
    ["network", prepared.effectivePolicy.networkAllowed === true],
    ["upload", prepared.effectivePolicy.externalUploadAllowed === true],
    ["secrets", prepared.effectivePolicy.secretsAllowed === true],
  ] as const;
  const enabledDomainOrder = new Map<BodyPolicyDomain, number>(
    enabledDomains.flatMap(([domain, enabled], kindOrder) =>
      enabled ? [[domain, kindOrder] as const] : [],
    ),
  );
  if (enabledDomainOrder.size === 0) return [];

  const candidates: Array<{
    domain: BodyPolicyDomain;
    kindOrder: number;
    detection: Detection;
  }> = [];
  const preparedParagraphLineIndexes = new Set<number>();

  for (const preparedParagraph of prepared.securityParagraphs) {
    if (!preparedParagraph.structurallyEligible) continue;
    const { paragraph, clauseRanges } = preparedParagraph;
    for (const { lineIndex } of paragraph.lines) {
      preparedParagraphLineIndexes.add(lineIndex);
    }
    const statementFacts = bodyPolicyStatementFactRanges(
      paragraph.text,
      clauseRanges,
    );
    const facts = statementFacts.map(({ fact }) => fact);
    for (const {
      fact,
      range,
      clauseRange,
      crossesClauseBoundary,
    } of statementFacts) {
      const domain = fact.domain;
      if (domain === undefined) continue;
      const kindOrder = enabledDomainOrder.get(domain);
      if (
        kindOrder === undefined ||
        !bodyPolicyFactEmitsContradiction(fact, domain)
      ) {
        continue;
      }
      const evidence =
        crossesClauseBoundary || hasEarlierBodyPolicyFact(facts, fact)
          ? clippedParagraphEvidenceForRange(paragraph, range.start, range.end)
          : paragraph.startLine === paragraph.endLine
            ? {
                startLine: paragraph.startLine,
                snippet: bodyPolicyClauseEvidenceSnippet(
                  paragraph.text,
                  clauseRange,
                ),
              }
            : paragraphEvidenceForRange(
                paragraph,
                fact.evidenceStart,
                fact.evidenceEnd,
              );
      if (evidence === undefined) continue;
      candidates.push({
        domain,
        kindOrder,
        detection: {
          metadata: RULES.bodyPolicyContradiction,
          severity: "high",
          ...evidence,
          dedupeKey: `body-policy-contradiction:${domain}`,
        },
      });
    }
  }

  for (
    let lineIndex = prepared.scanStart;
    lineIndex < prepared.visibleLines.length;
    lineIndex += 1
  ) {
    if (preparedParagraphLineIndexes.has(lineIndex)) continue;
    const line = prepared.visibleLines[lineIndex] ?? "";
    if (
      prepared.markdownView.isCodeBlockLine(lineIndex) ||
      isPolicyLine(line)
    ) {
      continue;
    }
    const fallbackStatement = bodyPolicyFallbackStatement(line);
    const statementText = fallbackStatement.text;
    const clauseRanges = disclosureClauseRangesIntersectingRange(
      statementText,
      0,
      statementText.length,
    );
    const statementFacts = bodyPolicyStatementFactRanges(
      statementText,
      clauseRanges,
    );
    const facts = statementFacts.map(({ fact }) => fact);
    for (const {
      fact,
      range,
      clauseRange,
      crossesClauseBoundary,
    } of statementFacts) {
      const domain = fact.domain;
      if (domain === undefined) continue;
      const kindOrder = enabledDomainOrder.get(domain);
      if (
        kindOrder === undefined ||
        !bodyPolicyFactEmitsContradiction(fact, domain)
      ) {
        continue;
      }
      candidates.push({
        domain,
        kindOrder,
        detection: {
          metadata: RULES.bodyPolicyContradiction,
          severity: "high",
          startLine: lineIndex + 1,
          snippet: bodyPolicyFallbackEvidenceSnippet(
            line,
            fallbackStatement,
            crossesClauseBoundary || hasEarlierBodyPolicyFact(facts, fact)
              ? statementText.slice(range.start, range.end)
              : bodyPolicyClauseEvidenceSnippet(statementText, clauseRange),
            crossesClauseBoundary || hasEarlierBodyPolicyFact(facts, fact)
              ? range.start
              : clauseRange.start,
          ),
          dedupeKey: `body-policy-contradiction:${domain}`,
        },
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.detection.startLine - right.detection.startLine ||
      left.kindOrder - right.kindOrder,
  );
  const selectedDomains = new Set<BodyPolicyDomain>();
  return candidates.flatMap(({ domain, detection }) => {
    if (selectedDomains.has(domain)) return [];
    selectedDomains.add(domain);
    return [detection];
  });
}

function bodyPolicyFallbackStatement(line: string): {
  readonly text: string;
  readonly sourceOffset: number;
} {
  const heading =
    /^[ \t]{0,3}#{1,6}[ \t]+(?<content>.*?)(?:[ \t]+#+[ \t]*)?$/u.exec(line);
  const content = heading?.groups?.content;
  if (content === undefined) return { text: line, sourceOffset: 0 };
  return { text: content, sourceOffset: line.indexOf(content) };
}

function bodyPolicyFallbackEvidenceSnippet(
  line: string,
  statement: { readonly sourceOffset: number },
  snippet: string,
  snippetStart: number,
): string {
  return statement.sourceOffset > 0 && snippetStart === 0
    ? `${line.slice(0, statement.sourceOffset)}${snippet}`
    : snippet;
}

function bodyPolicyFactEmitsContradiction(
  facts: BodyPolicyClauseFacts,
  enabledPermissivePolicyDomain: BodyPolicyDomain,
): boolean {
  return (
    facts.domain === enabledPermissivePolicyDomain &&
    facts.modality === "prohibited" &&
    facts.scope === "workflow" &&
    facts.completeness === "complete"
  );
}

function policyDetections(
  line: string,
  evidence: DetectionEvidence,
  policy: SecurityPolicy,
  hasHumanApprovalGuard: boolean,
  input: PolicyDetectionInput,
  paragraphText?: string,
  paragraphLineStartOffset?: number,
  paragraphLineEndOffset?: number,
  paragraphClauseText?: string,
): Detection[] {
  const detections: Detection[] = [];
  const shouldAnalyzeDestinations = input.scope !== "line-local";
  const analyzeLineLocal = input.scope !== "destination";
  const analysis = input.scope === "line-local" ? undefined : input.analysis;
  const semanticLine = paragraphClauseText ?? line;
  const positiveActions = positiveDisclosureActions(semanticLine);
  const positiveDestinationAction = positiveActions.some(
    ({ kind }) => kind === "network" || kind === "external-upload",
  );
  const defensiveAction =
    isDefensiveActionInstruction(semanticLine) && positiveActions.length === 0;
  const safeOrGuarded =
    (GUARDED_ACTION_RE.test(semanticLine) &&
      !WEAK_OR_NEGATED_APPROVAL_RE.test(semanticLine)) ||
    (defensiveAction && !positiveDestinationAction);
  const invalidNetworkAllowlist = policy.invalidDeclared.has(
    "approvedNetworkDestinations",
  );
  const invalidUploadAllowlist = policy.invalidDeclared.has(
    "approvedUploadDestinations",
  );

  if (
    shouldAnalyzeDestinations &&
    analysis !== undefined &&
    policy.networkAllowed === false &&
    isNetworkInstruction(analysis) &&
    !safeOrGuarded
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      ...evidence,
    });
  }

  if (
    shouldAnalyzeDestinations &&
    analysis !== undefined &&
    (invalidNetworkAllowlist ||
      (policy.networkAllowed !== false &&
        policy.approvedNetworkDestinations.length > 0))
  ) {
    for (const destination of unapprovedNetworkDestinations(
      analysis,
      policy,
      invalidNetworkAllowlist,
    )) {
      detections.push({
        metadata: RULES.unapprovedNetworkDestination,
        severity: "high",
        ...evidence,
        dedupeKey: `unapproved-network:${destination.host}${destination.path}`,
      });
    }
  }

  if (
    shouldAnalyzeDestinations &&
    analysis !== undefined &&
    policy.externalUploadAllowed === false &&
    isUploadInstruction(analysis) &&
    !safeOrGuarded
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      ...evidence,
    });
  }

  if (
    shouldAnalyzeDestinations &&
    analysis !== undefined &&
    isUploadInstruction(analysis) &&
    (invalidUploadAllowlist ||
      (policy.externalUploadAllowed !== false &&
        policy.approvedUploadDestinations.length > 0))
  ) {
    for (const destination of unapprovedDestinations(
      uploadDestinations(analysis),
      policy.approvedUploadDestinations,
      invalidUploadAllowlist,
    )) {
      detections.push({
        metadata: RULES.unapprovedUploadDestination,
        severity: "high",
        ...evidence,
        dedupeKey: invalidUploadAllowlist
          ? `invalid-upload:${destination.host}${destination.path}`
          : `unapproved-upload:${destination.host}${destination.path}`,
      });
    }
  }

  if (
    analyzeLineLocal &&
    policy.secretsAllowed === false &&
    SECRET_WORD_RE.test(line) &&
    !isSafeSensitiveHandlingInstruction(line) &&
    !paragraphExplicitlyProhibitsLineDisclosure(
      paragraphText,
      paragraphLineStartOffset,
      paragraphLineEndOffset,
    )
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      ...evidence,
    });
  }

  if (
    analyzeLineLocal &&
    effectiveAllowedDataClass(policy)?.toLowerCase() === "disclosed" &&
    UNDISCLOSED_DATA_RE.test(line)
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      ...evidence,
    });
  }

  const needsApproval =
    policy.humanApprovalRequired === true &&
    ((shouldAnalyzeDestinations &&
      analysis !== undefined &&
      requiresDestinationApprovalGuard(semanticLine, analysis)) ||
      (analyzeLineLocal &&
        (requiresLineLocalApprovalGuard(line) ||
          (paragraphClauseText !== undefined &&
            lineHasSensitiveApprovalTarget(line) &&
            requiresLineLocalApprovalGuard(paragraphClauseText))))) &&
    !(
      hasHumanApprovalGuard ||
      (paragraphClauseText !== undefined &&
        hasExplicitHumanApprovalGuard(paragraphClauseText))
    ) &&
    !defensiveAction;
  if (needsApproval) {
    detections.push({
      metadata: RULES.missingHumanApprovalGuard,
      severity: "medium",
      ...evidence,
    });
  }

  return detections;
}

function policyContradictions(policy: SecurityPolicy): Detection[] {
  const detections: Detection[] = [];

  if (
    policy.networkAllowed === false &&
    policy.externalUploadAllowed === true
  ) {
    detections.push({
      metadata: RULES.policyContradiction,
      severity: "high",
      startLine: policy.lineByField.get("externalUploadAllowed") ?? 1,
      snippet: "external_upload_allowed is true while network_allowed is false",
    });
  }

  if (policy.secretsAllowed === true && policy.externalUploadAllowed === true) {
    detections.push({
      metadata: RULES.policyContradiction,
      severity: "high",
      startLine: policy.lineByField.get("secretsAllowed") ?? 1,
      snippet: "secrets_allowed and external_upload_allowed are both true",
    });
  }

  return detections;
}

function sensitiveDataDetections(
  line: string,
  evidence: DetectionEvidence,
  policy: SecurityPolicy,
  analysis: SecurityCommandAnalysis,
  paragraphText?: string,
  paragraphLineStartOffset?: number,
  paragraphLineEndOffset?: number,
): Detection[] {
  if (analysis.support === "fallback-required") {
    return fallbackSensitiveDataDetections(line, evidence, policy, analysis);
  }

  const detections: Detection[] = [];
  const sensitiveSources = analysis.sensitiveSources.filter(
    ({ kind }) => kind !== "environment-variable-api",
  );
  const sensitiveFile = sensitiveSources.length > 0;
  const hasDisclosureSink = analysis.sinks.some(({ kind }) =>
    [
      "stdout-or-log",
      "prompt-or-context",
      "network",
      "external-upload",
    ].includes(kind),
  );
  const safeHandling =
    analysis.localOnlySensitiveOperation ||
    paragraphExplicitlyProhibitsLineDisclosure(
      paragraphText,
      paragraphLineStartOffset,
      paragraphLineEndOffset,
    ) ||
    (!hasDisclosureSink && isSafeSensitiveHandlingInstruction(line));
  const sourceEvidence =
    sensitiveSources.length === 0
      ? evidence
      : detectionEvidenceForSource(analysis, sensitiveSources[0] ?? undefined);

  if (sensitiveFile && !safeHandling) {
    detections.push({
      metadata: RULES.sensitiveFileReference,
      severity: "high",
      ...sourceEvidence,
    });
  }

  const exposesSecret =
    (SECRET_ACTION_RE.test(line) || hasDisclosureSink) &&
    (SECRET_WORD_RE.test(line) || sensitiveFile) &&
    !safeHandling;

  if (exposesSecret) {
    detections.push({
      metadata: RULES.secretMaterialInstruction,
      severity:
        policy.secretsAllowed === false || policy.externalUploadAllowed === true
          ? "critical"
          : "high",
      ...sourceEvidence,
    });
  }

  return detections;
}

function paragraphExplicitlyProhibitsLineDisclosure(
  paragraphText: string | undefined,
  paragraphLineStartOffset: number | undefined,
  paragraphLineEndOffset: number | undefined,
): boolean {
  if (
    paragraphText === undefined ||
    paragraphLineStartOffset === undefined ||
    paragraphLineEndOffset === undefined
  ) {
    return false;
  }
  return disclosureRangeIsExplicitlyProhibited(
    paragraphText,
    paragraphLineStartOffset,
    paragraphLineEndOffset,
  );
}

function fallbackSensitiveDataDetections(
  line: string,
  evidence: DetectionEvidence,
  policy: SecurityPolicy,
  analysis: SecurityCommandAnalysis,
): Detection[] {
  const detections: Detection[] = [];
  const sensitiveSources = analysis.sensitiveSources.filter(
    ({ kind }) => kind !== "environment-variable-api",
  );
  const sensitiveFile =
    referencesSensitiveFile(line) || sensitiveSources.length > 0;
  const hasDisclosureSink = analysis.sinks.some(({ kind }) =>
    [
      "stdout-or-log",
      "prompt-or-context",
      "network",
      "external-upload",
    ].includes(kind),
  );
  const safeHandling =
    !hasDisclosureSink && isSafeSensitiveHandlingInstruction(line);
  const sourceEvidence =
    sensitiveSources.length === 0
      ? evidence
      : detectionEvidenceForSource(analysis, sensitiveSources[0] ?? undefined);

  if (sensitiveFile && !safeHandling) {
    detections.push({
      metadata: RULES.sensitiveFileReference,
      severity: "high",
      ...sourceEvidence,
    });
  }

  const exposesSecret =
    (SECRET_ACTION_RE.test(line) || hasDisclosureSink) &&
    (SECRET_WORD_RE.test(line) || sensitiveFile) &&
    !safeHandling;
  if (exposesSecret) {
    detections.push({
      metadata: RULES.secretMaterialInstruction,
      severity:
        policy.secretsAllowed === false || policy.externalUploadAllowed === true
          ? "critical"
          : "high",
      ...sourceEvidence,
    });
  }
  return detections;
}

function detectionEvidenceForSource(
  analysis: SecurityCommandAnalysis,
  source: SecurityCommandAnalysis["sensitiveSources"][number] | undefined,
): DetectionEvidence {
  if (source === undefined) {
    return {
      startLine: analysis.source.startLine,
      endLine: analysis.source.endLine,
      snippet: analysis.source.text,
    };
  }
  const startLine = source.sourceSpan.startLine ?? analysis.source.startLine;
  const endLine = source.sourceSpan.endLine ?? startLine;
  const relativeStart = Math.max(0, startLine - analysis.source.startLine);
  const relativeEnd = Math.max(
    relativeStart,
    endLine - analysis.source.startLine,
  );
  return {
    startLine,
    ...(endLine === startLine ? {} : { endLine }),
    snippet: analysis.source.lines
      .slice(relativeStart, relativeEnd + 1)
      .join("\n"),
  };
}

function referencesSensitiveFile(line: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(line));
}

function isSafeSensitiveHandlingInstruction(line: string): boolean {
  if (hasPositiveDisclosureAction(line)) return false;
  return (
    SAFE_NEGATION_RE.test(line) ||
    /\b(never|do not|don't|avoid|exclude|skip)\b.{0,50}\b(upload|send|share|attach|copy|paste|include|print|cat|echo|log|dump)\b/i.test(
      line,
    ) ||
    /\b(upload|send|share|attach|copy|paste|include|print|cat|echo|log|dump)\b.{0,50}\b(never|do not|don't|avoid|exclude|skip)\b/i.test(
      line,
    )
  );
}

function networkAndUploadDetections(
  line: string,
  evidence: DetectionEvidence,
  policy: SecurityPolicy,
  analysis: DestinationAnalysis,
  paragraphClauseText?: string,
): Detection[] {
  const detections: Detection[] = [];
  const semanticLine = paragraphClauseText ?? line;
  const positiveDestinationAction = positiveDisclosureActions(
    semanticLine,
  ).some(({ kind }) => kind === "network" || kind === "external-upload");
  if (
    (GUARDED_ACTION_RE.test(semanticLine) &&
      !WEAK_OR_NEGATED_APPROVAL_RE.test(semanticLine)) ||
    (isDefensiveActionInstruction(semanticLine) && !positiveDestinationAction)
  ) {
    return detections;
  }

  if (isUploadInstruction(analysis)) {
    detections.push({
      metadata: RULES.externalUploadInstruction,
      severity: policy.externalUploadAllowed === false ? "high" : "medium",
      ...evidence,
    });
  }

  if (
    isBulkDataSharingInstruction(line) ||
    (paragraphClauseText !== undefined &&
      BULK_DATA_TARGET_RE.test(line) &&
      isBulkDataSharingInstruction(paragraphClauseText))
  ) {
    detections.push({
      metadata: RULES.bulkDataSharingInstruction,
      severity: "medium",
      ...evidence,
    });
  }

  if (
    CLOUD_UPLOAD_RE.test(line) ||
    CLOUD_DESTINATION_RE.test(line) ||
    (paragraphClauseText !== undefined &&
      PARAGRAPH_DESTINATION_TARGET_RE.test(line) &&
      (CLOUD_UPLOAD_RE.test(paragraphClauseText) ||
        CLOUD_DESTINATION_RE.test(paragraphClauseText)))
  ) {
    detections.push({
      metadata: RULES.cloudUploadInstruction,
      severity: "medium",
      ...evidence,
    });
  }

  return detections;
}

function contextScopeDetections(
  line: string,
  lineNumber: number,
  paragraphClauseText?: string,
): Detection[] {
  const detections: Detection[] = [];
  const semanticLine = paragraphClauseText ?? line;

  if (
    (OVERBROAD_CONTEXT_RE.test(line) ||
      (paragraphClauseText !== undefined &&
        BULK_DATA_TARGET_RE.test(line) &&
        OVERBROAD_CONTEXT_RE.test(paragraphClauseText))) &&
    !isDefensiveActionInstruction(semanticLine)
  ) {
    detections.push({
      metadata: RULES.overbroadContextInstruction,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (
    (NO_REDACTION_RE.test(line) ||
      (UNREDACTED_SENSITIVE_DATA_RE.test(line) &&
        DATA_DISCLOSURE_ACTION_RE.test(line)) ||
      (paragraphClauseText !== undefined &&
        REDACTION_TARGET_RE.test(line) &&
        (NO_REDACTION_RE.test(paragraphClauseText) ||
          (UNREDACTED_SENSITIVE_DATA_RE.test(paragraphClauseText) &&
            DATA_DISCLOSURE_ACTION_RE.test(paragraphClauseText))))) &&
    !isDefensiveActionInstruction(semanticLine)
  ) {
    detections.push({
      metadata: RULES.noRedactionInstruction,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  return detections;
}

function commandDetections(
  line: string,
  lineNumber: number,
  hasCommandRiskGuard: boolean,
  analysis?: SecurityCommandAnalysis,
): Detection[] {
  const detections: Detection[] = [];
  const defensiveAction = isDefensiveOrGuardedActionInstruction(line);

  const remoteScript = line.match(REMOTE_SCRIPT_RE);
  if (remoteScript && !hasPinnedRemoteScript(line) && !defensiveAction) {
    const fetchCommand = remoteScript[1] ?? "curl";
    const remoteUrl = (remoteScript[2] ?? line).replace(/[.,;:]+$/, "");
    const shell = remoteScript[3] ?? "sh";
    detections.push({
      metadata: RULES.unpinnedRemoteScript,
      severity: "high",
      startLine: lineNumber,
      snippet: `${fetchCommand} ${remoteUrl} | ${shell}`,
      dedupeKey: `${RULES.unpinnedRemoteScript.id}:${remoteUrl}`,
    });
  }

  const unapprovedDependencies =
    analysis?.dependencyInstalls.filter(
      ({ pinning, floatingAllowed }) =>
        !floatingAllowed &&
        (pinning === "unpinned" ||
          pinning === "floating-literal" ||
          pinning === "variable-unverified"),
    ) ?? [];
  const structuredUnpinnedInstall =
    analysis?.dependencyInstallCommand === true &&
    unapprovedDependencies.length > 0;
  const requiresDependencyFallback =
    analysis === undefined ||
    analysis.support === "fallback-required" ||
    !analysis.dependencyInstallCommand;
  const unpinnedInstall =
    structuredUnpinnedInstall ||
    (requiresDependencyFallback && unpinnedDependencyInstall(line));
  if (unpinnedInstall && !defensiveAction) {
    detections.push({
      metadata: RULES.unpinnedDependencyInstall,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
      ...(structuredUnpinnedInstall
        ? { details: dependencyFindingDetails(unapprovedDependencies) }
        : {}),
    });
  }

  if (
    PRIVILEGED_COMMAND_RE.test(line) &&
    !hasCommandRiskGuard &&
    !defensiveAction
  ) {
    detections.push({
      metadata: RULES.privilegedCommandWithoutGuard,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (
    DESTRUCTIVE_COMMAND_RE.test(line) &&
    !hasCommandRiskGuard &&
    !defensiveAction
  ) {
    detections.push({
      metadata: RULES.destructiveCommand,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (CREDENTIAL_ARG_RE.test(line) || CREDENTIAL_HEADER_RE.test(line)) {
    detections.push({
      metadata: RULES.credentialInCommandArg,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  return detections;
}

function dependencyFindingDetails(
  dependencies: SecurityCommandAnalysis["dependencyInstalls"],
): Record<string, unknown> {
  const projected = dependencies.map(
    ({
      ecosystem,
      packageManager,
      packageName,
      normalizedPackageName,
      reference,
      selector,
      selectorKind,
      pinning,
    }) => ({
      ecosystem,
      packageManager,
      ...(packageName === undefined ? {} : { packageName }),
      ...(normalizedPackageName === undefined ? {} : { normalizedPackageName }),
      reference,
      selector,
      selectorKind,
      pinning,
      floatingAllowed: false,
    }),
  );
  return projected.length === 1
    ? { ...projected[0], dependencies: projected }
    : { dependencies: projected };
}

function predictableTempDetections(
  line: string,
  lineNumber: number,
): Detection[] {
  const tempMatches = line.match(PREDICTABLE_TEMP_GLOBAL_RE) ?? [];
  if (
    tempMatches.length === 0 ||
    DESTRUCTIVE_COMMAND_RE.test(line) ||
    /mktemp|tempfile|random|unique/i.test(line)
  ) {
    return [];
  }

  return [
    {
      metadata: RULES.predictableTempPath,
      severity: sensitiveTempWords(line) ? "medium" : "low",
      startLine: lineNumber,
      snippet: line,
      dedupeKey: `${RULES.predictableTempPath.id}:${tempMatches[0]}:${Math.floor(
        (lineNumber - 1) / 10,
      )}`,
    },
  ];
}

function securityPolicyResolutionDetections(
  parsedPolicy: SecurityPolicy,
  resolvedPolicy: SecurityPolicy,
  config: SecurityConfig | undefined,
  content: string,
  markdownParserEligible: boolean,
  markdownView?: MarkdownSecurityView,
  securityParagraphs: readonly PreparedSecurityParagraphContext[] = [],
): Detection[] {
  const detections: Detection[] = [];
  if (parsedPolicy.securityProfile === undefined) {
    addForbiddenInputDetections(
      detections,
      resolvedPolicy,
      content,
      markdownParserEligible,
      markdownView,
      securityParagraphs,
    );
    return detections;
  }

  const chain = securityProfileChain(parsedPolicy.securityProfile, config);
  const profileEvidence = policyFieldEvidence(
    parsedPolicy,
    "securityProfile",
    content,
    1,
    `security_profile: ${parsedPolicy.securityProfile}`,
  );

  if (chain.missingProfile !== undefined) {
    detections.push({
      metadata: RULES.policyProfileNotFound,
      severity: "high",
      startLine: profileEvidence.startLine,
      endLine: profileEvidence.endLine,
      snippet: profileEvidence.snippet,
      dedupeKey: `profile-not-found:${chain.missingProfile}`,
    });
    return detections;
  }

  if (chain.cycle !== undefined) {
    detections.push({
      metadata: RULES.policyProfileCycle,
      severity: "high",
      startLine: profileEvidence.startLine,
      endLine: profileEvidence.endLine,
      snippet: profileEvidence.snippet,
      dedupeKey: `profile-cycle:${chain.cycle.join(">")}`,
    });
    return detections;
  }

  const inheritedNetworkAllowed = inheritedBoolean(chain, "networkAllowed");
  const inheritedUploadAllowed = inheritedBoolean(
    chain,
    "externalUploadAllowed",
  );
  const inheritedSecretsAllowed = inheritedBoolean(chain, "secretsAllowed");
  const inheritedNetworkDestinations = chain.profiles.some(
    (item) => item.profile.approvedDomains.length > 0,
  );
  const inheritedUploadDestinations = chain.profiles.some(
    (item) => item.profile.approvedUploadDomains.length > 0,
  );

  addScalarOverrideContradiction(
    detections,
    parsedPolicy,
    content,
    "networkAllowed",
    inheritedNetworkAllowed,
    profileEvidence.startLine,
  );
  addScalarOverrideContradiction(
    detections,
    parsedPolicy,
    content,
    "externalUploadAllowed",
    inheritedUploadAllowed,
    profileEvidence.startLine,
  );
  addScalarOverrideContradiction(
    detections,
    parsedPolicy,
    content,
    "secretsAllowed",
    inheritedSecretsAllowed,
    profileEvidence.startLine,
  );

  if (
    parsedPolicy.declared.has("networkAllowed") &&
    parsedPolicy.networkAllowed === false &&
    (inheritedNetworkAllowed ||
      inheritedNetworkDestinations ||
      resolvedPolicy.approvedNetworkDestinations.length >
        parsedPolicy.approvedNetworkDestinations.length)
  ) {
    detections.push({
      metadata: RULES.policyOverrideContradiction,
      severity: "high",
      ...policyFieldDetectionEvidence(
        parsedPolicy,
        "networkAllowed",
        content,
        profileEvidence.startLine,
        "network_allowed: false",
      ),
      dedupeKey: "override-contradiction:network",
    });
  }

  if (
    parsedPolicy.declared.has("externalUploadAllowed") &&
    parsedPolicy.externalUploadAllowed === false &&
    (inheritedUploadAllowed ||
      inheritedUploadDestinations ||
      resolvedPolicy.approvedUploadDestinations.length >
        parsedPolicy.approvedUploadDestinations.length)
  ) {
    detections.push({
      metadata: RULES.policyOverrideContradiction,
      severity: "high",
      ...policyFieldDetectionEvidence(
        parsedPolicy,
        "externalUploadAllowed",
        content,
        profileEvidence.startLine,
        "external_upload_allowed: false",
      ),
      dedupeKey: "override-contradiction:upload",
    });
  }

  addForbiddenInputDetections(
    detections,
    resolvedPolicy,
    content,
    markdownParserEligible,
    markdownView,
    securityParagraphs,
  );

  return detections;
}

function addForbiddenInputDetections(
  detections: Detection[],
  policy: SecurityPolicy,
  content: string,
  markdownParserEligible: boolean,
  markdownView?: MarkdownSecurityView,
  securityParagraphs: readonly PreparedSecurityParagraphContext[] = [],
): void {
  for (const forbiddenInput of policy.forbiddenInputs) {
    const detection = forbiddenInputDetection(
      content,
      forbiddenInput,
      markdownParserEligible,
      markdownView,
      securityParagraphs,
    );
    if (detection !== undefined) detections.push(detection);
  }
}

function inheritedBoolean(
  chain: SecurityProfileChain,
  field: "networkAllowed" | "externalUploadAllowed" | "secretsAllowed",
): boolean | undefined {
  for (let index = chain.profiles.length - 1; index >= 0; index -= 1) {
    const value = chain.profiles[index]?.profile[field];
    if (value !== undefined) return value;
  }
  return undefined;
}

function addScalarOverrideContradiction(
  detections: Detection[],
  parsedPolicy: SecurityPolicy,
  content: string,
  field: "networkAllowed" | "externalUploadAllowed" | "secretsAllowed",
  inheritedValue: boolean | undefined,
  fallbackLine: number,
): void {
  const artifactValue = parsedPolicy[field];
  if (
    inheritedValue === false &&
    artifactValue === true &&
    parsedPolicy.declared.has(field)
  ) {
    pushOverrideContradiction(
      detections,
      parsedPolicy,
      content,
      field,
      fallbackLine,
    );
  }
}

function pushOverrideContradiction(
  detections: Detection[],
  parsedPolicy: SecurityPolicy,
  content: string,
  field: "networkAllowed" | "externalUploadAllowed" | "secretsAllowed",
  fallbackLine: number,
): void {
  const evidence = policyFieldEvidence(
    parsedPolicy,
    field,
    content,
    fallbackLine,
    field,
  );
  detections.push({
    metadata: RULES.policyOverrideContradiction,
    severity: "high",
    startLine: evidence.startLine,
    endLine: evidence.endLine,
    snippet: evidence.snippet,
    dedupeKey: `override-contradiction:${field}`,
  });
}

function invalidCanonicalSecurityDetections(
  issues: readonly CanonicalSecurityMetadataIssue[],
): Detection[] {
  return issues.map((issue) => ({
    metadata: {
      ...RULES.invalidCanonicalPolicyMetadata,
      title: `Invalid metadata.${issue.key}: ${issue.reason}.`,
    },
    severity: "high",
    startLine: issue.startLine,
    endLine: issue.endLine,
    snippet: issue.snippet,
    dedupeKey: `invalid-canonical-policy:${issue.key}:${issue.startLine}`,
  }));
}

function policyFieldEvidence(
  policy: SecurityPolicy,
  field: string,
  content: string,
  fallbackLine: number,
  fallbackSnippet: string,
): { startLine: number; endLine: number; snippet: string } {
  const canonical = policy.evidenceByField.get(field);
  if (canonical !== undefined) return canonical;
  const startLine = policy.lineByField.get(field) ?? fallbackLine;
  return {
    startLine,
    endLine: startLine,
    snippet: lineSnippet(content, startLine) ?? fallbackSnippet,
  };
}

function policyFieldDetectionEvidence(
  policy: SecurityPolicy,
  field: string,
  content: string,
  fallbackLine: number,
  fallbackSnippet: string,
): Pick<Detection, "startLine" | "endLine" | "snippet"> {
  return policyFieldEvidence(
    policy,
    field,
    content,
    fallbackLine,
    fallbackSnippet,
  );
}

function forbiddenInputDetection(
  content: string,
  forbiddenInput: string,
  markdownParserEligible: boolean,
  markdownView?: MarkdownSecurityView,
  securityParagraphs: readonly PreparedSecurityParagraphContext[] = [],
): Detection | undefined {
  const needle = forbiddenInput.trim();
  if (needle.length === 0) return undefined;

  const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
  const sourceLines = content.split(/\r?\n/);
  const lines = markdownView
    ? sourceLines.map((_, index) => markdownView.visibleLine(index))
    : sourceLines;
  const scanStart = securityContentStart(markdownParserEligible, markdownView);
  let lineLocalDetection: Detection | undefined;
  for (let index = scanStart; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!pattern.test(line)) continue;
    if (SAFE_FORBIDDEN_INPUT_PATTERN.test(line)) continue;
    if (!FORBIDDEN_INPUT_ACTION_PATTERN.test(line)) continue;
    lineLocalDetection = {
      metadata: RULES.forbiddenInputInstruction,
      severity: "high",
      startLine: index + 1,
      snippet: line.trim(),
      dedupeKey: `forbidden-input:${needle.toLowerCase()}`,
    };
    break;
  }

  const paragraphPattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "giu");
  let paragraphDetection: Detection | undefined;
  paragraphSearch: for (const preparedParagraph of securityParagraphs) {
    if (!preparedParagraph.structurallyEligible) continue;
    const { paragraph, clauseRanges } = preparedParagraph;
    for (const match of paragraph.text.matchAll(paragraphPattern)) {
      if (match.index === undefined) continue;
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      const clauseRange = clauseRanges.find(
        ({ start, end }) => start < matchEnd && end > matchStart,
      );
      if (clauseRange === undefined) continue;
      const clause = paragraph.text.slice(clauseRange.start, clauseRange.end);
      if (SAFE_FORBIDDEN_INPUT_PATTERN.test(clause)) continue;
      if (!FORBIDDEN_INPUT_ACTION_PATTERN.test(clause)) continue;
      const evidence = paragraphEvidenceForRange(
        paragraph,
        matchStart,
        matchEnd,
      );
      if (evidence === undefined) continue;
      paragraphDetection = {
        metadata: RULES.forbiddenInputInstruction,
        severity: "high",
        ...evidence,
        dedupeKey: `forbidden-input:${needle.toLowerCase()}`,
      };
      break paragraphSearch;
    }
  }
  if (lineLocalDetection === undefined) return paragraphDetection;
  if (paragraphDetection === undefined) return lineLocalDetection;
  return paragraphDetection.startLine < lineLocalDetection.startLine
    ? paragraphDetection
    : lineLocalDetection;
}

function securityContentStart(
  markdownParserEligible: boolean,
  markdownView: MarkdownSecurityView | undefined,
): number {
  if (!markdownParserEligible) return 0;
  if (markdownView === undefined) {
    throw new Error(
      "Eligible Markdown security analysis requires syntax state",
    );
  }
  return markdownView.bodyStartLine - 1;
}

function lineSnippet(content: string, line: number): string | undefined {
  return content.split(/\r?\n/)[line - 1]?.trim();
}

function unapprovedNetworkDestinations(
  analysis: DestinationAnalysis,
  policy: SecurityPolicy,
  invalidAllowlist = false,
): NetworkDestination[] {
  return unapprovedDestinations(
    networkDestinations(analysis),
    policy.approvedNetworkDestinations,
    invalidAllowlist,
  );
}

function isBulkDataSharingInstruction(line: string): boolean {
  return BULK_DATA_SOURCE_RE.test(line) && DATA_DISCLOSURE_ACTION_RE.test(line);
}

function semanticInstructionDetections(
  unit: MarkdownSemanticUnit,
  markdownView: MarkdownSecurityView,
  options: {
    evidence?: DetectionEvidence;
    sectionText?: string;
  } = {},
): Detection[] {
  const detections: Detection[] = [];
  const firstLine =
    unit.kind === "code"
      ? (unit.contentStartLine ?? unit.startLine)
      : unit.startLine;
  const instructionLines = unit.lines.map((line) => line.trim());
  const instructionText = instructionLines.join(" ");
  if (!instructionText.trim()) return detections;
  const lineOffsets = instructionLines.map((_, index) =>
    instructionLines
      .slice(0, index)
      .reduce((offset, line) => offset + line.length + 1, 0),
  );
  const windowEvidence = options.evidence ?? {
    startLine: firstLine,
    endLine: firstLine + instructionLines.length - 1,
    snippet: instructionLines.join("\n"),
  };

  const safeguardLineIndex = instructionLines.findIndex(
    (line) => unsafeSafeguardClause(line) !== undefined,
  );
  const safeguardWindowMatches =
    unsafeSafeguardClause(instructionText) !== undefined;
  if (safeguardLineIndex >= 0 || safeguardWindowMatches) {
    const evidence =
      options.evidence !== undefined
        ? options.evidence
        : safeguardLineIndex >= 0
          ? semanticLineEvidence(
              instructionLines,
              firstLine,
              safeguardLineIndex,
            )
          : windowEvidence;
    detections.push({
      metadata: RULES.safeguardBypassInstruction,
      severity: "high",
      ...evidence,
      dedupeKey: `${RULES.safeguardBypassInstruction.id}:${evidence.startLine}`,
    });
  }

  const sentences = semanticSentenceSpans(instructionText);
  const reviewGuardText = markdownView.inlineCodeProse(unit, instructionText);
  const untrustedAction = untrustedExecutionActions(sentences).find(
    (action) =>
      UNTRUSTED_CONTENT_SOURCE_RE.test(instructionText.slice(0, action.end)) &&
      !isDefensiveUntrustedAction(sentences, action) &&
      !hasPrecedingReviewGuard(sentences, action, reviewGuardText),
  );
  if (untrustedAction !== undefined) {
    const actionLineIndex = semanticLineIndexAtOffset(
      lineOffsets,
      untrustedAction.start,
    );
    const actionLineStart = lineOffsets[actionLineIndex] ?? 0;
    const actionLine = instructionLines[actionLineIndex] ?? "";
    const untrustedContentOnLine = UNTRUSTED_CONTENT_SOURCE_RE.test(
      instructionText.slice(
        actionLineStart,
        actionLineStart + actionLine.length,
      ),
    );
    const evidence = untrustedContentOnLine
      ? semanticLineEvidence(instructionLines, firstLine, actionLineIndex)
      : {
          startLine: firstLine,
          endLine: firstLine + actionLineIndex,
          snippet: instructionLines.slice(0, actionLineIndex + 1).join("\n"),
        };
    detections.push({
      metadata: RULES.untrustedContentAsInstruction,
      severity: "high",
      ...evidence,
      dedupeKey: `${RULES.untrustedContentAsInstruction.id}:${firstLine}:${untrustedAction.start}:${untrustedAction.end}`,
    });
  }

  for (const [lineIndex, line] of instructionLines.entries()) {
    if (
      !RECURSIVE_EXTERNAL_TRAVERSAL_RE.test(line) ||
      DIRECT_DEFENSIVE_SEMANTIC_RE.test(line)
    ) {
      continue;
    }
    const evidenceLine = firstLine + lineIndex;
    const sectionText =
      options.sectionText ?? markdownView.instructionSectionText(evidenceLine);
    const hasAnyBoundary = TRAVERSAL_BOUNDARY_PATTERNS.some((pattern) =>
      pattern.test(sectionText),
    );
    if (!hasAnyBoundary) {
      const sensitiveSink = sectionText
        .split(/\r?\n/)
        .some(
          (sectionLine) =>
            isUploadInstruction(analyzeDestinations(sectionLine)) ||
            (SECRET_WORD_RE.test(sectionLine) &&
              DATA_DISCLOSURE_ACTION_RE.test(sectionLine)),
        );
      detections.push({
        metadata: sensitiveSink
          ? {
              ...RULES.unboundedExternalSourceTraversal,
              riskClass: "suspicious",
            }
          : RULES.unboundedExternalSourceTraversal,
        severity: sensitiveSink ? "medium" : "low",
        startLine: evidenceLine,
        snippet: line,
        dedupeKey: `${RULES.unboundedExternalSourceTraversal.id}:${evidenceLine}`,
      });
    }
  }

  return detections;
}

function unsafeSafeguardClause(text: string): string | undefined {
  const actions = safeguardActionPolarities(text);
  for (const pattern of SAFEGUARD_BYPASS_PATTERNS) {
    for (const match of overlappingPatternMatches(text, pattern)) {
      const matchEnd = match.start + match.text.length;
      const matchedActions = actions.filter(
        ({ start }) =>
          start >= match.start &&
          start < matchEnd &&
          !SAFEGUARD_HARD_SCOPE_BOUNDARY_RE.test(
            text.slice(match.start, start),
          ),
      );
      if (matchedActions.some(({ prohibited }) => !prohibited)) {
        return match.text;
      }
    }
  }
  return undefined;
}

function overlappingPatternMatches(
  text: string,
  pattern: RegExp,
): Array<{ text: string; start: number }> {
  const matches: Array<{ text: string; start: number }> = [];
  const flags = pattern.flags.replace(/[gy]/gu, "");
  let cursor = 0;
  while (cursor < text.length) {
    const match = new RegExp(pattern.source, flags).exec(text.slice(cursor));
    if (match?.index === undefined) break;
    const start = cursor + match.index;
    matches.push({ text: match[0], start });
    cursor = start + 1;
  }
  return matches;
}

function safeguardActionPolarities(
  text: string,
): Array<{ start: number; end: number; prohibited: boolean }> {
  const actions = [...text.matchAll(SAFEGUARD_ACTION_PREDICATE_RE)].flatMap(
    (match) =>
      match.index === undefined
        ? []
        : [
            {
              start: match.index,
              end: match.index + match[0].length,
              prohibited: false,
            },
          ],
  );

  for (const [index, action] of actions.entries()) {
    const previous = actions[index - 1];
    const localStart = previous?.end ?? Math.max(0, action.start - 120);
    const localPrefix = text.slice(localStart, action.start);
    const prohibitions = [...localPrefix.matchAll(SAFEGUARD_PROHIBITION_RE)];
    const directProhibition = prohibitions[prohibitions.length - 1];
    if (directProhibition?.index !== undefined) {
      const directBridge = localPrefix.slice(
        directProhibition.index + directProhibition[0].length,
      );
      action.prohibited = isDirectSafeguardProhibitionBridge(directBridge);
      continue;
    }
    if (
      previous?.prohibited === true &&
      (isCoordinatedSafeguardActionBridge(
        text.slice(previous.end, action.start),
      ) ||
        isDependentInfinitivalPurposeBridge(
          text.slice(previous.end, action.start),
        ))
    ) {
      action.prohibited = true;
    }
  }

  return actions;
}

function isCoordinatedSafeguardActionBridge(bridge: string): boolean {
  if (
    bridge.length > 80 ||
    SAFEGUARD_HARD_SCOPE_BOUNDARY_RE.test(bridge) ||
    bridge.trim().length === 0
  ) {
    return false;
  }
  if (/^\s*,\s*$/u.test(bridge)) return true;
  if (/^[^,]{1,70},\s*$/u.test(bridge)) return true;
  return /^[^,]{0,70}(?:,\s*)?(?:and|or|nor)\s*$/iu.test(bridge);
}

function isDirectSafeguardProhibitionBridge(bridge: string): boolean {
  return (
    bridge.length <= 80 &&
    !hasSafeguardClauseBoundary(bridge) &&
    !SAFEGUARD_FINITE_CLAUSE_RE.test(bridge)
  );
}

function isDependentInfinitivalPurposeBridge(bridge: string): boolean {
  if (
    bridge.length > 80 ||
    /,/u.test(bridge) ||
    hasSafeguardClauseBoundary(bridge) ||
    SAFEGUARD_FINITE_CLAUSE_RE.test(bridge)
  ) {
    return false;
  }
  return /\b(?:(?:merely|only)\s+to|(?:in\s+order|so\s+as)\s+to|to)\s*$/iu.test(
    bridge,
  );
}

function hasSafeguardClauseBoundary(bridge: string): boolean {
  return (
    SAFEGUARD_HARD_SCOPE_BOUNDARY_RE.test(bridge) ||
    SAFEGUARD_GRAMMATICAL_SCOPE_BOUNDARY_RE.test(bridge)
  );
}

function semanticLineEvidence(
  lines: string[],
  firstLine: number,
  lineIndex: number,
): Pick<Detection, "startLine" | "endLine" | "snippet"> {
  return {
    startLine: firstLine + lineIndex,
    endLine: firstLine + lineIndex,
    snippet: lines[lineIndex] ?? "",
  };
}

function semanticLineIndexAtOffset(
  lineOffsets: number[],
  offset: number,
): number {
  for (let index = lineOffsets.length - 1; index >= 0; index -= 1) {
    if ((lineOffsets[index] ?? 0) <= offset) return index;
  }
  return 0;
}

type SemanticTextSpan = {
  text: string;
  start: number;
  end: number;
};

type UntrustedActionVerb =
  | "execute"
  | "run"
  | "apply"
  | "follow"
  | "obey"
  | "adopt"
  | "treat"
  | "regard"
  | "accept";

type UntrustedExecutionAction = SemanticTextSpan & {
  sentenceIndex: number;
  verb: UntrustedActionVerb;
};

function semanticSentenceSpans(text: string): SemanticTextSpan[] {
  const sentences: SemanticTextSpan[] = [];
  let start = 0;
  for (const boundary of text.matchAll(/[.!?]+(?=\s+|$)/g)) {
    const end = (boundary.index ?? 0) + boundary[0].length;
    appendTrimmedSemanticSpan(sentences, text, start, end);
    start = end;
  }
  appendTrimmedSemanticSpan(sentences, text, start, text.length);
  return sentences;
}

function appendTrimmedSemanticSpan(
  spans: SemanticTextSpan[],
  text: string,
  start: number,
  end: number,
): void {
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  if (start < end) spans.push({ text: text.slice(start, end), start, end });
}

function untrustedExecutionActions(
  sentences: SemanticTextSpan[],
): UntrustedExecutionAction[] {
  const actions: UntrustedExecutionAction[] = [];
  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const pattern = new RegExp(
      UNTRUSTED_CONTENT_EXECUTION_RE.source,
      `${UNTRUSTED_CONTENT_EXECUTION_RE.flags}g`,
    );
    for (const match of sentence.text.matchAll(pattern)) {
      const text = match[0] ?? "";
      const verb = untrustedActionVerb(text);
      if (verb === undefined) continue;
      const start = sentence.start + (match.index ?? 0);
      actions.push({
        text,
        start,
        end: start + text.length,
        sentenceIndex,
        verb,
      });
    }
  }
  return actions;
}

function untrustedActionVerb(text: string): UntrustedActionVerb | undefined {
  const match = text.match(
    /\b(execute|executing|run|running|apply|applying|follow|following|obey|obeying|adopt|adopting|treat|regard|accept)\b/i,
  );
  const verb = match?.[1]?.toLowerCase() ?? "";
  if (verb.startsWith("execut")) return "execute";
  if (verb.startsWith("run")) return "run";
  if (verb.startsWith("appl")) return "apply";
  if (verb.startsWith("follow")) return "follow";
  if (verb.startsWith("obey")) return "obey";
  if (verb.startsWith("adopt")) return "adopt";
  if (verb === "treat" || verb === "regard" || verb === "accept") return verb;
  return undefined;
}

function isDefensiveUntrustedAction(
  sentences: SemanticTextSpan[],
  action: UntrustedExecutionAction,
): boolean {
  const sentence = sentences[action.sentenceIndex];
  if (sentence === undefined) return false;
  const actionStart = action.start - sentence.start;
  return DIRECT_DEFENSIVE_ACTION_PREFIX_RE.test(
    sentence.text.slice(0, actionStart),
  );
}

function hasPrecedingReviewGuard(
  sentences: SemanticTextSpan[],
  action: UntrustedExecutionAction,
  guardText: string,
): boolean {
  const sentence = sentences[action.sentenceIndex];
  if (sentence === undefined) return false;
  if (CONTRADICTORY_REVIEW_ACTION_RE.test(sentence.text)) return false;

  const guardSentences = semanticSentenceSpans(guardText);
  const guardActionSentence = guardSentences.find(
    (candidate) =>
      candidate.start <= action.start && action.start < candidate.end,
  );
  if (guardActionSentence === undefined) return false;

  const sameSentenceGuards = reviewGuardActions(guardActionSentence);
  if (
    sameSentenceGuards.some(
      (guard) =>
        guard.start < action.start &&
        guard.targetStart === action.start &&
        guard.verb === action.verb,
    )
  ) {
    return true;
  }

  const precedingSentence = guardSentences.findLast(
    (candidate) => candidate.end <= guardActionSentence.start,
  );
  return (
    precedingSentence !== undefined &&
    reviewGuardActions(precedingSentence).some(
      (guard) =>
        guard.verb === action.verb &&
        reviewGuardScopeCovers(precedingSentence.text, sentence.text),
    )
  );
}

function reviewGuardScopeCovers(
  guardSentence: string,
  actionSentence: string,
): boolean {
  if (BROAD_REVIEW_GUARD_SCOPE_RE.test(guardSentence)) return true;
  const actionSources = untrustedSourceSpans(actionSentence);
  if (actionSources.length === 0) return false;
  const guardSources = new Set(untrustedSourceSpans(guardSentence));
  return actionSources.some((source) => guardSources.has(source));
}

function untrustedSourceSpans(text: string): string[] {
  const pattern = new RegExp(
    UNTRUSTED_CONTENT_SOURCE_RE.source,
    `${UNTRUSTED_CONTENT_SOURCE_RE.flags}g`,
  );
  return [...text.matchAll(pattern)].map((match) =>
    (match[0] ?? "").toLowerCase(),
  );
}

function reviewGuardActions(
  sentence: SemanticTextSpan,
): Array<
  SemanticTextSpan & { targetStart: number; verb: UntrustedActionVerb }
> {
  const guards: Array<{
    text: string;
    start: number;
    end: number;
    targetStart: number;
    verb: UntrustedActionVerb;
  }> = [];
  const pattern = new RegExp(
    UNTRUSTED_CONTENT_REVIEW_GUARD_RE.source,
    `${UNTRUSTED_CONTENT_REVIEW_GUARD_RE.flags}g`,
  );
  for (const match of sentence.text.matchAll(pattern)) {
    const text = match[0] ?? "";
    const before = text.search(/\b(before|prior to)\b/i);
    if (before < 0) continue;
    const targetText = text.slice(before);
    const target = targetText.match(
      /\b(execute|executing|run|running|apply|applying|follow|following|obey|obeying|adopt|adopting)\b/i,
    );
    const verb = untrustedActionVerb(target?.[0] ?? "");
    if (target === null || verb === undefined) continue;
    const start = sentence.start + (match.index ?? 0);
    guards.push({
      text,
      start,
      end: start + text.length,
      targetStart: start + before + (target.index ?? 0),
      verb,
    });
  }
  return guards;
}

function matchesDisallowedCommand(line: string, command: string): boolean {
  const normalizedLine = line.toLowerCase().replace(/\s+/g, " ");
  const normalizedCommand = command.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalizedCommand.length === 0) return false;

  if (/^[a-z0-9_-]+$/.test(normalizedCommand)) {
    const escaped = escapeRegExp(normalizedCommand);
    return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`).test(
      normalizedLine,
    );
  }

  return normalizedLine.includes(normalizedCommand);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPolicyLine(line: string): boolean {
  return isSecurityPolicyLine(line);
}

function isShellCommentLine(
  line: string,
  lineIndex: number,
  markdownView?: MarkdownSecurityView,
): boolean {
  const strippedComment = line.replace(/^\s*(#|\/\/)\s*/, "");
  return (
    /^\s*\/\//.test(line) ||
    (/^\s*#/.test(line) &&
      ((markdownView?.isCodeBlockLine(lineIndex) ?? false) ||
        isCommandLike(strippedComment) ||
        CREDENTIAL_ARG_ANY_RE.test(strippedComment) ||
        REMOTE_SCRIPT_RE.test(strippedComment) ||
        PREDICTABLE_TEMP_RE.test(strippedComment)))
  );
}

function isCommandLike(line: string): boolean {
  return /\b(npm|pnpm|yarn|pip3?|python(?:\d+(?:\.\d+)*)?|py|uv|brew|docker|curl|wget|sudo|chmod|chown|git|gh|aws|gcloud|az|kubectl|echo|cat|cp|mv|rm|touch|mkdir)\b/i.test(
    line,
  );
}

function hasExplicitHumanApprovalGuard(line: string): boolean {
  if (WEAK_OR_NEGATED_APPROVAL_RE.test(line)) {
    return false;
  }
  return APPROVAL_RE.test(line);
}

function hasLocalRiskMitigationGuard(line: string): boolean {
  return RECOVERY_GUARD_RE.test(line);
}

function isPrecedingGuardWithinBoundary(
  lines: readonly string[],
  guardIndex: number,
  instructionIndex: number,
  markdownView?: MarkdownSecurityView,
): boolean {
  if (guardIndex < 0 || guardIndex >= instructionIndex) return false;
  if (markdownView !== undefined) {
    return markdownView.sameStructuralSection(guardIndex, instructionIndex);
  }
  return !lines
    .slice(guardIndex + 1, instructionIndex + 1)
    .some((line) => !line.trim());
}

function hasStructuredGuard(
  lines: readonly string[],
  commandIndex: number,
  guard: (line: string) => boolean,
  markdownView?: MarkdownSecurityView,
): boolean {
  if (markdownView !== undefined) {
    return markdownView.associatedGuardLines(commandIndex).some(guard);
  }

  // Plain-text and script artifacts retain nearby guard association without
  // interpreting their contents as Markdown.
  let cursor = commandIndex - 1;
  while (cursor >= 0 && !(lines[cursor] ?? "").trim()) cursor -= 1;
  let inspected = 0;
  while (cursor >= 0 && inspected < 6) {
    const line = lines[cursor] ?? "";
    if (!line.trim()) break;
    if (guard(line)) return true;
    cursor -= 1;
    inspected += 1;
  }
  return false;
}

function requiresDestinationApprovalGuard(
  line: string,
  analysis: DestinationAnalysis,
): boolean {
  return (
    EXTERNAL_UPLOAD_RE.test(line) ||
    CLOUD_UPLOAD_RE.test(line) ||
    networkDestinations(analysis).length > 0
  );
}

function lineHasParagraphDestinationTarget(
  line: string,
  analysis: DestinationAnalysis,
): boolean {
  return (
    analysis.candidates.some(
      ({ destination, kind }) =>
        destination !== undefined ||
        kind === "explicit-url" ||
        kind === "network-share" ||
        kind === "bare-host" ||
        kind === "unsupported-host",
    ) || PARAGRAPH_DESTINATION_TARGET_RE.test(line)
  );
}

function lineHasSensitiveApprovalTarget(line: string): boolean {
  return SECRET_WORD_RE.test(line) || referencesSensitiveFile(line);
}

function requiresLineLocalApprovalGuard(line: string): boolean {
  return (
    (SECRET_ACTION_RE.test(line) && SECRET_WORD_RE.test(line)) ||
    (referencesSensitiveFile(line) &&
      !isSafeSensitiveHandlingInstruction(line)) ||
    PRIVILEGED_COMMAND_RE.test(line) ||
    DESTRUCTIVE_COMMAND_RE.test(line)
  );
}

function isDefensiveOrGuardedActionInstruction(line: string): boolean {
  return isDefensiveActionInstruction(line) || GUARDED_ACTION_RE.test(line);
}

function isDefensiveActionInstruction(line: string): boolean {
  if (
    /\b(no approval is needed|approved by default|safe to run)\b/i.test(line)
  ) {
    return false;
  }
  return DEFENSIVE_ACTION_RE.test(line);
}

function hasPinnedRemoteScript(line: string): boolean {
  return /\b(sha256|sha512|checksum|gpg|cosign|sigstore|version|v\d+\.\d+\.\d+|@[a-f0-9]{7,40})\b/i.test(
    line,
  );
}

function unpinnedDependencyInstall(line: string): boolean {
  const npm = line.match(/\bnpm\s+(?:install|i|add)\s+([^\n#]+)/i);
  if (npm && splitCommandArgs(npm[1] ?? "").some(isUnpinnedNpmPackage)) {
    return true;
  }

  const pnpm = line.match(/\bpnpm\s+(?:add|install)\s+([^\n#]+)/i);
  if (pnpm && splitCommandArgs(pnpm[1] ?? "").some(isUnpinnedNpmPackage)) {
    return true;
  }

  const yarn = line.match(/\byarn\s+(?:global\s+)?add\s+([^\n#]+)/i);
  if (yarn && splitCommandArgs(yarn[1] ?? "").some(isUnpinnedNpmPackage)) {
    return true;
  }

  const pip = line.match(
    /\b(?:pip3?|(?:python(?:\d+(?:\.\d+)*)?|py)\s+-m\s+pip|uv\s+pip)\s+install\s+([^\n#]+)/i,
  );
  if (pip && splitCommandArgs(pip[1] ?? "").some(isUnpinnedPythonPackage)) {
    return true;
  }

  const brew = line.match(/\bbrew\s+install\s+([^\n#]+)/i);
  if (brew && splitCommandArgs(brew[1] ?? "").some(isUnpinnedBrewFormula)) {
    return true;
  }

  const docker = line.match(/\bdocker\s+(?:pull|run)\s+([^\s#]+)/i);
  if (docker && isUnpinnedContainerImage(docker[1] ?? "")) {
    return true;
  }

  return false;
}

function splitCommandArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((arg) => arg.trim())
    .filter(
      (arg) => arg.length > 0 && !arg.startsWith("-") && !/[|;&]/.test(arg),
    );
}

function isUnpinnedNpmPackage(arg: string): boolean {
  const normalized = arg.replace(/^(['"])(.*)\1$/u, "$2");
  if (
    isPlaceholder(normalized) ||
    normalized.startsWith(".") ||
    /^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized)
  ) {
    return false;
  }
  return classifyNpmSelector(normalized).selectorKind !== "exact";
}

function isUnpinnedPythonPackage(arg: string): boolean {
  const normalized = arg.replace(/^(['"])(.*)\1$/u, "$2");
  if (
    isPlaceholder(normalized) ||
    normalized.startsWith("-") ||
    normalized.startsWith(".")
  ) {
    return false;
  }
  return classifyPythonSelector(normalized).selectorKind !== "exact";
}

function isUnpinnedBrewFormula(arg: string): boolean {
  if (isPlaceholder(arg) || arg.includes("/")) {
    return false;
  }
  return !arg.includes("@");
}

function isUnpinnedContainerImage(image: string): boolean {
  if (isPlaceholder(image)) {
    return false;
  }
  const tag = image.includes(":") ? image.split(":").pop() : undefined;
  return tag === undefined || tag === "" || tag === "latest";
}

function isPlaceholder(value: string): boolean {
  return /^<.*>$|^\[.*\]$|^(example|placeholder|package|image)$/i.test(value);
}

function sensitiveTempWords(line: string): boolean {
  return /\b(profile|credential|credentials|secret|token|password|cert|certificate|key|signing|auth|cookie|session|log|dump)\b|\/tmp\/(?:token|secret)\b|\/tmp\/[^/\s]+\.plist\b/i.test(
    line,
  );
}

function dedupeDetections(detections: Detection[]): Detection[] {
  const seen = new Set<string>();
  const unique: Detection[] = [];
  const descriptionDetections = detections.filter(
    (detection) => detection.semanticEvidenceSource === "canonical-description",
  );
  for (const detection of detections) {
    if (
      detection.semanticEvidenceSource !== "canonical-description" &&
      descriptionDetections.some(
        (description) =>
          description.metadata.id === detection.metadata.id &&
          equivalentSemanticEvidence(
            description.semanticEvidenceText ?? "",
            detection.snippet,
          ),
      )
    ) {
      continue;
    }
    const key =
      detection.dedupeKey ?? `${detection.metadata.id}:${detection.snippet}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(detection);
    }
  }
  return unique;
}

function equivalentSemanticEvidence(first: string, second: string): boolean {
  const left = normalizeSemanticEvidence(first);
  const right = normalizeSemanticEvidence(second);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function normalizeSemanticEvidence(value: string): string {
  return value
    .replace(/^\s*(?:description:\s*)?[>|*-]?\s*/gim, "")
    .replace(/[`'".,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findingFromDetection(
  artifact: Artifact,
  detection: Detection,
): Finding {
  return {
    id: detection.metadata.id,
    severity: detection.severity,
    category: detection.metadata.category,
    title: detection.metadata.title,
    evidence: {
      path: artifact.path,
      startLine: detection.startLine,
      endLine: detection.endLine ?? detection.startLine,
      snippet:
        detection.endLine !== undefined &&
        detection.endLine > detection.startLine
          ? detection.snippet.trim().slice(0, 1000)
          : snippet(detection.snippet),
    },
    whyItMatters: detection.metadata.whyItMatters,
    remediation: detection.metadata.remediation,
    constraints: detection.metadata.constraints,
    verificationSteps: detection.metadata.verificationSteps,
    llmHint: detection.metadata.llmHint,
    confidence: detection.metadata.confidence,
    riskClass: detection.metadata.riskClass,
    ...(detection.details === undefined ? {} : { details: detection.details }),
  };
}

function snippet(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}
