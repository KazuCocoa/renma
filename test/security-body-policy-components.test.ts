import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFactEvidence,
  bodyPolicyFacts as statementGroupFacts,
  bodyPolicyFindings,
  titleCase,
} from "./body-policy-test-helpers.js";

test("quote provenance blocks every enclosed statement separator", () => {
  const quoteStyles = [
    { style: "straight-double", open: '"', close: '"' },
    { style: "straight-single", open: "'", close: "'" },
    { style: "curly-double", open: "“", close: "”" },
    { style: "curly-single", open: "‘", close: "’" },
    { style: "escaped-visible", open: '\\"', close: '\\"' },
  ] as const;
  const separators = [
    { name: "semicolon", text: "; " },
    { name: "period", text: ". " },
    { name: "exclamation", text: "! " },
    { name: "question", text: "? " },
    { name: "and", text: " and " },
    { name: "comma", text: ", " },
    { name: "but", text: " but " },
    { name: "yet", text: " yet " },
    { name: "however", text: " however, " },
    { name: "then", text: " then " },
  ] as const;
  const domains = [
    { domain: "network", prohibition: "never use the network" },
    { domain: "upload", prohibition: "no external uploads" },
    { domain: "secrets", prohibition: "never use credentials" },
  ] as const;

  for (const { domain, prohibition } of domains) {
    for (const { name: separatorName, text: separator } of separators) {
      for (const activeSubject of [true, false]) {
        const outsidePrefix = activeSubject
          ? "This workflow documents "
          : "Documentation says ";
        const unquotedPrefix = activeSubject
          ? "This workflow validates inputs"
          : "Validate inputs";
        for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
          const renderedSeparator =
            layout === "soft-wrap" ? `${separator.trimEnd()}\n` : separator;
          const unquoted = `${unquotedPrefix}${renderedSeparator}${prohibition}.`;
          const renderedUnquoted =
            layout === "heading" ? `## ${unquoted}` : unquoted;
          assert.equal(
            bodyPolicyFindings(renderedUnquoted, domain).length,
            1,
            `${domain}, ${separatorName}, ${activeSubject ? "active" : "standalone"}, ${layout}, unquoted`,
          );

          for (const { style, open, close } of quoteStyles) {
            const prose = `${outsidePrefix}${open}validate inputs${renderedSeparator}${prohibition}.${close}`;
            const body = layout === "heading" ? `## ${prose}` : prose;
            const message = `${domain}, ${style}, ${separatorName}, ${activeSubject ? "active" : "standalone"}, ${layout}`;
            assert.equal(bodyPolicyFindings(body, domain).length, 0, message);

            const normalized = prose.replaceAll("\n", " ");
            assert.equal(
              statementGroupFacts(normalized).some(
                (fact) =>
                  fact.domain === domain &&
                  fact.modality === "prohibited" &&
                  fact.scope === "workflow" &&
                  fact.completeness === "complete",
              ),
              false,
              `${message}, private facts`,
            );
          }
        }
      }
    }
  }

  for (const apostropheControl of [
    "The helper's notes say validate inputs; never use the network.",
    "The helpers' notes say validate inputs; never use the network.",
  ]) {
    assert.equal(
      bodyPolicyFindings(apostropheControl, "network").length,
      1,
      apostropheControl,
    );
  }
});

