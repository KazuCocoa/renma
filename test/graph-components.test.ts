import assert from "node:assert/strict";
import { test } from "node:test";
import { stronglyConnectedComponents } from "../src/graph-components.js";

test("components match mutual reachability for every three-node directed graph", () => {
  const ids = ["", "__proto__", "é"];
  const pairs = ids.flatMap((from) => ids.map((to) => ({ from, to })));
  for (let mask = 0; mask < 1 << pairs.length; mask += 1) {
    const edges = Object.freeze(
      pairs
        .filter((_, index) => mask & (1 << index))
        .map((edge) => Object.freeze(edge)),
    );
    const present = new Set(edges.flatMap(({ from, to }) => [from, to]));
    const reachable = ids.map((from) =>
      ids.map(
        (to) =>
          from === to ||
          edges.some((edge) => edge.from === from && edge.to === to),
      ),
    );
    // Independent oracle: transitive closure, then mutual reachability.
    for (let via = 0; via < ids.length; via += 1) {
      for (let from = 0; from < ids.length; from += 1) {
        for (let to = 0; to < ids.length; to += 1) {
          reachable[from]![to] ||=
            reachable[from]![via]! && reachable[via]![to]!;
        }
      }
    }
    const expected = new Set(
      ids
        .filter((id) => present.has(id))
        .map((id) => {
          const from = ids.indexOf(id);
          return JSON.stringify(
            ids
              .filter(
                (other, to) =>
                  present.has(other) &&
                  reachable[from]![to] &&
                  reachable[to]![from],
              )
              .sort(),
          );
        }),
    );
    const actual = stronglyConnectedComponents(edges);
    assert.deepEqual(
      actual.map((component) => JSON.stringify(component)).sort(),
      [...expected].sort(),
    );
    assert.deepEqual(
      stronglyConnectedComponents([...edges, ...edges].reverse()),
      actual,
    );
  }
});
