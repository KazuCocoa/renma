import assert from "node:assert/strict";
import test from "node:test";

import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import {
  BODY_POLICY_0244_GOLDEN_CASES,
  BODY_POLICY_0244_GOLDEN_SOURCE,
  type LegacyBodyPolicyFindingProjection,
} from "./fixtures/body-policy-0244-golden.js";

interface IntentionalCompatibilityChange {
  readonly reason: string;
  readonly current: readonly LegacyBodyPolicyFindingProjection[];
}

const INTENTIONAL_COMPATIBILITY_CHANGES: Readonly<
  Record<string, IntentionalCompatibilityChange>
> = {
  "pairwise-01-ordinary-one-line": findingChange(
    "This workflow validates inputs and is deterministic, yet must not use the network.",
    "Statement groups intentionally retain the explicit workflow subject through a supported copular middle predicate.",
  ),
  "pairwise-05-modified-ordinary-one-line": findingChange(
    "The operation requires external uploads and also may write local logs, yet must not upload files.",
    "Statement groups intentionally retain the explicit operation subject through a supported auxiliary middle predicate.",
  ),
  "pairwise-09-but-one-line": findingChange(
    "This run does not require credential access but audits logs, yet must not use credentials.",
    "Statement groups intentionally retain the explicit run subject through a supported ordinary middle predicate.",
  ),
  "pairwise-13-yet-one-line": findingChange(
    "The process must not upload files during local setup, yet checks configuration, yet must not use the network.",
    "A local first predicate no longer discards the grammatical process subject before a complete later workflow prohibition.",
  ),
  "pairwise-17-however-one-line": findingChange(
    "This task must not access credentials from production; however, it is deterministic, yet must not upload files.",
    "A specific-source first predicate no longer discards the grammatical task subject through a supported copular predicate.",
  ),
  "pairwise-21-semicolon-one-line": compatibilityChange(
    [
      finding("This workflow must not use the network"),
      finding(
        "This workflow must not use the network; may write local logs, yet must not use credentials.",
      ),
    ],
    "Strict semicolon compatibility preserves the first-domain finding while statement-group continuation adds the independently supported later domain.",
  ),
  "pairwise-22-semicolon-soft-wrap": findingChange(
    "This task must not upload files;",
    "Physical-line evidence intentionally retains the visible semicolon before an ordinary Markdown soft wrap.",
  ),
  "pairwise-23-semicolon-hard-break": findingChange(
    "The process must not upload files; may write local logs, yet audits logs but",
    "An independently complete first-domain prohibition remains reportable with evidence bounded to the physical line before a Markdown hard break.",
  ),
  "pairwise-25-then-one-line": findingChange(
    "The operation validates inputs then audits logs, yet must not use the network.",
    "Strict then compatibility carries the explicit operation subject through the supported ordinary middle predicate.",
  ),
  "descriptive-says-helper-one-line": noFindingChange(
    "Precision tightening rejects a descriptive bridge that assigns the prohibition to a helper rather than the workflow.",
  ),
  "descriptive-says-helper-soft-wrap": noFindingChange(
    "The descriptive changed-subject precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "descriptive-says-helper-heading": noFindingChange(
    "Fallback headings use the same descriptive changed-subject precision boundary as prepared prose.",
  ),
  "descriptive-documents-helper-one-line": noFindingChange(
    "Precision tightening rejects documentation about a helper prohibition as a workflow-wide instruction.",
  ),
  "descriptive-documents-helper-soft-wrap": noFindingChange(
    "The descriptive helper precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "descriptive-documents-helper-heading": noFindingChange(
    "Fallback headings use the same descriptive helper precision boundary as prepared prose.",
  ),
  "conditional-subject-bridge-one-line": noFindingChange(
    "A conditional subject-to-predicate bridge is not treated as an unconditional workflow prohibition.",
  ),
  "conditional-subject-bridge-soft-wrap": noFindingChange(
    "The conditional bridge precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "conditional-subject-bridge-heading": noFindingChange(
    "Fallback headings use the same conditional bridge precision boundary as prepared prose.",
  ),
  "changed-subject-bridge-one-line": noFindingChange(
    "A helper introduced between the workflow subject and prohibition is an explicit changed subject.",
  ),
  "changed-subject-bridge-soft-wrap": noFindingChange(
    "The direct changed-subject precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "changed-subject-bridge-heading": noFindingChange(
    "Fallback headings use the same direct changed-subject precision boundary as prepared prose.",
  ),
  "changed-middle-helper-one-line": noFindingChange(
    "An explicit helper subject clears inherited workflow scope before the later implicit predicate.",
  ),
  "precision-unexpected-modifier": noFindingChange(
    "An unrecognized adverb is unsupported bridge syntax rather than evidence of workflow-subject inheritance.",
  ),
  "precision-changed-helper": noFindingChange(
    "An explicit helper subject prevents the later prohibition from inheriting workflow scope.",
  ),
  "precision-unsupported-although": noFindingChange(
    "An unsupported subordinate connector does not inherit workflow scope.",
  ),
  "precision-offline-helper": noFindingChange(
    "An explicit offline-helper subject prevents workflow-subject inheritance.",
  ),
  "precision-specific-upload-target": noFindingChange(
    "A destination-specific upload restriction does not contradict workflow-wide permissive upload metadata.",
  ),
  "precision-unsupported-network-remainder": noFindingChange(
    "An exception clause leaves the prohibition incomplete and therefore non-emitting.",
  ),
  "precision-semicolon-however-without-comma": noFindingChange(
    "The malformed semicolon-however boundary is unsupported syntax and does not inherit workflow scope.",
  ),
  "precision-changed-helper-chain": noFindingChange(
    "A changed helper subject clears subject state across the remainder of a contrastive chain.",
  ),
  "independent-earlier-network-prohibition": findingChange(
    "No network access and this workflow requires network access",
    "Independent same-domain facts retain the earlier complete prohibition instead of allowing the later requirement to suppress it.",
  ),
  "stabilization-unrelated-workflow": findingChange(
    "This workflow validates inputs but must not use credentials.",
    "Statement-group evidence includes the inherited prohibition instead of ending at the earlier domain-free predicate.",
  ),
  "stabilization-unrelated-task": findingChange(
    "This task prepares the report, yet must not upload files.",
    "Statement-group evidence includes the inherited prohibition instead of ending at the earlier domain-free task predicate.",
  ),
  "stabilization-unrelated-process": findingChange(
    "The process checks configuration; however, it must not use the network.",
    "Statement-group evidence includes the inherited prohibition instead of ending at the earlier domain-free process predicate.",
  ),
  "stabilization-specific-network": findingChange(
    "This workflow must not use network access to production systems but must not use credentials.",
    "A specific-target first predicate no longer prevents an independent later-domain workflow prohibition.",
  ),
  "stabilization-specific-secret": findingChange(
    "This workflow must not access credentials from production yet must not upload files.",
    "A specific-source first predicate no longer prevents an independent later-domain workflow prohibition.",
  ),
  "stabilization-three-secrets": findingChange(
    "This workflow requires network access but checks logs, yet must not use credentials.",
    "Statement-group subject state and evidence intentionally span three supported predicates.",
  ),
  "stabilization-three-upload": findingChange(
    "This workflow requires network access, but may write local logs, yet must not upload files.",
    "Statement-group subject state intentionally spans an auxiliary middle predicate beyond the legacy matcher distance.",
  ),
  "stabilization-modifier-still": findingChange(
    "This workflow requires network access but still must not use credentials.",
    "Evidence includes the supported bounded modifier and inherited prohibition.",
  ),
  "stabilization-modifier-also": findingChange(
    "This workflow requires credentials yet also must not upload files.",
    "Evidence includes the supported bounded modifier and inherited cross-domain prohibition.",
  ),
  "stabilization-modifier-therefore": findingChange(
    "This workflow requires external uploads; however, it therefore must not use the network.",
    "The bounded statement modifier grammar intentionally supports therefore across a contrastive boundary.",
  ),
  "stabilization-heading": findingChange(
    "## This workflow requires network access but must not use credentials",
    "Fallback heading evidence includes the supported inherited prohibition.",
  ),
  "stabilization-bare-semicolon": findingChange(
    "This workflow requires network access; must not use credentials.",
    "Strict semicolon compatibility retains the finding while evidence includes its prohibition.",
  ),
  "stabilization-then": findingChange(
    "This workflow requires network access then must not use credentials.",
    "Strict then compatibility retains the finding while evidence includes its prohibition.",
  ),
  "stabilization-middle-copular": findingChange(
    "This workflow validates inputs but is deterministic, yet must not use credentials.",
    "Statement groups intentionally retain the explicit subject through a supported copular middle predicate.",
  ),
  "stabilization-middle-audits": findingChange(
    "This workflow validates inputs but audits logs, yet must not upload files.",
    "Statement groups intentionally retain the explicit subject through a curated ordinary middle predicate.",
  ),
  "stabilization-middle-reviews": findingChange(
    "This task runs but reviews results, yet must not use the network.",
    "Statement groups intentionally retain the explicit task subject through a curated ordinary middle predicate.",
  ),
  "scope-proof-descriptive-lists-upload": noFindingChange(
    "A descriptive lists bridge does not turn quoted or summarized upload policy text into a workflow prohibition.",
  ),
  "scope-proof-changed-helper-network": noFindingChange(
    "A supported subjectless network prohibition cannot borrow workflow scope after an explicit helper subject.",
  ),
  "scope-proof-changed-helper-upload": noFindingChange(
    "A supported subjectless upload prohibition remains attached to its explicit helper subject.",
  ),
  "scope-proof-conditional-network": noFindingChange(
    "A conditional predicate segment cannot receive the clause-facts standalone workflow default.",
  ),
  "bridge-parenthetical-deterministic-validation": noFindingChange(
    "During deterministic validation establishes phase-local scope just as other bounded validation phases do.",
  ),
  "bridge-parenthetical-local-network": noFindingChange(
    "Local setup scope inside a subject bridge is preserved instead of erased before fact classification.",
  ),
  "bridge-parenthetical-validation-upload": noFindingChange(
    "A validation-step-only bridge is local and therefore does not contradict workflow-wide upload permission.",
  ),
  "bridge-parenthetical-exception-network": noFindingChange(
    "An exception inside a subject bridge prevents classification as a complete workflow prohibition.",
  ),
  "bridge-parenthetical-target-upload": noFindingChange(
    "A destination inside a subject bridge preserves specific-target upload scope.",
  ),
  "middle-inflected-uploads": findingChange(
    "This workflow checks inputs but uploads files, yet must not use credentials.",
    "The third-person upload predicate retains the grammatical workflow subject and bounds evidence through the final prohibition.",
  ),
  "middle-inflected-operates": findingChange(
    "This workflow validates inputs but operates offline, yet must not use credentials.",
    "The third-person operates predicate retains the grammatical workflow subject and bounds evidence through the final prohibition.",
  ),
  "middle-changed-audit-jobs": noFindingChange(
    "Audit jobs is a strong noun phrase with its own modal predicate, so it clears workflow-subject state.",
  ),
  "middle-changed-review-tasks": noFindingChange(
    "Review tasks is a strong changed subject rather than the subjectless verb reviews.",
  ),
  "middle-changed-log-processors": noFindingChange(
    "Log processors is a strong changed subject rather than the subjectless verb logs.",
  ),
  "bounded-directive-please-network": findingChange(
    "Please do not use the network.",
    "A bounded directive prefix preserves the standalone policy scope of the supported prohibition.",
  ),
  "bounded-coordination-semicolon-network": findingChange(
    "never use the network.",
    "A directly supported prohibition after subjectless semicolon coordination receives an independent standalone policy default.",
  ),
  "bounded-coordination-two-domains-and": compatibilityChange(
    [
      finding("No external uploads and never use the network."),
      finding("No external uploads and never use the network."),
    ],
    "Independent subjectless prohibitions preserve one ordered finding for each enabled domain.",
  ),
  "bounded-coordination-two-domains-semicolon": compatibilityChange(
    [finding("Never use the network"), finding("no external uploads.")],
    "The independently supported first predicate adds the missing network finding while retaining the legacy upload evidence.",
  ),
  "bounded-paired-local-network": noFindingChange(
    "A comma-delimited local modifier remains attached to the prohibition and prevents workflow-wide scope.",
  ),
  "bounded-paired-exception-network": noFindingChange(
    "A comma-delimited exception remains attached to the prohibition and prevents complete workflow-wide scope.",
  ),
  "bounded-paired-target-upload": noFindingChange(
    "A comma-delimited upload target remains attached to the prohibition and preserves target-specific scope.",
  ),
  "bounded-changed-subject-audits": noFindingChange(
    "The one-word plural noun audits is a changed subject before a modal prohibition, so later predicates cannot inherit workflow scope through it.",
  ),
  "bounded-changed-subject-reviews": noFindingChange(
    "The one-word plural noun reviews is a changed subject before a modal prohibition, so later predicates cannot inherit workflow scope through it.",
  ),
  "stabilization2-directive-conditional-secrets": noFindingChange(
    "A supported outer directive cannot bypass the embedded workflow subject's conditional bridge.",
  ),
  "stabilization2-directive-local-upload": noFindingChange(
    "A supported policy label cannot erase local scope inside the embedded workflow subject bridge.",
  ),
  "stabilization2-directive-changed-helper-secrets": noFindingChange(
    "A supported outer policy label cannot bypass an explicit helper subject between the embedded workflow subject and prohibition.",
  ),
  "stabilization2-semicolon-unknown-network": findingChange(
    "never use the network.",
    "A bare semicolon proves an independent standalone policy boundary even when the preceding imperative is outside the curated predicate vocabulary.",
  ),
  "stabilization2-semicolon-unknown-secrets": findingChange(
    "never use credentials.",
    "A directly supported secret prohibition after a bare semicolon remains independent of the unknown preceding imperative.",
  ),
  "stabilization2-relative-target-network": findingChange(
    "This workflow that documents network access to production must not use the network.",
    "The network target belongs to the bounded relative predicate and no longer qualifies the later workflow prohibition.",
  ),
  "stabilization2-homograph-finite-reviews": noFindingChange(
    "Reviews followed by the finite head require is a changed subject, so it clears workflow-subject inheritance before the later prohibition.",
  ),
  "stabilization3-prefixed-network": findingChange(
    "Policy: this workflow validates inputs but must not use the network.",
    "The supported policy prefix now installs the embedded workflow subject in statement-group state, so the later predicate inherits it with complete evidence.",
  ),
  "stabilization3-prefixed-secrets": findingChange(
    "Requirement: the process checks configuration, yet must not use credentials.",
    "A policy-label-prefixed process subject remains active across the contrastive continuation.",
  ),
  "stabilization3-later-directive": findingChange(
    "For safety, never use the network.",
    "A supported directive after a bare semicolon starts an independent standalone policy instead of retaining evidence from the earlier active subject.",
  ),
  "stabilization3-modal-shared-network": findingChange(
    "This workflow validates inputs but must never use the network.",
    "Modal-never is classified as a subjectless prohibition before the strong changed-subject matcher.",
  ),
  "stabilization3-modifier-shared-secrets": findingChange(
    "The process checks configuration but explicitly cannot use credentials.",
    "The shared bounded modifier vocabulary recognizes explicitly as an inherited predicate prefix.",
  ),
  "stabilization3-modifier-shared-secret-verb": findingChange(
    "This task checks inputs but directly never uses credentials.",
    "The shared prefix grammar and bounded third-person secret action preserve the explicit task subject.",
  ),
  "stabilization3-modal-hard-network": findingChange(
    "Must never use the network.",
    "A directly supported modal-never prohibition receives standalone scope after a hard sentence boundary.",
  ),
  "stabilization3-modal-hard-upload": findingChange(
    "Shall never upload files.",
    "The complete modal-never family is supported for standalone upload prohibitions after a hard boundary.",
  ),
  "stabilization3-quoted-single": noFindingChange(
    "A bare semicolon inside a bounded straight-single-quoted example cannot create an independent policy or retain only the closing quote in evidence.",
  ),
  "stabilization3-prefixed-paired-local": noFindingChange(
    "A supported outer policy label does not erase a naked local paired-comma qualification.",
  ),
  "stabilization3-prefixed-paired-exception": noFindingChange(
    "A supported directive does not erase a naked paired-comma exception.",
  ),
  "stabilization3-prefixed-paired-target": noFindingChange(
    "A supported policy label does not erase a destination-specific paired-comma upload qualification.",
  ),
  "stabilization3-relative-inner-prohibition": findingChange(
    "This workflow,\nwhich the helper says must not use the network,\nmust not upload files.",
    "The bounded object-relative clause remains attached while only the main upload prohibition receives workflow scope.",
    13,
  ),
  "stabilization3-homograph-upload": noFindingChange(
    "Reports followed by the compatible finite security action upload is a changed subject and clears workflow-subject inheritance.",
  ),
  "stabilization3-subjectless-audits": findingChange(
    "This workflow audits logs, then must not upload files.",
    "The genuine subjectless audits predicate retains the workflow subject through a comma-then continuation.",
  ),
  "stabilization3-make-sure-that": findingChange(
    "Make sure that this workflow never uses credentials.",
    "Optional that after a recognized make-sure directive and a bounded third-person action remain an instruction.",
  ),
};

