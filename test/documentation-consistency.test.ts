import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };

const DOCUMENTATION_ENTRYPOINTS = ["README.md", "docs/README.md"] as const;

test("documentation entrypoint links resolve", async () => {
  for (const documentPath of DOCUMENTATION_ENTRYPOINTS) {
    const markdown = await readRepoFile(documentPath);
    for (const rawTarget of markdownLinkTargets(markdown)) {
      const relativeTarget = repositoryRelativeMarkdownTarget(rawTarget);
      if (!relativeTarget) continue;

      const resolved = path.resolve(path.dirname(documentPath), relativeTarget);
      await assert.doesNotReject(
        access(resolved),
        `${documentPath} contains an unresolved local link: ${rawTarget}`,
      );
    }
  }
});

test("package version matches the latest changelog release", async () => {
  const changelog = await readRepoFile("CHANGELOG.md");
  const latestRelease = changelog.match(
    /^## \[(\d+\.\d+\.\d+)\](?: - \d{4}-\d{2}-\d{2})?$/m,
  )?.[1];

  assert.ok(latestRelease, "CHANGELOG.md must contain a release heading.");
  assert.equal(
    packageJson.version,
    latestRelease,
    "package.json version must match the latest CHANGELOG.md release heading.",
  );
});

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

function markdownLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) =>
    (match[1] ?? "").trim(),
  );
}

function repositoryRelativeMarkdownTarget(
  rawTarget: string,
): string | undefined {
  if (
    rawTarget === "" ||
    rawTarget.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
  ) {
    return undefined;
  }

  const withoutTitle = rawTarget.startsWith("<")
    ? rawTarget.slice(1, rawTarget.indexOf(">"))
    : (rawTarget.split(/\s+["']/)[0] ?? rawTarget);
  const target = decodeURIComponent(withoutTitle.split("#", 1)[0] ?? "");
  return target || undefined;
}
