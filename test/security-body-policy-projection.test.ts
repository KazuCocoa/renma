import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFactEvidence,
  bodyPolicyFacts as statementGroupFacts,
  bodyPolicyFindings,
} from "./body-policy-test-helpers.js";

test("private facts retain candidate evidence and domain order before public deduplication", () => {
  const body =
    "This workflow must not use the network and also must not use the network, must not upload files, yet must not use credentials.";
  const facts = statementGroupFacts(body).filter(
    (fact) =>
      fact.modality === "prohibited" &&
      fact.scope === "workflow" &&
      fact.completeness === "complete",
  );

  assert.deepEqual(
    facts.map((fact) => ({
      domain: fact.domain,
      evidence: body.slice(fact.evidenceStart, fact.evidenceEnd),
    })),
    [
      {
        domain: "network",
        evidence: "This workflow must not use the network",
      },
      {
        domain: "network",
        evidence:
          "This workflow must not use the network and also must not use the network",
      },
      {
        domain: "upload",
        evidence:
          "This workflow must not use the network and also must not use the network, must not upload files",
      },
      {
        domain: "secrets",
        evidence: body.slice(0, -1),
      },
    ],
  );
});

test("changed subjects stop multi-predicate workflow inheritance", () => {
  for (const { domain, body } of [
    {
      domain: "secrets",
      body: "This workflow validates inputs but the helper audits logs, yet must not use credentials.",
    },
    {
      domain: "upload",
      body: "This workflow validates inputs but validation is delegated, yet the helper must not upload files.",
    },
    {
      domain: "upload",
      body: "This workflow checks inputs but audit jobs must never use the network, yet must not upload files.",
    },
    {
      domain: "upload",
      body: "This workflow checks inputs but review tasks must not use credentials, yet must not upload files.",
    },
    {
      domain: "upload",
      body: "This workflow validates inputs but log processors must never perform external uploads.",
    },
    {
      domain: "upload",
      body: "This workflow checks inputs but audits must not use the network, yet must not upload files.",
    },
    {
      domain: "upload",
      body: "This workflow checks inputs but reviews must not use credentials, yet must not upload files.",
    },
    {
      domain: "network",
      body: "This workflow validates inputs but logs must not contain credentials, yet must not use the network.",
    },
    {
      domain: "upload",
      body: "This workflow checks inputs but audits are reviewed, yet must not upload files.",
    },
    {
      domain: "secrets",
      body: "This workflow checks inputs but reviews require approval, yet must not use credentials.",
    },
    {
      domain: "network",
      body: "This workflow validates inputs but logs contain credentials, yet must not use the network.",
    },
    {
      domain: "upload",
      body: "This workflow checks inputs but audits have approval, yet must not upload files.",
    },
    {
      domain: "secrets",
      body: "This workflow checks inputs but reviews need approval, yet must not use credentials.",
    },
    {
      domain: "network",
      body: "This workflow validates inputs but logs include credentials, yet must not use the network.",
    },
  ] as const) {
    for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
      const prose =
        layout === "soft-wrap"
          ? body.replaceAll(/ (?=(?:but|yet)\b)/gu, "\n")
          : body;
      const renderedBody = layout === "heading" ? `## ${prose}` : prose;
      assert.equal(
        bodyPolicyFindings(renderedBody, domain).length,
        0,
        `${body}, ${layout}`,
      );
      const normalizedBody = prose.replaceAll("\n", " ");
      assert.equal(
        statementGroupFacts(normalizedBody).some(
          (fact) =>
            fact.domain === domain &&
            fact.modality === "prohibited" &&
            fact.scope === "workflow" &&
            fact.completeness === "complete",
        ),
        false,
        `${body}, ${layout}, private facts`,
      );
    }
  }
});

