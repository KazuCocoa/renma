import path from "node:path";

import type { Asset, AssetKind, AssetStatus, Skill } from "./model.js";
import type { RepositorySnapshot } from "./repository-evidence.js";
import type {
  Diagnostic,
  Evidence,
  MetadataValue,
  ParsedDocument,
} from "./types.js";

export const SKILL_INDEX_SCHEMA_VERSION = "renma.skill-index.v1";

export type SkillRouteEvidenceKind = "metadata" | "markdown_link";
export type SkillEntrypointReason = "explicit" | "inferred";

export interface SkillRouteEvidence extends Evidence {
  kind: SkillRouteEvidenceKind;
  target: string;
}

export interface SkillRoute {
  from: string;
  to: string;
  resolved: boolean;
  targetId?: string;
  targetKind?: AssetKind;
  targetPath?: string;
  targetStatus?: AssetStatus;
  evidence: SkillRouteEvidence[];
}

export interface SkillIndexEntry {
  id: string;
  title: string;
  sourcePath: string;
  owner?: string;
  status?: AssetStatus;
  tags: string[];
  products: string[];
  aliases: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  requiredContext: string[];
  optionalContext: string[];
  requiredLens: string[];
  optionalLens: string[];
  discoveryEntrypoint?: boolean;
  entrypointReason?: SkillEntrypointReason;
  incomingRouteCount: number;
  outgoingRouteCount: number;
  reachable: boolean;
}

export interface SkillIndexReport {
  schemaVersion: typeof SKILL_INDEX_SCHEMA_VERSION;
  root: string;
  configPath?: string;
  scannedFileCount: number;
  skillCount: number;
  routeCount: number;
  entrypointCount: number;
  reachableSkillCount: number;
  entrypointIds: string[];
  skills: SkillIndexEntry[];
  routes: SkillRoute[];
  diagnostics: Diagnostic[];
}

interface RouteCandidate {
  from: Skill;
  target: string;
  evidence: SkillRouteEvidence;
  resolvedTarget?: Asset;
}

interface SkillSource {
  skill: Skill;
  document?: ParsedDocument;
  aliases: string[];
  explicitEntrypoint?: boolean;
}

/** Build deterministic skill-routing evidence from one repository snapshot. */
export function buildSkillIndex(
  snapshot: RepositorySnapshot,
): SkillIndexReport {
  const assets = [...snapshot.catalog.assets].sort(compareAssets);
  const skills = assets.filter(isSkill);
  const documentsByPath = new Map(
    snapshot.documents.map((document) => [
      normalizePath(document.artifact.path),
      document,
    ]),
  );
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const assetsByPath = new Map(
    assets.map((asset) => [normalizePath(asset.sourcePath), asset]),
  );
  const skillSources = skills.map((skill) =>
    skillSource(skill, documentsByPath.get(normalizePath(skill.sourcePath))),
  );

  const candidates = [
    ...declaredRouteCandidates(skillSources, assetsById, assetsByPath),
    ...observedRouteCandidates(skillSources, assetsByPath),
  ];
  const routes = mergeRouteCandidates(candidates);
  const diagnostics = routeDiagnostics(routes, skillSources);

  const activeSkills = skillSources.filter(({ skill }) => isActive(skill));
  const activeIds = new Set(activeSkills.map(({ skill }) => skill.id));
  const incoming = routeCounts(routes, "incoming", activeIds);
  const outgoing = routeCounts(routes, "outgoing", activeIds);
  const entrypointReasons = inferEntrypoints(activeSkills, incoming);
  const entrypointIds = [...entrypointReasons.keys()].sort();
  const reachableIds = reachableSkills(entrypointIds, routes, activeIds);

  diagnostics.push(
    ...cycleDiagnostics(routes, activeIds),
    ...aliasDiagnostics(activeSkills),
    ...unreachableDiagnostics(activeSkills, reachableIds),
  );
  diagnostics.sort(compareDiagnostics);

  const entries = skillSources
    .map(({ skill, document, aliases, explicitEntrypoint }) => {
      const entrypointReason = entrypointReasons.get(skill.id);
      const entry: SkillIndexEntry = {
        id: skill.id,
        title: skillTitle(skill, document),
        sourcePath: skill.sourcePath,
        ...(skill.metadata.owner ? { owner: skill.metadata.owner } : {}),
        ...(skill.metadata.status ? { status: skill.metadata.status } : {}),
        tags: [...skill.metadata.tags].sort(),
        products: productFacets(skill.metadata.tags),
        aliases,
        whenToUse: [...skill.metadata.whenToUse],
        whenNotToUse: [...skill.metadata.whenNotToUse],
        requiredContext: [...skill.requiredContext],
        optionalContext: [...skill.optionalContext],
        requiredLens: [...skill.requiredLens],
        optionalLens: [...skill.optionalLens],
        ...(explicitEntrypoint === undefined
          ? {}
          : { discoveryEntrypoint: explicitEntrypoint }),
        ...(entrypointReason ? { entrypointReason } : {}),
        incomingRouteCount: incoming.get(skill.id) ?? 0,
        outgoingRouteCount: outgoing.get(skill.id) ?? 0,
        reachable: reachableIds.has(skill.id),
      };
      return entry;
    })
    .sort(compareSkillEntries);

  return {
    schemaVersion: SKILL_INDEX_SCHEMA_VERSION,
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scannedFileCount: snapshot.scannedFileCount,
    skillCount: entries.length,
    routeCount: routes.length,
    entrypointCount: entrypointIds.length,
    reachableSkillCount: activeSkills.filter(({ skill }) =>
      reachableIds.has(skill.id),
    ).length,
    entrypointIds,
    skills: entries,
    routes,
    diagnostics,
  };
}