const PAIRWISE_CASES = BODY_POLICY_0244_GOLDEN_CASES.filter(
  ({ coverage }) => coverage.group === "pairwise",
);

const CURRENT_BODY_POLICY_PRECISION_MATRIX = [
  {
    name: "standalone subjectless default",
    body: "Do not use the network.",
    expected: [finding("Do not use the network.")],
    coverage: {
      predicateStart: "supported-subjectless",
      provenance: "supported-subjectless",
      subjectProof: "standalone-default",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "explicit workflow qualifier",
    body: "Network access is forbidden for this workflow.",
    expected: [finding("Network access is forbidden for this workflow.")],
    coverage: {
      predicateStart: "unsupported",
      provenance: "supported-domain-subject",
      subjectProof: "explicit-workflow-qualifier",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "composed direct punctuation and modifier",
    body: "This workflow: always must not use the network.",
    expected: [finding("This workflow: always must not use the network.")],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "explicit-workflow-subject",
      bridgeSequence: "punctuation-plus-modifier",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "bounded direct relative",
    body: "This workflow that validates inputs must not use credentials.",
    expected: [
      finding("This workflow that validates inputs must not use credentials."),
    ],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "explicit-workflow-subject",
      bridgeSequence: "bounded-relative",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "base middle policy verb",
    body: "This workflow checks inputs but upload reports, yet must not use the network.",
    expected: [
      finding(
        "This workflow checks inputs but upload reports, yet must not use the network.",
      ),
    ],
    coverage: {
      predicateStart: "supported-subjectless",
      provenance: "projected-supported",
      subjectProof: "inherited-workflow-subject",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "base",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "third-person middle policy verb soft wrap",
    body: "This workflow validates inputs\nbut uploads files,\nyet must not use credentials.",
    expected: [
      finding(
        "This workflow validates inputs\nbut uploads files,\nyet must not use credentials.",
        13,
      ),
    ],
    coverage: {
      predicateStart: "supported-subjectless",
      provenance: "projected-supported",
      subjectProof: "inherited-workflow-subject",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "third-person",
      layout: "soft-wrap",
      domainBehavior: "single",
    },
  },
  {
    name: "heading fallback direct bridge",
    body: "## This task — explicitly cannot upload files.",
    expected: [finding("## This task — explicitly cannot upload files.")],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "explicit-workflow-subject",
      bridgeSequence: "punctuation-plus-modifier",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "heading",
      domainBehavior: "single",
    },
  },
  {
    name: "descriptive direct bridge",
    body: "This workflow lists no external uploads.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "descriptive",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "explicit changed subject",
    body: "This workflow checks inputs but audit jobs must never use the network, yet must not upload files.",
    expected: [],
    coverage: {
      predicateStart: "explicit-changed-subject",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "changed-subject",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "conditional predicate segment",
    body: "This workflow validates inputs\nbut if offline, never use the network.",
    expected: [],
    coverage: {
      predicateStart: "conditional-or-subordinate",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "conditional",
      verbForm: "none",
      layout: "soft-wrap",
      domainBehavior: "clean",
    },
  },
  {
    name: "unsupported predicate start",
    body: "This workflow unexpectedly must not use credentials.",
    expected: [],
    coverage: {
      predicateStart: "unsupported",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "unsupported",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "parenthetical local scope",
    body: "This workflow (during local setup) must not use the network.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "bounded-parenthetical",
      bridgeQualification: "local-step",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "parenthetical exception",
    body: "This workflow (except for approved domains) must not use the network.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "bounded-parenthetical",
      bridgeQualification: "exception",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "parenthetical specific target",
    body: "This workflow (to a public bucket) must not upload files.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "bounded-parenthetical",
      bridgeQualification: "specific-target",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "domain ordering and deduplication",
    body: "This workflow must not use the network and also must not use the network, must not upload files, yet must not use credentials.",
    expected: [
      finding(
        "This workflow must not use the network and also must not use the network, must not upload files,",
      ),
      finding(
        "This workflow must not use the network and also must not use the network, must not upload files,",
      ),
      finding(
        "This workflow must not use the network and also must not use the network, must not upload files, yet must not use credentials.",
      ),
    ],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "mixed-supported",
      subjectProof: "inherited-workflow-subject",
      bridgeSequence: "modifier",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "ordered-deduplicated",
    },
  },
] as const;

const CURRENT_BOUNDED_STATEMENT_MATRIX = [
  {
    name: "directive one-line",
    body: "Please do not use the network.",
    expected: [finding("Please do not use the network.")],
    coverage: {
      directivePrefix: "directive",
      separator: "start",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "none",
      layout: "one-line",
    },
  },
  {
    name: "directive soft wrap",
    body: "For safety,\nno external uploads.",
    expected: [finding("For safety,\nno external uploads.", 12)],
    coverage: {
      directivePrefix: "directive",
      separator: "start",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "none",
      layout: "soft-wrap",
    },
  },
  {
    name: "policy label heading fallback",
    body: "## Policy: no external uploads.",
    expected: [finding("## Policy: no external uploads.")],
    coverage: {
      directivePrefix: "policy-label",
      separator: "start",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "none",
      layout: "heading",
    },
  },
  {
    name: "subjectless and coordination",
    body: "Validate inputs and no external uploads.",
    expected: [finding("Validate inputs and no external uploads.")],
    coverage: {
      directivePrefix: "none",
      separator: "and-without-active-subject",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "none",
      layout: "one-line",
    },
  },
  {
    name: "subjectless semicolon coordination soft wrap",
    body: "Validate inputs;\nnever use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 12,
        endLine: 12,
        snippet: "never use the network.",
      },
    ],
    coverage: {
      directivePrefix: "none",
      separator: "semicolon-without-active-subject",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "none",
      layout: "soft-wrap",
    },
  },
  {
    name: "coordination with active workflow subject",
    body: "This workflow validates inputs and never use the network.",
    expected: [
      finding("This workflow validates inputs and never use the network."),
    ],
    coverage: {
      directivePrefix: "none",
      separator: "and-with-active-subject",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "workflow",
      layout: "one-line",
    },
  },
  {
    name: "subjectless two-domain ordering",
    body: "Never use the network; no external uploads.",
    expected: [
      finding("Never use the network"),
      finding("no external uploads."),
    ],
    coverage: {
      directivePrefix: "plain-start",
      separator: "semicolon-without-active-subject",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "none",
      layout: "one-line",
    },
  },
  {
    name: "paired relative modifier",
    body: "This workflow, which validates inputs, must not use credentials.",
    expected: [
      finding(
        "This workflow, which validates inputs, must not use credentials.",
      ),
    ],
    coverage: {
      directivePrefix: "none",
      separator: "none",
      pairedModifier: "relative",
      relativeAttachment: "unqualified",
      subjectShape: "workflow",
      layout: "one-line",
    },
  },
  {
    name: "paired local modifier soft wrap",
    body: "This workflow, during local setup,\nmust not use the network.",
    expected: [],
    coverage: {
      directivePrefix: "none",
      separator: "none",
      pairedModifier: "local",
      relativeAttachment: "none",
      subjectShape: "workflow",
      layout: "soft-wrap",
    },
  },
  {
    name: "paired exception heading fallback",
    body: "## This workflow, except for approved domains, must not use the network.",
    expected: [],
    coverage: {
      directivePrefix: "none",
      separator: "none",
      pairedModifier: "exception",
      relativeAttachment: "none",
      subjectShape: "workflow",
      layout: "heading",
    },
  },
  {
    name: "paired specific target",
    body: "This workflow, to a public bucket, must not upload files.",
    expected: [],
    coverage: {
      directivePrefix: "none",
      separator: "none",
      pairedModifier: "specific-target",
      relativeAttachment: "none",
      subjectShape: "workflow",
      layout: "one-line",
    },
  },
  {
    name: "inline relative unrelated preposition",
    body: "This workflow that is designed to validate inputs must not use the network.",
    expected: [
      finding(
        "This workflow that is designed to validate inputs must not use the network.",
      ),
    ],
    coverage: {
      directivePrefix: "none",
      separator: "none",
      pairedModifier: "none",
      relativeAttachment: "unrelated-preposition",
      subjectShape: "workflow",
      layout: "one-line",
    },
  },
  {
    name: "inline relative domain-specific attachment",
    body: "This workflow that uploads reports to a public bucket must not upload files.",
    expected: [
      finding(
        "This workflow that uploads reports to a public bucket must not upload files.",
      ),
    ],
    coverage: {
      directivePrefix: "none",
      separator: "none",
      pairedModifier: "none",
      relativeAttachment: "domain-specific-preposition",
      subjectShape: "workflow",
      layout: "one-line",
    },
  },
  {
    name: "single-word changed subject",
    body: "This workflow checks inputs but audits must not use the network, yet must not upload files.",
    expected: [],
    coverage: {
      directivePrefix: "none",
      separator: "contrastive-with-active-subject",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "single-word-changed",
      layout: "one-line",
    },
  },
  {
    name: "multiword changed subject soft wrap",
    body: "This workflow checks inputs\nbut audit jobs must not use the network,\nyet must not upload files.",
    expected: [],
    coverage: {
      directivePrefix: "none",
      separator: "contrastive-with-active-subject",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "multiword-changed",
      layout: "soft-wrap",
    },
  },
  {
    name: "subjectless homograph predicate heading fallback",
    body: "## This workflow checks inputs but audits logs, yet must not upload files.",
    expected: [
      finding(
        "## This workflow checks inputs but audits logs, yet must not upload files.",
      ),
    ],
    coverage: {
      directivePrefix: "none",
      separator: "contrastive-with-active-subject",
      pairedModifier: "none",
      relativeAttachment: "none",
      subjectShape: "subjectless-homograph",
      layout: "heading",
    },
  },
] as const;

const CURRENT_DIRECTIVE_BRIDGE_MATRIX = [
  { prefix: "Policy:", prefixClass: "policy-label" },
  { prefix: "For safety,", prefixClass: "directive" },
].flatMap(({ prefix, prefixClass }) =>
  [
    {
      bridgeClass: "immediate",
      suffix: "this workflow must not use the network.",
      emits: true,
    },
    {
      bridgeClass: "descriptive",
      suffix: "this workflow says do not use the network.",
      emits: false,
    },
    {
      bridgeClass: "conditional",
      suffix: "this workflow when offline must not use the network.",
      emits: false,
    },
    {
      bridgeClass: "local",
      suffix: "this workflow (during local setup) must not use the network.",
      emits: false,
    },
    {
      bridgeClass: "changed-subject",
      suffix: "this workflow: the helper must not use the network.",
      emits: false,
    },
  ].map(({ bridgeClass, suffix, emits }) => {
    const body = `${prefix} ${suffix}`;
    return {
      name: `${prefixClass} × ${bridgeClass}`,
      body,
      expected: emits ? [finding(body)] : [],
      coverage: { prefixClass, bridgeClass },
    };
  }),
);

const CURRENT_SEPARATOR_PREVIOUS_MATRIX = [
  { previousClass: "known", previous: "Validate inputs", eligible: true },
  {
    previousClass: "unknown",
    previous: "Clean the workspace",
    eligible: false,
  },
  {
    previousClass: "changed-subject",
    previous: "The helper validates inputs",
    eligible: false,
  },
  {
    previousClass: "conditional",
    previous: "If requested validate inputs",
    eligible: false,
  },
  {
    previousClass: "descriptive",
    previous: "Documentation says validate inputs",
    eligible: false,
  },
].flatMap(({ previousClass, previous, eligible }) =>
  [
    { separatorClass: "and", separator: " and ", fullEvidence: true },
    { separatorClass: "comma", separator: ", ", fullEvidence: true },
    { separatorClass: "but", separator: " but ", fullEvidence: false },
    { separatorClass: "yet", separator: " yet ", fullEvidence: false },
    { separatorClass: "then", separator: " then ", fullEvidence: false },
    {
      separatorClass: "semicolon",
      separator: "; ",
      fullEvidence: false,
    },
  ].map(({ separatorClass, separator, fullEvidence }) => {
    const body = `${previous}${separator}never use the network.`;
    const emits = separatorClass === "semicolon" || eligible;
    return {
      name: `${separatorClass} × ${previousClass}`,
      body,
      expected: emits
        ? [finding(fullEvidence ? body : "never use the network.")]
        : [],
      coverage: { separatorClass, previousClass },
    };
  }),
);

const CURRENT_MODAL_DOMAIN_MATRIX = [
  {
    domain: "network",
    subject: "This workflow",
    predicate: "use the network",
  },
  { domain: "upload", subject: "This task", predicate: "upload files" },
  {
    domain: "secrets",
    subject: "The process",
    predicate: "use credentials",
  },
].flatMap(({ domain, subject, predicate }) =>
  [
    "must",
    "shall",
    "will",
    "should",
    "would",
    "may",
    "might",
    "can",
    "could",
  ].map((modal) => {
    const body = `${subject} ${modal} never ${predicate}.`;
    return {
      name: `${modal} × ${domain}`,
      body,
      expected: [finding(body)],
      coverage: { modal, domain },
    };
  }),
);

const CURRENT_MODIFIER_QUALIFICATION_MATRIX = [
  {
    modifierClass: "relative",
    qualificationClass: "descriptive",
    body: "This workflow that documents logs must not use the network.",
    emits: true,
  },
  {
    modifierClass: "relative",
    qualificationClass: "local",
    body: "This workflow that validates inputs during setup must not use the network.",
    emits: true,
  },
  {
    modifierClass: "relative",
    qualificationClass: "conditional",
    body: "This workflow that runs when scheduled must not use the network.",
    emits: true,
  },
  {
    modifierClass: "relative",
    qualificationClass: "specific-target",
    body: "This workflow that documents network access to production must not use the network.",
    emits: true,
  },
  {
    modifierClass: "relative",
    qualificationClass: "specific-source",
    body: "This workflow that uses credentials from production must not use credentials.",
    emits: true,
  },
  {
    modifierClass: "naked",
    qualificationClass: "descriptive",
    body: "This workflow says must not use the network.",
    emits: false,
  },
  {
    modifierClass: "naked",
    qualificationClass: "local",
    body: "This workflow (during local setup) must not use the network.",
    emits: false,
  },
  {
    modifierClass: "naked",
    qualificationClass: "conditional",
    body: "This workflow when offline must not use the network.",
    emits: false,
  },
  {
    modifierClass: "naked",
    qualificationClass: "specific-target",
    body: "This workflow, to a public bucket, must not upload files.",
    emits: false,
  },
  {
    modifierClass: "naked",
    qualificationClass: "specific-source",
    body: "This workflow (from production) must not use credentials.",
    emits: false,
  },
].map(({ modifierClass, qualificationClass, body, emits }) => ({
  name: `${modifierClass} × ${qualificationClass}`,
  body,
  expected: emits ? [finding(body)] : [],
  coverage: { modifierClass, qualificationClass },
}));

const CURRENT_HOMOGRAPH_HEAD_MATRIX = ["audits", "reviews", "logs"].flatMap(
  (homograph) =>
    [
      { headClass: "copular", predicate: `${homograph} are reviewed` },
      { headClass: "auxiliary", predicate: `${homograph} have approval` },
      {
        headClass: "finite",
        predicate:
          homograph === "reviews"
            ? "reviews require approval"
            : `${homograph} contain entries`,
      },
      {
        headClass: "negative-modal",
        predicate: `${homograph} must not use the network`,
      },
    ].map(({ headClass, predicate }) => {
      const body = `This workflow checks inputs but ${predicate}, yet must not upload files.`;
      return {
        name: `${homograph} × ${headClass}`,
        body,
        expected: [],
        coverage: { homograph, headClass },
      };
    }),
);

test("0.24.4 body-policy golden cases are self-contained and immutable", () => {
  assert.equal(BODY_POLICY_0244_GOLDEN_SOURCE.tag, "v0.24.4");
  assert.equal(
    BODY_POLICY_0244_GOLDEN_SOURCE.commit,
    "9e72e1adddd588ea72cba1c3e06ed1d07de330d9",
  );
  assert.match(
    BODY_POLICY_0244_GOLDEN_SOURCE.generatedBy,
    /securityDiagnosticFindings/u,
  );
  assert.equal(BODY_POLICY_0244_GOLDEN_CASES.length, 184);
  assert.equal(
    new Set(BODY_POLICY_0244_GOLDEN_CASES.map(({ name }) => name)).size,
    BODY_POLICY_0244_GOLDEN_CASES.length,
  );
  assert.ok(Object.isFrozen(BODY_POLICY_0244_GOLDEN_SOURCE));
  assert.ok(Object.isFrozen(BODY_POLICY_0244_GOLDEN_CASES));

  for (const fixture of BODY_POLICY_0244_GOLDEN_CASES) {
    assert.ok(fixture.name.length > 0);
    assert.ok(fixture.body.length > 0);
    assert.ok(Object.isFrozen(fixture), fixture.name);
    assert.ok(Object.isFrozen(fixture.coverage), fixture.name);
    assert.ok(Object.isFrozen(fixture.expected), fixture.name);
    for (const findingProjection of fixture.expected) {
      assert.ok(Object.isFrozen(findingProjection), fixture.name);
    }
  }
});

test("frozen 0.24.4 cases cover every required pairwise interaction", () => {
  assert.equal(PAIRWISE_CASES.length, 32);
  assertPairwiseCoverage(
    "first predicate kind × later scope",
    PAIRWISE_CASES,
    "firstKind",
    [
      "unrelated",
      "requirement",
      "not-required",
      "local",
      "specific",
      "workflow-prohibition",
    ],
    "laterScope",
    ["workflow", "local", "specific", "unsupported"],
  );
  assertPairwiseCoverage(
    "earlier domain × later domain",
    PAIRWISE_CASES,
    "earlierDomain",
    ["network", "upload", "secrets"],
    "laterDomain",
    ["network", "upload", "secrets"],
  );
  assertPairwiseCoverage(
    "connector × layout",
    PAIRWISE_CASES,
    "connector",
    [
      "ordinary",
      "modified-ordinary",
      "but",
      "yet",
      "however",
      "semicolon",
      "then",
      "sentence",
    ],
    "layout",
    ["one-line", "soft-wrap", "hard-break", "heading"],
  );
  assertPairwiseCoverage(
    "connector × implicit or changed subject",
    PAIRWISE_CASES,
    "connector",
    [
      "ordinary",
      "modified-ordinary",
      "but",
      "yet",
      "however",
      "semicolon",
      "then",
      "sentence",
    ],
    "subjectMode",
    ["implicit", "changed"],
  );
  assertPairwiseCoverage(
    "predicate count × middle predicate category",
    PAIRWISE_CASES,
    "predicateCount",
    [3, 4],
    "middleCategory",
    ["copular", "auxiliary", "ordinary", "established"],
  );
});

test("public body-policy findings match each frozen 0.24.4 body except explicit changes", () => {
  const corpusNames = new Set(
    BODY_POLICY_0244_GOLDEN_CASES.map(({ name }) => name),
  );
  for (const allowlistedName of Object.keys(
    INTENTIONAL_COMPATIBILITY_CHANGES,
  )) {
    assert.ok(
      corpusNames.has(allowlistedName),
      `orphaned compatibility allowlist case ${allowlistedName}`,
    );
  }

  for (const fixture of BODY_POLICY_0244_GOLDEN_CASES) {
    const current = bodyPolicyFindingProjections(fixture.body);
    const intentional = INTENTIONAL_COMPATIBILITY_CHANGES[fixture.name];
    if (intentional === undefined) {
      assert.deepEqual(current, fixture.expected, fixture.name);
      continue;
    }
    assert.ok(intentional.reason.trim().length > 0, fixture.name);
    assert.notDeepEqual(intentional.current, fixture.expected, fixture.name);
    assert.deepEqual(current, intentional.current, fixture.name);
  }
});

test("current body-policy precision matrix has exact bounded public output", () => {
  for (const fixture of CURRENT_BODY_POLICY_PRECISION_MATRIX) {
    assert.deepEqual(
      bodyPolicyFindingProjections(fixture.body),
      fixture.expected,
      fixture.name,
    );
  }

  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.predicateStart,
      ),
    ),
    new Set([
      "supported-subjectless",
      "explicit-workflow-subject",
      "explicit-changed-subject",
      "conditional-or-subordinate",
      "unsupported",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.subjectProof,
      ),
    ),
    new Set([
      "standalone-default",
      "explicit-workflow-subject",
      "inherited-workflow-subject",
      "explicit-workflow-qualifier",
      "no-workflow-proof",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.provenance,
      ),
    ),
    new Set([
      "supported-subjectless",
      "supported-domain-subject",
      "supported-workflow-prefix",
      "projected-supported",
      "mixed-supported",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.bridgeSequence,
      ),
    ),
    new Set([
      "immediate",
      "punctuation-plus-modifier",
      "bounded-relative",
      "bounded-parenthetical",
      "modifier",
      "unsupported",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.bridgeQualification,
      ),
    ),
    new Set([
      "none",
      "descriptive",
      "changed-subject",
      "conditional",
      "unsupported",
      "local-step",
      "exception",
      "specific-target",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.verbForm,
      ),
    ),
    new Set(["none", "base", "third-person"]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.layout,
      ),
    ),
    new Set(["one-line", "soft-wrap", "heading"]),
  );
  assert.equal(
    CURRENT_BODY_POLICY_PRECISION_MATRIX.at(-1)?.expected.length,
    3,
    "one public finding remains for each enabled domain after same-domain deduplication",
  );
});

