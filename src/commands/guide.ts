import { buildSkillAuthoringGuidance } from "../guidance/skill-authoring.js";
import {
  renderSkillGuideJson,
  renderSkillGuidePrompt,
} from "../renderers/guide.js";

export type GuideTopic = "skill";
export type GuideFormat = "prompt" | "json";

export interface GuideOptions {
  topic: GuideTopic;
  format: GuideFormat;
  renmaVersion: string;
}

/** Print deterministic authoring guidance without reading or changing a repository. */
export function runGuideCommand(options: GuideOptions): number {
  const guidance = buildSkillAuthoringGuidance(options.renmaVersion);
  const output =
    options.format === "json"
      ? renderSkillGuideJson(guidance)
      : renderSkillGuidePrompt(guidance);
  process.stdout.write(`${output}\n`);
  return 0;
}