function skillSource(skill: Skill, document?: ParsedDocument): SkillSource {
  const aliases = document
    ? listMetadata(document.metadata.discovery_aliases)
        .map((alias) => alias.trim())
        .filter(Boolean)
    : [];
  const explicitEntrypoint = document
    ? booleanMetadata(document.metadata.discovery_entrypoint)
    : undefined;

  return {
    skill,
    ...(document ? { document } : {}),
    aliases: uniqueSorted(aliases),
    ...(explicitEntrypoint === undefined ? {} : { explicitEntrypoint }),
  };
}

function declaredRouteCandidates(
  sources: SkillSource[],
  assetsById: Map<string, Asset>,
  assetsByPath: Map<string, Asset>,
): RouteCandidate[] {
  const candidates: RouteCandidate[] = [];
  for (const { skill, document } of sources) {
    if (!document) continue;
    const targets = listMetadata(document.metadata.routes_to);
    targets.forEach((target, index) => {
      const normalizedTarget = target.trim();
      if (!normalizedTarget) return;
      const resolvedTarget =
        assetsById.get(normalizedTarget) ??
        assetsByPath.get(normalizeRepositoryReference(normalizedTarget));
      candidates.push({
        from: skill,
        target: normalizedTarget,
        evidence: metadataRouteEvidence(document, normalizedTarget, index),
        ...(resolvedTarget ? { resolvedTarget } : {}),
      });
    });
  }
  return candidates;
}

function observedRouteCandidates(
  sources: SkillSource[],
  assetsByPath: Map<string, Asset>,
): RouteCandidate[] {
  const candidates: RouteCandidate[] = [];
  for (const { skill, document } of sources) {
    if (!document) continue;
    for (const link of document.links) {
      const targetPath = resolveMarkdownTarget(
        skill.sourcePath,
        link.target,
        assetsByPath,
      );
      if (!targetPath) continue;
      const resolvedTarget = assetsByPath.get(targetPath);
      if (!resolvedTarget || resolvedTarget.kind !== "skill") continue;
      if (resolvedTarget.id === skill.id) continue;
      candidates.push({
        from: skill,
        target: link.target,
        resolvedTarget,
        evidence: {
          kind: "markdown_link",
          target: link.target,
          path: skill.sourcePath,
          startLine: link.line,
          endLine: link.line,
          snippet: document.lines[link.line - 1]?.trim() ?? link.target,
        },
      });
    }
  }
  return candidates;
}

function mergeRouteCandidates(candidates: RouteCandidate[]): SkillRoute[] {
  const routes = new Map<string, SkillRoute>();
  for (const candidate of candidates) {
    const targetKey = candidate.resolvedTarget?.id ?? candidate.target;
    const key = `${candidate.from.id}\0${targetKey}`;
    const current = routes.get(key);
    if (current) {
      if (
        !current.evidence.some((evidence) =>
          sameEvidence(evidence, candidate.evidence),
        )
      ) {
        current.evidence.push(candidate.evidence);
        current.evidence.sort(compareRouteEvidence);
      }
      continue;
    }

    const target = candidate.resolvedTarget;
    routes.set(key, {
      from: candidate.from.id,
      to: candidate.target,
      resolved: target !== undefined,
      ...(target
        ? {
            targetId: target.id,
            targetKind: target.kind,
            targetPath: target.sourcePath,
            ...(target.metadata.status
              ? { targetStatus: target.metadata.status }
              : {}),
          }
        : {}),
      evidence: [candidate.evidence],
    });
  }

  return [...routes.values()].sort(compareRoutes);
}