test("current bounded statement matrix has exact output and complete dimensions", () => {
  for (const fixture of CURRENT_BOUNDED_STATEMENT_MATRIX) {
    assert.deepEqual(
      bodyPolicyFindingProjections(fixture.body),
      fixture.expected,
      fixture.name,
    );
  }

  assertMatrixCoverage(CURRENT_BOUNDED_STATEMENT_MATRIX, "directivePrefix", [
    "directive",
    "policy-label",
    "plain-start",
    "none",
  ]);
  assertMatrixCoverage(CURRENT_BOUNDED_STATEMENT_MATRIX, "separator", [
    "start",
    "and-without-active-subject",
    "semicolon-without-active-subject",
    "and-with-active-subject",
    "contrastive-with-active-subject",
    "none",
  ]);
  assertMatrixCoverage(CURRENT_BOUNDED_STATEMENT_MATRIX, "pairedModifier", [
    "none",
    "relative",
    "local",
    "exception",
    "specific-target",
  ]);
  assertMatrixCoverage(CURRENT_BOUNDED_STATEMENT_MATRIX, "relativeAttachment", [
    "none",
    "unqualified",
    "unrelated-preposition",
    "domain-specific-preposition",
  ]);
  assertMatrixCoverage(CURRENT_BOUNDED_STATEMENT_MATRIX, "subjectShape", [
    "none",
    "workflow",
    "single-word-changed",
    "multiword-changed",
    "subjectless-homograph",
  ]);
  assertMatrixCoverage(CURRENT_BOUNDED_STATEMENT_MATRIX, "layout", [
    "one-line",
    "soft-wrap",
    "heading",
  ]);
});