test("supported prefixed workflow subjects establish statement-group state", () => {
  for (const { domain, body, softBody, evidence } of [
    {
      domain: "network",
      body: "Policy: this workflow validates inputs but must not use the network.",
      softBody:
        "Policy:\nthis workflow validates inputs\nbut must not use the network.",
      evidence:
        "Policy: this workflow validates inputs but must not use the network",
    },
    {
      domain: "upload",
      body: "For safety, this task requires external uploads and must not upload files.",
      softBody:
        "For safety,\nthis task requires external uploads\nand must not upload files.",
      evidence:
        "For safety, this task requires external uploads and must not upload files",
    },
    {
      domain: "secrets",
      body: "Requirement: the process checks configuration, yet must not use credentials.",
      softBody:
        "Requirement:\nthe process checks configuration,\nyet must not use credentials.",
      evidence:
        "Requirement: the process checks configuration, yet must not use credentials",
    },
    {
      domain: "secrets",
      body: "Policy: this workflow, which validates inputs, must not use credentials.",
      softBody:
        "Policy:\nthis workflow, which validates inputs,\nmust not use credentials.",
      evidence:
        "Policy: this workflow, which validates inputs, must not use credentials",
    },
    {
      domain: "upload",
      body: "This workflow validates inputs; Policy: no external uploads.",
      softBody: "This workflow validates inputs;\nPolicy: no external uploads.",
      evidence: "Policy: no external uploads",
    },
    {
      domain: "network",
      body: "This task prepares results; For safety, never use the network.",
      softBody:
        "This task prepares results;\nFor safety, never use the network.",
      evidence: "For safety, never use the network",
    },
  ] as const) {
    for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
      const prose = layout === "soft-wrap" ? softBody : body;
      const renderedBody = layout === "heading" ? `## ${prose}` : prose;
      const findings = bodyPolicyFindings(renderedBody, domain);
      assert.equal(findings.length, 1, `${body}, ${layout}`);
      const normalizedBody = prose.replaceAll("\n", " ");
      const fact = statementGroupFacts(normalizedBody).find(
        (candidate) =>
          candidate.domain === domain &&
          candidate.modality === "prohibited" &&
          candidate.scope === "workflow" &&
          candidate.completeness === "complete",
      );
      assert.ok(fact, `${body}, ${layout}, private fact`);
      assert.equal(
        normalizedBody.slice(fact.evidenceStart, fact.evidenceEnd),
        evidence,
        `${body}, ${layout}, evidence`,
      );
    }
  }

  for (const body of [
    "Documentation: this workflow says do not use the network.",
    "The helper's policy: no external uploads.",
    "Policy: the helper must not use credentials.",
  ]) {
    for (const domain of ["network", "upload", "secrets"] as const) {
      for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
        const renderedBody = layout === "heading" ? `## ${body}` : body;
        assert.equal(
          bodyPolicyFindings(renderedBody, domain).length,
          0,
          `${body}, ${domain}, ${layout}`,
        );
      }
    }
  }
});