function routeDiagnostics(
  routes: SkillRoute[],
  sources: SkillSource[],
): Diagnostic[] {
  const sourceById = new Map(
    sources.map((source) => [source.skill.id, source]),
  );
  const diagnostics: Diagnostic[] = [];

  for (const route of routes) {
    const evidence = route.evidence[0];
    const sourcePath = sourceById.get(route.from)?.skill.sourcePath;
    if (!route.resolved) {
      diagnostics.push({
        code: "DISCOVERY-UNRESOLVED-ROUTE",
        severity: "warning",
        message: `Skill route "${route.to}" from "${route.from}" does not resolve to a discovered asset.`,
        ...(sourcePath ? { path: sourcePath } : {}),
        ...(evidence ? { evidence } : {}),
        llmHint:
          "Fix the exact skill ID or repository-relative path, or remove the route if the target is no longer part of this repository.",
        details: { source: route.from, target: route.to },
      });
      continue;
    }

    if (route.targetKind !== "skill") {
      diagnostics.push({
        code: "DISCOVERY-ROUTE-TARGET-NOT-SKILL",
        severity: "warning",
        message: `Skill route "${route.to}" from "${route.from}" resolves to ${route.targetKind ?? "an unknown asset kind"}, not a skill.`,
        ...(sourcePath ? { path: sourcePath } : {}),
        ...(evidence ? { evidence } : {}),
        llmHint:
          "Point routes_to at a discovered skill. Use requires_context, optional_context, requires_lens, or optional_lens for context relationships.",
        details: {
          source: route.from,
          target: route.to,
          targetId: route.targetId,
          targetKind: route.targetKind,
          targetPath: route.targetPath,
        },
      });
      continue;
    }

    const source = sourceById.get(route.from)?.skill;
    if (
      source &&
      isActive(source) &&
      (route.targetStatus === "deprecated" || route.targetStatus === "archived")
    ) {
      diagnostics.push({
        code: "DISCOVERY-DEPRECATED-SKILL-ROUTED",
        severity: "warning",
        message: `Active routing from "${route.from}" reaches ${route.targetStatus} skill "${route.targetId}".`,
        ...(sourcePath ? { path: sourcePath } : {}),
        ...(evidence ? { evidence } : {}),
        llmHint:
          "Route to the active replacement skill or keep an explicit compatibility explanation in the source SKILL.md.",
        details: {
          source: route.from,
          targetId: route.targetId,
          targetPath: route.targetPath,
          targetStatus: route.targetStatus,
        },
      });
    }
  }

  for (const source of sources) {
    if (!source.document) continue;
    const raw = metadataText(source.document.metadata.discovery_entrypoint);
    if (raw !== undefined && booleanMetadata(raw) === undefined) {
      const field = source.document.metadataFields.discovery_entrypoint;
      diagnostics.push({
        code: "DISCOVERY-INVALID-ENTRYPOINT",
        severity: "warning",
        message: `Invalid discovery_entrypoint value "${raw}". Expected true or false.`,
        path: source.skill.sourcePath,
        ...(field
          ? {
              evidence: {
                path: field.path,
                startLine: field.startLine,
                endLine: field.endLine,
                snippet: field.raw,
              },
            }
          : {}),
      });
    }
  }

  return diagnostics;
}

function cycleDiagnostics(
  routes: SkillRoute[],
  activeIds: Set<string>,
): Diagnostic[] {
  const adjacency = routeAdjacency(routes, activeIds);
  const components = stronglyConnectedComponents(
    [...activeIds].sort(),
    adjacency,
  );
  const diagnostics: Diagnostic[] = [];

  for (const component of components) {
    const selfLoop =
      component.length === 1 &&
      (adjacency.get(component[0] ?? "") ?? []).includes(component[0] ?? "");
    if (component.length < 2 && !selfLoop) continue;
    const members = [...component].sort();
    const route = routes.find(
      (candidate) =>
        candidate.targetId !== undefined &&
        members.includes(candidate.from) &&
        members.includes(candidate.targetId),
    );
    const evidence = route?.evidence[0];
    diagnostics.push({
      code: "DISCOVERY-ROUTE-CYCLE",
      severity: "warning",
      message: `Skill routing cycle detected: ${members.join(" -> ")}.`,
      ...(evidence ? { path: evidence.path, evidence } : {}),
      llmHint:
        "Keep layered routing directional. Remove the back edge or document a terminal workflow boundary instead of routing entrypoints to each other cyclically.",
      details: { skills: members },
    });
  }

  return diagnostics;
}