test("current stabilization matrices cover every requested cross-product", () => {
  const matrices = [
    CURRENT_DIRECTIVE_BRIDGE_MATRIX,
    CURRENT_SEPARATOR_PREVIOUS_MATRIX,
    CURRENT_MODAL_DOMAIN_MATRIX,
    CURRENT_MODIFIER_QUALIFICATION_MATRIX,
    CURRENT_HOMOGRAPH_HEAD_MATRIX,
  ] as const;
  for (const matrix of matrices) {
    for (const fixture of matrix) {
      assert.deepEqual(
        bodyPolicyFindingProjections(fixture.body),
        fixture.expected,
        fixture.name,
      );
    }
  }

  assertMatrixCrossProduct(
    CURRENT_DIRECTIVE_BRIDGE_MATRIX,
    "prefixClass",
    ["policy-label", "directive"],
    "bridgeClass",
    ["immediate", "descriptive", "conditional", "local", "changed-subject"],
  );
  assertMatrixCrossProduct(
    CURRENT_SEPARATOR_PREVIOUS_MATRIX,
    "separatorClass",
    ["and", "comma", "but", "yet", "then", "semicolon"],
    "previousClass",
    ["known", "unknown", "changed-subject", "conditional", "descriptive"],
  );
  assertMatrixCrossProduct(
    CURRENT_MODAL_DOMAIN_MATRIX,
    "modal",
    [
      "must",
      "shall",
      "will",
      "should",
      "would",
      "may",
      "might",
      "can",
      "could",
    ],
    "domain",
    ["network", "upload", "secrets"],
  );
  assertMatrixCrossProduct(
    CURRENT_MODIFIER_QUALIFICATION_MATRIX,
    "modifierClass",
    ["relative", "naked"],
    "qualificationClass",
    [
      "descriptive",
      "local",
      "conditional",
      "specific-target",
      "specific-source",
    ],
  );
  assertMatrixCrossProduct(
    CURRENT_HOMOGRAPH_HEAD_MATRIX,
    "homograph",
    ["audits", "reviews", "logs"],
    "headClass",
    ["copular", "auxiliary", "finite", "negative-modal"],
  );
});

