import { compareUtf16CodeUnits } from "./canonical-json.js";

/**
 * Find components among edge endpoints without recursion. Callers own edge
 * eligibility, self-loop interpretation, and domain-specific report ordering.
 */
export function stronglyConnectedComponents(
  edges: readonly { from: string; to: string }[],
): string[][] {
  const targets = new Map<string, Set<string>>();
  const sources = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    for (const id of [from, to]) {
      if (!targets.has(id)) targets.set(id, new Set());
      if (!sources.has(id)) sources.set(id, new Set());
    }
    targets.get(from)!.add(to);
    sources.get(to)!.add(from);
  }
  const nodeIds = [...targets.keys()].sort(compareUtf16CodeUnits);
  const sortedTargets = new Map(
    nodeIds.map((id) => [
      id,
      [...targets.get(id)!].sort(compareUtf16CodeUnits),
    ]),
  );

  // First pass: record finish order in the forward graph.
  const visited = new Set<string>();
  const finishingOrder: string[] = [];
  for (const nodeId of nodeIds) {
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const traversal = [{ nodeId, nextTargetIndex: 0 }];
    while (traversal.length > 0) {
      const frame = traversal[traversal.length - 1]!;
      const targetId = sortedTargets.get(frame.nodeId)![frame.nextTargetIndex];
      if (targetId !== undefined) {
        frame.nextTargetIndex += 1;
        if (!visited.has(targetId)) {
          visited.add(targetId);
          traversal.push({ nodeId: targetId, nextTargetIndex: 0 });
        }
      } else {
        finishingOrder.push(frame.nodeId);
        traversal.pop();
      }
    }
  }

  // Second pass: each reverse traversal visits exactly one component.
  const assigned = new Set<string>();
  const components: string[][] = [];
  for (const nodeId of finishingOrder.reverse()) {
    if (assigned.has(nodeId)) continue;
    assigned.add(nodeId);
    const component: string[] = [];
    const traversal = [nodeId];
    while (traversal.length > 0) {
      const member = traversal.pop()!;
      component.push(member);
      for (const sourceId of sources.get(member)!) {
        if (assigned.has(sourceId)) continue;
        assigned.add(sourceId);
        traversal.push(sourceId);
      }
    }
    components.push(component.sort(compareUtf16CodeUnits));
  }
  return components;
}
