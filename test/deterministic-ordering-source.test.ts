import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("production code uses explicit locale-independent string ordering", async () => {
  const files = await sourceFiles("src");
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\.localeCompare\s*\(/u.test(source)) {
      violations.push(`${file}: localeCompare`);
    }
    if (/\.(?:sort|toSorted)\(\s*\)/u.test(source)) {
      violations.push(`${file}: default string sort`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    "machine semantics must use compareUtf16CodeUnits instead of localeCompare or default string sort",
  );
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(candidate);
      return entry.isFile() && entry.name.endsWith(".ts") ? [candidate] : [];
    }),
  );
  return nested.flat();
}