test("composed cross-product boundaries keep exact evidence, order, and deduplication", () => {
  const orderingBody =
    "Policy: this workflow validates inputs but must never use the network, yet must never upload files, and directly never uses credentials and still never uses credentials.";
  assert.deepEqual(bodyPolicyFindingProjections(orderingBody), [
    finding(
      "Policy: this workflow validates inputs but must never use the network",
    ),
    finding(
      "Policy: this workflow validates inputs but must never use the network, yet must never upload files",
    ),
    finding(
      "Policy: this workflow validates inputs but must never use the network, yet must never upload files, and directly never uses credentials",
    ),
  ]);

  const relativeBody =
    "This workflow,\nwhich the helper says must not use the network,\nmust not upload files.";
  assert.deepEqual(bodyPolicyFindingProjections(relativeBody), [
    finding(relativeBody, 13),
  ]);

  for (const quoted of [
    'Documentation says "validate inputs; never use the network."',
    "The example reads 'clean the workspace; no external uploads.'",
    "The guide shows “rotate the logs; never use credentials.”",
    'Documentation says \\"validate inputs; never use the network.\\"',
    'Documentation says "validate \\"inputs; never use the network\\" carefully."',
  ]) {
    assert.deepEqual(bodyPolicyFindingProjections(quoted), [], quoted);
  }
});