function aliasDiagnostics(sources: SkillSource[]): Diagnostic[] {
  const claims = new Map<string, SkillSource[]>();
  for (const source of sources) {
    if (!isActive(source.skill)) continue;
    for (const alias of source.aliases) {
      const normalized = normalizeAlias(alias);
      if (!normalized) continue;
      const current = claims.get(normalized) ?? [];
      current.push(source);
      claims.set(normalized, current);
    }
  }

  const diagnostics: Diagnostic[] = [];
  for (const [alias, owners] of [...claims.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const uniqueOwners = uniqueSorted(owners.map(({ skill }) => skill.id));
    if (uniqueOwners.length < 2) continue;
    const first = owners.toSorted((a, b) =>
      a.skill.id.localeCompare(b.skill.id),
    )[0];
    diagnostics.push({
      code: "DISCOVERY-DUPLICATE-ALIAS",
      severity: "warning",
      message: `Discovery alias "${alias}" is claimed by multiple active skills: ${uniqueOwners.join(", ")}.`,
      ...(first ? { path: first.skill.sourcePath } : {}),
      llmHint:
        "Keep aliases specific enough to identify one skill, or route the broad alias to a shared entrypoint skill.",
      details: { alias, skills: uniqueOwners },
    });
  }
  return diagnostics;
}

function unreachableDiagnostics(
  sources: SkillSource[],
  reachableIds: Set<string>,
): Diagnostic[] {
  return sources
    .filter(({ skill }) => isActive(skill) && !reachableIds.has(skill.id))
    .map(
      ({ skill }): Diagnostic => ({
        code: "DISCOVERY-UNREACHABLE-SKILL",
        severity: "warning",
        message: `Active skill "${skill.id}" is not reachable from any discovery entrypoint.`,
        path: skill.sourcePath,
        llmHint:
          "Add a route from an appropriate entrypoint, mark this skill as an explicit entrypoint, or set discovery_entrypoint: false only when the skill is intentionally hidden and still reachable through another route.",
        details: { skillId: skill.id },
      }),
    );
}

function inferEntrypoints(
  sources: SkillSource[],
  incoming: Map<string, number>,
): Map<string, SkillEntrypointReason> {
  const reasons = new Map<string, SkillEntrypointReason>();
  for (const source of sources) {
    if (source.explicitEntrypoint === true) {
      reasons.set(source.skill.id, "explicit");
      continue;
    }
    if (
      source.explicitEntrypoint !== false &&
      (incoming.get(source.skill.id) ?? 0) === 0
    ) {
      reasons.set(source.skill.id, "inferred");
    }
  }
  return reasons;
}

function reachableSkills(
  entrypointIds: string[],
  routes: SkillRoute[],
  activeIds: Set<string>,
): Set<string> {
  const adjacency = routeAdjacency(routes, activeIds);
  const reachable = new Set<string>();
  const queue = [...entrypointIds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const target of adjacency.get(current) ?? []) {
      if (!reachable.has(target)) queue.push(target);
    }
  }
  return reachable;
}

function routeCounts(
  routes: SkillRoute[],
  direction: "incoming" | "outgoing",
  activeIds: Set<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const route of routes) {
    if (
      route.targetKind !== "skill" ||
      !route.targetId ||
      !activeIds.has(route.from) ||
      !activeIds.has(route.targetId)
    ) {
      continue;
    }
    const id = direction === "incoming" ? route.targetId : route.from;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function routeAdjacency(
  routes: SkillRoute[],
  activeIds: Set<string>,
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const id of activeIds) adjacency.set(id, []);
  for (const route of routes) {
    if (
      route.targetKind !== "skill" ||
      !route.targetId ||
      !activeIds.has(route.from) ||
      !activeIds.has(route.targetId)
    ) {
      continue;
    }
    const targets = adjacency.get(route.from) ?? [];
    targets.push(route.targetId);
    adjacency.set(route.from, uniqueSorted(targets));
  }
  return adjacency;
}