test("inherited prohibition prefixes cover connectors and domains", () => {
  const domains = [
    {
      domain: "network",
      action: "use the network",
      thirdPersonAction: "uses the network",
    },
    {
      domain: "upload",
      action: "upload files",
      thirdPersonAction: "uploads files",
    },
    {
      domain: "secrets",
      action: "use credentials",
      thirdPersonAction: "uses credentials",
    },
  ] as const;
  const prefixes = [
    {
      prefixClass: "modal-never",
      predicate: (action: string) => `must never ${action}`,
    },
    {
      prefixClass: "always",
      predicate: (action: string) => `always must not ${action}`,
    },
    {
      prefixClass: "explicitly",
      predicate: (action: string) => `explicitly cannot ${action}`,
    },
    {
      prefixClass: "directly",
      predicate: (_action: string, thirdPersonAction: string) =>
        `directly never ${thirdPersonAction}`,
    },
    {
      prefixClass: "also",
      predicate: (action: string) => `also must not ${action}`,
    },
    {
      prefixClass: "still",
      predicate: (action: string) => `still must not ${action}`,
    },
    {
      prefixClass: "therefore",
      predicate: (action: string) => `therefore must not ${action}`,
    },
  ] as const;
  const connectors = [
    { connectorClass: "and", text: " and " },
    { connectorClass: "comma", text: ", " },
    { connectorClass: "but", text: " but " },
    { connectorClass: "yet", text: ", yet " },
    { connectorClass: "semicolon", text: "; " },
    { connectorClass: "then", text: ", then " },
  ] as const;

  for (const { domain, action, thirdPersonAction } of domains) {
    for (const { prefixClass, predicate } of prefixes) {
      for (const { connectorClass, text: connector } of connectors) {
        const laterPredicate = predicate(action, thirdPersonAction);
        const body = `This workflow validates inputs${connector}${laterPredicate}.`;
        for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
          const prose =
            layout === "soft-wrap"
              ? body.replace(connector, `${connector.trimEnd()}\n`)
              : body;
          const renderedBody = layout === "heading" ? `## ${prose}` : prose;
          const findings = bodyPolicyFindings(renderedBody, domain);
          assert.equal(
            findings.length,
            1,
            `${domain}, ${prefixClass}, ${connectorClass}, ${layout}`,
          );
          const normalizedBody = prose.replaceAll("\n", " ");
          const fact = statementGroupFacts(normalizedBody).find(
            (candidate) =>
              candidate.domain === domain &&
              candidate.modality === "prohibited" &&
              candidate.scope === "workflow" &&
              candidate.completeness === "complete",
          );
          assert.ok(
            fact,
            `${domain}, ${prefixClass}, ${connectorClass}, ${layout}, private fact`,
          );
          assert.equal(
            normalizedBody.slice(fact.evidenceStart, fact.evidenceEnd),
            normalizedBody.slice(0, -1),
          );
        }
      }
    }
  }

  for (const body of [
    "audits are reviewed",
    "reviews require approval",
    "logs contain credentials",
    "audit jobs must never use the network",
  ]) {
    assert.equal(
      statementGroupFacts(
        `This workflow validates inputs but ${body}, yet must not upload files.`,
      ).some(
        (fact) =>
          fact.domain === "upload" &&
          fact.modality === "prohibited" &&
          fact.scope === "workflow" &&
          fact.completeness === "complete",
      ),
      false,
      body,
    );
  }
});

test("bare-semicolon standalone proof respects quote enclosure", () => {
  const domains = [
    { domain: "network", prohibition: "never use the network" },
    { domain: "upload", prohibition: "no external uploads" },
    { domain: "secrets", prohibition: "never use credentials" },
  ] as const;
  const enclosures = [
    { enclosure: "none", open: "", close: "", emits: true },
    { enclosure: "double", open: '"', close: '"', emits: false },
    { enclosure: "single", open: "'", close: "'", emits: false },
    { enclosure: "curly-double", open: "“", close: "”", emits: false },
    { enclosure: "curly-single", open: "‘", close: "’", emits: false },
    { enclosure: "escaped-double", open: '\\"', close: '\\"', emits: false },
  ] as const;

  for (const { domain, prohibition } of domains) {
    for (const { enclosure, open, close, emits } of enclosures) {
      const body = `${emits ? "Clean the workspace" : "Documentation says "}${open}validate inputs; ${prohibition}.${close}`;
      for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
        const prose = layout === "soft-wrap" ? body.replace("; ", ";\n") : body;
        const renderedBody = layout === "heading" ? `## ${prose}` : prose;
        assert.equal(
          bodyPolicyFindings(renderedBody, domain).length,
          emits ? 1 : 0,
          `${domain}, ${enclosure}, ${layout}`,
        );
        if (!emits) {
          const normalizedBody = prose.replaceAll("\n", " ");
          assert.equal(
            statementGroupFacts(normalizedBody).some(
              (fact) =>
                fact.domain === domain &&
                fact.modality === "prohibited" &&
                fact.scope === "workflow" &&
                fact.completeness === "complete",
            ),
            false,
            `${domain}, ${enclosure}, ${layout}, private facts`,
          );
        }
      }
    }
  }

  const apostropheControl =
    "The helper's notes say validate inputs; never use the network.";
  assert.equal(bodyPolicyFindings(apostropheControl, "network").length, 1);
  assert.equal(
    bodyPolicyFindings(
      "The helpers' notes say validate inputs; never use the network.",
      "network",
    ).length,
    1,
  );
  assert.equal(
    bodyPolicyFindings(
      "Documentation says validate inputs; never use the network.",
      "network",
    ).length,
    1,
  );
  assert.equal(
    bodyPolicyFindings(
      'Documentation says "validate \\"inputs; never use the network\\" carefully."',
      "network",
    ).length,
    0,
  );
});

