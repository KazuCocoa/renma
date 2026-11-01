import type {
  SkillDiscoveryCycleDiff,
  SkillDiscoveryDiff,
  SkillDiscoveryDiffSkill,
  SkillDiscoveryRouteChange,
  SkillDiscoveryRouteDiffState,
} from "../skill-discovery-diff.js";
import type {
  SkillDiscoveryCiPolicyEvaluation,
  SkillDiscoveryCiPolicyMatch,
} from "../skill-discovery-ci-policy.js";
import { MAX_LIST_ITEMS, formatOverflow } from "./ci-report-list.js";

export function formatSkillDiscoverySection(
  discovery: SkillDiscoveryDiff,
  policy?: SkillDiscoveryCiPolicyEvaluation,
): string[] {
  const lines = [
    "## Skill Discovery Changes",
    "",
    `- Schema: ${discovery.schemaVersion}`,
  ];
  lines.push(
    ...(policy
      ? formatSkillDiscoveryPolicySummary(policy)
      : ["- CI policy effect: none (observation only)"]),
  );

  if (!hasSkillDiscoveryChanges(discovery)) {
    lines.push("- No Skill Discovery topology changes.");
  } else {
    lines.push(
      `- Adoption: ${discovery.adoption.from} -> ${discovery.adoption.to}`,
      `- Coverage: ${discovery.coverage.from} -> ${discovery.coverage.to}`,
      `- Published entrypoints: +${discovery.publishedEntrypoints.added.length} / -${discovery.publishedEntrypoints.removed.length}`,
      `- Reachability: +${discovery.reachability.newlyReachable.length} reachable / +${discovery.reachability.newlyNotReached.length} not-reached`,
      `- Unrouted Skills: +${discovery.unroutedSkills.newlyUnrouted.length} / -${discovery.unroutedSkills.resolvedUnrouted.length}`,
      `- Routes: +${discovery.routes.added.length} / -${discovery.routes.removed.length} / ${discovery.routes.changed.length} changed`,
      `- Cyclic components: +${discovery.cycles.added.length} / -${discovery.cycles.resolved.length}`,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Added published entrypoints",
      discovery.publishedEntrypoints.added,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Removed published entrypoints",
      discovery.publishedEntrypoints.removed,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Newly reachable Skills",
      discovery.reachability.newlyReachable,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Newly not-reached Skills",
      discovery.reachability.newlyNotReached,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Newly unrouted Skills",
      discovery.unroutedSkills.newlyUnrouted,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Resolved unrouted Skills",
      discovery.unroutedSkills.resolvedUnrouted,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Added routes",
      discovery.routes.added,
      formatDiscoveryRoute,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Removed routes",
      discovery.routes.removed,
      formatDiscoveryRoute,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Changed routes",
      discovery.routes.changed,
      formatDiscoveryRouteChange,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Added cyclic components",
      discovery.cycles.added,
      formatDiscoveryCycle,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Resolved cyclic components",
      discovery.cycles.resolved,
      formatDiscoveryCycle,
    );
  }

  if (policy?.outcome === "warn") {
    appendSkillDiscoveryDetails(
      lines,
      "CI review policy matches",
      policy.matches,
      formatSkillDiscoveryPolicyMatch,
    );
  }
  return lines;
}

function formatSkillDiscoveryPolicySummary(
  policy: SkillDiscoveryCiPolicyEvaluation,
): string[] {
  const { from, to, effective } = policy.configured;
  const configured =
    from === to
      ? [`- CI review policy: ${from}`]
      : [
          `- CI review policy: ${from} -> ${to}`,
          `- Effective CI review policy: ${effective}`,
        ];
  if (effective === "off") {
    return [...configured, "- Policy outcome: PASS — policy disabled"];
  }
  if (policy.outcome === "pass") {
    return [
      ...configured,
      "- Policy outcome: PASS — no configured review conditions matched",
    ];
  }
  return [
    ...configured,
    "- Policy outcome: WARN — review requested; exit behavior unchanged",
  ];
}

function formatSkillDiscoveryPolicyMatch(
  match: SkillDiscoveryCiPolicyMatch,
): string {
  if (match.skill) {
    return `${match.id}: ${match.skill.id} (\`${match.skill.path}\`)`;
  }
  if (match.route) {
    return `${match.id}: \`${match.route.sourcePath}\` -> \`${match.route.normalizedTarget}\``;
  }
  if (match.fromState !== undefined && match.toState !== undefined) {
    return `${match.id}: ${match.fromState} -> ${match.toState}`;
  }
  return `${match.id}: ${match.summary}`;
}

function hasSkillDiscoveryChanges(discovery: SkillDiscoveryDiff): boolean {
  return (
    discovery.adoption.changed ||
    discovery.coverage.changed ||
    Object.values(discovery.summary).some((value) => value !== 0) ||
    discovery.publishedEntrypoints.added.length > 0 ||
    discovery.publishedEntrypoints.removed.length > 0 ||
    discovery.reachability.newlyReachable.length > 0 ||
    discovery.reachability.newlyNotReached.length > 0 ||
    discovery.unroutedSkills.newlyUnrouted.length > 0 ||
    discovery.unroutedSkills.resolvedUnrouted.length > 0 ||
    discovery.routes.added.length > 0 ||
    discovery.routes.removed.length > 0 ||
    discovery.routes.changed.length > 0 ||
    discovery.cycles.added.length > 0 ||
    discovery.cycles.resolved.length > 0
  );
}

function appendSkillDiscoveryDetails<T>(
  lines: string[],
  heading: string,
  items: readonly T[],
  render: (item: T) => string,
): void {
  if (items.length === 0) return;
  lines.push("", `### ${heading}`, "");
  lines.push(
    ...items.slice(0, MAX_LIST_ITEMS).map((item) => `- ${render(item)}`),
    ...formatOverflow(items.length),
  );
}

function formatDiscoverySkill(skill: SkillDiscoveryDiffSkill): string {
  return `${skill.id} (\`${skill.path}\`)`;
}

function formatDiscoveryRoute(route: SkillDiscoveryRouteDiffState): string {
  const declarationLabel =
    route.declarationCount === 1 ? "declaration" : "declarations";
  return `\`${route.sourcePath}\` -> \`${route.normalizedTarget}\` (${route.resolution}, ${route.usable ? "usable" : "unusable"}, ${route.declarationCount} ${declarationLabel})`;
}

function formatDiscoveryRouteChange(change: SkillDiscoveryRouteChange): string {
  return `\`${change.identity.sourcePath}\` -> \`${change.identity.normalizedTarget}\`: ${change.changedFields.join(", ")}`;
}

function formatDiscoveryCycle(cycle: SkillDiscoveryCycleDiff): string {
  return `${cycle.skillIds.join(", ")}${cycle.selfLoop ? " (self-loop)" : ""}`;
}