function stronglyConnectedComponents(
  nodes: string[],
  adjacency: Map<string, string[]>,
): string[][] {
  let index = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (node: string): void => {
    indexes.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of adjacency.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0),
        );
      } else if (onStack.has(target)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node) ?? 0, indexes.get(target) ?? 0),
        );
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component.sort());
  };

  for (const node of nodes) {
    if (!indexes.has(node)) visit(node);
  }
  return components.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

function metadataRouteEvidence(
  document: ParsedDocument,
  target: string,
  index: number,
): SkillRouteEvidence {
  const item = document.metadataListItems.routes_to?.[index];
  const field = item ?? document.metadataFields.routes_to;
  return {
    kind: "metadata",
    target,
    path: field?.path ?? document.artifact.path,
    startLine: field?.startLine ?? 1,
    endLine: field?.endLine ?? 1,
    snippet: field?.raw ?? `routes_to: ${target}`,
  };
}

function resolveMarkdownTarget(
  sourcePath: string,
  rawTarget: string,
  assetsByPath: Map<string, Asset>,
): string | undefined {
  const target = markdownPath(rawTarget);
  if (!target) return undefined;

  const repositoryRelative = normalizeRepositoryReference(target);
  if (assetsByPath.has(repositoryRelative)) return repositoryRelative;

  const relative = normalizePath(
    path.posix.normalize(
      path.posix.join(path.posix.dirname(sourcePath), target),
    ),
  );
  return assetsByPath.has(relative) ? relative : undefined;
}

function markdownPath(rawTarget: string): string | undefined {
  const target = rawTarget.trim();
  if (
    !target ||
    target.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("//")
  ) {
    return undefined;
  }
  const withoutTitle =
    target.match(/^<([^>]+)>$/)?.[1] ?? target.split(/\s+["']/)[0];
  const pathOnly = withoutTitle?.split(/[?#]/, 1)[0]?.trim();
  if (!pathOnly) return undefined;
  return pathOnly.startsWith("/") ? pathOnly.slice(1) : pathOnly;
}

function listMetadata(value: MetadataValue | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value))
    return value.map((item) => item.trim()).filter(Boolean);
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function metadataText(value: MetadataValue | undefined): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function booleanMetadata(
  value: MetadataValue | undefined,
): boolean | undefined {
  const text = metadataText(value)?.toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
}

function productFacets(tags: string[]): string[] {
  return uniqueSorted(
    tags
      .map((tag) => tag.match(/^product:(.+)$/i)?.[1]?.trim())
      .filter((product): product is string => Boolean(product)),
  );
}

function skillTitle(skill: Skill, document?: ParsedDocument): string {
  return (
    document?.headings.find((heading) => heading.depth === 1)?.text ??
    document?.headings[0]?.text ??
    skill.id
  );
}

function isSkill(asset: Asset): asset is Skill {
  return asset.kind === "skill";
}

function isActive(skill: Skill): boolean {
  return (
    skill.metadata.status !== "deprecated" &&
    skill.metadata.status !== "archived"
  );
}

function normalizeRepositoryReference(reference: string): string {
  return normalizePath(reference).replace(/^\.\//, "");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sameEvidence(a: SkillRouteEvidence, b: SkillRouteEvidence): boolean {
  return (
    a.kind === b.kind &&
    a.path === b.path &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.target === b.target
  );
}

function compareAssets(a: Asset, b: Asset): number {
  return a.sourcePath.localeCompare(b.sourcePath) || a.id.localeCompare(b.id);
}

function compareSkillEntries(a: SkillIndexEntry, b: SkillIndexEntry): number {
  return a.sourcePath.localeCompare(b.sourcePath) || a.id.localeCompare(b.id);
}

function compareRoutes(a: SkillRoute, b: SkillRoute): number {
  return (
    a.from.localeCompare(b.from) ||
    (a.targetId ?? a.to).localeCompare(b.targetId ?? b.to) ||
    a.to.localeCompare(b.to)
  );
}

function compareRouteEvidence(
  a: SkillRouteEvidence,
  b: SkillRouteEvidence,
): number {
  return (
    a.path.localeCompare(b.path) ||
    a.startLine - b.startLine ||
    a.kind.localeCompare(b.kind) ||
    a.target.localeCompare(b.target)
  );
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    (a.path ?? "").localeCompare(b.path ?? "") ||
    (a.code ?? "").localeCompare(b.code ?? "") ||
    a.message.localeCompare(b.message)
  );
}
