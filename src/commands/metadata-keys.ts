import {
  AGENT_SKILLS_TOP_LEVEL_FIELDS,
  ASSET_BINDING_METADATA_DEFINITIONS,
  CANONICAL_SKILL_METADATA_KEYS,
  CANONICAL_SKILL_PUBLICATION_METADATA_KEY,
  NON_SKILL_AUXILIARY_METADATA_DEFINITIONS,
  NON_SKILL_CATALOG_METADATA_KEYS,
  SECURITY_METADATA_FIELD_DEFINITIONS,
} from "../metadata-definitions.js";

/** Print the installed vocabulary without accessing repository state. */
export function runMetadataKeysCommand(format: "text" | "json"): number {
  const keys = {
    skill: [
      ...Object.values(CANONICAL_SKILL_METADATA_KEYS),
      ...SECURITY_METADATA_FIELD_DEFINITIONS.map((field) => field.skillKey),
      CANONICAL_SKILL_PUBLICATION_METADATA_KEY,
      ...ASSET_BINDING_METADATA_DEFINITIONS.flatMap((field) =>
        "skillKey" in field ? [field.skillKey] : [],
      ),
    ],
    nonSkill: [
      ...Object.values(NON_SKILL_CATALOG_METADATA_KEYS),
      ...SECURITY_METADATA_FIELD_DEFINITIONS.map((field) => field.nonSkillKey),
      ...NON_SKILL_AUXILIARY_METADATA_DEFINITIONS.map(
        (field) => field.nonSkillKey,
      ),
      ...ASSET_BINDING_METADATA_DEFINITIONS.map((field) => field.nonSkillKey),
    ],
    agentSkillTopLevel: AGENT_SKILLS_TOP_LEVEL_FIELDS,
  };
  const output =
    format === "json"
      ? JSON.stringify(keys, null, 2)
      : Object.entries(keys)
          .map(
            ([group, fields]) =>
              `${group}:\n${fields.map((key) => `  ${key}`).join("\n")}`,
          )
          .join("\n\n");
  process.stdout.write(`${output}\n`);
  return 0;
}
