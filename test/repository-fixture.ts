import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";

import { stringify } from "yaml";

const execFile = promisify(execFileCallback);

export interface RepositoryFixtureOptions {
  prefix?: string;
  testContext?: TestContext;
}

export interface SkillFixtureOptions {
  id?: string;
  description?: string;
  owner?: string;
  status?: "experimental" | "stable" | "deprecated" | "archived";
  continuesWith?: readonly string[];
  publishedEntrypoint?: boolean;
  metadata?: Readonly<Record<string, string>>;
  body?: string;
}

export interface ContextFixtureOptions {
  id: string;
  owner?: string;
  status?: "experimental" | "stable" | "deprecated" | "archived" | string;
  whenToUse?: readonly string[];
  whenNotToUse?: readonly string[];
  requiresContext?: readonly string[];
  optionalContext?: readonly string[];
  body?: string;
}

export interface ContextLensFixtureOptions {
  id: string;
  owner?: string;
  purpose?: string;
  appliesTo?: readonly string[];
  focus?: readonly string[];
  expectedOutputs?: readonly string[];
  body?: string;
}

/** Focused builder for filesystem-backed Renma repository tests. */
export class RepositoryFixture {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(
    options: RepositoryFixtureOptions = {},
  ): Promise<RepositoryFixture> {
    const root = await mkdtemp(
      path.join(os.tmpdir(), options.prefix ?? "renma-fixture-"),
    );
    const fixture = new RepositoryFixture(root);
    options.testContext?.after(() => fixture.cleanup());
    return fixture;
  }

  static at(root: string): RepositoryFixture {
    return new RepositoryFixture(path.resolve(root));
  }

  resolve(relativePath: string): string {
    const normalized = normalizeFixturePath(relativePath);
    return path.join(this.root, ...normalized.split("/"));
  }

  async write(
    relativePath: string,
    content: string | Uint8Array,
  ): Promise<string> {
    const absolutePath = this.resolve(relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    return absolutePath;
  }

  async read(relativePath: string): Promise<string> {
    return readFile(this.resolve(relativePath), "utf8");
  }

  async writeConfig(config: unknown | string): Promise<string> {
    const content =
      typeof config === "string"
        ? config
        : `${JSON.stringify(config, null, 2)}\n`;
    return this.write("renma.config.json", content);
  }

  async skill(
    nameOrPath: string,
    options: SkillFixtureOptions = {},
  ): Promise<string> {
    const relativePath = skillFixturePath(nameOrPath);
    const name = path.posix.basename(path.posix.dirname(relativePath));
    const metadataLines = [
      `  renma.id: ${options.id ?? `skill.${name}`}`,
      ...(options.continuesWith
        ? [`  renma.continues-with: '${JSON.stringify(options.continuesWith)}'`]
        : []),
      ...(options.status ? [`  renma.status: ${options.status}`] : []),
      ...(options.owner ? [`  renma.owner: ${options.owner}`] : []),
      ...(options.publishedEntrypoint
        ? ['  renma.published-entrypoint: "true"']
        : []),
      ...Object.entries(options.metadata ?? {}).map(
        ([key, value]) => `  renma.${key}: ${JSON.stringify(value)}`,
      ),
    ];
    const description =
      options.description ??
      `Review ${name} repository evidence and produce deterministic results. Use when ${name} workflow validation is requested; do not use for runtime selection, prompt assembly, or command execution.`;
    const body =
      options.body ??
      `# ${name}\n\nReview repository evidence and report completion.\n`;
    return this.write(
      relativePath,
      [
        "---",
        `name: ${name}`,
        `description: ${description}`,
        "metadata:",
        ...metadataLines,
        "---",
        body.trimEnd(),
        "",
      ].join("\n"),
    );
  }

  async context(
    relativePath: string,
    options: ContextFixtureOptions,
  ): Promise<string> {
    const frontmatter = compactRecord({
      id: options.id,
      owner: options.owner,
      status: options.status,
      when_to_use: options.whenToUse,
      when_not_to_use: options.whenNotToUse,
      requires_context: options.requiresContext,
      optional_context: options.optionalContext,
    });
    return this.writeMarkdownFixture(
      relativePath,
      frontmatter,
      options.body ?? `# ${options.id}\n\nRepository context evidence.\n`,
    );
  }

  async contextLens(
    relativePath: string,
    options: ContextLensFixtureOptions,
  ): Promise<string> {
    const frontmatter = compactRecord({
      id: options.id,
      owner: options.owner,
      purpose: options.purpose,
      applies_to: options.appliesTo,
      focus: options.focus,
      expected_outputs: options.expectedOutputs,
    });
    return this.writeMarkdownFixture(
      relativePath,
      frontmatter,
      options.body ?? `# ${options.id}\n\nPurpose-specific interpretation.\n`,
    );
  }

  async initializeGit(branch = "main"): Promise<void> {
    await this.git(["init", "-b", branch]);
    await this.git(["config", "user.email", "renma@example.test"]);
    await this.git(["config", "user.name", "Renma Test"]);
  }

  async git(args: readonly string[]): Promise<string> {
    const { stdout } = await execFile("git", ["-C", this.root, ...args]);
    return stdout.trim();
  }

  async cleanup(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private async writeMarkdownFixture(
    relativePath: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ): Promise<string> {
    return this.write(
      relativePath,
      `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${body.trimEnd()}\n`,
    );
  }
}

export function normalizeFixturePath(relativePath: string): string {
  const slashPath = relativePath.replaceAll("\\", "/");
  if (path.posix.isAbsolute(slashPath)) {
    throw new Error("Repository fixture paths must be relative.");
  }
  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, "");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("Repository fixture paths must stay within the fixture.");
  }
  return normalized;
}

function skillFixturePath(nameOrPath: string): string {
  const normalized = normalizeFixturePath(nameOrPath);
  return normalized.includes("/")
    ? normalized
    : `skills/${normalized}/SKILL.md`;
}

function compactRecord(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter((entry) => entry[1] !== undefined),
  );
}