function assertPairwiseCoverage(
  label: string,
  fixtures: typeof PAIRWISE_CASES,
  leftKey: string,
  leftValues: readonly (string | number)[],
  rightKey: string,
  rightValues: readonly (string | number)[],
): void {
  const actual = new Set(
    fixtures.map(
      ({ coverage }) =>
        `${String(coverage[leftKey])}:${String(coverage[rightKey])}`,
    ),
  );
  const expected = new Set(
    leftValues.flatMap((left) =>
      rightValues.map((right) => `${String(left)}:${String(right)}`),
    ),
  );
  assert.deepEqual(actual, expected, label);
}

function assertMatrixCrossProduct<
  Fixture extends {
    readonly coverage: Readonly<Record<string, string>>;
  },
>(
  fixtures: readonly Fixture[],
  leftKey: string,
  leftValues: readonly string[],
  rightKey: string,
  rightValues: readonly string[],
): void {
  const actual = new Set(
    fixtures.map(
      ({ coverage }) => `${coverage[leftKey]}:${coverage[rightKey]}`,
    ),
  );
  const expected = new Set(
    leftValues.flatMap((left) =>
      rightValues.map((right) => `${left}:${right}`),
    ),
  );
  assert.deepEqual(actual, expected, `${leftKey} × ${rightKey}`);
}

