import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillAuthoringGuidance } from "../src/guidance/skill-authoring.js";
import { renderSkillGuidePrompt } from "../src/renderers/guide.js";

test("generated and derived artifacts remain qualified evidence", () => {
  const guidance = buildSkillAuthoringGuidance("test-version");
  const truth = guidance.interaction.truthSources.join("\n");
  const prompt = renderSkillGuidePrompt(guidance);

  assert.match(truth, /Generated and derived artifacts/);
  assert.match(
    truth,
    /previous plans, summaries, visualizations, review comments, and agent output/,
  );
  assert.match(
    truth,
    /does not make their claims current or authoritative/,
  );
  assert.match(
    truth,
    /explicitly reviewed and designated the derived artifact itself as authoritative/,
  );
  assert.match(
    truth,
    /preserve the conflict[\s\S]*recency, detail, or model confidence/,
  );
  assert.match(prompt, /Generated and derived artifacts/);
});

test("human review exposes material decisions without claiming understanding", () => {
  const phases = buildSkillAuthoringGuidance(
    "test-version",
  ).interaction.phases.join("\n");

  assert.match(phases, /human review supported by a compact summary/);
  assert.match(phases, /material non-obvious decisions/);
  assert.match(phases, /their governing evidence or authority/);
  assert.match(phases, /the consequence of changing them/);
  assert.match(
    phases,
    /Do not claim that the reviewer understood, approved, or independently verified them/,
  );
});

test("handoff validity does not promote stale supporting evidence", () => {
  const rules = buildSkillAuthoringGuidance("test-version").handoff.rules.join(
    "\n",
  );

  assert.match(
    rules,
    /does not prove that its supporting evidence remains applicable/,
  );
  assert.match(
    rules,
    /repository or external-source state may have materially changed/,
  );
  assert.match(
    rules,
    /recheck only the evidence relevant to pending authoring decisions/,
  );
  assert.match(rules, /re-enter the creation gate/);
  assert.match(
    rules,
    /Skill contract, source authority, security decisions, runtime-unknown handling, or asset boundaries/,
  );
});