test("paired-comma workflow bridges distinguish relative and naked shapes", () => {
  const domains = [
    {
      domain: "network",
      prohibition: "must not use the network",
      target: "to production",
    },
    {
      domain: "upload",
      prohibition: "must not upload files",
      target: "to a public bucket",
    },
    {
      domain: "secrets",
      prohibition: "must not use credentials",
      target: "from production",
    },
  ] as const;
  const prefixes = [
    { prefixClass: "plain", prefix: "" },
    { prefixClass: "directive", prefix: "For safety, " },
    { prefixClass: "policy-label", prefix: "Policy: " },
  ] as const;

  for (const { domain, prohibition, target } of domains) {
    for (const { prefixClass, prefix } of prefixes) {
      for (const { modifierClass, modifier, emits } of [
        {
          modifierClass: "object-relative",
          modifier: "which the security team validates",
          emits: true,
        },
        {
          modifierClass: "local",
          modifier: "during local setup",
          emits: false,
        },
        {
          modifierClass: "exception",
          modifier: "except for approved domains",
          emits: false,
        },
        {
          modifierClass: "specific-target",
          modifier: target,
          emits: false,
        },
        {
          modifierClass: "changed-subject",
          modifier: "the helper validates inputs",
          emits: false,
        },
      ] as const) {
        const body = `${prefix}this workflow, ${modifier}, ${prohibition}.`;
        for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
          const prose =
            layout === "soft-wrap"
              ? body.replace(`, ${prohibition}`, `,\n${prohibition}`)
              : body;
          const renderedBody = layout === "heading" ? `## ${prose}` : prose;
          assert.equal(
            bodyPolicyFindings(renderedBody, domain).length,
            emits ? 1 : 0,
            `${domain}, ${prefixClass}, ${modifierClass}, ${layout}`,
          );
        }
      }
    }
  }

  const relativeWithInnerProhibition =
    "This workflow,\nwhich the helper says must not use the network,\nmust not upload files.";
  assert.equal(
    bodyPolicyFindings(relativeWithInnerProhibition, "network").length,
    0,
  );
  const uploadFindings = bodyPolicyFindings(
    relativeWithInnerProhibition,
    "upload",
  );
  assert.equal(uploadFindings.length, 1);
  assert.equal(
    uploadFindings[0]?.evidence.snippet,
    relativeWithInnerProhibition,
  );

  assert.equal(
    bodyPolicyFindings(
      "This workflow which the security team validates must not use the network.",
      "network",
    ).length,
    0,
  );
  assert.equal(
    bodyPolicyFindings(
      "Policy: this workflow, which says the helper must not use credentials, documents policy text.",
      "secrets",
    ).length,
    0,
  );
});

