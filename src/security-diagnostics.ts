import { compareUtf16CodeUnits } from "./canonical-json.js";
import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import type { DiagnosticId } from "./diagnostic-ids.js";
import {
  hiddenUnicodeAnalysisApplies,
  hiddenUnicodeFindings,
} from "./hidden-unicode.js";
import {
  classifyNpmSelector,
  classifyPythonSelector,
  type FloatingDependencyAllowance,
} from "./dependency-selectors.js";
import {
  applySecurityConfig,
  emptySecurityPolicy,
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
import { projectFindingRepairGuidance } from "./finding-repair-guidance.js";
import type {
  Finding,
  RepairConstraint,
  RiskClass,
  VerificationStep,
} from "./types/diagnostics.js";
import type { ParsedDocument } from "./types/metadata.js";
import {
  SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION,
  type SecurityAnalysisCoverage,
  type SecurityAnalysisCoverageArtifact,
  type SecurityAnalysisCoverageState,
} from "./types/security-analysis-coverage.js";
import type { SecurityConfig } from "./types/configuration.js";
import type {
  ParsedYamlFrontmatter,
  YamlFrontmatterComment,
  YamlFrontmatterCommentAnalysis,
} from "./yaml-frontmatter.js";
import { ensureYamlFrontmatterForDocument } from "./yaml-frontmatter.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import { parseDocument } from "./markdown.js";
import { inspectAgentSkill } from "./agent-skills.js";
import { AGENT_SKILL_TOP_LEVEL_KEYS } from "./metadata-definitions.js";
import {
  attachMarkdownSyntax,
  ensureMarkdownSyntaxForDocument,
  markdownSourceRange,
  parseMarkdownSyntax,
  requiredMarkdownPosition,
  type MarkdownSyntax,
} from "./markdown-syntax.js";
import {
  MarkdownSecurityView,
  type MarkdownHtmlComment,
  type MarkdownSecurityEligibility,
  type MarkdownSemanticUnit,
} from "./markdown-security-view.js";
import {
  analyzeSecurityCommand,
  hasPositiveDisclosureAction,
  positiveDisclosureActions,
  type SecurityCommandAnalysis,
} from "./security-command/index.js";
import {
  hasBoundedShellCommandSubstitution,
  tokenizeBoundedShell,
} from "./security-command/shell.js";
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
  type ResolvedDestinationEvidence,
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
import type { PlainTextSupportSecurityReachability } from "./static-support.js";
import {
  collectHelperCommandEvidence,
  type HelperCommandEvidence,
} from "./helper-command-evidence.js";

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
  repairConstraints: RepairConstraint[];
  verificationStepsV2: VerificationStep[];
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
    repairConstraints: [
      {
        kind: "must_preserve",
        text: "Keep the policy deterministic and local to the artifact.",
      },
      {
        kind: "must_not_change",
        text: "Do not infer approval from prose alone.",
      },
      {
        kind: "must_preserve",
        text: "Preserve existing repository governance metadata.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      { text: "Confirm the artifact declares the relevant policy fields." },
      {
        text: "Review the security-sensitive instruction against the declared policy.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not weaken restrictions without human review.",
      },
      {
        kind: "must_preserve",
        text: "Keep network and upload allowances explicit.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm contradictory policy fields no longer appear together.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not guess the intended boolean, list, or profile value.",
      },
      {
        kind: "must_preserve",
        text: "Keep canonical Agent Skills metadata values string-valued.",
      },
      {
        kind: "must_preserve",
        text: "Preserve the local declaration as blocked until a human confirms the policy.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the canonical field uses the documented exact encoding.",
      },
      {
        text: "Confirm inherited policy does not broaden the rejected local declaration.",
      },
    ],
    llmHint:
      "Inspect the exact metadata.renma.* evidence and ask for human confirmation of the intended policy before replacing it. Do not guess a permissive value.",
    confidence: "high",
    riskClass: "violation",
  },
  invalidRenmaPolicyMetadata: {
    id: DIAGNOSTIC_IDS.SEC_INVALID_RENMA_POLICY_METADATA,
    category: "safety",
    title: "Non-Skill Renma security metadata is invalid or ambiguous",
    whyItMatters:
      "An invalid local policy declaration must fail closed instead of inheriting a more permissive profile or repository value.",
    remediation:
      "Repair the YAML or replace the value only after confirming the intended policy. Do not recover authority from raw lines.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not guess the intended boolean, list, or profile value.",
      },
      {
        kind: "must_preserve",
        text: "Keep the exact non-Skill Renma frontmatter delimiter contract.",
      },
      {
        kind: "must_preserve",
        text: "Preserve the local declaration as blocked until a human confirms the policy.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the frontmatter is valid YAML with one declaration per recognized field.",
      },
      {
        text: "Confirm inherited policy does not broaden the rejected local declaration.",
      },
    ],
    llmHint:
      "Inspect the exact non-Skill frontmatter evidence and ask for human confirmation before repairing the rejected policy declaration. Do not infer a permissive value.",
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
    repairConstraints: [
      { kind: "allowed_change", text: "deterministic" },
      {
        kind: "allowed_change",
        text: "uses bounded workflow-scope and prohibition patterns",
      },
      {
        kind: "allowed_change",
        text: "does not perform general natural-language intent classification",
      },
    ],
    verificationStepsV2: [
      {
        text: "Run renma scan and confirm policy fields match the body instructions.",
        command: "renma scan",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not silently ignore profile references.",
      },
      {
        kind: "must_preserve",
        text: "Keep profile names deterministic and repo-local.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the referenced security profile exists in configuration.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not resolve cycles by choosing the least restrictive profile.",
      },
      {
        kind: "must_preserve",
        text: "Keep inherited policy chains short and explicit.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm profile inheritance resolves without revisiting the same profile.",
      },
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
    repairConstraints: [
      {
        kind: "allowed_change",
        text: "Artifact-local explicit denials remain strict.",
      },
      {
        kind: "must_not_change",
        text: "Do not weaken local restrictions through profile inheritance.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm inherited policy does not contradict explicit artifact denials.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not reinterpret forbidden inputs as allowed data.",
      },
      {
        kind: "must_preserve",
        text: "Keep profile data-class restrictions explicit.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the artifact no longer instructs agents to handle forbidden inputs.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not silently relax network, upload, or secret restrictions.",
      },
      {
        kind: "must_preserve",
        text: "Preserve the artifact's intended workflow where it can be made policy-compliant.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      { text: "Confirm no instruction conflicts with the declared policy." },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not replace approval with vague cautionary language.",
      },
      {
        kind: "must_preserve",
        text: "Keep the guard close to the sensitive instruction.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the sensitive action is guarded by nearby approval language.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not expose file contents in diagnostics.",
      },
      {
        kind: "must_preserve",
        text: "Keep allowlisted sample paths separate from real secret material.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm sensitive file references are removed, mocked, or protected by policy.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not include secret values in the repair.",
      },
      {
        kind: "allowed_change",
        text: "Prefer safe placeholders and redaction guidance.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm secret material is not requested for printing, copying, uploading, or context inclusion.",
      },
    ],
    llmHint:
      "Rewrite this instruction so secret-bearing files are never copied into prompts, logs, uploads, or diagnostics.",
    confidence: "high",
    riskClass: "violation",
  },
  hiddenOperationalInstruction: {
    id: DIAGNOSTIC_IDS.SEC_HIDDEN_OPERATIONAL_INSTRUCTION,
    category: "safety",
    title: "HTML comment contains a security-sensitive operational instruction",
    whyItMatters:
      "Markdown renderers hide HTML comments, but an agent that consumes the raw artifact can still read and follow security-sensitive instructions inside them.",
    remediation:
      "Remove the hidden instruction, or move an intentionally agent-facing instruction into visible Markdown with the applicable policy and safeguards.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not treat HTML comments as a place for operational instructions.",
      },
      {
        kind: "must_preserve",
        text: "Keep ordinary metadata, formatting, and explanatory comments non-operational.",
      },
      {
        kind: "must_not_change",
        text: "Do not weaken the underlying security policy to silence this finding.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the reported HTML comment no longer contains a recognized security-sensitive instruction.",
      },
      {
        text: "Confirm any retained operational instruction is visible and governed by the appropriate policy.",
      },
    ],
    llmHint:
      "Inspect only the reported HTML-comment span. Remove hidden operational wording or make the intended instruction visible with explicit policy and safeguards.",
    confidence: "high",
    riskClass: "suspicious",
  },
  hiddenFrontmatterInstruction: {
    id: DIAGNOSTIC_IDS.SEC_HIDDEN_FRONTMATTER_INSTRUCTION,
    category: "safety",
    title:
      "YAML frontmatter comment contains a security-sensitive operational instruction",
    whyItMatters:
      "Metadata consumers ignore YAML comments, but an agent that consumes the raw Skill can still read and follow security-sensitive instructions inside them.",
    remediation:
      "Remove the hidden instruction, or move an intentionally agent-facing instruction into visible Markdown with the applicable policy and safeguards.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not treat YAML frontmatter comments as a place for operational instructions.",
      },
      {
        kind: "must_preserve",
        text: "Keep ordinary metadata, formatting, and explanatory comments non-operational.",
      },
      {
        kind: "must_not_change",
        text: "Do not weaken the underlying security policy to silence this finding.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the reported YAML frontmatter comment no longer contains a recognized security-sensitive instruction.",
      },
      {
        text: "Confirm any retained operational instruction is visible and governed by the appropriate policy.",
      },
    ],
    llmHint:
      "Inspect only the reported YAML-comment span. Remove hidden operational wording or make the intended instruction visible with explicit policy and safeguards.",
    confidence: "high",
    riskClass: "suspicious",
  },
  externalUploadInstruction: {
    id: DIAGNOSTIC_IDS.SEC_EXTERNAL_UPLOAD_INSTRUCTION,
    category: "safety",
    title: "Instruction sends repository data to an external destination",
    whyItMatters:
      "External uploads can disclose proprietary code, logs, credentials, customer data, or unreleased operational details.",
    remediation:
      "Require explicit approval and destination review before uploading or sharing repository data externally.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not assume cloud or pastebin destinations are safe.",
      },
      {
        kind: "must_preserve",
        text: "Keep approved destinations explicit in policy metadata.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm uploads are either removed or guarded by explicit policy and approval.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not use fuzzy destination matching.",
      },
      {
        kind: "must_preserve",
        text: "Keep hostnames or URL prefixes explicit.",
      },
      {
        kind: "must_not_change",
        text: "Do not remove the network requirement, use broad wildcards, or move the declaration elsewhere only to silence this warning.",
      },
      {
        kind: "must_not_change",
        text: "Do not replace specific domains with broad wildcards unless the source documentation explicitly supports that exact scope.",
      },
      {
        kind: "must_preserve",
        text: "If the required domains are unknown, keep the issue visible and add a TODO with supporting references instead of guessing.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm every real external destination is represented by a specific approved network destination.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not treat general network approval as upload approval.",
      },
      {
        kind: "must_preserve",
        text: "Keep upload destinations explicit and deterministic.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      { text: "Confirm every upload destination is approved or removed." },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not ask an agent to paste entire repositories, logs, or context bundles.",
      },
      {
        kind: "allowed_change",
        text: "Prefer scoped evidence snippets over bulk data transfer.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm sharing instructions name a bounded, minimal data set.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not treat generic cloud storage as approved by default.",
      },
      { kind: "must_preserve", text: "Keep external upload policy explicit." },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      { text: "Confirm cloud uploads are removed, approved, or guarded." },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not introduce runtime context selection.",
      },
      {
        kind: "must_preserve",
        text: "Keep guidance deterministic and repository-local.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm context instructions are scoped and exclude sensitive material.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not weaken redaction requirements.",
      },
      {
        kind: "must_preserve",
        text: "Keep examples synthetic where possible.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm instructions require redaction where sensitive data may appear.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not weaken policy, verification, warnings, or approval requirements merely to make a workflow continue or diagnostics pass.",
      },
      {
        kind: "must_not_change",
        text: "Do not replace required approval with dry-run, backup, rollback, silence, timeout, or post-hoc review.",
      },
      {
        kind: "must_preserve",
        text: "Keep permission failures fail-closed and report unresolved authority instead of selecting a more dangerous fallback.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the bypass instruction is removed or rewritten as a fail-closed stop and report path.",
      },
      {
        text: "Confirm the original security policy and approval requirement remain at least as strict.",
      },
    ],
    llmHint:
      "Rewrite the instruction to preserve the safeguard, stop when approval or permission is unavailable, report the blocker, and rerun renma scan without adding a suppression or relaxing policy.",
    confidence: "high",
    riskClass: "violation",
  },
  riskyOperationErrorSuppression: {
    id: DIAGNOSTIC_IDS.SEC_RISKY_OPERATION_ERROR_SUPPRESSION,
    category: "safety",
    title: "Risky operation failure is explicitly suppressed",
    whyItMatters:
      "Hiding failure from a destructive, privileged, upload, or sensitive-data operation can make an agent continue after an incomplete, unsafe, or partially applied action.",
    remediation:
      "Preserve the failure, stop the workflow, and report the blocker. Add explicit verification and rollback guidance where a partial operation is possible.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not replace the reported failure path with another suppression or ignored exit status.",
      },
      {
        kind: "must_preserve",
        text: "Keep the underlying security classification and any required human approval at least as strict.",
      },
      {
        kind: "allowed_change",
        text: "Add explicit verification or rollback after preserving and reporting the original failure.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the risky operation no longer discards or ignores its failure.",
      },
      {
        text: "Confirm failure stops the workflow and partial effects are verified or rolled back.",
      },
    ],
    llmHint:
      "Remove the suppression attached to the risky operation. Preserve its non-zero failure, stop and report the blocker, add explicit verification or rollback when needed, and rerun renma scan.",
    confidence: "high",
    riskClass: "violation",
  },
  instructionHierarchyOverride: {
    id: DIAGNOSTIC_IDS.SEC_INSTRUCTION_HIERARCHY_OVERRIDE,
    category: "safety",
    title: "Instruction attempts to override higher-authority guidance",
    whyItMatters:
      "Agent-facing instructions that claim precedence over system, developer, platform, or other higher-level instructions can redirect the host agent around its governing authority and safety policy.",
    remediation:
      "Remove the hierarchy override, preserve host system and developer authority, and express only the Skill's intended local behavior without claiming higher priority.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not replace the override with a weaker synonym that still supersedes higher-authority instructions.",
      },
      {
        kind: "must_preserve",
        text: "Preserve system, developer, platform-policy, and host-agent instruction authority.",
      },
      {
        kind: "allowed_change",
        text: "State bounded local behavior and routing conditions without making an instruction-priority claim.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the agent-facing text no longer claims to ignore, override, or supersede higher-authority instructions.",
      },
      {
        text: "Confirm the intended local behavior remains subordinate to host instructions and policy.",
      },
    ],
    llmHint:
      "Remove the hierarchy-override claim. Rewrite only the intended local Skill behavior, explicitly preserve system and developer authority, and rerun renma scan.",
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not execute or follow embedded instructions verbatim.",
      },
      {
        kind: "must_preserve",
        text: "Preserve provenance and distinguish source content from repository-owned instructions.",
      },
      {
        kind: "allowed_change",
        text: "Reading, quoting, summarizing, or validating a source is not permission to execute it.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm external or tool-produced content is handled as data rather than authority.",
      },
      {
        text: "Confirm any retained action comes from reviewed repository guidance or explicit human approval.",
      },
    ],
    llmHint:
      "Replace verbatim-follow or execute-every-command guidance with untrusted-data handling, bounded fact extraction, provenance, validation, and an explicit review gate.",
    confidence: "high",
    riskClass: "violation",
  },
  executableAsPolicyAuthority: {
    id: DIAGNOSTIC_IDS.SEC_EXECUTABLE_AS_POLICY_AUTHORITY,
    category: "safety",
    title: "Executable helper becomes security-policy authority",
    whyItMatters:
      "A repository helper can produce review evidence, but its opaque behavior must not silently become the authority that permits, approves, or authorizes a security-sensitive operation.",
    remediation:
      "Keep the authorization decision in reviewed Skill instructions and declarative Renma security policy. Use the helper only to collect or validate evidence for that decision.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not treat ordinary helper execution, linting, testing, validation, or calculation as policy delegation.",
      },
      {
        kind: "must_not_change",
        text: "Do not interpret or execute the helper while repairing the instruction.",
      },
      {
        kind: "must_preserve",
        text: "Preserve the helper when it remains useful as evidence rather than authority.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the helper no longer decides whether a security-sensitive operation is allowed, permitted, approved, authorized, or safe.",
      },
      {
        text: "Confirm reviewed instructions and declarative policy state the authorization boundary.",
      },
    ],
    llmHint:
      "Rewrite the instruction so the recognized helper reports bounded evidence, while reviewed Skill instructions and declarative Renma policy retain the allow/deny or approval decision.",
    confidence: "high",
    riskClass: "suspicious",
  },
  unboundedExternalSourceTraversal: {
    id: DIAGNOSTIC_IDS.SEC_UNBOUNDED_EXTERNAL_SOURCE_TRAVERSAL,
    category: "safety",
    title: "Recursive external source traversal has no stated boundary",
    whyItMatters:
      "Unbounded traversal of links, issues, attachments, or related pages can expand scope unpredictably, revisit cycles, consume excessive resources, and expose an agent to unrelated or malicious content.",
    remediation:
      "Define source and relevance scope, logical identity and visited handling, depth or count limits, failure stop conditions, and unresolved-scope reporting in the same bounded section.",
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not make Renma crawl sources or enforce traversal at runtime.",
      },
      {
        kind: "must_not_change",
        text: "Do not treat one named source read as recursive traversal.",
      },
      {
        kind: "must_preserve",
        text: "Keep traversal bounds local to the instruction they govern.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm recursive traversal is removed or has explicit local scope and termination boundaries.",
      },
      {
        text: "Confirm cycles, failures, and unresolved scope have deterministic handling guidance.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not execute the remote script during remediation.",
      },
      { kind: "must_preserve", text: "Keep install guidance reproducible." },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm remote script execution is removed or pinned with verification.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Check repository evidence and the intended support matrix before selecting a package version, formula version, image tag, or digest; never invent one.",
      },
      {
        kind: "must_preserve",
        text: "Preserve existing package-manager, Homebrew, and container-image conventions.",
      },
      {
        kind: "must_not_change",
        text: "Use fail-closed variables only in structurally supported forms, and never use npm/PyPI floating-selector allowances to suppress Homebrew or Docker findings.",
      },
      {
        kind: "must_not_change",
        text: "Do not claim that uninspected manifests, lockfiles, requirements files, constraints files, or other dependency sources were verified.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm structured npm/PyPI installs use reviewed exact selectors, structurally accepted fail-closed variables, or exact asset-local npm:/pypi: floating-selector approvals.",
      },
      {
        text: "Confirm Homebrew formulas use a supported versioned formula when repository conventions permit it, and container images use an explicit non-floating tag or immutable digest.",
      },
      {
        text: "Confirm no value was invented and no uninspected dependency source is described as verified.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not normalize privileged commands as routine setup.",
      },
      { kind: "must_preserve", text: "Keep the guard close to the command." },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm privileged commands require approval or have been removed.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not reinterpret the quoted literal as an operational instruction solely to raise severity.",
      },
      {
        kind: "must_not_change",
        text: "Do not automatically rewrite an owner-authored description.",
      },
      {
        kind: "must_preserve",
        text: "Keep real operational text visible to the existing security diagnostics.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm the description contains capabilities and selection boundaries rather than a concrete high-risk payload.",
      },
      {
        text: "If exact evidence is necessary, confirm it is in a clearly non-operational Skill body section.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not normalize destructive commands as routine setup.",
      },
      {
        kind: "must_preserve",
        text: "Keep any required destructive action narrowly scoped.",
      },
      {
        kind: "must_preserve",
        text: "Keep approval and recovery guidance close to the command.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      { text: "Confirm destructive commands are removed or guarded." },
      {
        text: "Review any remaining command for scope, backup, and rollback guidance.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not bypass the configured disallowed command list.",
      },
      {
        kind: "must_preserve",
        text: "Keep any replacement workflow deterministic and reviewable.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm disallowed command instructions have been removed or rewritten.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not preserve literal credential examples.",
      },
      {
        kind: "allowed_change",
        text: "Use placeholders only when examples are necessary.",
      },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm command examples do not include token, password, key, or certificate values.",
      },
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
    repairConstraints: [
      {
        kind: "must_not_change",
        text: "Do not put sensitive material in shared /tmp paths.",
      },
      { kind: "must_preserve", text: "Keep cleanup instructions explicit." },
    ],
    verificationStepsV2: [
      { text: "Run renma scan.", command: "renma scan" },
      {
        text: "Confirm sensitive temporary paths are randomized, scoped, and cleaned up.",
      },
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
// Defensive-action polarity rejects only these explicit permissive claims;
// the broader weak-guard vocabulary above is not interchangeable here.
const PERMISSIVE_APPROVAL_CLAIM_RE =
  /\b(no approval is needed|approved by default|safe to run)\b/i;
const RECOVERY_GUARD_RE =
  /\b(create|make|take|keep|verify|confirm|document|check|use|run)\b.{0,40}\b(backup|rollback|roll back|restore|dry[- ]run|revert)\b|\b(backup|rollback|roll back|restore|dry[- ]run|revert)\b.{0,40}\b(first|before|steps?|plan|guidance|confirm|verify|check)\b/i;
const SECRET_WORD_RE =
  /\b(secret|secrets|credential|credentials|token|password|passwd|api key|apikey|private key|ssh key|signing key|certificate|cert|auth)\b/i;
const SECRET_ACTION_RE =
  /\b(copy|print|cat|echo|paste|upload|send|share|attach|include|dump|export|log|summari[sz]e)\b/i;
// Policy eligibility includes local acquisition verbs such as `read` and
// `collect`; SECRET_ACTION_RE is narrower because it recognizes disclosure.
const POLICY_RELEVANT_SENSITIVE_MATERIAL_ACTION_RE =
  /\b(read|collect|copy|print|cat|echo|paste|upload|send|share|attach|include|dump|export|log|load|provide)\b/i;
const SAFE_NEGATION_RE =
  /\b(not|never|avoid|exclude|without|redact|mock|fake|sample|placeholder|dummy)\b.{0,40}\b(secret|secrets|credential|credentials|token|password|private key)\b|\b(secret|secrets|credential|credentials|token|password|private key)\b.{0,40}\b(not|never|avoid|exclude|redact|mock|fake|sample|placeholder|dummy)\b/i;
const SENSITIVE_DISCLOSURE_PROHIBITION_BEFORE_ACTION_RE =
  /\b(never|do not|don't|avoid|exclude|skip)\b.{0,50}\b(upload|send|share|attach|copy|paste|include|print|cat|echo|log|dump)\b/i;
const SENSITIVE_DISCLOSURE_ACTION_BEFORE_PROHIBITION_RE =
  /\b(upload|send|share|attach|copy|paste|include|print|cat|echo|log|dump)\b.{0,50}\b(never|do not|don't|avoid|exclude|skip)\b/i;
const DEFENSIVE_ACTION_RE =
  /\b(do\s+not|don't|never|avoid|exclude|skip|omit|forbid|forbidden|disallow|block)\b.{0,80}\b(upload|send|post|put|share|attach|submit|sync|push|publish|copy|paste|include|print|cat|echo|log|dump|curl|wget|pipe|bash|sh|sudo|chmod|chown|rm\s+-|git\s+reset|git\s+clean|delete|install|add)\b/i;
const GUARDED_ACTION_RE =
  /\b(only|unless|after|with|before)\b.{0,80}\b(approval|approved|confirmation|confirm|human review|maintainer review|redact|redacted|redaction|dry[- ]run|backup|rollback)\b|\b(redact|redacted|redaction|approval|approved|confirmation|confirm|human review|maintainer review|dry[- ]run|backup|rollback)\b.{0,80}\b(before|after|upload|send|post|put|share|sudo|rm\s+-|git\s+reset|git\s+clean|delete|install|add)\b/i;
const REMOTE_SCRIPT_RE =
  /\b(curl|wget)\b[^\n]*?(https?:\/\/[^\s|`'")]+)[^\n]*\|\s*(sh|bash|zsh)\b/i;
const PRIVILEGED_SHELL_COMMAND_DEFINITIONS = [
  ["sudo", String.raw`sudo`],
  ["chmod", String.raw`chmod\s+(?:777|666|\+w|a\+w)`],
  ["chown", String.raw`chown`],
  [
    "docker",
    String.raw`docker\s+run\b[^\n]*(?:--privileged|-v\s+\/|--pid=host)`,
  ],
  ["mount", String.raw`mount`],
  ["launchctl", String.raw`launchctl`],
  ["systemctl", String.raw`systemctl`],
] as const;
const DESTRUCTIVE_SHELL_COMMAND_DEFINITIONS = [
  ["rm", String.raw`rm\s+-[^\n]*[rf][^\n]*`],
  ["git", String.raw`git\s+reset\s+--hard|git\s+clean\s+-[^\n]*[xdf][^\n]*`],
  ["docker", String.raw`docker\s+(?:rm|rmi|system\s+prune|volume\s+rm)\b`],
  ["kubectl", String.raw`kubectl\s+delete\b`],
  ["drop", String.raw`drop\s+database`],
  ["truncate", String.raw`truncate\s+table`],
] as const;
const PRIVILEGED_SHELL_COMMAND_PATTERNS = shellCommandRiskPatterns(
  PRIVILEGED_SHELL_COMMAND_DEFINITIONS,
);
const DESTRUCTIVE_SHELL_COMMAND_PATTERNS = shellCommandRiskPatterns(
  DESTRUCTIVE_SHELL_COMMAND_DEFINITIONS,
);
const PRIVILEGED_COMMAND_RE = shellCommandRiskFallbackPattern(
  PRIVILEGED_SHELL_COMMAND_DEFINITIONS,
);
const DESTRUCTIVE_COMMAND_RE = shellCommandRiskFallbackPattern(
  DESTRUCTIVE_SHELL_COMMAND_DEFINITIONS,
);
const CREDENTIAL_ARG_RE =
  /--?(token|password|passwd|secret|credential|api[-_]?key|key|cert|certificate|signing[-_]?key|auth)(=|\s+)(?!<|\$|\{|\[|REDACTED|redacted|xxx|XXX|placeholder|example)[^\s"'`]+/i;
const CREDENTIAL_ARG_ANY_RE =
  /--?(token|password|passwd|secret|credential|api[-_]?key|key|cert|certificate|signing[-_]?key|auth)(=|\s+)[^\s"'`]+/i;
const CREDENTIAL_HEADER_RE =
  /\bAuthorization:\s*Bearer\s+(?!<|\$|\{|\[|REDACTED|redacted|xxx|XXX|placeholder|example)[^\s"'`]+/i;
const PREDICTABLE_TEMP_RE = /\/tmp\/[A-Za-z0-9._/-]+/;
const PREDICTABLE_TEMP_GLOBAL_RE = /\/tmp\/[A-Za-z0-9._/-]+/g;

type RiskyOperationKind =
  | "destructive-command"
  | "privileged-command"
  | "security-sensitive-upload"
  | "sensitive-data-operation";

type RiskyShellFailureSuppression = {
  start: number;
  suppression: "|| true" | "|| :";
  operationKinds: RiskyOperationKind[];
};

// These forms intentionally require a recognized risky-operation class and a
// bounded, explicit ignore-failure continuation. Generic error handling and
// generic `|| true` remain outside this diagnostic.
const RISKY_OPERATION_PROSE_TARGET_SOURCE = String.raw`(?:destructive|privileged|security[- ]sensitive|sensitive[- ]data)\s+(?:operation|command|action)|external\s+upload(?:\s+(?:operation|command|action))?|sudo\s+(?:operation|command|invocation)`;
const RISKY_OPERATION_FAILURE_SOURCE = String.raw`(?:fails?|failed|failure|errors?|returns?\s+(?:a\s+)?non[- ]zero\s+(?:status|exit(?:\s+status)?))`;
const RISKY_OPERATION_SUPPRESSION_SOURCE = String.raw`(?:ignore|disregard|suppress)`;
const RISKY_OPERATION_CONTINUATION_SOURCE = String.raw`(?:continue|proceed)`;
const RISKY_OPERATION_ERROR_TARGET_SOURCE = String.raw`(?:the\s+)?(?:errors?|failures?|non[- ]zero\s+(?:status|exit(?:\s+status)?))`;
const LOCAL_INSTRUCTION_TEXT_SOURCE = String.raw`[^.;:!?—–\n\r]`;
const RISKY_OPERATION_FAILURE_SUPPRESSION_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:if|when)\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,60}\b(?:${RISKY_OPERATION_PROSE_TARGET_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,50}\b(?:${RISKY_OPERATION_FAILURE_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,80}\b(?:${RISKY_OPERATION_SUPPRESSION_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,40}\b(?:${RISKY_OPERATION_ERROR_TARGET_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,60}\b(?:and\s+)?(?:${RISKY_OPERATION_CONTINUATION_SOURCE})\b`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:${RISKY_OPERATION_SUPPRESSION_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,40}\b(?:${RISKY_OPERATION_ERROR_TARGET_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,60}\b(?:from|of)\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,60}\b(?:${RISKY_OPERATION_PROSE_TARGET_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,60}\b(?:and\s+)?(?:${RISKY_OPERATION_CONTINUATION_SOURCE})\b`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:if|when)\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,60}\b(?:${RISKY_OPERATION_PROSE_TARGET_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,50}\b(?:${RISKY_OPERATION_FAILURE_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,80}\b(?:${RISKY_OPERATION_CONTINUATION_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,40}\b(?:and\s+|then\s+)?(?:${RISKY_OPERATION_SUPPRESSION_SOURCE})\b${LOCAL_INSTRUCTION_TEXT_SOURCE}{0,40}\b(?:${RISKY_OPERATION_ERROR_TARGET_SOURCE})\b`,
    "i",
  ),
];
const RISKY_OPERATION_SUPPRESSION_ACTION_RE =
  /^(?:ignore|disregard|suppress)/iu;

// This is an intentionally small English grammar. It recognizes explicit
// authority supersession, not persona statements or broad prompt injection.
const INSTRUCTION_AUTHORITY_TARGET_SOURCE = String.raw`(?:(?:all|any|every)\s+)?(?:previous|prior|earlier|preceding)(?:\s+(?:(?:system|developer)(?:\s*(?:or|and|\/)\s*(?:system|developer))?|higher[- ]level|platform|host[- ]agent))?\s+(?:safety\s+)?(?:instructions?|prompts?)|(?:system|developer)(?:\s*(?:or|and|\/)\s*(?:system|developer))?\s+(?:instructions?|prompts?)|higher[- ](?:level|authority)\s+(?:safety\s+)?instructions?|platform\s+(?:policy|policies|instructions?)|host[- ]agent\s+(?:instruction\s+hierarchy|instructions?)`;
const INSTRUCTION_HIERARCHY_OVERRIDE_ACTION_SOURCE = String.raw`(?:ignore(?:s|ing)?|disregard(?:s|ing)?|override(?:s|ing)?|supersede(?:s|ing)?)`;
const DIRECT_INSTRUCTION_HIERARCHY_OVERRIDE_RE = new RegExp(
  String.raw`\b(?:${INSTRUCTION_HIERARCHY_OVERRIDE_ACTION_SOURCE})\b[\t ]{1,16}(?:the\s+)?(?:${INSTRUCTION_AUTHORITY_TARGET_SOURCE})\b`,
  "i",
);
const PRECEDENCE_INSTRUCTION_HIERARCHY_OVERRIDE_RE = new RegExp(
  String.raw`\b(?:takes?\s+precedence\s+over|override(?:s|ing)?|supersede(?:s|ing)?)\b[\t ]{1,16}(?:the\s+)?(?:${INSTRUCTION_AUTHORITY_TARGET_SOURCE})\b`,
  "i",
);
const INSTRUCTION_HIERARCHY_OVERRIDE_ACTION_RE =
  /^(?:ignore(?:s|ing)?|disregard(?:s|ing)?|override(?:s|ing)?|supersede(?:s|ing)?|takes?\s+precedence\s+over)/iu;
const INSTRUCTION_HIERARCHY_OVERRIDE_NEGATION_RE =
  /\b(?:cannot|can't|can not|can\s+never|may\s+not|(?:do|does|did) not|don't|doesn't|didn't|(?:will|would) not|won't|wouldn't|(?:is|are|was|were) (?:unable to|not able to|not (?:allowed|permitted|authorized) to))(?:\s+(?:ever|possibly|legitimately|lawfully|safely|actually))*\s*$/iu;
const INSTRUCTION_HIERARCHY_ACTOR_SOURCE = String.raw`(?:skills?|rules?|polic(?:y|ies)|instructions?|guidance|workflows?|agents?|helpers?)`;
const INSTRUCTION_HIERARCHY_ACTOR_REFERENCE_SOURCE = String.raw`(?:(?:(?:this|that|the|any|a|an|local|lower[- ]level|agent-facing)\s+){0,3}${INSTRUCTION_HIERARCHY_ACTOR_SOURCE})`;
const INSTRUCTION_HIERARCHY_NEGATED_MODAL_SOURCE = String.raw`(?:may|can|will|should|must)(?:\s+(?:ever|possibly|legitimately|lawfully|safely|actually))*`;
const NEGATED_ACTOR_ACTION_SUBJECT_RE = new RegExp(
  String.raw`(?:^|\b)(?:no\s+${INSTRUCTION_HIERARCHY_ACTOR_REFERENCE_SOURCE}\s+(?:${INSTRUCTION_HIERARCHY_NEGATED_MODAL_SOURCE}|(?:is|are|was|were)\s+(?:allowed|permitted|authorized)\s+to)|neither\s+${INSTRUCTION_HIERARCHY_ACTOR_REFERENCE_SOURCE}\s+nor\s+(?:its\s+)?${INSTRUCTION_HIERARCHY_ACTOR_REFERENCE_SOURCE}\s+${INSTRUCTION_HIERARCHY_NEGATED_MODAL_SOURCE}|(?:nothing|neither\s+${INSTRUCTION_HIERARCHY_ACTOR_SOURCE})\s+${INSTRUCTION_HIERARCHY_NEGATED_MODAL_SOURCE}|under\s+no\s+circumstances\s+${INSTRUCTION_HIERARCHY_NEGATED_MODAL_SOURCE}\s+${INSTRUCTION_HIERARCHY_ACTOR_REFERENCE_SOURCE}|it\s+is\s+(?:forbidden|prohibited|not\s+(?:allowed|permitted|authorized))\s+for\s+${INSTRUCTION_HIERARCHY_ACTOR_REFERENCE_SOURCE}\s+to)\s*$`,
  "i",
);
const INSTRUCTION_HIERARCHY_ATTRIBUTION_SUBJECT_SOURCE = String.raw`(?:documentation|docs?|reviewer|maintainer|(?:incident|audit|review)(?:\s+report)?)`;
const INSTRUCTION_HIERARCHY_ATTRIBUTION_VERB_SOURCE = String.raw`(?:says?|states?|reads?|contains?|quotes?|not(?:e|es|ed|ing)|documents?|records?|explains?)`;
const INSTRUCTION_HIERARCHY_DISCUSSION_QUOTE_SOURCE = [
  String.raw`"[^"\n\r]{0,160}`,
  String.raw`'[^'\n\r]{0,160}`,
  String.raw`\u0060[^\u0060\n\r]{0,160}`,
  String.raw`“[^”\n\r]{0,160}`,
  String.raw`‘[^’\n\r]{0,160}`,
].join("|");
const INSTRUCTION_HIERARCHY_QUOTED_DISCUSSION_PREFIX_RE = new RegExp(
  String.raw`(?:\bfor\s+example\s*,?|\bthe\s+(?:phrase|statement|prompt)|\b(?:(?:(?:the|a)\s+)?${INSTRUCTION_HIERARCHY_ATTRIBUTION_SUBJECT_SOURCE})\s+${INSTRUCTION_HIERARCHY_ATTRIBUTION_VERB_SOURCE}\b\s*(?:[:,])?)\s*(?:${INSTRUCTION_HIERARCHY_DISCUSSION_QUOTE_SOURCE})$`,
  "i",
);
const INSTRUCTION_HIERARCHY_ATTRIBUTED_TEXT_SOURCE = String.raw`(?:(?!\b(?:but|then|however|therefore|yet|so)\b)[^,.;:!?—–\n\r])`;
const INSTRUCTION_HIERARCHY_DISCUSSION_PREFIX_RE = new RegExp(
  String.raw`\bfor\s+example\s*,?\s*(?:["'\u0060“‘]\s*)?$|\bthe\s+(?:phrase|statement|prompt)\s+["'\u0060“‘]\s*$|\b(?:(?:(?:the|a)\s+)?${INSTRUCTION_HIERARCHY_ATTRIBUTION_SUBJECT_SOURCE})\s+${INSTRUCTION_HIERARCHY_ATTRIBUTION_VERB_SOURCE}\b\s*(?:[:,]\s*)?${INSTRUCTION_HIERARCHY_ATTRIBUTED_TEXT_SOURCE}{0,120}(?:["'\u0060“‘]\s*)?$|\baccording\s+to\s+(?:(?:the|an?)\s+)?${INSTRUCTION_HIERARCHY_ATTRIBUTION_SUBJECT_SOURCE}\b\s*,?\s*${INSTRUCTION_HIERARCHY_ATTRIBUTED_TEXT_SOURCE}{0,120}$`,
  "i",
);
const INSTRUCTION_HIERARCHY_FINITE_SUBJECT_SOURCE = String.raw`(?:i|you|he|she|it|we|they|(?:(?:this|that|these|those|the|a|an|local|lower[- ]level|agent-facing)\s+){0,3}${INSTRUCTION_HIERARCHY_ACTOR_SOURCE})`;
const INSTRUCTION_HIERARCHY_INDEPENDENT_CONTINUATION_SOURCE = String.raw`(?:${INSTRUCTION_HIERARCHY_FINITE_SUBJECT_SOURCE}\s+${INSTRUCTION_HIERARCHY_NEGATED_MODAL_SOURCE}|${INSTRUCTION_HIERARCHY_OVERRIDE_ACTION_SOURCE})`;
const QUALIFIED_NEGATED_ACTOR_ACTION_SUBJECT_RE = new RegExp(
  String.raw`^\s*no\s+${INSTRUCTION_HIERARCHY_ACTOR_REFERENCE_SOURCE}\s+(?:(?:in|within|under|that|which|who)\b)(?:(?!\b(?:but|then|however|therefore|yet|so)\b\s*(?:${INSTRUCTION_HIERARCHY_INDEPENDENT_CONTINUATION_SOURCE})\b)[^,.;:!?—–\n\r]){0,60}\s+${INSTRUCTION_HIERARCHY_NEGATED_MODAL_SOURCE}\s*$`,
  "i",
);
const INSTRUCTION_HIERARCHY_QUESTION_SUBJECT_RE =
  /^\s*(?:do|does|did|can|could|should|would|will|may|must|is|are)\s+(?:(?:this|these|a|an|the)\s+)?(?:local\s+)?(?:skill|rule|policy|instructions?|guidance|system|developer|platform|higher[- ]level|host[- ]agent)\b[^.!?;:—–\n\r]{0,100}$/iu;
const INSTRUCTION_HIERARCHY_INDIRECT_QUESTION_PREFIX_RE =
  /^\s*(?:(?:verify|determine|check|assess|document|explain)\s+(?:whether|if)\b|explain\s+why\s+(?:(?:this|these|a|an|the)\s+)?(?:local\s+)?(?:skill|rule|policy|instructions?|guidance|system|developer|platform|higher[- ]level|host[- ]agent)\b)[^,.!?;:—–\n\r]{0,120}$/iu;

type SafeguardBypassPattern = {
  pattern: RegExp;
  /** Presence opts this pattern into bounded immediate next-clause association. */
  immediateContinuationCondition?: RegExp;
  /** Only selected condition families treat restored approval as defensive. */
  restoredApprovalGuardCanExempt?: boolean;
};

// These bounds keep each family within a reviewable local statement. They are
// intentional grammar limits, not an attempt at synonym or coreference coverage.
const SAFEGUARD_CONTROL_TARGET_SOURCE = String.raw`security checks?|security policy|security profile|safeguards?|guardrails?|human approval|approval|confirmation|authorization|security warnings?|warnings?|diagnostics?|verification|validation`;
const SAFEGUARD_CONTINUATION_ACTION_SOURCE = String.raw`continue|proceed|execute|run|apply|upload|delete|publish`;
const DIRECT_SAFEGUARD_DISABLEMENT_RE = new RegExp(
  String.raw`\b(ignore|bypass|circumvent|skip|omit|disabl(?:e|ing)|deactivat(?:e|ing)|turn off|suppress(?:ed|ing)?)\b.{0,100}\b(${SAFEGUARD_CONTROL_TARGET_SOURCE})\b`,
  "i",
);
const SAFEGUARD_FIRST_DISABLEMENT_RE = new RegExp(
  String.raw`\b(${SAFEGUARD_CONTROL_TARGET_SOURCE})\b.{0,100}\b(ignore[ds]?|bypass(?:ed)?|circumvent(?:ed)?|skip(?:ped)?|omit(?:ted)?|disabl(?:e|ed|ing)|deactivat(?:e|ed|ing)|turn(?:ed)? off|suppress(?:ed|ion|ing)?)\b`,
  "i",
);
const ACTION_WITHOUT_APPROVAL_RE = new RegExp(
  String.raw`\b(${SAFEGUARD_CONTINUATION_ACTION_SOURCE})\b.{0,80}\b(without|despite (?:missing|unavailable)|even (?:if|when) (?:there is )?no)\b.{0,60}\b(approval|confirmation|authorization|review|verification)\b`,
  "i",
);
const MISSING_APPROVAL_CONTINUATION_RE = new RegExp(
  String.raw`\b(if|when)\b.{0,80}\b(approval|confirmation|authorization|review|user response|human response)\b.{0,80}\b(unavailable|missing|cannot be obtained|can't be obtained|times? out|no response)\b.{0,100}\b(${SAFEGUARD_CONTINUATION_ACTION_SOURCE})\b`,
  "i",
);
const POLICY_WEAKENING_TO_SILENCE_DIAGNOSTICS_RE =
  /\b(weaken|relax|lower|loosen|override|change)\b.{0,80}\b(security policy|security profile|policy|restrictions?|rules?)\b.{0,80}\b(pass|silence|clear|avoid)\b.{0,40}\b(diagnostics?|checks?|scan|warnings?)\b/i;
const POST_HOC_APPROVAL_RE =
  /\b(obtain|request|record|seek|get|ask for)\b.{0,30}\b(approval|confirmation|authorization|review)\b.{0,40}\b(afterward|later|retroactively|post[- ]hoc|after the (?:action|operation|upload|change))\b|\b(approval|confirmation|authorization|review)\b.{0,30}\b(can|may|will|should)\b.{0,20}\b(obtained|requested|recorded|given)\b.{0,30}\b(afterward|later|retroactively|post[- ]hoc)\b/i;
const RISKIER_PERMISSION_FALLBACK_RE =
  /\b(if|when)\b.{0,100}\b(permission|permissions|access)\b.{0,60}\b(denied|unavailable|insufficient|missing)\b.{0,100}\b(fall back|fallback|switch|retry|use)\b.{0,60}\b(sudo|privileged|force|insecure|unsafe|less safe|broader access)\b/i;
const HUMAN_NONRESPONSE_AUTOMATIC_ACTION_RE =
  /\b(if|when)\b.{0,100}\b(user|human|owner|reviewer)\b.{0,60}\b(does not|doesn't|fails? to|never)\b.{0,30}\b(respond|reply|confirm|approve)\b.{0,100}\b(automatically|by default|continue|proceed|execute|run|apply|upload|delete|publish)\b/i;
const SUPPRESSION_TO_PASS_DIAGNOSTICS_RE =
  /\b(add|create|use)\b.{0,24}\b(?:a\s+)?suppression\b.{0,60}\b(pass|silence|clear|avoid)\b.{0,30}\b(diagnostics?|checks?|scan|warnings?|validation)\b/i;

/** Bounded missing-approval or missing-review condition before an action. */
const MISSING_APPROVAL_CONDITION_RE =
  /\b(?:if|when)\b[^.;:!?—–\n\r]{0,80}\b(?:approval|confirmation|authorization|review|user response|human response)\b[^.;:!?—–\n\r]{0,80}\b(?:unavailable|missing|cannot be obtained|can't be obtained|times? out|no response)\b/iu;
/** Bounded permission or access failure condition before a privileged fallback. */
const PERMISSION_OR_ACCESS_FAILURE_CONDITION_RE =
  /\b(?:if|when)\b[^.;:!?—–\n\r]{0,100}\b(?:permission|permissions|access)\b[^.;:!?—–\n\r]{0,60}\b(?:denied|unavailable|insufficient|missing)\b/iu;
/** Bounded human nonresponse or nonapproval condition before a default action. */
const HUMAN_NONRESPONSE_CONDITION_RE =
  /\b(?:if|when)\b[^.;:!?—–\n\r]{0,100}\b(?:user|human|owner|reviewer)\b[^.;:!?—–\n\r]{0,60}\b(?:does not|doesn't|fails? to|never)\b[^.;:!?—–\n\r]{0,30}\b(?:respond|reply|confirm|approve)\b/iu;
const SAFEGUARD_BYPASS_PATTERNS: readonly SafeguardBypassPattern[] = [
  {
    pattern: DIRECT_SAFEGUARD_DISABLEMENT_RE,
  },
  {
    pattern: SAFEGUARD_FIRST_DISABLEMENT_RE,
  },
  {
    pattern: ACTION_WITHOUT_APPROVAL_RE,
  },
  {
    pattern: MISSING_APPROVAL_CONTINUATION_RE,
    immediateContinuationCondition: MISSING_APPROVAL_CONDITION_RE,
    restoredApprovalGuardCanExempt: true,
  },
  {
    pattern: POLICY_WEAKENING_TO_SILENCE_DIAGNOSTICS_RE,
  },
  {
    pattern: POST_HOC_APPROVAL_RE,
  },
  {
    pattern: RISKIER_PERMISSION_FALLBACK_RE,
    immediateContinuationCondition: PERMISSION_OR_ACCESS_FAILURE_CONDITION_RE,
    // A riskier permission fallback remains fail-closed even when its action
    // clause adds approval wording; restored approval is not a safe fallback.
    restoredApprovalGuardCanExempt: false,
  },
  {
    pattern: HUMAN_NONRESPONSE_AUTOMATIC_ACTION_RE,
    immediateContinuationCondition: HUMAN_NONRESPONSE_CONDITION_RE,
    restoredApprovalGuardCanExempt: false,
  },
  {
    pattern: SUPPRESSION_TO_PASS_DIAGNOSTICS_RE,
  },
];
const SAFEGUARD_ACTION_PREDICATE_RE =
  /(?<![\p{L}\p{N}_-])(ignore[ds]?|disregard(?:s|ed|ing)?|bypass(?:ed)?|circumvent(?:ed)?|skip(?:ped)?|omit(?:ted)?|disabl(?:e|ed|ing)|deactivat(?:e|ed|ing)|turn(?:ed)? off|suppress(?:es|ed|ing)?|continue|proceed|execute|run|apply|upload|delete|publish|weaken|relax|lower|loosen|override(?:s|ing)?|supersede(?:s|d|ing)?|takes?\s+precedence\s+over|change|obtain(?:ed)?|request(?:ed)?|record(?:ed)?|seek|get|ask for|fall back|fallback|switch|retry|use|add|create|automatically)\b/giu;
const SAFEGUARD_PROHIBITION_RE =
  /\b(do not|don't|never|avoid|must not|should not|prohibit|forbid)\b/giu;
const SAFEGUARD_HARD_SCOPE_BOUNDARY_RE = /[.;:!?—–\n\r]/u;
const SAFEGUARD_IMMEDIATE_CLAUSE_SEPARATOR_RE = /^[\s,.;:!?—–]+$/u;
const SAFEGUARD_GRAMMATICAL_SCOPE_BOUNDARY_RE =
  /\b(?:if|when|unless|although|though|whereas|while|because|but|however|instead|otherwise|then|fallback|fall back)\b/iu;
// A subject followed by a finite auxiliary/copula starts a new clause; a
// trailing `to` in that clause does not make it a dependent purpose complement.
const SAFEGUARD_FINITE_CLAUSE_RE =
  /(?:^|\s)(?:(?:i|you|he|she|it|we|they|this|that|these|those)\b|(?:the|a|an)\s+[\p{L}\p{N}_-]+\b)\s+(?:am|is|are|was|were|be|being|been|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would)\b/iu;
const SAFEGUARD_COMMA_ONLY_COORDINATION_BRIDGE_RE = /^\s*,\s*$/u;
const SAFEGUARD_TRAILING_LIST_COMMA_BRIDGE_RE = /^[^,]{1,70},\s*$/u;
const SAFEGUARD_CONJUNCTION_COORDINATION_BRIDGE_RE =
  /^[^,]{0,70}(?:,\s*)?(?:and|or|nor)\s*$/iu;
const SAFEGUARD_INFINITIVAL_PURPOSE_BRIDGE_RE =
  /\b(?:(?:merely|only)\s+to|(?:in\s+order|so\s+as)\s+to|to)\s*$/iu;
const DIRECT_DEFENSIVE_SEMANTIC_RE =
  /\b(do not|don't|never|avoid|must not|should not|prohibit|forbid)\b.{0,24}\b(ignore|bypass|circumvent|skip|omit|disable|deactivate|turn off|suppress|weaken|relax|continue|proceed|execute|run|apply|follow|obey|adopt|treat)\b/i;
const UNTRUSTED_CONTENT_SOURCE_RE =
  /\b(external (?:page|site|document|source|content|instructions?)|issue body|issue description|logs?|tool output|command output|attachment|downloaded (?:file|markdown|document|instructions?)|fetched (?:page|markdown|document|content|instructions?)|retrieved (?:page|document|content|instructions?))\b/i;
// Bounds associate the source and action within one local instruction while
// deliberately stopping short of general natural-language coreference.
const UNTRUSTED_EXECUTION_ACTION_RE =
  /\b(execute|run|apply|follow|obey|adopt)\b.{0,80}?\b(every command|all commands?|instructions?|steps?|verbatim|exactly|without review)\b|\b(treat|regard|accept)\b.{0,80}?\b(authoritative|trusted instructions?|commands?|executable guidance)\b|\b(follow|obey|execute|run|apply)\b.{0,50}?\b(it|them|the content|the instructions?)\b.{0,40}?\b(verbatim|exactly|without review)\b/i;
const UNTRUSTED_ACTION_VERB_RE =
  /\b(execute|executing|run|running|apply|applying|follow|following|obey|obeying|adopt|adopting|treat|regard|accept)\b/i;
const EXECUTABLE_POLICY_AUTHORITY_DELEGATION_RE =
  /^[\s`*_).,:;\]–—-]{0,24}(?:(?:(?:and\s+)?use\s+(?:its|the\s+helper(?:'s)?)\s+(?:result|output|exit\s+code)\s+to)|to)\s+(?<decision>(?:determine|decide|establish)\s+(?:if|whether)\b.{0,160}?\b(?:is|are|would\s+be|may\s+be|can\s+be)\s+(?:allowed|permitted|approved|authorized|safe)\b)/i;
const EXECUTABLE_POLICY_AUTHORITY_SECURITY_CONCEPT_RE = new RegExp(
  [
    String.raw`\b(?:uploads?|uploading|uploaded)\b`,
    String.raw`\b(?:sends?|sending|sent|posts?|posting|posted|shares?|sharing|shared|attaches?|attaching|attached|submits?|submitting|submitted|syncs?|syncing|synced|pushes?|pushing|pushed|publishes?|publishing|published)\b.{0,80}\b(?:secrets?|credentials?|tokens?|private[ -]keys?|\.env|environment[ -]files?|repository[ -]data|source[ -]code|private[ -]data|sensitive[ -]data|externally|publicly|third[ -]part(?:y|ies)|remote(?:ly)?)\b`,
    String.raw`\b(?:network|internet)[ -](?:access|use|usage|connection|requests?)\b`,
    String.raw`\b(?:access(?:es|ed|ing)?|reads?|reading|read|writes?|writing|wrote|copies?|copying|copied|stores?|storing|stored|logs?|logging|logged|prints?|printing|printed|exposes?|exposing|exposed|discloses?|disclosing|disclosed|uses?|using|used|handles?|handling|handled|deletes?|deleting|deleted|rotates?|rotating|rotated)\b.{0,80}\b(?:secrets?|credentials?|tokens?|private[ -]keys?|\.env|environment[ -]files?)\b`,
    String.raw`\b(?:security|privacy|authorization)[ -]policy\b|\baccess[ -]control\b`,
  ].join("|"),
  "i",
);
const REVIEW_VOCABULARY_SOURCE = String.raw`(?:review(?:s|ed|ing|ers?)?|validat(?:e|es|ed|ing|ion)|verif(?:y|ies|ied|ying|ication)|inspect(?:s|ed|ing|ion)?|check(?:s|ed|ing)?)`;
const UNTRUSTED_REVIEW_ORDERING_SOURCE = String.raw`before|prior to`;
const UNTRUSTED_REVIEW_TARGET_ACTION_SOURCE = String.raw`execute|executing|run|running|apply|applying|follow|following|obey|obeying|adopt|adopting`;
const UNTRUSTED_CONTENT_REVIEW_GUARD_RE = new RegExp(
  String.raw`\b${REVIEW_VOCABULARY_SOURCE}\b.{0,80}?\b(${UNTRUSTED_REVIEW_ORDERING_SOURCE})\b.{0,60}?\b(${UNTRUSTED_REVIEW_TARGET_ACTION_SOURCE})\b`,
  "i",
);
// Review guards govern only executable action verbs. `treat`, `regard`, and
// `accept` describe trust assignment and are intentionally not review targets.
const UNTRUSTED_REVIEW_ORDERING_RE = new RegExp(
  String.raw`\b(${UNTRUSTED_REVIEW_ORDERING_SOURCE})\b`,
  "i",
);
const UNTRUSTED_REVIEW_TARGET_ACTION_RE = new RegExp(
  String.raw`\b(${UNTRUSTED_REVIEW_TARGET_ACTION_SOURCE})\b`,
  "i",
);
const SEMANTIC_SENTENCE_BOUNDARY_RE = /[.!?]+(?=\s+|$)/;
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
const POLICY_RELEVANT_TOOL_INVOCATION_RE =
  /\b(?:curl|wget)\b|\b(?:npm|pnpm|yarn)\s+(?:install|add)\b|\b(?:pip3?|python(?:\d+(?:\.\d+)*)?\s+-m\s+pip|uv\s+pip)\s+install\b/i;
const COMMAND_LIKE_TOOL_RE =
  /\b(npm|pnpm|yarn|pip3?|python(?:\d+(?:\.\d+)*)?|py|uv|brew|docker|curl|wget|sudo|chmod|chown|git|gh|aws|gcloud|az|kubectl|echo|cat|cp|mv|rm|touch|mkdir)\b/i;
const COMMAND_LIKE_LEADING_MARKER_RE =
  /^(?:(?:[-*+]|\d+[.)])\s+)?(?:[$>%]\s*)?/u;
type SecurityDiagnosticsConfig = {
  security?: SecurityConfig;
};

type SecurityPolicyAuthority = "artifact" | "none";

interface SecurityDocumentAnalysisOptions {
  readonly eligibility?: MarkdownSecurityEligibility;
  readonly policyAuthority?: SecurityPolicyAuthority;
  readonly surface?: "markdown" | "plain-text-support";
}

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
  readonly yamlFrontmatterCommentAnalysis:
    YamlFrontmatterCommentAnalysis | undefined;
  readonly scanStart: number;
  readonly logicalCommands: PreparedLogicalCommandAnalysis;
  readonly helperCommands: readonly HelperCommandEvidence[];
  readonly securityParagraphs: readonly PreparedSecurityParagraphContext[];
  readonly securityParagraphContextByLine: ReadonlyMap<
    number,
    SecurityParagraphLineContext
  >;
  readonly surface: "markdown" | "plain-text-support";
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
  readonly resolvedDestinations: readonly ResolvedDestinationEvidence[];
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
  return analyzeSecurityDiagnostics(inputs, config).findings;
}

/** Findings and target-state coverage derived from one shared analysis pass. */
export interface SecurityDiagnosticsAnalysis {
  findings: Finding[];
  coverage: SecurityAnalysisCoverage;
}

export interface SecurityDiagnosticsAnalysisOptions {
  plainTextSupportReachability?: ReadonlyMap<
    string,
    PlainTextSupportSecurityReachability
  >;
}

/** Run existing security analyses and record exactly which layers executed. */
export function analyzeSecurityDiagnostics(
  inputs: Array<Artifact | ParsedDocument>,
  config: SecurityDiagnosticsConfig = {},
  options: SecurityDiagnosticsAnalysisOptions = {},
): SecurityDiagnosticsAnalysis {
  const analyses = inputs.map((input) => {
    const artifact = "artifact" in input ? input.artifact : input;
    const rawFindings = hiddenUnicodeFindings(artifact);
    const document = "artifact" in input ? input : parseDocument(input);
    const plainTextReachability = options.plainTextSupportReachability?.get(
      artifact.path,
    );
    const prepared =
      plainTextReachability === undefined
        ? prepareSecurityDocumentAnalysis(document, config.security)
        : preparePlainTextSupportSecurityAnalysis(document);
    return {
      findings: [
        ...rawFindings,
        ...(prepared === undefined
          ? []
          : securityFindingsForPreparedDocument(prepared)),
      ].map((finding) => projectFindingRepairGuidance(finding)),
      coverage: securityAnalysisCoverageArtifact(artifact, prepared),
    };
  });
  return {
    findings: analyses.flatMap((analysis) => analysis.findings),
    coverage: {
      schemaVersion: SECURITY_ANALYSIS_COVERAGE_SCHEMA_VERSION,
      artifacts: analyses
        .map((analysis) => analysis.coverage)
        .sort((left, right) => compareUtf16CodeUnits(left.path, right.path)),
    },
  };
}

function securityFindingsForPreparedDocument(
  prepared: PreparedSecurityDocumentAnalysis,
): Finding[] {
  const instructionDetections = [
    ...collectCanonicalDescriptionDetections(prepared),
    ...collectSecurityLineDetections(prepared),
    ...collectSemanticInstructionDetections(prepared),
    ...collectExecutablePolicyAuthorityDetections(prepared),
  ];
  const detections: Detection[] = [
    ...collectPolicyPreludeDetections(
      prepared,
      hasPolicyRelevantInstructionSurface(prepared),
    ),
    ...instructionDetections,
    ...(prepared.surface === "markdown"
      ? collectHiddenHtmlCommentDetections(prepared)
      : []),
    ...(prepared.surface === "markdown"
      ? collectHiddenYamlFrontmatterCommentDetections(prepared)
      : []),
    ...policyContradictions(prepared.effectivePolicy),
  ];

  return dedupeDetections(detections).map((detection) =>
    findingFromDetection(prepared.artifact, detection),
  );
}

function securityAnalysisCoverageArtifact(
  artifact: Artifact,
  prepared: PreparedSecurityDocumentAnalysis | undefined,
): SecurityAnalysisCoverageArtifact {
  const hiddenUnicode = hiddenUnicodeAnalysisApplies(artifact)
    ? "analyzed"
    : "not-applicable";
  const semanticInstructions = semanticInstructionCoverageState(
    artifact,
    prepared,
  );
  const canonicalDescription = canonicalDescriptionCoverageState(
    artifact,
    prepared,
  );
  const yamlFrontmatterComments = yamlFrontmatterCommentCoverageState(
    artifact,
    prepared,
  );
  return {
    path: artifact.path,
    kind: artifact.kind,
    contentClassification: artifact.contentClassification,
    analyses: {
      hiddenUnicode,
      semanticInstructions,
      canonicalDescription,
      yamlFrontmatterComments,
    },
    ...(yamlFrontmatterComments === "analyzed"
      ? {
          surfaceCounts: {
            yamlFrontmatterComments:
              prepared?.yamlFrontmatterCommentAnalysis?.comments.length ?? 0,
          },
        }
      : {}),
  };
}

function semanticInstructionCoverageState(
  artifact: Artifact,
  prepared: PreparedSecurityDocumentAnalysis | undefined,
): SecurityAnalysisCoverageState {
  if (prepared !== undefined) return "analyzed";
  if (!hiddenUnicodeAnalysisApplies(artifact)) return "not-applicable";
  if (artifact.kind === "script") return "not-applicable";
  return "unsupported";
}

function canonicalDescriptionCoverageState(
  artifact: Artifact,
  prepared: PreparedSecurityDocumentAnalysis | undefined,
): SecurityAnalysisCoverageState {
  if (artifact.kind !== "skill") return "not-applicable";
  if (prepared === undefined) return "unsupported";
  return prepared.canonicalDescription === undefined
    ? "not-analyzable"
    : "analyzed";
}

function yamlFrontmatterCommentCoverageState(
  artifact: Artifact,
  prepared: PreparedSecurityDocumentAnalysis | undefined,
): SecurityAnalysisCoverageState {
  if (artifact.kind === "skill" && prepared === undefined) return "unsupported";
  if (prepared?.yamlFrontmatterCommentAnalysis === undefined)
    return "not-applicable";
  return prepared.yamlFrontmatterCommentAnalysis?.commentsAnalyzable === true
    ? "analyzed"
    : "not-analyzable";
}

function collectHiddenHtmlCommentDetections(
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  return prepared.markdownView.htmlComments.flatMap((comment, commentIndex) => {
    const underlying = hiddenInstructionProjectionDetections(
      prepared,
      comment.content,
      {
        eligibility: "raw-agent-visible",
        policyAuthority: "none",
      },
    );
    return underlying.map((detection) => {
      const mappedStartLine = hiddenCommentSourceLine(
        comment,
        detection.startLine,
      );
      const mappedEndLine = hiddenCommentSourceLine(
        comment,
        detection.endLine ?? detection.startLine,
      );
      return {
        metadata: RULES.hiddenOperationalInstruction,
        severity: detection.severity,
        startLine: mappedStartLine,
        ...(mappedEndLine === mappedStartLine
          ? {}
          : { endLine: mappedEndLine }),
        snippet: htmlCommentEvidenceSnippet(
          prepared.sourceLines,
          comment,
          mappedStartLine,
          mappedEndLine,
        ),
        dedupeKey: [
          RULES.hiddenOperationalInstruction.id,
          commentIndex,
          detection.metadata.id,
          detection.startLine,
          detection.endLine ?? detection.startLine,
          detection.snippet,
        ].join(":"),
        details: {
          sourceProjection: "raw-agent-visible-html-comment",
          matchedDiagnosticId: detection.metadata.id,
          commentRange: {
            startLine: comment.startLine,
            endLine: comment.endLine,
            startColumn: comment.startColumn,
            endColumn: comment.endColumn,
          },
        },
      };
    });
  });
}

function collectHiddenYamlFrontmatterCommentDetections(
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  const comments = prepared.yamlFrontmatterCommentAnalysis?.comments ?? [];
  return comments.flatMap((comment, commentIndex) => {
    const underlying = hiddenInstructionProjectionDetections(
      prepared,
      comment.content,
      {
        eligibility: "raw-agent-visible",
        policyAuthority: "none",
      },
    );
    return underlying.map((detection) => {
      const mappedStartLine = yamlCommentSourceLine(
        comment,
        detection.startLine,
      );
      const mappedEndLine = yamlCommentSourceLine(
        comment,
        detection.endLine ?? detection.startLine,
      );
      return {
        metadata: RULES.hiddenFrontmatterInstruction,
        severity: detection.severity,
        startLine: mappedStartLine,
        ...(mappedEndLine === mappedStartLine
          ? {}
          : { endLine: mappedEndLine }),
        snippet: yamlCommentEvidenceSnippet(
          prepared.sourceLines,
          comment,
          mappedStartLine,
          mappedEndLine,
        ),
        dedupeKey: [
          RULES.hiddenFrontmatterInstruction.id,
          commentIndex,
          detection.metadata.id,
          detection.startLine,
          detection.endLine ?? detection.startLine,
          detection.snippet,
        ].join(":"),
        details: {
          sourceProjection: "raw-agent-visible-yaml-frontmatter-comment",
          matchedDiagnosticId: detection.metadata.id,
          commentRange: {
            startLine: comment.startLine,
            endLine: comment.endLine,
            startColumn: comment.startColumn,
            endColumn: comment.endColumn,
          },
        },
      };
    });
  });
}

function hiddenInstructionProjectionDetections(
  prepared: PreparedSecurityDocumentAnalysis,
  content: string,
  options: SecurityDocumentAnalysisOptions = {},
): Detection[] {
  const projectedArtifact: Artifact = {
    ...prepared.artifact,
    kind: "context",
    sizeBytes: content.length + 1,
    content: `\n${content}`,
    markdownParserEligible: true,
  };
  const projected = prepareSecurityDocumentAnalysis(
    parseDocument(projectedArtifact),
    undefined,
    options,
  );
  if (projected === undefined) return [];

  const recognizedDetections = dedupeDetections([
    ...collectSecurityLineDetections(projected),
    ...collectSemanticInstructionDetections(projected),
  ]);
  return recognizedDetections.length > 0 ||
    !hasPolicyRelevantInstructionSurface(projected)
    ? recognizedDetections
    : [
        {
          metadata: RULES.missingPolicyMetadata,
          severity: "high" as const,
          startLine: 2,
          endLine: content.split(/\r?\n/u).length + 1,
          snippet: content,
          dedupeKey: "hidden-policy-relevant-instruction-surface",
        },
      ];
}

function hiddenCommentSourceLine(
  comment: MarkdownHtmlComment,
  projectedLine: number,
): number {
  return Math.max(
    comment.startLine,
    Math.min(comment.endLine, comment.startLine + projectedLine - 2),
  );
}

function htmlCommentEvidenceSnippet(
  sourceLines: readonly string[],
  comment: MarkdownHtmlComment,
  startLine: number,
  endLine: number,
): string {
  const lines = sourceLines.slice(startLine - 1, endLine);
  if (lines.length === 0) return comment.content;
  if (startLine === comment.startLine) {
    lines[0] = (lines[0] ?? "").slice(comment.startColumn - 1);
  }
  if (endLine === comment.endLine) {
    const endIndex = lines.length - 1;
    const sourceEndColumn =
      startLine === endLine
        ? comment.endColumn - comment.startColumn
        : comment.endColumn - 1;
    lines[endIndex] = (lines[endIndex] ?? "").slice(0, sourceEndColumn);
  }
  return lines.join("\n");
}

function yamlCommentSourceLine(
  comment: YamlFrontmatterComment,
  projectedLine: number,
): number {
  const lineIndex = Math.max(
    0,
    Math.min(comment.lines.length - 1, projectedLine - 2),
  );
  return comment.lines[lineIndex]?.line ?? comment.startLine;
}

function yamlCommentEvidenceSnippet(
  sourceLines: readonly string[],
  comment: YamlFrontmatterComment,
  startLine: number,
  endLine: number,
): string {
  const lines = comment.lines
    .filter((line) => line.line >= startLine && line.line <= endLine)
    .map((line) =>
      (sourceLines[line.line - 1] ?? "").slice(
        line.startColumn - 1,
        line.endColumn - 1,
      ),
    );
  return lines.length > 0 ? lines.join("\n") : comment.content;
}

function prepareSecurityDocumentAnalysis(
  document: ParsedDocument,
  securityConfig?: SecurityConfig,
  options: SecurityDocumentAnalysisOptions = {},
): PreparedSecurityDocumentAnalysis | undefined {
  const artifact = document.artifact;
  const plainTextSupport = options.surface === "plain-text-support";
  if (
    artifact.kind === "script" ||
    (artifact.kind === "asset" && !plainTextSupport) ||
    artifact.contentClassification === "binary" ||
    (!artifact.markdownParserEligible && !plainTextSupport)
  )
    return undefined;

  const policyAuthority = options.policyAuthority ?? "artifact";
  const policyResolution =
    policyAuthority === "none"
      ? { policy: emptySecurityPolicy(), issues: [] }
      : resolveOperationalSecurityPolicy(document);
  const parsedPolicy = policyResolution.policy;
  const effectivePolicy =
    policyAuthority === "none"
      ? parsedPolicy
      : applySecurityConfig(parsedPolicy, securityConfig);
  const sourceLines = artifact.content.split(/\r?\n/);
  const syntax = ensureMarkdownSyntaxForDocument(document);
  if (syntax === undefined) {
    throw new Error(
      "Eligible Markdown document is missing its primary syntax parse",
    );
  }
  const markdownView = new MarkdownSecurityView(
    syntax,
    options.eligibility ?? "markdown-structured",
  );
  const skillFrontmatter =
    !plainTextSupport && artifact.kind === "skill"
      ? inspectAgentSkill(document).frontmatter
      : undefined;
  const frontmatter = frontmatterCommentAnalysisForDocument(
    document,
    plainTextSupport,
    skillFrontmatter,
  );
  const canonicalDescription = canonicalSkillDescriptionSecurityUnit(
    document,
    sourceLines,
    skillFrontmatter,
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
  const helperCommands = collectHelperCommandEvidence([document]);
  const securityParagraphAnalysis = prepareSecurityParagraphContexts(
    markdownView,
    syntax,
    logicalCommands.commandByLine,
  );

  return {
    artifact,
    parsedPolicy,
    effectivePolicy,
    securityConfig: policyAuthority === "none" ? undefined : securityConfig,
    policyIssues: policyResolution.issues,
    sourceLines,
    visibleLines,
    markdownView,
    canonicalDescription,
    yamlFrontmatterCommentAnalysis: frontmatter,
    scanStart,
    logicalCommands,
    helperCommands,
    securityParagraphs: securityParagraphAnalysis.paragraphs,
    securityParagraphContextByLine: securityParagraphAnalysis.contextByLine,
    surface: options.surface ?? "markdown",
  };
}

function frontmatterCommentAnalysisForDocument(
  document: ParsedDocument,
  plainTextSupport: boolean,
  skillFrontmatter: ParsedYamlFrontmatter | undefined,
): YamlFrontmatterCommentAnalysis | undefined {
  if (plainTextSupport) return undefined;
  if (document.artifact.kind === "skill") {
    return skillFrontmatter;
  }
  const frontmatter = ensureYamlFrontmatterForDocument(document);
  return frontmatter.present ? frontmatter : undefined;
}

function preparePlainTextSupportSecurityAnalysis(
  document: ParsedDocument,
): PreparedSecurityDocumentAnalysis | undefined {
  const syntax = parseMarkdownSyntax(document.artifact.content, 1);
  const projectedDocument: ParsedDocument = {
    ...document,
    lines: syntax.sourceLines,
    metadata: {},
    metadataFields: {},
    metadataListItems: {},
  };
  attachMarkdownSyntax(projectedDocument, syntax);
  return prepareSecurityDocumentAnalysis(projectedDocument, undefined, {
    eligibility: "plain-text-structured",
    policyAuthority: "none",
    surface: "plain-text-support",
  });
}

function canonicalSkillDescriptionSecurityUnit(
  document: ParsedDocument,
  sourceLines: readonly string[],
  frontmatter: ParsedYamlFrontmatter | undefined,
): CanonicalDescriptionSecurityUnit | undefined {
  if (document.artifact.kind !== "skill" || frontmatter === undefined)
    return undefined;
  // Eligibility depends only on trustworthy parsed description evidence, not
  // independent Agent Skills identity or filename validation.
  if (
    !frontmatter.present ||
    !frontmatter.closed ||
    !frontmatter.mapping ||
    frontmatter.errors.length > 0
  ) {
    return undefined;
  }

  const descriptionFields = frontmatter.fields.filter(
    (candidate) => candidate.key === AGENT_SKILL_TOP_LEVEL_KEYS.description,
  );
  if (descriptionFields.length !== 1) return undefined;
  const field = descriptionFields[0]!;
  if (
    typeof field.value !== "string" ||
    !Number.isSafeInteger(field.startLine) ||
    !Number.isSafeInteger(field.endLine) ||
    field.startLine < 2 ||
    field.endLine < field.startLine ||
    field.endLine >= frontmatter.bodyStartLine - 1 ||
    field.endLine > sourceLines.length
  ) {
    return undefined;
  }

  return {
    text: field.value,
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
      resolvedDestinations: paragraphResolvedDestinationEvidence(
        paragraph,
        markdownView,
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

function paragraphResolvedDestinationEvidence(
  paragraph: SecurityParagraphContext,
  markdownView: MarkdownSecurityView,
): ResolvedDestinationEvidence[] {
  const lineByIndex = new Map(
    paragraph.lines.map((line) => [line.lineIndex, line]),
  );
  return markdownView.resolvedDestinations.flatMap(
    (destination): ResolvedDestinationEvidence[] => {
      const first = lineByIndex.get(destination.startLine - 1);
      const last = lineByIndex.get(destination.endLine - 1);
      if (first === undefined || last === undefined) return [];
      const startOffset =
        first.startOffset +
        paragraphLineOffsetForSourceColumn(
          first,
          destination.startColumn,
          markdownView,
        );
      const endOffset =
        last.startOffset +
        paragraphLineOffsetForSourceColumn(
          last,
          destination.endColumn,
          markdownView,
        );
      if (endOffset <= startOffset || endOffset > paragraph.text.length) {
        return [];
      }
      return [
        {
          target: destination.target,
          text: destination.text,
          startOffset,
          endOffset,
        },
      ];
    },
  );
}

function paragraphLineOffsetForSourceColumn(
  line: SecurityParagraphSourceLine,
  sourceColumn: number,
  markdownView: MarkdownSecurityView,
): number {
  const visible = markdownView.visibleLine(line.lineIndex);
  const leadingWhitespace = visible.length - visible.trimStart().length;
  return Math.max(
    0,
    Math.min(
      line.text.length,
      markdownView.visibleOffsetForSourceColumn(line.lineIndex, sourceColumn) -
        leadingWhitespace,
    ),
  );
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
    const resolvedDestinations = context.preparedParagraph.resolvedDestinations
      .filter(
        (destination) =>
          destination.startOffset >= clause.startOffset &&
          destination.endOffset <= clause.endOffset,
      )
      .map((destination) => ({
        target: destination.target,
        text: destination.text,
        startOffset: destination.startOffset - clause.startOffset,
        endOffset: destination.endOffset - clause.startOffset,
      }));
    analysis = analyzeDestinations(clause.text, resolvedDestinations);
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
  const commandText = line.trim().replace(COMMAND_LIKE_LEADING_MARKER_RE, "");
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
          scanStart,
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
  const { sourceLines, visibleLines, markdownView, logicalCommands } = prepared;
  const lineNumber = index + 1;
  const line = markdownView.instructionLine(index);
  if (markdownView.isNonOperationalExampleLine(index)) return undefined;
  if (markdownView.isLinkDefinitionLine(index)) return undefined;
  if (
    !markdownView.usesRawAgentVisibleEligibility() &&
    isShellCommentLine(line, index, markdownView)
  ) {
    return undefined;
  }
  if (
    !markdownView.usesRawAgentVisibleEligibility() &&
    isFrontmatterPolicyLine(line, index, prepared.scanStart)
  ) {
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
  let cachedLineDestinationAnalysis: DestinationAnalysis | undefined;
  const lineDestinationAnalysis = (): DestinationAnalysis => {
    cachedLineDestinationAnalysis ??= analyzeDestinations(
      line,
      lineResolvedDestinationEvidence(markdownView, index, line.length),
    );
    return cachedLineDestinationAnalysis;
  };
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
      destinationAnalysis: lineDestinationAnalysis(),
    });
    return cachedLineSecurityAnalysis;
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

function lineResolvedDestinationEvidence(
  markdownView: MarkdownSecurityView,
  lineIndex: number,
  lineLength: number,
): ResolvedDestinationEvidence[] {
  return markdownView.resolvedDestinations.flatMap(
    (destination): ResolvedDestinationEvidence[] => {
      if (
        destination.startLine !== lineIndex + 1 ||
        destination.endLine !== lineIndex + 1
      ) {
        return [];
      }
      const startOffset = markdownView.visibleOffsetForSourceColumn(
        lineIndex,
        destination.startColumn,
      );
      const endOffset = markdownView.visibleOffsetForSourceColumn(
        lineIndex,
        destination.endColumn,
      );
      if (
        startOffset < 0 ||
        endOffset <= startOffset ||
        endOffset > lineLength
      ) {
        return [];
      }
      return [
        {
          target: destination.target,
          text: destination.text,
          startOffset,
          endOffset,
        },
      ];
    },
  );
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
              ...(detection.metadata.id ===
              RULES.riskyOperationErrorSuppression.id
                ? logicalShellCommandEvidence(logicalCommand)
                : evidence),
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

function collectExecutablePolicyAuthorityDetections(
  prepared: PreparedSecurityDocumentAnalysis,
): Detection[] {
  if (prepared.artifact.kind !== "skill" || prepared.surface !== "markdown") {
    return [];
  }

  return prepared.helperCommands.flatMap((command) => {
    const unit = prepared.markdownView.semanticUnits.find(
      (candidate) =>
        candidate.kind === "paragraph" &&
        candidate.startLine <= command.line &&
        candidate.endLine >= command.line,
    );
    if (unit === undefined) return [];

    const instructionText = unit.lines.join(" ");
    const commandStart = instructionText.indexOf(command.snippet);
    if (commandStart < 0) return [];
    const suffix = instructionText.slice(commandStart + command.snippet.length);
    const delegation = EXECUTABLE_POLICY_AUTHORITY_DELEGATION_RE.exec(suffix);
    const decision = delegation?.groups?.decision;
    if (
      decision === undefined ||
      !EXECUTABLE_POLICY_AUTHORITY_SECURITY_CONCEPT_RE.test(decision)
    ) {
      return [];
    }

    const evidence: DetectionEvidence = {
      startLine: unit.startLine,
      endLine: unit.endLine,
      snippet: prepared.sourceLines
        .slice(unit.startLine - 1, unit.endLine)
        .join("\n"),
    };
    return [
      {
        metadata: RULES.executableAsPolicyAuthority,
        severity: "medium" as const,
        ...evidence,
        dedupeKey: `${RULES.executableAsPolicyAuthority.id}:${command.line}:${command.launcher}:${command.rawTarget}`,
        details: {
          evidenceKind: "recognized-helper-command",
          launcher: command.launcher,
          rawTarget: command.rawTarget,
          decision: decision.trim(),
        },
      },
    ];
  });
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
  DIAGNOSTIC_IDS.SEC_INSTRUCTION_HIERARCHY_OVERRIDE,
  DIAGNOSTIC_IDS.SEC_INSTRUCTION_VIOLATES_POLICY,
  DIAGNOSTIC_IDS.SEC_MISSING_HUMAN_APPROVAL_GUARD,
  DIAGNOSTIC_IDS.SEC_NO_REDACTION_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_OVERBROAD_CONTEXT_INSTRUCTION,
  DIAGNOSTIC_IDS.SEC_PRIVILEGED_COMMAND_WITHOUT_GUARD,
  DIAGNOSTIC_IDS.SEC_RISKY_OPERATION_ERROR_SUPPRESSION,
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
        underlyingDiagnosticIds: [...underlyingDiagnosticIds].sort(
          compareUtf16CodeUnits,
        ),
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

// Canonical descriptions may quote example requests for routing. The bounds
// stop at sentence breaks so masking those literals cannot hide later
// operational instructions in the description.
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
      prepared.markdownView.isNonOperationalExampleLine(lineIndex) ||
      (prepared.markdownView.isBlockQuotedLine(lineIndex) &&
        !prepared.markdownView.isOperationalBlockQuotedLine(lineIndex))
    ) {
      continue;
    }
    const line = prepared.markdownView.instructionLine(lineIndex);
    if (
      !prepared.markdownView.usesRawAgentVisibleEligibility() &&
      (isFrontmatterPolicyLine(line, lineIndex, prepared.scanStart) ||
        isShellCommentLine(line, lineIndex, prepared.markdownView))
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
  if (POLICY_RELEVANT_TOOL_INVOCATION_RE.test(text)) {
    return true;
  }

  const sensitiveTarget =
    SECRET_WORD_RE.test(text) || referencesSensitiveFile(text);
  const sensitiveAction =
    POLICY_RELEVANT_SENSITIVE_MATERIAL_ACTION_RE.test(text);
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
  scanStart: number,
  markdownView: MarkdownSecurityView,
): boolean {
  const source = sourceLines[lineIndex] ?? "";
  const visible = visibleLines[lineIndex] ?? "";
  const operationalBlockQuote =
    markdownView.isOperationalBlockQuotedLine(lineIndex);
  return (
    (source === visible || operationalBlockQuote) &&
    !markdownView.isNonOperationalExampleLine(lineIndex) &&
    (!markdownView.isBlockQuotedLine(lineIndex) || operationalBlockQuote) &&
    (markdownView.usesRawAgentVisibleEligibility() ||
      (!isFrontmatterPolicyLine(visible, lineIndex, scanStart) &&
        !isShellCommentLine(visible, lineIndex, markdownView)))
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
      isFrontmatterPolicyLine(line, lineIndex, prepared.scanStart)
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
    SENSITIVE_DISCLOSURE_PROHIBITION_BEFORE_ACTION_RE.test(line) ||
    SENSITIVE_DISCLOSURE_ACTION_BEFORE_PROHIBITION_RE.test(line)
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
  const shellCommandRiskKinds = classifyShellCommandRiskKinds(line, true);

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

  if (!defensiveAction) {
    for (const suppression of riskyShellFailureSuppressions(line)) {
      detections.push({
        metadata: RULES.riskyOperationErrorSuppression,
        severity: "high",
        startLine: lineNumber,
        snippet: line,
        dedupeKey: `${RULES.riskyOperationErrorSuppression.id}:${lineNumber}:${suppression.start}`,
        details: {
          suppressionKind: suppression.suppression,
          operationKinds: suppression.operationKinds,
        },
      });
    }
  }

  if (
    shellCommandRiskKinds.includes("privileged-command") &&
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
    shellCommandRiskKinds.includes("destructive-command") &&
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

function riskyShellFailureSuppressions(
  command: string,
): RiskyShellFailureSuppression[] {
  const tokenization = tokenizeBoundedShell(command);
  if (!tokenization.supported) return [];

  const suppressions: RiskyShellFailureSuppression[] = [];
  for (const [index, token] of tokenization.tokens.entries()) {
    if (token.kind !== "operator" || token.value !== "||") continue;
    const suppressor = tokenization.tokens[index + 1];
    if (
      suppressor?.kind !== "word" ||
      (suppressor.value !== "true" && suppressor.value !== ":")
    ) {
      continue;
    }

    const previousBoundary = [...tokenization.tokens.slice(0, index)]
      .reverse()
      .find(
        (candidate) =>
          candidate.kind === "operator" &&
          isShellCommandBoundary(candidate.value),
      );
    const previousPipelineBoundary = [...tokenization.tokens.slice(0, index)]
      .reverse()
      .find(
        (candidate) =>
          candidate.kind === "operator" &&
          isShellPipelineBoundary(candidate.value),
      );
    const operationStart = previousBoundary?.end ?? 0;
    const pipelineStart = previousPipelineBoundary?.end ?? 0;
    const operation = command.slice(operationStart, token.start).trim();
    const sensitiveDataOperation = command
      .slice(pipelineStart, token.start)
      .trim();
    if (!operation) continue;
    const operationKinds = classifyRiskyShellOperation(
      operation,
      sensitiveDataOperation,
    );
    if (operationKinds.length === 0) continue;

    suppressions.push({
      start: pipelineStart,
      suppression: suppressor.value === "true" ? "|| true" : "|| :",
      operationKinds,
    });
  }
  return suppressions;
}

function isShellCommandBoundary(operator: string): boolean {
  return (
    operator === ";" ||
    operator === "|" ||
    operator === "||" ||
    operator === "&&" ||
    operator === "&"
  );
}

function isShellPipelineBoundary(operator: string): boolean {
  return isShellCommandBoundary(operator) && operator !== "|";
}

function classifyShellCommandRiskKinds(
  command: string,
  allowConservativeFallback: boolean,
): RiskyOperationKind[] {
  const tokenization = tokenizeBoundedShell(command);
  if (!tokenization.supported) {
    return allowConservativeFallback
      ? fallbackShellCommandRiskKinds(command)
      : [];
  }

  const kinds = new Set<RiskyOperationKind>();
  let segmentStart = 0;
  for (const token of tokenization.tokens) {
    if (token.kind !== "operator" || !isShellCommandBoundary(token.value)) {
      continue;
    }
    addShellCommandSegmentRiskKinds(
      kinds,
      command.slice(segmentStart, token.start).trim(),
      allowConservativeFallback,
    );
    segmentStart = token.end;
  }
  addShellCommandSegmentRiskKinds(
    kinds,
    command.slice(segmentStart).trim(),
    allowConservativeFallback,
  );

  return (["destructive-command", "privileged-command"] as const).filter(
    (kind) => kinds.has(kind),
  );
}

function addShellCommandSegmentRiskKinds(
  kinds: Set<RiskyOperationKind>,
  segment: string,
  allowConservativeFallback: boolean,
): void {
  if (!segment) return;

  const executable = directShellExecutable(segment);
  const effectiveExecutable = effectiveShellExecutable(segment);
  const destructivePattern =
    effectiveExecutable === undefined
      ? undefined
      : DESTRUCTIVE_SHELL_COMMAND_PATTERNS.get(effectiveExecutable);
  const privilegedPattern =
    executable === undefined
      ? undefined
      : PRIVILEGED_SHELL_COMMAND_PATTERNS.get(executable);
  if (destructivePattern?.test(segment) === true) {
    kinds.add("destructive-command");
  }
  if (privilegedPattern?.test(segment) === true) {
    kinds.add("privileged-command");
  }

  if (!allowConservativeFallback) return;
  const commandPositionEstablished =
    destructivePattern !== undefined ||
    privilegedPattern !== undefined ||
    (effectiveExecutable !== undefined &&
      LITERAL_OUTPUT_SHELL_EXECUTABLES.has(effectiveExecutable));
  if (
    commandPositionEstablished &&
    !hasBoundedShellCommandSubstitution(segment)
  ) {
    return;
  }
  for (const kind of fallbackShellCommandRiskKinds(segment)) kinds.add(kind);
}

function fallbackShellCommandRiskKinds(command: string): RiskyOperationKind[] {
  const kinds: RiskyOperationKind[] = [];
  if (DESTRUCTIVE_COMMAND_RE.test(command)) kinds.push("destructive-command");
  if (PRIVILEGED_COMMAND_RE.test(command)) kinds.push("privileged-command");
  return kinds;
}

function classifyRiskyShellOperation(
  operation: string,
  sensitiveDataOperation = operation,
): RiskyOperationKind[] {
  const kinds: RiskyOperationKind[] = classifyShellCommandRiskKinds(
    operation,
    false,
  );
  const effectiveExecutable = effectiveShellExecutable(operation);
  const literalOutputOnly =
    effectiveExecutable !== undefined &&
    LITERAL_OUTPUT_SHELL_EXECUTABLES.has(effectiveExecutable) &&
    !hasBoundedShellCommandSubstitution(operation);

  const analysis = analyzeSecurityCommand({
    source: {
      text: operation,
      startLine: 1,
      endLine: operation.split(/\r?\n/u).length,
      lines: operation.split(/\r?\n/u),
    },
  });
  if (!literalOutputOnly && isUploadInstruction(analysis.destinationAnalysis)) {
    kinds.push("security-sensitive-upload");
  }
  const sensitiveDataAnalysis =
    sensitiveDataOperation === operation
      ? analysis
      : analyzeSecurityCommand({
          source: {
            text: sensitiveDataOperation,
            startLine: 1,
            endLine: sensitiveDataOperation.split(/\r?\n/u).length,
            lines: sensitiveDataOperation.split(/\r?\n/u),
          },
        });
  if (
    !literalOutputOnly &&
    ((sensitiveDataAnalysis.sensitiveSources.length > 0 &&
      sensitiveDataAnalysis.sinks.length > 0) ||
      CREDENTIAL_ARG_ANY_RE.test(sensitiveDataOperation))
  ) {
    kinds.push("sensitive-data-operation");
  }
  return kinds;
}

const LITERAL_OUTPUT_SHELL_EXECUTABLES = new Set(["echo", "printf"]);
const SHELL_PRESENTATION_MARKER_RE = /^(?:[-*+$%]|\d+[.)])$/u;
const SHELL_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const SHELL_REDIRECTION_OPERATOR_RE = /^(?:>|>>|<|<<|&>)$/u;
const SHELL_WRAPPER_RE = /^(?:command|env)$/iu;
const SHELL_WRAPPER_OPTION_WITH_VALUE_RE = /^(?:-u|--unset|-C|--chdir)$/u;
const SUDO_OPTION_WITH_VALUE_RE =
  /^(?:-[ughpCTRD]|--(?:user|group|host|prompt|chdir|command-timeout|chroot))$/u;

function directShellExecutable(command: string): string | undefined {
  const words = shellCommandWords(command);
  if (words === undefined) return undefined;
  return normalizedShellExecutable(words[directShellExecutableIndex(words)]);
}

function effectiveShellExecutable(command: string): string | undefined {
  const words = shellCommandWords(command);
  if (words === undefined) return undefined;
  let index = directShellExecutableIndex(words);
  if (normalizedShellExecutable(words[index]) !== "sudo") {
    return normalizedShellExecutable(words[index]);
  }

  index += 1;
  while ((words[index] ?? "").startsWith("-")) {
    const option = words[index] ?? "";
    index += 1;
    if (SUDO_OPTION_WITH_VALUE_RE.test(option)) index += 1;
  }
  index = wrappedShellExecutableIndex(words, index);
  return normalizedShellExecutable(words[index]);
}

function normalizedShellExecutable(
  word: string | undefined,
): string | undefined {
  if (word === undefined) return undefined;
  return word.slice(word.lastIndexOf("/") + 1).toLowerCase();
}

function shellCommandWords(command: string): string[] | undefined {
  const tokenization = tokenizeBoundedShell(command);
  if (!tokenization.supported) return undefined;

  const words: string[] = [];
  let skipRedirectionTarget = false;
  for (const [index, token] of tokenization.tokens.entries()) {
    if (token.kind === "operator") {
      skipRedirectionTarget = SHELL_REDIRECTION_OPERATOR_RE.test(token.value);
      continue;
    }
    const next = tokenization.tokens[index + 1];
    if (
      /^\d+$/u.test(token.value) &&
      next?.kind === "operator" &&
      SHELL_REDIRECTION_OPERATOR_RE.test(next.value) &&
      token.end === next.start
    ) {
      continue;
    }
    if (skipRedirectionTarget) {
      skipRedirectionTarget = false;
      continue;
    }
    words.push(token.value);
  }
  return words;
}

function directShellExecutableIndex(words: readonly string[]): number {
  let index = 0;
  while (SHELL_PRESENTATION_MARKER_RE.test(words[index] ?? "")) index += 1;
  return wrappedShellExecutableIndex(words, index);
}

function wrappedShellExecutableIndex(
  words: readonly string[],
  startIndex: number,
): number {
  let index = startIndex;
  while (SHELL_ASSIGNMENT_RE.test(words[index] ?? "")) index += 1;
  while (SHELL_WRAPPER_RE.test(normalizedShellExecutable(words[index]) ?? "")) {
    index += 1;
    while ((words[index] ?? "").startsWith("-")) {
      const option = words[index] ?? "";
      index += 1;
      if (SHELL_WRAPPER_OPTION_WITH_VALUE_RE.test(option)) index += 1;
    }
    while (SHELL_ASSIGNMENT_RE.test(words[index] ?? "")) index += 1;
  }
  return index;
}

function shellCommandRiskPatterns(
  definitions: readonly (readonly [string, string])[],
): ReadonlyMap<string, RegExp> {
  return new Map(
    definitions.map(([executable, source]) => [
      executable,
      new RegExp(String.raw`\b(?:${source})\b`, "i"),
    ]),
  );
}

function shellCommandRiskFallbackPattern(
  definitions: readonly (readonly [string, string])[],
): RegExp {
  const alternatives = definitions
    .map(([, source]) => `(?:${source})`)
    .join("|");
  return new RegExp(String.raw`\b(?:${alternatives})\b`, "i");
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
  return issues.map((issue) => {
    const canonical =
      issue.identifierAuthority === "canonical" ||
      (issue.identifierAuthority === undefined &&
        issue.key.startsWith("renma."));
    return {
      metadata: {
        ...(canonical
          ? RULES.invalidCanonicalPolicyMetadata
          : RULES.invalidRenmaPolicyMetadata),
        title: canonical
          ? `Invalid metadata.${issue.key}: ${issue.reason}.`
          : `Invalid ${issue.key}: ${issue.reason}.`,
      },
      severity: "high",
      startLine: issue.startLine,
      endLine: issue.endLine,
      snippet: issue.snippet,
      dedupeKey: `invalid-${canonical ? "canonical" : "renma"}-policy:${issue.key}:${issue.startLine}`,
    };
  });
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

  const riskyFailureSuppression =
    unsafeRiskyOperationFailureSuppression(instructionText);
  if (riskyFailureSuppression !== undefined) {
    const evidence =
      options.evidence ??
      semanticSpanEvidence(
        instructionLines,
        lineOffsets,
        firstLine,
        riskyFailureSuppression.start,
        riskyFailureSuppression.end,
      );
    detections.push({
      metadata: RULES.riskyOperationErrorSuppression,
      severity: "high",
      ...evidence,
      dedupeKey: `${RULES.riskyOperationErrorSuppression.id}:${firstLine}:${riskyFailureSuppression.start}`,
      details: {
        suppressionKind: "explicit-prose-failure-continuation",
      },
    });
  }

  const hierarchyOverride = unsafeInstructionHierarchyOverride(instructionText);
  if (hierarchyOverride !== undefined) {
    const evidence =
      options.evidence ??
      semanticSpanEvidence(
        instructionLines,
        lineOffsets,
        firstLine,
        hierarchyOverride.start,
        hierarchyOverride.end,
      );
    detections.push({
      metadata: RULES.instructionHierarchyOverride,
      severity: "high",
      ...evidence,
      dedupeKey: `${RULES.instructionHierarchyOverride.id}:${firstLine}:${hierarchyOverride.start}`,
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
  const analysisText = safeguardMarkdownPresentationProjection(text);
  const actions = safeguardActionPolarities(
    analysisText,
    negatedActorActionIsDefensive,
  );
  for (const {
    pattern,
    immediateContinuationCondition,
    restoredApprovalGuardCanExempt,
  } of SAFEGUARD_BYPASS_PATTERNS) {
    for (const match of overlappingPatternMatches(analysisText, pattern)) {
      const matchEnd = match.start + match.text.length;
      const matchedActions = actions.filter(
        ({ start }) =>
          start >= match.start &&
          start < matchEnd &&
          isSafeguardPatternActionAssociated(
            analysisText,
            match.start,
            start,
            immediateContinuationCondition,
            restoredApprovalGuardCanExempt ?? false,
          ),
      );
      if (matchedActions.some(({ prohibited }) => !prohibited)) {
        return text.slice(match.start, matchEnd);
      }
    }
  }
  return undefined;
}

type UnsafeBoundedActionMatch = {
  start: number;
  end: number;
};

function unsafeRiskyOperationFailureSuppression(
  text: string,
): UnsafeBoundedActionMatch | undefined {
  return firstUnsafeBoundedActionMatch(
    text,
    RISKY_OPERATION_FAILURE_SUPPRESSION_PATTERNS,
    RISKY_OPERATION_SUPPRESSION_ACTION_RE,
  );
}

function unsafeInstructionHierarchyOverride(
  text: string,
): UnsafeBoundedActionMatch | undefined {
  return firstUnsafeBoundedActionMatch(
    text,
    [
      DIRECT_INSTRUCTION_HIERARCHY_OVERRIDE_RE,
      PRECEDENCE_INSTRUCTION_HIERARCHY_OVERRIDE_RE,
    ],
    INSTRUCTION_HIERARCHY_OVERRIDE_ACTION_RE,
    hierarchyOverrideActionIsDefensive,
  );
}

function firstUnsafeBoundedActionMatch(
  text: string,
  patterns: readonly RegExp[],
  recognizedAction: RegExp,
  additionalProhibition?: (text: string, actionStart: number) => boolean,
): UnsafeBoundedActionMatch | undefined {
  const analysisText = safeguardMarkdownPresentationProjection(text);
  const actions = safeguardActionPolarities(
    analysisText,
    additionalProhibition,
  );
  for (const pattern of patterns) {
    for (const match of overlappingPatternMatches(analysisText, pattern)) {
      const end = match.start + match.text.length;
      const unsafeAction = actions.some(
        (action) =>
          action.start >= match.start &&
          action.start < end &&
          recognizedAction.test(analysisText.slice(action.start, action.end)) &&
          !action.prohibited,
      );
      if (unsafeAction) {
        return {
          start: match.start,
          end,
        };
      }
    }
  }
  return undefined;
}

const HIGHER_AUTHORITY_SUBJECT_RE =
  /(?:higher[- ](?:level|authority)\s+(?:safety\s+)?instructions?|host[- ]agent\s+(?:instruction\s+hierarchy|instructions?))\s*$/iu;
const PLATFORM_AUTHORITY_SUBJECT_RE =
  /platform\s+(?:policy|policies|instructions?)\s*$/iu;
const SYSTEM_AUTHORITY_SUBJECT_RE = /system\s+(?:instructions?|prompts?)\s*$/iu;
const LOWER_THAN_HIGHER_AUTHORITY_TARGET_RE =
  /^(?:(?:(?:all|any|every)\s+)?(?:previous|prior|earlier|preceding)\b|(?:system|developer)\b|platform\s+(?:policy|policies|instructions?))/iu;
const LOWER_THAN_PLATFORM_AUTHORITY_TARGET_RE =
  /^(?:(?:(?:all|any|every)\s+)?(?:previous|prior|earlier|preceding)\b|(?:system|developer)\b)/iu;
const LOWER_THAN_SYSTEM_AUTHORITY_TARGET_RE =
  /^(?:(?:(?:all|any|every)\s+)?(?:previous|prior|earlier|preceding)\b|developer\b)/iu;

function hierarchyOverrideActionIsDefensive(
  text: string,
  actionStart: number,
): boolean {
  const boundedPrefix = text.slice(Math.max(0, actionStart - 180), actionStart);
  const clausePrefix = boundedActionClausePrefix(boundedPrefix);
  if (
    INSTRUCTION_HIERARCHY_OVERRIDE_NEGATION_RE.test(clausePrefix) ||
    negatedActorClauseIsDefensive(clausePrefix) ||
    INSTRUCTION_HIERARCHY_QUOTED_DISCUSSION_PREFIX_RE.test(boundedPrefix) ||
    INSTRUCTION_HIERARCHY_DISCUSSION_PREFIX_RE.test(boundedPrefix) ||
    INSTRUCTION_HIERARCHY_QUESTION_SUBJECT_RE.test(clausePrefix) ||
    INSTRUCTION_HIERARCHY_INDIRECT_QUESTION_PREFIX_RE.test(clausePrefix)
  ) {
    return true;
  }

  const actionRemainder = text.slice(actionStart, actionStart + 240);
  const action = INSTRUCTION_HIERARCHY_OVERRIDE_ACTION_RE.exec(actionRemainder);
  if (action === null) return false;
  const target = actionRemainder
    .slice(action[0].length)
    .trimStart()
    .replace(/^the\s+/iu, "");
  if (
    HIGHER_AUTHORITY_SUBJECT_RE.test(clausePrefix) &&
    LOWER_THAN_HIGHER_AUTHORITY_TARGET_RE.test(target)
  ) {
    return true;
  }
  if (
    PLATFORM_AUTHORITY_SUBJECT_RE.test(clausePrefix) &&
    LOWER_THAN_PLATFORM_AUTHORITY_TARGET_RE.test(target)
  ) {
    return true;
  }
  return (
    SYSTEM_AUTHORITY_SUBJECT_RE.test(clausePrefix) &&
    LOWER_THAN_SYSTEM_AUTHORITY_TARGET_RE.test(target)
  );
}

function negatedActorActionIsDefensive(
  text: string,
  actionStart: number,
): boolean {
  const boundedPrefix = text.slice(Math.max(0, actionStart - 180), actionStart);
  return negatedActorClauseIsDefensive(
    boundedActionClausePrefix(boundedPrefix),
  );
}

function negatedActorClauseIsDefensive(clausePrefix: string): boolean {
  return (
    NEGATED_ACTOR_ACTION_SUBJECT_RE.test(clausePrefix) ||
    QUALIFIED_NEGATED_ACTOR_ACTION_SUBJECT_RE.test(clausePrefix)
  );
}

function boundedActionClausePrefix(boundedPrefix: string): string {
  const boundary = Math.max(
    boundedPrefix.lastIndexOf("."),
    boundedPrefix.lastIndexOf(";"),
    boundedPrefix.lastIndexOf(":"),
    boundedPrefix.lastIndexOf("!"),
    boundedPrefix.lastIndexOf("?"),
    boundedPrefix.lastIndexOf("—"),
    boundedPrefix.lastIndexOf("–"),
    boundedPrefix.lastIndexOf("\n"),
    boundedPrefix.lastIndexOf("\r"),
  );
  return boundedPrefix.slice(boundary + 1);
}

/** Mask only parsed Markdown emphasis delimiters while retaining every offset. */
function safeguardMarkdownPresentationProjection(text: string): string {
  if (!/[*_]/u.test(text)) return text;
  const projected = text.split("");
  const syntax = parseMarkdownSyntax(text, 1);
  for (const { node } of syntax.records) {
    if (node.type !== "emphasis" && node.type !== "strong") continue;
    const position = requiredMarkdownPosition(node);
    const start = position.start.offset;
    const end = position.end.offset;
    if (start === undefined || end === undefined) continue;
    const delimiterLength = node.type === "strong" ? 2 : 1;
    const delimiter = text[start];
    const closingStart = end - delimiterLength;
    if (
      (delimiter !== "*" && delimiter !== "_") ||
      text.slice(start, start + delimiterLength) !==
        delimiter.repeat(delimiterLength) ||
      text.slice(closingStart, end) !== delimiter.repeat(delimiterLength)
    ) {
      continue;
    }
    for (let index = start; index < start + delimiterLength; index += 1) {
      projected[index] = " ";
    }
    for (let index = closingStart; index < end; index += 1) {
      projected[index] = " ";
    }
  }
  return projected.join("");
}

function isSafeguardPatternActionAssociated(
  text: string,
  matchStart: number,
  actionStart: number,
  immediateContinuationCondition: RegExp | undefined,
  restoredApprovalGuardCanExempt: boolean,
): boolean {
  const prefix = text.slice(matchStart, actionStart);
  const crossesHardBoundary = SAFEGUARD_HARD_SCOPE_BOUNDARY_RE.test(prefix);
  if (immediateContinuationCondition === undefined) {
    return !crossesHardBoundary;
  }
  if (!crossesHardBoundary) {
    return (
      !restoredApprovalGuardCanExempt ||
      !safeguardActionHasExplicitApprovalGuard(text, actionStart)
    );
  }

  const condition = immediateContinuationCondition.exec(prefix);
  if (condition?.index === undefined) return false;
  const bridge = prefix.slice(condition.index + condition[0].length);
  if (!SAFEGUARD_IMMEDIATE_CLAUSE_SEPARATOR_RE.test(bridge)) {
    return false;
  }
  // Approval restoration is an explicit per-family policy, not a universal
  // exemption from conditional safeguard-bypass recognition.
  if (!restoredApprovalGuardCanExempt) return true;

  return !safeguardActionHasExplicitApprovalGuard(text, actionStart);
}

function safeguardActionHasExplicitApprovalGuard(
  text: string,
  actionStart: number,
): boolean {
  const actionRemainder = text.slice(actionStart, actionStart + 160);
  const nextBoundary = actionRemainder.search(SAFEGUARD_HARD_SCOPE_BOUNDARY_RE);
  const actionClause =
    nextBoundary === -1
      ? actionRemainder
      : actionRemainder.slice(0, nextBoundary);
  return hasExplicitHumanApprovalGuard(actionClause);
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
  additionalProhibition?: (text: string, actionStart: number) => boolean,
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
    if (additionalProhibition?.(text, action.start) ?? false) {
      action.prohibited = true;
      continue;
    }
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
  if (SAFEGUARD_COMMA_ONLY_COORDINATION_BRIDGE_RE.test(bridge)) return true;
  if (SAFEGUARD_TRAILING_LIST_COMMA_BRIDGE_RE.test(bridge)) return true;
  return SAFEGUARD_CONJUNCTION_COORDINATION_BRIDGE_RE.test(bridge);
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
  return SAFEGUARD_INFINITIVAL_PURPOSE_BRIDGE_RE.test(bridge);
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

function semanticSpanEvidence(
  lines: string[],
  lineOffsets: number[],
  firstLine: number,
  start: number,
  end: number,
): DetectionEvidence {
  const startLineIndex = semanticLineIndexAtOffset(lineOffsets, start);
  const endLineIndex = semanticLineIndexAtOffset(
    lineOffsets,
    Math.max(start, end - 1),
  );
  return {
    startLine: firstLine + startLineIndex,
    endLine: firstLine + endLineIndex,
    snippet: lines.slice(startLineIndex, endLineIndex + 1).join("\n"),
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

/**
 * `matchAll` requires a global expression. Return a fresh instance so repeated
 * sentence analysis cannot share mutable `lastIndex` state.
 */
function cloneWithGlobalFlag(pattern: RegExp): RegExp {
  const flags = pattern.global ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function semanticSentenceSpans(text: string): SemanticTextSpan[] {
  const sentences: SemanticTextSpan[] = [];
  let start = 0;
  for (const boundary of text.matchAll(
    cloneWithGlobalFlag(SEMANTIC_SENTENCE_BOUNDARY_RE),
  )) {
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
    const pattern = cloneWithGlobalFlag(UNTRUSTED_EXECUTION_ACTION_RE);
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
  const match = text.match(UNTRUSTED_ACTION_VERB_RE);
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
  const pattern = cloneWithGlobalFlag(UNTRUSTED_CONTENT_SOURCE_RE);
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
  const pattern = cloneWithGlobalFlag(UNTRUSTED_CONTENT_REVIEW_GUARD_RE);
  for (const match of sentence.text.matchAll(pattern)) {
    const text = match[0] ?? "";
    const before = text.search(UNTRUSTED_REVIEW_ORDERING_RE);
    if (before < 0) continue;
    const targetText = text.slice(before);
    const target = targetText.match(UNTRUSTED_REVIEW_TARGET_ACTION_RE);
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

function isFrontmatterPolicyLine(
  line: string,
  lineIndex: number,
  bodyStartIndex: number,
): boolean {
  return lineIndex < bodyStartIndex && isPolicyLine(line);
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
  return COMMAND_LIKE_TOOL_RE.test(line);
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
  if (PERMISSIVE_APPROVAL_CLAIM_RE.test(line)) {
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
    repairConstraints: detection.metadata.repairConstraints,
    verificationStepsV2: detection.metadata.verificationStepsV2,
    llmHint: detection.metadata.llmHint,
    confidence: detection.metadata.confidence,
    riskClass: detection.metadata.riskClass,
    ...(detection.details === undefined ? {} : { details: detection.details }),
  };
}

function snippet(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}
