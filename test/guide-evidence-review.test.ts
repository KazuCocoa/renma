import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillAuthoringGuidance } from "../src/guidance/skill-authoring.js";
import { renderSkillGuidePrompt } from "../src/renderers/guide.js";

test("generated artifacts remain qualified evidence", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const truth = guidance.interaction.truthSources.join("\n");
  const prompt = renderSkillGuidePrompt(guidance);

  assert.match(truth, /Generated and derived artifacts/);
  assert.match(truth, /previous plans, summaries, visualizations/);
  assert.match(truth, /review comments, and agent output/);
  assert.match(truth, /does not make their claims current or authoritative/);
  assert.match(truth, /explicitly reviewed and designated/);
  assert.match(truth, /derived artifact itself as authoritative/);
  assert.match(truth, /preserve the conflict/);
  assert.match(truth, /recency, detail, or model confidence/);
  assert.match(prompt, /Generated and derived artifacts/);
});

test("human review exposes material decisions", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const phases = guidance.interaction.phases.join("\n");

  assert.match(phases, /human review supported by a compact summary/);
  assert.match(phases, /material non-obvious decisions/);
  assert.match(phases, /their governing evidence or authority/);
  assert.match(phases, /the consequence of changing them/);
  assert.match(phases, /Do not claim that the reviewer understood/);
  assert.match(phases, /approved, or independently verified them/);
});

test("handoff evidence remains qualified", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const rules = guidance.handoff.rules.join("\n");

  assert.match(rules, /supporting evidence remains applicable/);
  assert.match(rules, /repository or external-source state/);
  assert.match(rules, /may have materially changed/);
  assert.match(rules, /evidence relevant to pending authoring decisions/);
  assert.match(rules, /re-enter the creation gate/);
  assert.match(rules, /Skill contract, source authority, security decisions/);
  assert.match(rules, /runtime-unknown handling, or asset boundaries/);
});
