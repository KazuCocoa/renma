/**
 * Stable v1 discovery helpers for external library consumers.
 *
 * Keep this surface pure and repository-relative. Filesystem walking,
 * repository-marker resolution, scanner orchestration, and migration-only
 * classifiers remain internal implementation details.
 */
import { classifyAssetPath as classifyKnownAssetPath } from "./discovery.js";
import type { AssetClassificationEvidence } from "./types/classification.js";

export {
  classifyRepositorySkillEntrypointPath,
  classifyRepositorySkillPath,
  logicalSkillDirectory,
  normalizeAssetRepositoryRelativePath,
  normalizeRepositorySkillRelativePath,
  type RepositorySkillPath,
} from "./discovery.js";
export {
  RESERVED_SKILL_SUPPORT_DIRS,
  SKILL_ROOTS,
  SKILL_SUPPORT_DISCOVERY_MODE,
  type ReservedSkillSupportDirectory,
  type CanonicalSkillEntrypointPath,
  type SkillRoot,
} from "./skill-path-contract.js";

/** Classify a path while retaining an open forward-compatible wire type. */
export function classifyAssetPath(
  relativePath: string,
  options: { metadataType?: string } = {},
): AssetClassificationEvidence {
  return classifyKnownAssetPath(relativePath, options);
}