test("paired relatives classify their own subject relationship and bounded policy", () => {
  const domains = [
    {
      domain: "network",
      complete: "must not use the network",
      local: "must not use the network during local setup",
      specific: "must not use network access to production systems",
    },
    {
      domain: "upload",
      complete: "cannot upload files",
      local: "cannot upload files during local setup",
      specific: "cannot upload files to a public bucket",
    },
    {
      domain: "secrets",
      complete: "must never use credentials",
      local: "must never use credentials during local setup",
      specific: "must not access credentials from production",
    },
  ] as const;
  const prefixes = [
    { name: "plain", text: "" },
    { name: "directive", text: "Please " },
    { name: "policy-label", text: "Policy: " },
  ] as const;

  for (const [innerIndex, inner] of domains.entries()) {
    for (const relationship of [
      "subject-relative",
      "object-relative",
    ] as const) {
      for (const scope of ["complete", "local", "specific"] as const) {
        for (const mainRelation of ["same", "different"] as const) {
          const main: (typeof domains)[number] =
            mainRelation === "same"
              ? inner
              : (domains[(innerIndex + 1) % domains.length] ?? inner);
          for (const mainProhibitionPresent of [false, true]) {
            for (const prefix of prefixes) {
              const relativePredicate = inner[scope];
              const relative =
                relationship === "subject-relative"
                  ? `which ${relativePredicate}`
                  : `which the helper says ${relativePredicate}`;
              const mainPredicate: string = mainProhibitionPresent
                ? main.complete
                : "validates inputs";
              const oneLine: string = `${prefix.text}this workflow, ${relative}, ${mainPredicate}.`;
              for (const layout of [
                "one-line",
                "soft-wrap",
                "heading",
              ] as const) {
                const prose: string =
                  layout === "soft-wrap"
                    ? oneLine
                        .replace(`, ${relative}`, `,\n${relative}`)
                        .replace(`, ${mainPredicate}`, `,\n${mainPredicate}`)
                    : oneLine;
                const body: string =
                  layout === "heading" ? `## ${prose}` : prose;
                const innerExpected: boolean =
                  (relationship === "subject-relative" &&
                    scope === "complete") ||
                  (mainProhibitionPresent && main.domain === inner.domain);
                const mainExpected: boolean =
                  mainProhibitionPresent ||
                  (relationship === "subject-relative" &&
                    scope === "complete" &&
                    main.domain === inner.domain);
                const message = `${relationship}, ${inner.domain}, ${scope}, ${mainRelation}, ${mainProhibitionPresent ? "main-prohibition" : "main-prose"}, ${prefix.name}, ${layout}`;
                assert.equal(
                  bodyPolicyFindings(body, inner.domain).length,
                  innerExpected ? 1 : 0,
                  `${message}, inner`,
                );
                assert.equal(
                  bodyPolicyFindings(body, main.domain).length,
                  mainExpected ? 1 : 0,
                  `${message}, main`,
                );
              }
            }
          }
        }
      }
    }
  }

  for (const { domain, body, evidence } of [
    {
      domain: "network",
      body: "This workflow, which must not use the network, validates inputs.",
      evidence: "This workflow, which must not use the network",
    },
    {
      domain: "upload",
      body: "This task, which cannot upload files, prepares the report.",
      evidence: "This task, which cannot upload files",
    },
    {
      domain: "secrets",
      body: "Policy: the process, which must never use credentials, checks configuration.",
      evidence: "Policy: the process, which must never use credentials",
    },
  ] as const) {
    const fact = statementGroupFacts(body).find(
      (candidate) =>
        candidate.domain === domain &&
        candidate.modality === "prohibited" &&
        candidate.scope === "workflow" &&
        candidate.completeness === "complete",
    );
    assertFactEvidence(
      fact,
      body,
      evidence,
      {
        modality: "prohibited",
        scope: "workflow",
        completeness: "complete",
      },
      body,
    );
  }

  for (const unsupported of [
    "This workflow, which apparently must not use the network, validates inputs.",
    "Policy: this workflow, which perhaps cannot upload files, prepares the report.",
    "Please this workflow, which reportedly must not use credentials, checks configuration.",
  ]) {
    for (const domain of ["network", "upload", "secrets"] as const) {
      assert.equal(
        bodyPolicyFindings(unsupported, domain).length,
        0,
        unsupported,
      );
    }
  }
});

