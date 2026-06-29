import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("release-prep prints GitHub release notes from the target changelog section", () => {
  const result = spawnSync(
    "node",
    ["tools/release-prep.mjs", "--release-notes", "--version", "0.6.0"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^Renma v0\.6\.0 includes 8 changelog entries across added and changed\./,
  );
  assert.match(result.stdout, /## Highlights/);
  assert.match(result.stdout, /### Added/);
  assert.match(result.stdout, /- Added freshness diagnostics/);
  assert.match(result.stdout, /### Changed/);
  assert.match(result.stdout, /## Upgrade/);
  assert.match(result.stdout, /## Validation/);
  assert.match(
    result.stdout,
    /node dist\/index\.js diff \. --from v0\.5\.1 --to HEAD --format markdown/,
  );
});
