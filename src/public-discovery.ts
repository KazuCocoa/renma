/**
 * Stable v1 discovery helpers for external library consumers.
 *
 * Keep this surface pure and repository-relative. Filesystem walking,
 * repository-marker resolution, scanner orchestration, and migration-only
 * classifiers remain internal implementation details.
 */
export {
  RESERVED_SKILL_SUPPORT_DIRS,
  SKILL_ROOTS,
  SKILL_SUPPORT_DISCOVERY_MODE,
  classifyAssetPath,
  classifyRepositorySkillEntrypointPath,
  classifyRepositorySkillPath,
  logicalSkillDirectory,
  normalizeAssetRepositoryRelativePath,
  normalizeRepositorySkillRelativePath,
  type RepositorySkillPath,
  type ReservedSkillSupportDirectory,
  type CanonicalSkillEntrypointPath,
  type SkillRoot,
} from "./discovery.js";
