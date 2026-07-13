import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import type { DiagnosticId } from "./diagnostic-ids.js";
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
import type { Artifact, Finding, RiskClass, SecurityConfig } from "./types.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import {
  policyArtifactFor,
  skillArtifactsByDirectory,
} from "./security-policy-inventory.js";

type SecurityCategory = "safety";

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
};

type NetworkDestination = {
  raw: string;
  host: string;
  path: string;
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
      "compares policy metadata with simple body denials",
      "does not classify intent",
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
      "Pin package, image, and formula versions or refer to the repository lockfile.",
    constraints: [
      "Do not pick arbitrary versions without checking the repository's intended support matrix.",
      "Preserve existing package manager conventions.",
    ],
    verificationSteps: [
      "Run renma scan.",
      "Confirm dependency install instructions are pinned or lockfile-based.",
    ],
    llmHint:
      "Pin packages, images, or formulas in setup instructions, or route through the repository's lockfile command.",
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
const BODY_NETWORK_DISALLOWED_RE =
  /\b(no|without|avoid|exclude|disallow|forbid|forbidden|block|do\s+not|don't|never)\b.{0,80}\b(network|internet|external|remote|http|https|api|webhook|download|fetch|curl|wget)\b/i;
const BODY_UPLOAD_DISALLOWED_RE =
  /\b(no|without|avoid|exclude|disallow|forbid|forbidden|block|do\s+not|don't|never)\b.{0,80}\b(upload|send|post|share|attach|submit|sync|push|publish|external upload|third-party)\b/i;
const BODY_SECRET_DISALLOWED_RE =
  /\b(no|without|avoid|exclude|disallow|forbid|forbidden|block|do\s+not|don't|never)\b.{0,80}\b(secret|secrets|credential|credentials|token|password|private key|private keys|\.env|env files?|customer data)\b/i;

const NETWORK_ACTION_RE =
  /\b(curl|wget|http|https|api|webhook|post|get|upload|download|fetch|send|sync|push)\b|https?:\/\//i;
const NETWORK_DESTINATION_RE =
  /\b(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}(?::\d+)?(?:\/[^\s"'`<>{}[\]]*)?/gi;
const TRAILING_DESTINATION_PUNCTUATION_RE = /[),.;:!?]+$/;
const EXTERNAL_UPLOAD_RE =
  /\b(upload|send|post|share|attach|submit|sync|push|publish)\b.*\b(external|remote|third[- ]party|pastebin|gist|slack|discord|s3|gcs|cloud|storage|bucket|drive|dropbox|notion|jira|github)\b|\b(post|put)\b.*https?:\/\//i;
const CLOUD_UPLOAD_RE =
  /\b(upload|sync|copy|send|push|publish)\b.*\b(s3|gcs|cloud storage|bucket|drive|dropbox|box|onedrive|blob storage|azure storage|storage)\b/i;
const UPLOAD_DESTINATION_ACTION_RE =
  /\b(upload|send|post|put|share|attach|submit|sync|push|publish|copy)\b|--data(?:-binary)?\b|-X\s*(?:POST|PUT)\b/i;
const BULK_DATA_RE =
  /\b(entire|whole|all|full|complete|raw)\b.*\b(repo|repository|workspace|codebase|project|context|logs?|files?|history|dataset)\b|\b(paste|upload|send|share|attach)\b.*\b(everything|all files|full logs|full context|entire repo|whole repository)\b/i;
const UNDISCLOSED_DATA_RE =
  /\b(include|attach|paste|upload|send|share|dump|export|print|collect|provide)\b.*\b(all|entire|full|complete|raw)\b.*\b(environment variables|env vars|env|process\.env|secrets?|credentials?|tokens?)\b/i;
const OVERBROAD_CONTEXT_RE =
  /\b(load|read|include|attach|paste|ingest|collect|provide|send)\b.*\b(entire|whole|all|full|complete|raw)\b.*\b(repo|repository|workspace|codebase|context|logs?|files?)\b/i;
const NO_REDACTION_RE =
  /\b(do not|don't|without|no|never)\b.{0,30}\b(redact|redaction|sanitize|mask|obfuscate)\b|\b(redact|sanitize|mask|obfuscate)\b.{0,30}\b(disabled|false|off)\b/i;
const APPROVAL_RE =
  /\b(ask|prompt|require|obtain|wait for)\b.{0,50}\b(human|user|owner|maintainer|reviewer|security)?\s*(approval|confirmation|consent|authorization|review)\b|\b(human|user|owner|maintainer|reviewer|security)\b.{0,50}\b(approve|approval|confirm|confirmation|review|consent|authorize|authorization)\b|\bonly\b.{0,20}\b(after|with)\b.{0,40}\b(explicit\s+)?(human|user|owner|maintainer|reviewer|security)?\s*(approval|confirmation|review|authorization)\b|\bdo\s+not\s+run\s+automatically\b.{0,60}\b(human|user|maintainer|review|approval|confirmation)\b/i;
const WEAK_OR_NEGATED_APPROVAL_RE =
  /\b(no approval|approval is not|approval isn't|approved by default|approval by default|without approval|automatically approved|safe|run carefully|make sure it works)\b/i;
const RECOVERY_GUARD_RE =
  /\b(create|make|take|keep|verify|confirm|document|check|use|run)\b.{0,40}\b(backup|rollback|roll back|restore|dry[- ]run|revert)\b|\b(backup|rollback|roll back|restore|dry[- ]run|revert)\b.{0,40}\b(first|before|steps?|plan|guidance|confirm|verify|check)\b/i;
const SECRET_WORD_RE =
  /\b(secret|secrets|credential|credentials|token|password|passwd|api key|apikey|private key|ssh key|signing key|certificate|cert|auth)\b/i;
const SECRET_ACTION_RE =
  /\b(copy|print|cat|echo|paste|upload|send|share|attach|include|dump|export|log|summari[sz]e|read)\b/i;
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

const SENSITIVE_FILE_PATTERNS = [
  /\.env(?:\b|\.|$)/i,
  /(^|[/\s])id_(rsa|dsa|ecdsa|ed25519)(?:\b|$)/i,
  /(^|[/\s])\.?ssh\/(?:config|id_[A-Za-z0-9_-]+)/i,
  /\.(p12|pfx|pem|key|p8|mobileprovision)(?:\b|$)/i,
  /(^|[/\s])kubeconfig(?:\b|$)/i,
  /(^|[/\s])\.kube\/config(?:\b|$)/i,
  /(^|[/\s])\.aws\/credentials(?:\b|$)/i,
  /(^|[/\s])credentials\.json(?:\b|$)/i,
  /(^|[/\s])service-account(?:\b|\.json|$)/i,
  /(^|[/\s])secrets?\.(json|ya?ml|toml|env)(?:\b|$)/i,
];

const CLOUD_DESTINATION_RE =
  /\b(s3:\/\/|gs:\/\/|az:\/\/|https?:\/\/(?:[^/\s]+\.)?(?:s3|storage|blob|drive|dropbox|box|onedrive|pastebin|gist|slack|discord)[^/\s]*\S*)/i;

type SecurityDiagnosticsConfig = {
  security?: SecurityConfig;
};

export function securityDiagnosticFindings(
  artifacts: Artifact[],
  config: SecurityDiagnosticsConfig = {},
): Finding[] {
  const owningSkills = skillArtifactsByDirectory(artifacts);
  return artifacts.flatMap((artifact) =>
    securityFindingsForArtifact(
      artifact,
      config.security,
      artifact.kind === "script" || artifact.kind === "asset"
        ? policyArtifactFor(artifact, owningSkills)
        : artifact,
    ),
  );
}

function securityFindingsForArtifact(
  artifact: Artifact,
  securityConfig?: SecurityConfig,
  policyArtifact?: Artifact,
): Finding[] {
  if (artifact.kind === "asset" || artifact.contentClassification === "binary")
    return [];
  const policyResolution = resolveOperationalSecurityPolicy(
    policyArtifact ?? { ...artifact, content: "" },
  );
  const effectiveSecurityConfig =
    artifact.kind === "script" && policyArtifact === undefined
      ? undefined
      : securityConfig;
  const parsedPolicy = policyResolution.policy;
  const policy = applySecurityConfig(parsedPolicy, effectiveSecurityConfig);
  const detections: Detection[] = [
    ...(policyArtifact === artifact
      ? invalidCanonicalSecurityDetections(policyResolution.issues)
      : []),
    ...securityPolicyResolutionDetections(
      parsedPolicy,
      policy,
      effectiveSecurityConfig,
      artifact.content,
      artifact.markdownParserEligible,
    ),
  ];
  const lines = artifact.content.split(/\r?\n/);
  const scanStart = securityContentStart(
    lines,
    artifact.markdownParserEligible,
  );
  let inFence = false;
  let recentHumanApprovalLine = 0;
  let recentRiskMitigationLine = 0;

  if (
    (artifact.kind === "skill" || artifact.kind === "context") &&
    !parsedPolicy.invalidDeclared.has("allowedData") &&
    effectiveAllowedDataClass(policy) === undefined &&
    effectiveAllowedDataList(policy).length === 0
  ) {
    detections.push({
      metadata: RULES.missingPolicyMetadata,
      severity: "medium",
      startLine: 1,
      snippet: "missing allowed_data policy metadata",
    });
  }

  detections.push(
    ...bodyPolicyContradictionDetections(
      artifact.content,
      policy,
      artifact.markdownParserEligible,
    ),
  );

  for (let index = scanStart; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    }

    const strippedComment = line.replace(/^\s*(#|\/\/)\s*/, "");
    const shellComment =
      /^\s*(#|\/\/)/.test(line) &&
      (inFence ||
        isCommandLike(strippedComment) ||
        CREDENTIAL_ARG_ANY_RE.test(strippedComment) ||
        REMOTE_SCRIPT_RE.test(strippedComment) ||
        PREDICTABLE_TEMP_RE.test(strippedComment));
    if (shellComment) {
      continue;
    }
    if (artifact.markdownParserEligible && isPolicyLine(line)) {
      continue;
    }
    const hasHumanApprovalGuard =
      hasExplicitHumanApprovalGuard(line) ||
      (recentHumanApprovalLine > 0 &&
        lineNumber - recentHumanApprovalLine <=
          DEFAULT_QUALITY_PROFILE.security.precedingLineFastPath) ||
      hasStructuredGuard(lines, index, hasExplicitHumanApprovalGuard);
    const hasCommandRiskGuard =
      hasHumanApprovalGuard ||
      hasLocalRiskMitigationGuard(line) ||
      (recentRiskMitigationLine > 0 &&
        lineNumber - recentRiskMitigationLine <=
          DEFAULT_QUALITY_PROFILE.security.precedingLineFastPath) ||
      hasStructuredGuard(lines, index, hasLocalRiskMitigationGuard);
    const commandLine =
      !shellComment &&
      (inFence ||
        isCommandLike(line) ||
        CREDENTIAL_ARG_ANY_RE.test(line) ||
        CREDENTIAL_HEADER_RE.test(line));

    detections.push(
      ...policyDetections(line, lineNumber, policy, hasHumanApprovalGuard),
    );
    detections.push(...disallowedCommandDetections(line, lineNumber, policy));
    if (!commandLine || referencesSensitiveFile(line)) {
      detections.push(...sensitiveDataDetections(line, lineNumber, policy));
    }
    if (!commandLine || policy.declared.size > 0 || isUploadInstruction(line)) {
      detections.push(...networkAndUploadDetections(line, lineNumber, policy));
    }
    detections.push(...contextScopeDetections(line, lineNumber));
    detections.push(...predictableTempDetections(line, lineNumber));

    if (commandLine) {
      detections.push(
        ...commandDetections(line, lineNumber, hasCommandRiskGuard),
      );
    }

    if (hasExplicitHumanApprovalGuard(line)) {
      recentHumanApprovalLine = lineNumber;
    }
    if (hasLocalRiskMitigationGuard(line)) {
      recentRiskMitigationLine = lineNumber;
    }
  }

  detections.push(...policyContradictions(policy));
  return dedupeDetections(detections).map((detection) =>
    findingFromDetection(artifact, detection),
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

function bodyPolicyContradictionDetections(
  content: string,
  policy: SecurityPolicy,
  markdownParserEligible: boolean,
): Detection[] {
  const detections: Detection[] = [];
  const lines = content.split(/\r?\n/);
  const scanStart = securityContentStart(lines, markdownParserEligible);
  const emitted = new Set<string>();
  let inFence = false;

  for (let index = scanStart; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || (markdownParserEligible && isPolicyLine(line))) continue;

    const lineNumber = index + 1;
    const candidates: Array<[string, boolean]> = [
      [
        "network",
        policy.networkAllowed === true && BODY_NETWORK_DISALLOWED_RE.test(line),
      ],
      [
        "upload",
        policy.externalUploadAllowed === true &&
          BODY_UPLOAD_DISALLOWED_RE.test(line),
      ],
      [
        "secrets",
        policy.secretsAllowed === true && BODY_SECRET_DISALLOWED_RE.test(line),
      ],
    ];

    for (const [kind, matched] of candidates) {
      if (!matched || emitted.has(kind)) continue;
      emitted.add(kind);
      detections.push({
        metadata: RULES.bodyPolicyContradiction,
        severity: "high",
        startLine: lineNumber,
        snippet: line.trim(),
        dedupeKey: `body-policy-contradiction:${kind}`,
      });
    }
  }

  return detections;
}

function policyDetections(
  line: string,
  lineNumber: number,
  policy: SecurityPolicy,
  hasHumanApprovalGuard: boolean,
): Detection[] {
  const detections: Detection[] = [];
  const defensiveAction = isDefensiveActionInstruction(line);
  const safeOrGuarded = isDefensiveOrGuardedActionInstruction(line);
  const invalidNetworkAllowlist = policy.invalidDeclared.has(
    "approvedNetworkDestinations",
  );
  const invalidUploadAllowlist = policy.invalidDeclared.has(
    "approvedUploadDestinations",
  );

  if (
    policy.networkAllowed === false &&
    NETWORK_ACTION_RE.test(line) &&
    !safeOrGuarded
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (
    invalidNetworkAllowlist ||
    (policy.networkAllowed !== false &&
      policy.approvedNetworkDestinations.length > 0)
  ) {
    for (const destination of unapprovedNetworkDestinations(
      line,
      policy,
      invalidNetworkAllowlist,
    )) {
      detections.push({
        metadata: RULES.unapprovedNetworkDestination,
        severity: "high",
        startLine: lineNumber,
        snippet: line,
        dedupeKey: destination.host + destination.path,
      });
    }
  }

  if (
    policy.externalUploadAllowed === false &&
    isUploadInstruction(line) &&
    !safeOrGuarded
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (
    isUploadInstruction(line) &&
    (invalidUploadAllowlist ||
      (policy.externalUploadAllowed !== false &&
        policy.approvedUploadDestinations.length > 0))
  ) {
    for (const destination of unapprovedDestinations(
      line,
      policy.approvedUploadDestinations,
      invalidUploadAllowlist,
    )) {
      detections.push({
        metadata: RULES.unapprovedUploadDestination,
        severity: "high",
        startLine: lineNumber,
        snippet: line,
        dedupeKey: invalidUploadAllowlist
          ? `invalid-upload:${destination.host}${destination.path}`
          : destination.host + destination.path,
      });
    }
  }

  if (
    policy.secretsAllowed === false &&
    SECRET_WORD_RE.test(line) &&
    !SAFE_NEGATION_RE.test(line)
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (
    effectiveAllowedDataClass(policy)?.toLowerCase() === "disclosed" &&
    UNDISCLOSED_DATA_RE.test(line)
  ) {
    detections.push({
      metadata: RULES.instructionViolatesPolicy,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  const needsApproval =
    policy.humanApprovalRequired === true &&
    requiresHumanApprovalGuard(line) &&
    !hasHumanApprovalGuard &&
    !defensiveAction;
  if (needsApproval) {
    detections.push({
      metadata: RULES.missingHumanApprovalGuard,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
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
  lineNumber: number,
  policy: SecurityPolicy,
): Detection[] {
  const detections: Detection[] = [];
  const sensitiveFile = referencesSensitiveFile(line);

  if (sensitiveFile && !isSafeSensitiveHandlingInstruction(line)) {
    detections.push({
      metadata: RULES.sensitiveFileReference,
      severity: "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  const exposesSecret =
    SECRET_ACTION_RE.test(line) &&
    (SECRET_WORD_RE.test(line) || sensitiveFile) &&
    !isSafeSensitiveHandlingInstruction(line);

  if (exposesSecret) {
    detections.push({
      metadata: RULES.secretMaterialInstruction,
      severity:
        policy.secretsAllowed === false || policy.externalUploadAllowed === true
          ? "critical"
          : "high",
      startLine: lineNumber,
      snippet: line,
    });
  }

  return detections;
}

function referencesSensitiveFile(line: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(line));
}

function isSafeSensitiveHandlingInstruction(line: string): boolean {
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
  lineNumber: number,
  policy: SecurityPolicy,
): Detection[] {
  const detections: Detection[] = [];
  if (isDefensiveOrGuardedActionInstruction(line)) {
    return detections;
  }

  if (EXTERNAL_UPLOAD_RE.test(line)) {
    detections.push({
      metadata: RULES.externalUploadInstruction,
      severity: policy.externalUploadAllowed === false ? "high" : "medium",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (BULK_DATA_RE.test(line)) {
    detections.push({
      metadata: RULES.bulkDataSharingInstruction,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (CLOUD_UPLOAD_RE.test(line) || CLOUD_DESTINATION_RE.test(line)) {
    detections.push({
      metadata: RULES.cloudUploadInstruction,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
    });
  }

  return detections;
}

function contextScopeDetections(line: string, lineNumber: number): Detection[] {
  const detections: Detection[] = [];

  if (OVERBROAD_CONTEXT_RE.test(line)) {
    detections.push({
      metadata: RULES.overbroadContextInstruction,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
    });
  }

  if (NO_REDACTION_RE.test(line)) {
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

  const unpinnedInstall = unpinnedDependencyInstall(line);
  if (unpinnedInstall && !defensiveAction) {
    detections.push({
      metadata: RULES.unpinnedDependencyInstall,
      severity: "medium",
      startLine: lineNumber,
      snippet: line,
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
): Detection[] {
  const detections: Detection[] = [];
  if (parsedPolicy.securityProfile === undefined) {
    addForbiddenInputDetections(
      detections,
      resolvedPolicy,
      content,
      markdownParserEligible,
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
  );

  return detections;
}

function addForbiddenInputDetections(
  detections: Detection[],
  policy: SecurityPolicy,
  content: string,
  markdownParserEligible: boolean,
): void {
  for (const forbiddenInput of policy.forbiddenInputs) {
    const detection = forbiddenInputDetection(
      content,
      forbiddenInput,
      markdownParserEligible,
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
  issues: CanonicalSecurityMetadataIssue[],
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
): Detection | undefined {
  const needle = forbiddenInput.trim();
  if (needle.length === 0) return undefined;

  const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
  const lines = content.split(/\r?\n/);
  const scanStart = securityContentStart(lines, markdownParserEligible);
  for (let index = scanStart; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!pattern.test(line)) continue;
    if (SAFE_FORBIDDEN_INPUT_PATTERN.test(line)) continue;
    if (!FORBIDDEN_INPUT_ACTION_PATTERN.test(line)) continue;
    return {
      metadata: RULES.forbiddenInputInstruction,
      severity: "high",
      startLine: index + 1,
      snippet: line.trim(),
      dedupeKey: `forbidden-input:${needle.toLowerCase()}`,
    };
  }
  return undefined;
}

function securityContentStart(
  lines: string[],
  markdownParserEligible: boolean,
): number {
  if (!markdownParserEligible || lines[0]?.trim() !== "---") return 0;
  const frontmatterEnd = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return frontmatterEnd > 0 ? frontmatterEnd + 1 : 0;
}

function lineSnippet(content: string, line: number): string | undefined {
  return content.split(/\r?\n/)[line - 1]?.trim();
}

function unapprovedNetworkDestinations(
  line: string,
  policy: SecurityPolicy,
  invalidAllowlist = false,
): NetworkDestination[] {
  return unapprovedDestinations(
    line,
    policy.approvedNetworkDestinations,
    invalidAllowlist,
  );
}

function unapprovedDestinations(
  line: string,
  approvedDestinations: string[],
  invalidAllowlist = false,
): NetworkDestination[] {
  const destinations = extractNetworkDestinations(line);
  if (invalidAllowlist) return destinations;

  const approved = approvedDestinations
    .map((destination) => normalizeNetworkDestination(destination))
    .filter(
      (destination): destination is NetworkDestination =>
        destination !== undefined,
    );
  if (approved.length === 0) {
    return [];
  }

  return destinations.filter(
    (destination) =>
      !approved.some((approvedDestination) =>
        networkDestinationMatches(destination, approvedDestination),
      ),
  );
}

function isUploadInstruction(line: string): boolean {
  return (
    EXTERNAL_UPLOAD_RE.test(line) ||
    CLOUD_UPLOAD_RE.test(line) ||
    (UPLOAD_DESTINATION_ACTION_RE.test(line) &&
      extractNetworkDestinations(line).length > 0)
  );
}

function extractNetworkDestinations(line: string): NetworkDestination[] {
  const seen = new Set<string>();
  const destinations: NetworkDestination[] = [];
  for (const match of line.matchAll(NETWORK_DESTINATION_RE)) {
    const destination = normalizeNetworkDestination(match[0] ?? "");
    if (destination === undefined) {
      continue;
    }
    const key = destination.host + destination.path;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    destinations.push(destination);
  }
  return destinations;
}

function normalizeNetworkDestination(
  candidate: string,
): NetworkDestination | undefined {
  const raw = candidate.trim().replace(TRAILING_DESTINATION_PUNCTUATION_RE, "");
  if (raw.length === 0) {
    return undefined;
  }

  const parseable = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  try {
    const url = new URL(parseable);
    const host = url.hostname.toLowerCase();
    if (!host.includes(".")) {
      return undefined;
    }
    const path = url.pathname.replace(/\/+$/, "");
    return {
      raw,
      host,
      path: path === "/" ? "" : path,
    };
  } catch {
    return undefined;
  }
}

function networkDestinationMatches(
  candidate: NetworkDestination,
  approved: NetworkDestination,
): boolean {
  if (approved.path.length > 0) {
    return (
      candidate.host === approved.host &&
      (candidate.path === approved.path ||
        candidate.path.startsWith(`${approved.path}/`))
    );
  }

  return (
    candidate.host === approved.host ||
    candidate.host.endsWith(`.${approved.host}`)
  );
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

function isCommandLike(line: string): boolean {
  return /\b(npm|pnpm|yarn|pip3?|brew|docker|curl|wget|sudo|chmod|chown|git|gh|aws|gcloud|az|kubectl|echo|cat|cp|mv|rm|touch|mkdir)\b/i.test(
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

function hasStructuredGuard(
  lines: string[],
  commandIndex: number,
  guard: (line: string) => boolean,
): boolean {
  const command = lines[commandIndex] ?? "";
  const commandIndent = command.match(/^\s*/)?.[0].length ?? 0;

  // Same Markdown list item, including an indented fenced command.
  if (commandIndent > 0) {
    for (let index = commandIndex - 1; index >= 0; index -= 1) {
      const line = lines[index] ?? "";
      if (/^\s*#{1,6}\s+/.test(line) || line.trim() === "---") break;
      if (/^\s*[-*+]\s+/.test(line)) return guard(line);
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (line.trim() && indent < commandIndent) break;
    }
  }

  // Paragraph directly associated with the command or its opening fence.
  let cursor = commandIndex - 1;
  while (cursor >= 0 && /^\s*```/.test(lines[cursor] ?? "")) cursor -= 1;
  while (cursor >= 0 && !(lines[cursor] ?? "").trim()) cursor -= 1;
  const paragraph: string[] = [];
  while (cursor >= 0) {
    const line = lines[cursor] ?? "";
    if (!line.trim() || line.trim() === "---" || /^\s*#{1,6}\s+/.test(line))
      break;
    paragraph.unshift(line);
    cursor -= 1;
  }
  if (paragraph.some(guard)) return true;

  // Explicit guard prose earlier in the same safety/constraint section is
  // structurally associated without depending on a fixed distance.
  const headingIndex = findParentSafetyHeading(lines, commandIndex);
  return (
    headingIndex >= 0 && lines.slice(headingIndex, commandIndex + 1).some(guard)
  );
}

function findParentSafetyHeading(lines: string[], fromIndex: number): number {
  let childDepth = 7;
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const match = (lines[index] ?? "").match(/^\s*(#{1,6})\s+(.+)$/);
    if (!match) continue;
    const depth = match[1]?.length ?? 1;
    if (depth >= childDepth) continue;
    if (
      /\b(human approval|safety|constraints?|guardrails?)\b/i.test(
        match[2] ?? "",
      )
    )
      return index;
    childDepth = depth;
  }
  return -1;
}

function requiresHumanApprovalGuard(line: string): boolean {
  return (
    EXTERNAL_UPLOAD_RE.test(line) ||
    CLOUD_UPLOAD_RE.test(line) ||
    referencesConcreteNetworkDestination(line) ||
    (SECRET_ACTION_RE.test(line) && SECRET_WORD_RE.test(line)) ||
    (referencesSensitiveFile(line) &&
      !isSafeSensitiveHandlingInstruction(line)) ||
    PRIVILEGED_COMMAND_RE.test(line) ||
    DESTRUCTIVE_COMMAND_RE.test(line)
  );
}

function referencesConcreteNetworkDestination(line: string): boolean {
  return (
    NETWORK_ACTION_RE.test(line) && extractNetworkDestinations(line).length > 0
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

  const pip = line.match(/\bpip3?\s+install\s+([^\n#]+)/i);
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
      (arg) =>
        arg.length > 0 &&
        !arg.startsWith("-") &&
        !arg.includes("=") &&
        !/[|;&]/.test(arg),
    );
}

function isUnpinnedNpmPackage(arg: string): boolean {
  if (isPlaceholder(arg) || arg.startsWith("$") || arg.startsWith(".")) {
    return false;
  }
  const packageName = arg.startsWith("@")
    ? arg.split("@").slice(0, 2).join("@")
    : arg.split("@")[0];
  return packageName === arg;
}

function isUnpinnedPythonPackage(arg: string): boolean {
  if (isPlaceholder(arg) || arg.startsWith("-") || arg.startsWith(".")) {
    return false;
  }
  return !/[=<>~!]=|===/.test(arg);
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
  for (const detection of detections) {
    const key =
      detection.dedupeKey ?? `${detection.metadata.id}:${detection.snippet}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(detection);
    }
  }
  return unique;
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
  };
}

function snippet(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}