test("security-action homographs clear inherited workflow subjects", () => {
  const changedSubjects = [
    {
      headClass: "copular",
      body: "This workflow checks inputs but audits are reviewed, yet must not upload files.",
      domain: "upload",
    },
    {
      headClass: "auxiliary",
      body: "This workflow checks inputs but reviews have approval, yet must not use credentials.",
      domain: "secrets",
    },
    {
      headClass: "general-finite",
      body: "This workflow checks inputs but reviews require approval, yet must not use credentials.",
      domain: "secrets",
    },
    {
      headClass: "security-action",
      body: "This workflow checks inputs but audits use the network, yet must not upload files.",
      domain: "upload",
    },
    {
      headClass: "security-action",
      body: "This workflow checks inputs but reviews access credentials, yet must not upload files.",
      domain: "upload",
    },
    {
      headClass: "security-action",
      body: "This workflow validates inputs but reports upload files, yet must not use credentials.",
      domain: "secrets",
    },
    {
      headClass: "security-action",
      body: "This workflow checks configuration but checks use the network, yet must not upload files.",
      domain: "upload",
    },
    {
      headClass: "negative-modal",
      body: "This workflow checks inputs but audit jobs must not use the network, yet must not upload files.",
      domain: "upload",
    },
  ] as const;
  for (const { headClass, body, domain } of changedSubjects) {
    for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
      const prose =
        layout === "soft-wrap"
          ? body.replace(" but ", "\nbut ").replace(", yet ", ",\nyet ")
          : body;
      const renderedBody = layout === "heading" ? `## ${prose}` : prose;
      assert.equal(
        bodyPolicyFindings(renderedBody, domain).length,
        0,
        `${headClass}, ${body}, ${layout}`,
      );
    }
  }

  for (const { body, domain } of [
    {
      body: "This workflow audits logs, then must not upload files.",
      domain: "upload",
    },
    {
      body: "This workflow reviews results, then must not use the network.",
      domain: "network",
    },
    {
      body: "This workflow checks use cases, then must not upload files.",
      domain: "upload",
    },
  ] as const) {
    for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
      const prose =
        layout === "soft-wrap" ? body.replace(", then ", ",\nthen ") : body;
      const renderedBody = layout === "heading" ? `## ${prose}` : prose;
      assert.equal(
        bodyPolicyFindings(renderedBody, domain).length,
        1,
        `${body}, ${layout}`,
      );
    }
  }
});