test("modal-never semantics compose subject mode, policy context, domain, and layout", () => {
  const modals = [
    { modal: "must", classification: "deontic", plain: true, policy: true },
    { modal: "shall", classification: "deontic", plain: true, policy: true },
    { modal: "will", classification: "commitment", plain: true, policy: true },
    {
      modal: "should",
      classification: "recommendation",
      plain: false,
      policy: true,
    },
    {
      modal: "may",
      classification: "epistemic",
      plain: false,
      policy: true,
    },
    {
      modal: "might",
      classification: "epistemic",
      plain: false,
      policy: false,
    },
    {
      modal: "can",
      classification: "capability",
      plain: false,
      policy: false,
    },
    {
      modal: "could",
      classification: "capability",
      plain: false,
      policy: false,
    },
    {
      modal: "would",
      classification: "hypothetical",
      plain: false,
      policy: false,
    },
  ] as const;
  const domains = [
    { domain: "network", action: "use the network" },
    { domain: "upload", action: "upload files" },
    { domain: "secrets", action: "use credentials" },
  ] as const;
  const prefixes = [
    { name: "plain", text: "", policyContext: false },
    { name: "policy-label", text: "Policy: ", policyContext: true },
    { name: "directive", text: "Please ", policyContext: true },
  ] as const;

  for (const modal of modals) {
    for (const { domain, action } of domains) {
      for (const prefix of prefixes) {
        for (const subjectMode of [
          "explicit",
          "inherited",
          "standalone",
        ] as const) {
          const oneLine = {
            explicit: `${prefix.text}this workflow ${modal.modal} never ${action}.`,
            inherited: `${prefix.text}this workflow validates inputs but ${modal.modal} never ${action}.`,
            standalone: `${prefix.text}${titleCase(modal.modal)} never ${action}.`,
          }[subjectMode];
          const expected = prefix.policyContext ? modal.policy : modal.plain;
          for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
            const prose =
              layout === "soft-wrap"
                ? subjectMode === "inherited"
                  ? oneLine.replace(" but ", "\nbut ")
                  : subjectMode === "explicit"
                    ? oneLine.replace(" workflow ", " workflow\n")
                    : prefix.text.length > 0
                      ? oneLine.replace(
                          prefix.text,
                          prefix.text.trimEnd() + "\n",
                        )
                      : oneLine.replace(` never ${action}`, ` never\n${action}`)
                : oneLine;
            const body = layout === "heading" ? `## ${prose}` : prose;
            assert.equal(
              bodyPolicyFindings(body, domain).length,
              expected ? 1 : 0,
              `${modal.classification}, ${modal.modal}, ${domain}, ${prefix.name}, ${subjectMode}, ${layout}`,
            );
          }
        }
      }
    }
  }

  for (const { domain, body } of [
    {
      domain: "network",
      body: "This workflow might never use the network.",
    },
    { domain: "upload", body: "This task could never upload files." },
    { domain: "secrets", body: "The process can never use credentials." },
    {
      domain: "network",
      body: "This workflow would never use the network.",
    },
  ] as const) {
    const fact = statementGroupFacts(body).find(
      (candidate) => candidate.domain === domain,
    );
    assert.ok(fact, body);
    assert.equal(fact.modality, "unknown", body);
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

test("supported outer prefixes compose one label and one directive component", () => {
  for (const { domain, body } of [
    { domain: "network", body: "Policy: please do not use the network." },
    {
      domain: "upload",
      body: "Requirement: ensure that no external uploads are allowed.",
    },
    {
      domain: "secrets",
      body: "Policy: please ensure that this workflow never uses credentials.",
    },
    { domain: "network", body: "For safety, please do not use the network." },
    { domain: "upload", body: "Policy: for safety, no external uploads." },
  ] as const) {
    for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
      const prose =
        layout === "soft-wrap"
          ? body.replace(/^(Policy:|Requirement:|For safety,)[ \t]+/u, "$1\n")
          : body;
      const rendered = layout === "heading" ? `## ${prose}` : prose;
      assert.equal(
        bodyPolicyFindings(rendered, domain).length,
        1,
        `${body}, ${layout}`,
      );
      const normalized = prose.replaceAll("\n", " ");
      const fact = statementGroupFacts(normalized).find(
        (candidate) =>
          candidate.domain === domain &&
          candidate.modality === "prohibited" &&
          candidate.scope === "workflow" &&
          candidate.completeness === "complete",
      );
      assert.ok(fact, `${body}, ${layout}, private fact`);
      assert.equal(
        normalized.slice(fact.evidenceStart, fact.evidenceEnd),
        normalized.slice(0, -1),
      );
    }
  }

  for (const body of [
    "Documentation policy: please do not use the network.",
    "The helper's requirement: no external uploads.",
    "Policy notes say please do not use credentials.",
    "Policy: Requirement: please do not use the network.",
    "Please make sure that ensure no external uploads.",
  ]) {
    for (const domain of ["network", "upload", "secrets"] as const) {
      assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
    }
  }
});

test("opaque quoted spans preserve outer subject and policy state", () => {
  const quoteStyles = [
    { name: "straight-double", open: '"', close: '"' },
    { name: "straight-single", open: "'", close: "'" },
    { name: "curly-double", open: "“", close: "”" },
    { name: "curly-single", open: "‘", close: "’" },
    { name: "escaped-visible", open: '\\"', close: '\\"' },
  ] as const;
  const enclosedSeparators = [
    { name: "semicolon", text: "; " },
    { name: "period", text: ". " },
    { name: "and", text: " and " },
    { name: "but", text: " but " },
    { name: "yet", text: " yet " },
    { name: "then", text: " then " },
  ] as const;
  const outerConnectors = ["and", "but", "yet", "then"] as const;
  const domains = [
    {
      domain: "network",
      quoted: "never use the network",
      final: "must not use the network",
      recommendation: "should never use the network",
    },
    {
      domain: "upload",
      quoted: "never upload files",
      final: "must not upload files",
      recommendation: "should never upload files",
    },
    {
      domain: "secrets",
      quoted: "never use credentials",
      final: "must not use credentials",
      recommendation: "should never use credentials",
    },
  ] as const;

  for (const quote of quoteStyles) {
    for (const enclosed of enclosedSeparators) {
      for (const connector of outerConnectors) {
        for (const state of ["subject", "policy"] as const) {
          for (const domain of domains) {
            const final =
              state === "subject" ? domain.final : domain.recommendation;
            const oneLine =
              state === "subject"
                ? `This workflow documents ${quote.open}example${enclosed.text}${domain.quoted}${quote.close} ${connector} ${final}.`
                : `Policy: documents ${quote.open}example${enclosed.text}${domain.quoted}${quote.close} ${connector} ${final}.`;
            for (const layout of [
              "one-line",
              "soft-wrap",
              "heading",
            ] as const) {
              const prose =
                layout === "soft-wrap"
                  ? oneLine.replace(
                      ` ${connector} ${final}`,
                      ` ${connector}\n${final}`,
                    )
                  : oneLine;
              const body = layout === "heading" ? `## ${prose}` : prose;
              const message = [
                quote.name,
                enclosed.name,
                connector,
                state,
                domain.domain,
                layout,
              ].join(", ");
              assert.equal(
                bodyPolicyFindings(body, domain.domain).length,
                1,
                message,
              );

              const normalized = prose.replaceAll("\n", " ");
              const emittingFacts = statementGroupFacts(normalized).filter(
                (fact) =>
                  fact.domain === domain.domain &&
                  fact.modality === "prohibited" &&
                  fact.scope === "workflow" &&
                  fact.completeness === "complete",
              );
              assert.equal(emittingFacts.length, 1, `${message}, facts`);
              assert.equal(
                emittingFacts[0]?.evidenceStart,
                0,
                `${message}, evidence start`,
              );
              assert.equal(
                emittingFacts[0]?.evidenceEnd,
                normalized.lastIndexOf(final) + final.length,
                `${message}, evidence end`,
              );
            }
          }
        }
      }
    }
  }
});

test("policy context is independent from workflow-subject state", () => {
  const prefixes = [
    "Policy:",
    "Requirement:",
    "Please",
    "For safety,",
  ] as const;
  const connectors = ["and", "but", "yet", "then"] as const;
  const domains = [
    {
      domain: "network",
      prohibition: "never use the network",
      recommendation: "should never use the network",
    },
    {
      domain: "upload",
      prohibition: "no external uploads",
      recommendation: "may never upload files",
    },
    {
      domain: "secrets",
      prohibition: "never use credentials",
      recommendation: "should never use credentials",
    },
  ] as const;

  for (const prefix of prefixes) {
    for (const connector of connectors) {
      for (const subjectMode of ["subjectless", "workflow"] as const) {
        for (const domain of domains) {
          for (const later of [
            domain.prohibition,
            domain.recommendation,
          ] as const) {
            const first =
              subjectMode === "workflow"
                ? "this workflow validates inputs"
                : "validate inputs";
            const oneLine = `${prefix} ${first} ${connector} ${later}.`;
            for (const layout of [
              "one-line",
              "soft-wrap",
              "heading",
            ] as const) {
              const prose =
                layout === "soft-wrap"
                  ? oneLine.replace(` ${connector} `, ` ${connector}\n`)
                  : oneLine;
              const body = layout === "heading" ? `## ${prose}` : prose;
              const message = `${prefix}, ${connector}, ${subjectMode}, ${domain.domain}, ${later}, ${layout}`;
              assert.equal(
                bodyPolicyFindings(body, domain.domain).length,
                1,
                message,
              );
              const normalized = prose.replaceAll("\n", " ");
              const fact = statementGroupFacts(normalized).find(
                (candidate) =>
                  candidate.domain === domain.domain &&
                  candidate.modality === "prohibited" &&
                  candidate.scope === "workflow" &&
                  candidate.completeness === "complete",
              );
              assertFactEvidence(
                fact,
                normalized,
                normalized.slice(0, normalized.lastIndexOf(".")),
                {
                  modality: "prohibited",
                  scope: "workflow",
                  completeness: "complete",
                },
                message,
              );
            }
          }
        }
      }
    }
  }

  for (const clean of [
    "Policy: validate inputs. Should never use the network.",
    "Policy: validate inputs.\n\nShould never use the network.",
    "Policy: validate inputs and the helper should never use the network.",
    'Policy: validate inputs and documents "should never use the network."',
    "Policy notes say validate inputs and should never use the network.",
  ]) {
    assert.equal(bodyPolicyFindings(clean, "network").length, 0, clean);
  }
});

test("subject-relative components reuse bounded statement-group state", () => {
  const domains = [
    { domain: "network", prohibition: "must not use the network" },
    { domain: "upload", prohibition: "cannot upload files" },
    { domain: "secrets", prohibition: "must never use credentials" },
  ] as const;
  const prefixes = ["", "Policy: ", "Please "] as const;

  for (const prefix of prefixes) {
    for (const domain of domains) {
      for (const predicateCount of [2, 3] as const) {
        for (const relationship of ["shared", "changed"] as const) {
          const middles =
            predicateCount === 2
              ? ["validates inputs"]
              : ["validates inputs", "checks results"];
          const final =
            relationship === "shared"
              ? domain.prohibition
              : `the helper ${domain.prohibition}`;
          const relative = `which ${[...middles, final].join(" and ")}`;
          const oneLine = `${prefix}this workflow, ${relative}, prepares the report.`;
          for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
            const prose =
              layout === "soft-wrap"
                ? oneLine
                    .replace(`, ${relative}`, `,\n${relative}`)
                    .replace(", prepares", ",\nprepares")
                : oneLine;
            const body = layout === "heading" ? `## ${prose}` : prose;
            const expected = relationship === "shared" ? 1 : 0;
            const message = `${prefix || "plain"}, ${domain.domain}, ${predicateCount}, ${relationship}, ${layout}`;
            assert.equal(
              bodyPolicyFindings(body, domain.domain).length,
              expected,
              message,
            );
            if (relationship === "shared") {
              const normalized = prose.replaceAll("\n", " ");
              const fact = statementGroupFacts(normalized).find(
                (candidate) =>
                  candidate.domain === domain.domain &&
                  candidate.modality === "prohibited" &&
                  candidate.scope === "workflow" &&
                  candidate.completeness === "complete",
              );
              const evidence = normalized.slice(
                0,
                normalized.indexOf(domain.prohibition) +
                  domain.prohibition.length,
              );
              assertFactEvidence(
                fact,
                normalized,
                evidence,
                {
                  modality: "prohibited",
                  scope: "workflow",
                  completeness: "complete",
                },
                message,
              );
            }
          }
        }
      }
    }
  }

  for (const { domain, body, expected } of [
    {
      domain: "network",
      body: "This workflow, which validates inputs and must not use the network and cannot upload files, prepares the report.",
      expected: 1,
    },
    {
      domain: "upload",
      body: "This workflow, which validates inputs and must not use the network and cannot upload files, prepares the report.",
      expected: 1,
    },
    {
      domain: "network",
      body: "This workflow, which validates inputs and must not use the network during local setup, prepares the report.",
      expected: 0,
    },
    {
      domain: "upload",
      body: "This workflow, which validates inputs and cannot upload files to a public bucket, prepares the report.",
      expected: 0,
    },
    {
      domain: "secrets",
      body: 'This workflow, which documents "must never use credentials" and validates inputs, must never use credentials.',
      expected: 1,
    },
    {
      domain: "secrets",
      body: 'This workflow, which documents "must never use credentials" and validates inputs, prepares the report.',
      expected: 0,
    },
    {
      domain: "network",
      body: "This workflow, which validates inputs, and must not use the network, prepares the report.",
      expected: 1,
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, expected, body);
  }
});

test("modal-negation semantics cover never, active, passive, and state forms", () => {
  const modals = [
    { modal: "must", plain: true, policy: true },
    { modal: "shall", plain: true, policy: true },
    { modal: "will", plain: true, policy: true },
    { modal: "should", plain: false, policy: true },
    { modal: "may", plain: false, policy: true },
    { modal: "might", plain: false, policy: false },
    { modal: "can", plain: false, policy: false },
    { modal: "could", plain: false, policy: false },
    { modal: "would", plain: false, policy: false },
  ] as const;
  const domains = [
    {
      domain: "network",
      action: "use the network",
      subject: "Network access",
      passive: "used",
    },
    {
      domain: "upload",
      action: "upload files",
      subject: "External uploads",
      passive: "performed",
    },
    {
      domain: "secrets",
      action: "use credentials",
      subject: "Credentials",
      passive: "used",
    },
  ] as const;

  for (const modal of modals) {
    for (const domain of domains) {
      for (const policyContext of [false, true]) {
        const prefix = policyContext ? "Policy: " : "";
        const forms = [
          {
            name: "never",
            body: `${prefix}this workflow ${modal.modal} never ${domain.action}.`,
            policyEligible: true,
          },
          {
            name: "active-not",
            body: `${prefix}this workflow ${modal.modal} not ${domain.action}.`,
            policyEligible: true,
          },
          {
            name: "passive-not",
            body: `${prefix}${domain.subject} ${modal.modal} not be ${domain.passive} in this workflow.`,
            policyEligible: true,
          },
          {
            name: "permission-state",
            body: `${prefix}${domain.subject} ${modal.modal} not be allowed in this workflow.`,
            policyEligible: true,
          },
          {
            name: "availability-state",
            body: `${prefix}${domain.subject} ${modal.modal} not be available in this workflow.`,
            policyEligible: false,
          },
        ] as const;
        for (const form of forms) {
          const expected =
            form.policyEligible && (policyContext ? modal.policy : modal.plain);
          for (const layout of ["one-line", "soft-wrap", "heading"] as const) {
            const prose =
              layout === "soft-wrap"
                ? form.body.replace(
                    policyContext ? "Policy: " : " in this workflow",
                    policyContext ? "Policy:\n" : "\nin this workflow",
                  )
                : form.body;
            const body = layout === "heading" ? `## ${prose}` : prose;
            const message = `${modal.modal}, ${domain.domain}, ${policyContext ? "policy" : "plain"}, ${form.name}, ${layout}`;
            assert.equal(
              bodyPolicyFindings(body, domain.domain).length,
              expected ? 1 : 0,
              message,
            );
          }
        }
      }
    }
  }

  for (const { domain, body } of [
    {
      domain: "network",
      body: "Network access may not be available in this workflow.",
    },
    {
      domain: "network",
      body: "Network access should not be used in this workflow.",
    },
    {
      domain: "upload",
      body: "External uploads should not be performed during this workflow.",
    },
  ] as const) {
    const fact = statementGroupFacts(body).find(
      (candidate) => candidate.domain === domain,
    );
    assert.ok(fact, body);
    assert.equal(fact.modality, "unknown", body);
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

test("unrelated coordinated remainders do not become completeness boundaries", () => {
  for (const { body, domain } of [
    {
      body: "No network access and only approved domains may be contacted.",
      domain: "network",
    },
    {
      body: "No external uploads and only approved transfers may proceed.",
      domain: "upload",
    },
    {
      body: "No secret access and use the approved vault when needed.",
      domain: "secrets",
    },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assert.equal(facts[0]?.completeness, "unsupported-remainder", body);
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});
