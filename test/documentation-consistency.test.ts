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

test("ownership and Discovery documentation retain the current evidence and exit boundaries", async () => {
  const authoring = (await readRepoFile("docs/authoring-guide.md")).replace(
    /\s+/g,
    " ",
  );
  assert.match(
    authoring,
    /Direct Markdown links from inspected standalone Contexts\/Lenses supply declared-owner candidates/,
  );
  assert.match(
    authoring,
    /Commands, prose path tokens, language imports, and transitive references supply no owner candidates/,
  );
  assert.match(
    authoring,
    /Owner resolution does not inherit or combine security policy/,
  );
  for (const filename of [
    "docs/authoring-guide.md",
    "docs/user-manual.md",
    "docs/development/design.md",
  ]) {
    const text = (await readRepoFile(filename)).replace(/\s+/g, " ");
    assert.doesNotMatch(
      text,
      /References do not establish ownership or policy inheritance|references do not transfer ownership or policy/,
    );
  }
  for (const filename of [
    "docs/skill-discovery.md",
    "docs/user-manual.md",
    "docs/development/internal-architecture.md",
  ]) {
    const text = (await readRepoFile(filename)).replace(/\s+/g, " ");
    assert.doesNotMatch(text, /its `WARN` exits `0`|`WARN` keeps exit `0`/);
    assert.match(text, /--fail-on-status/);
  }
});