test("bounded directive-that variants remain instruction-only", () => {
  for (const { domain, body } of [
    {
      domain: "upload",
      body: "Ensure that no external uploads are allowed.",
    },
    {
      domain: "secrets",
      body: "Make sure that this workflow never uses credentials.",
    },
    {
      domain: "network",
      body: "Please ensure that the workflow does not use the network.",
    },
  ] as const) {
    for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
      const prose =
        layout === "soft-wrap" ? body.replace(/^(.*? that) /u, "$1\n") : body;
      const renderedBody = layout === "heading" ? `## ${prose}` : prose;
      assert.equal(
        bodyPolicyFindings(renderedBody, domain).length,
        1,
        `${body}, ${layout}`,
      );
    }
  }

  for (const { domain, body } of [
    {
      domain: "upload",
      body: "Documentation ensures that no external uploads are mentioned.",
    },
    {
      domain: "secrets",
      body: "The helper makes sure that credentials are not logged.",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

test("fallback visible lines use the statement-group analyzer", () => {
  const body =
    "## This workflow requires network access but must not use credentials";
  const findings = bodyPolicyFindings(body, "secrets");

  assert.equal(findings.length, 1, body);
  assert.equal(findings[0]?.id, "SEC-BODY-POLICY-CONTRADICTION", body);
  assert.equal(
    findings[0]?.evidence.snippet,
    "## This workflow requires network access but must not use credentials",
    body,
  );
});

test("bare semicolons and then retain the strict 0.24.4 decision boundary", () => {
  for (const { domain, body } of [
    {
      domain: "secrets",
      body: "This workflow requires network access; must not use credentials.",
    },
    {
      domain: "upload",
      body: "This workflow requires network access then must not upload files.",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, 1, body);
  }
});

test("shared workflow-subject negative controls remain clean", () => {
  for (const { domain, body, expected } of [
    {
      domain: "network",
      body: "This workflow requires network access.",
      expected: { modality: "unknown", scope: "workflow" },
    },
    {
      domain: "network",
      body: "This workflow does not require network access.",
      expected: { modality: "not-required", scope: "workflow" },
    },
    {
      domain: "network",
      body: "This workflow must not use network access to production systems.",
      expected: { modality: "local-safeguard", scope: "specific-target" },
    },
    {
      domain: "upload",
      body: "This workflow must not upload logs to a public bucket.",
      expected: { modality: "prohibited", scope: "specific-target" },
    },
    {
      domain: "secrets",
      body: "This workflow must not access credentials from production.",
      expected: { modality: "prohibited", scope: "specific-source" },
    },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assert.deepEqual(
      {
        modality: facts[0]?.modality,
        scope: facts[0]?.scope,
        completeness: facts[0]?.completeness,
      },
      { ...expected, completeness: "complete" },
      body,
    );
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

test("modified shared-subject text retains body-policy suppression boundaries", () => {
  for (const { name, domain, body } of [
    {
      name: "quoted example",
      domain: "network",
      body: 'This workflow requires network access and also "must not use the network" is example wording.',
    },
    {
      name: "descriptive text",
      domain: "upload",
      body: "This workflow requires external uploads and also documents a prohibition on uploads.",
    },
    {
      name: "conditional prohibition",
      domain: "secrets",
      body: "This workflow requires credentials and also must not use credentials if offline mode is selected.",
    },
    {
      name: "local prohibition",
      domain: "network",
      body: "This workflow requires network access and also must not use the network during local setup.",
    },
    {
      name: "specific target",
      domain: "upload",
      body: "This workflow requires external uploads and also must not upload files to a public bucket.",
    },
    {
      name: "specific source",
      domain: "secrets",
      body: "This workflow requires credentials and also must not access credentials from production.",
    },
    {
      name: "unsupported remainder",
      domain: "network",
      body: "This workflow requires network access and also must not use the network except for approved domains.",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, 0, name);
  }
});

test("unrelated workflow prose does not give generic prohibitions workflow scope", () => {
  const body =
    "This workflow documents deployment guidance, and also do not expose credentials.";
  const facts = statementGroupFacts(body).filter(
    (fact) => fact.domain === "secrets",
  );
  assert.equal(facts.length, 1, body);
  assertFactEvidence(
    facts[0],
    body,
    "do not expose credentials",
    {
      modality: "unknown",
      scope: "unknown",
      completeness: "complete",
    },
    body,
  );
  assert.equal(bodyPolicyFindings(body, "secrets").length, 0, body);
});

test("contrastive projection preserves body-policy precision boundaries", () => {
  for (const { name, domain, body } of [
    {
      name: "cross-domain changed helper subject",
      domain: "secrets",
      body: "This workflow requires network access but the helper must not use credentials.",
    },
    {
      name: "changed subject stops a later contrastive chain",
      domain: "secrets",
      body: "This workflow validates inputs but the helper checks logs, yet must not use credentials.",
    },
    {
      name: "unsupported ambiguous connector",
      domain: "secrets",
      body: "This workflow validates inputs although must not use credentials.",
    },
    {
      name: "cross-domain period",
      domain: "secrets",
      body: "This workflow requires network access. Must not use credentials.",
    },
    {
      name: "cross-domain local prohibition",
      domain: "secrets",
      body: "This workflow requires network access but must not use credentials during local setup.",
    },
    {
      name: "cross-domain specific upload target",
      domain: "upload",
      body: "This workflow requires network access, yet must not upload files to a public bucket.",
    },
    {
      name: "cross-domain specific secret source",
      domain: "secrets",
      body: "This workflow requires network access; however, must not access credentials from production.",
    },
    {
      name: "cross-domain hard break",
      domain: "secrets",
      body: "This workflow requires network access but  \nmust not use credentials.",
    },
    {
      name: "period and changed subject",
      domain: "network",
      body: "This workflow requires network access. The helper must not use the network.",
    },
    {
      name: "period and implicit subject",
      domain: "network",
      body: "This workflow requires network access. Must not use the network.",
    },
    {
      name: "but and changed local subject",
      domain: "network",
      body: "This workflow requires network access but the local setup must not use the network.",
    },
    {
      name: "bare semicolon and changed command subject",
      domain: "upload",
      body: "This workflow requires external uploads; the validation command must not upload files.",
    },
    {
      name: "semicolon however without comma",
      domain: "network",
      body: "This workflow requires network access; however must not use the network.",
    },
    {
      name: "yet and changed helper subject",
      domain: "secrets",
      body: "This workflow requires credentials, yet the offline helper must not use credentials.",
    },
    {
      name: "local prohibition",
      domain: "network",
      body: "This workflow requires network access but must not use the network during local setup.",
    },
    {
      name: "specific upload target",
      domain: "upload",
      body: "This workflow requires external uploads, yet must not upload files to a public bucket.",
    },
    {
      name: "specific secret source",
      domain: "secrets",
      body: "This workflow requires credentials; however, must not access credentials from production.",
    },
    {
      name: "unsupported remainder",
      domain: "network",
      body: "This workflow requires network access but must not use the network except for approved domains.",
    },
    {
      name: "Markdown hard break",
      domain: "network",
      body: "This workflow requires network access but  \nmust not use the network.",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, 0, name);
  }
});

test("workflow subjects do not cross Markdown structural boundaries", () => {
  for (const { name, body } of [
    {
      name: "paragraphs",
      body: "This workflow requires network access.\n\nMust not use the network.",
    },
    {
      name: "list items",
      body: "- This workflow requires network access\n- Must not use the network.",
    },
    {
      name: "blockquotes",
      body: "> This workflow requires network access.\n>\n> Must not use the network.",
    },
    {
      name: "heading",
      body: "## This workflow requires network access\n\nMust not use the network.",
    },
    {
      name: "code block",
      body: "This workflow requires network access.\n\n```\nMust not use the network.\n```",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, "network").length, 0, name);
  }
});

test("affirmative requirements never become not-required facts or findings", () => {
  for (const { domain, body } of [
    { domain: "network", body: "Network access is required." },
    { domain: "upload", body: "External uploads are required." },
    { domain: "secrets", body: "Secret access is required." },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assert.equal(facts[0]?.modality, "unknown", body);
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

test("candidate scope and safeguard facts ignore coordinated unrelated text", () => {
  for (const { body, domain, evidence, completeness } of [
    {
      body: "Run npm validation and this workflow must not use the network.",
      domain: "network",
      evidence: "this workflow must not use the network",
      completeness: "complete",
    },
    {
      body: "This workflow must not upload files and run npm validation.",
      domain: "upload",
      evidence: "This workflow must not upload files",
      completeness: "unsupported-remainder",
    },
    {
      body: "Use npx locally and credentials must not be used in this workflow.",
      domain: "secrets",
      evidence: "credentials must not be used in this workflow",
      completeness: "complete",
    },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assertFactEvidence(
      facts[0],
      body,
      evidence,
      {
        modality: "prohibited",
        scope: "workflow",
        completeness,
      },
      body,
    );
    assert.equal(
      bodyPolicyFindings(body, domain).length,
      completeness === "complete" ? 1 : 0,
      body,
    );
  }

  const localText =
    "Do not use network access during maintenance and run npm validation.";
  const localFact = statementGroupFacts(localText).find(
    (fact) => fact.domain === "network",
  );
  assertFactEvidence(
    localFact,
    localText,
    "Do not use network access during maintenance",
    {
      modality: "prohibited",
      scope: "unknown",
      completeness: "unsupported-remainder",
    },
    localText,
  );
  assert.equal(bodyPolicyFindings(localText, "network").length, 0, localText);
});