function assertMatrixCoverage<
  Fixture extends {
    readonly coverage: Readonly<Record<string, string>>;
  },
>(
  fixtures: readonly Fixture[],
  key: string,
  expectedValues: readonly string[],
): void {
  assert.deepEqual(
    new Set(fixtures.map(({ coverage }) => coverage[key])),
    new Set(expectedValues),
    key,
  );
}

function compatibilityChange(
  current: readonly LegacyBodyPolicyFindingProjection[],
  reason: string,
): IntentionalCompatibilityChange {
  return { reason, current };
}

function findingChange(
  snippet: string,
  reason: string,
  endLine = 11,
): IntentionalCompatibilityChange {
  return compatibilityChange([finding(snippet, endLine)], reason);
}

function noFindingChange(reason: string): IntentionalCompatibilityChange {
  return compatibilityChange([], reason);
}

function finding(
  snippet: string,
  endLine = 11,
): LegacyBodyPolicyFindingProjection {
  return {
    id: "SEC-BODY-POLICY-CONTRADICTION",
    severity: "high",
    startLine: 11,
    endLine,
    snippet,
  };
}

function bodyPolicyFindingProjections(
  body: string,
): readonly LegacyBodyPolicyFindingProjection[] {
  const content = [
    "---",
    "name: security",
    "description: Use this deterministic security fixture to verify stable body-policy compatibility behavior.",
    "metadata:",
    "  renma.allowed-data: '[\"disclosed\"]'",
    "  renma.network-allowed: 'true'",
    "  renma.external-upload-allowed: 'true'",
    "  renma.secrets-allowed: 'true'",
    "---",
    "",
    body,
    "",
  ].join("\n");
  return securityDiagnosticFindings([
    {
      path: "skills/security/SKILL.md",
      absolutePath: "/repo/skills/security/SKILL.md",
      kind: "skill",
      sizeBytes: Buffer.byteLength(content),
      contentClassification: "text",
      markdownParserEligible: true,
      content,
    },
  ])
    .filter(({ id }) => id === "SEC-BODY-POLICY-CONTRADICTION")
    .map((findingProjection) => ({
      id: findingProjection.id,
      severity: findingProjection.severity,
      startLine: findingProjection.evidence.startLine,
      endLine:
        findingProjection.evidence.endLine ??
        findingProjection.evidence.startLine,
      snippet: findingProjection.evidence.snippet,
    }));
}
