import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillAuthoringGuidance } from "../src/guidance/skill-authoring.js";
import {
  renderSkillGuideJson,
  renderSkillGuidePrompt,
} from "../src/renderers/guide.js";

test("generated artifacts remain qualified evidence", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const truth = guidance.interaction.truthSources.join("\n");
  const prompt = renderSkillGuidePrompt(guidance);
  const json = renderSkillGuideJson(guidance);

  assert.match(truth, /Generated and derived artifacts/);
  assert.match(
    truth,
    /Renma-generated reports, test results, logs, diagnostics/,
  );
  assert.match(truth, /machine-generated review summaries or comments/);
  assert.match(truth, /external-review artifacts/);
  assert.match(truth, /bounded observations made by an identified producer/);
  assert.match(
    truth,
    /provenance, subject, scope, applicability, and currentness/,
  );
  assert.match(truth, /does not make the artifact governing authority/);
  assert.match(truth, /domain behavior, policy, completeness, or safety/);
  assert.match(truth, /favorable result alone/);
  assert.match(truth, /artifact's supported evidence boundary/);
  assert.match(truth, /applicable truth source/);
  assert.match(truth, /Preserve conflicts/);
  assert.match(truth, /recency, detail, or model confidence/);
  assert.match(truth, /authorized human's explicit decision/);
  assert.match(truth, /explicit user statement regardless of medium/);
  for (const projection of [prompt, json]) {
    assert.match(
      projection,
      /bounded observations made by an identified producer/,
    );
    assert.match(projection, /artifact's supported evidence boundary/);
    assert.match(projection, /authorized human's explicit decision/);
  }
});

test("human review exposes material decisions", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const phases = guidance.interaction.phases.join("\n");
  const prompt = renderSkillGuidePrompt(guidance);
  const json = renderSkillGuideJson(guidance);

  assert.match(phases, /human review supported by a compact summary/);
  assert.match(phases, /each material non-obvious decision/);
  assert.match(phases, /its governing evidence or authority/);
  assert.match(phases, /evidence-backed consequence of changing it/);
  assert.match(
    phases,
    /potential impact explicitly labeled Proposed or Unresolved/,
  );
  assert.match(phases, /when the consequence is not established/);
  assert.match(phases, /Do not claim that the reviewer understood/);
  assert.match(phases, /approved, or independently verified the proposal/);
  for (const projection of [prompt, json]) {
    assert.match(projection, /evidence-backed consequence of changing it/);
    assert.match(
      projection,
      /potential impact explicitly labeled Proposed or Unresolved/,
    );
  }
});

test("handoff evidence remains qualified", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const rules = guidance.handoff.rules.join("\n");
  const prompt = renderSkillGuidePrompt(guidance);
  const json = renderSkillGuideJson(guidance);

  assert.match(rules, /supporting evidence remains applicable/);
  assert.match(rules, /current applicability cannot be established/);
  assert.match(rules, /evidence supporting material handoff decisions/);
  assert.match(rules, /scaffolding or semantic authoring will rely on/);
  assert.match(rules, /re-enter the creation gate/i);
  assert.match(rules, /when the result changes/);
  assert.match(rules, /Skill contract, source authority, security decisions/);
  assert.match(rules, /runtime-unknown handling, or asset boundaries/);
  assert.doesNotMatch(rules, /since clarification|pending authoring decisions/);
  for (const projection of [prompt, json]) {
    assert.match(projection, /current applicability cannot be established/);
    assert.match(projection, /evidence supporting material handoff decisions/);
  }
});
