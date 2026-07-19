import assert from "node:assert/strict";
import { access, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import {
  INITIAL_CONFIG_CONTENT,
  initializeRepository,
} from "../src/commands/init.js";

test("init with no root initializes the current directory", async () => {
  const root = await fixture();
  const previousCwd = process.cwd();

  try {
    process.chdir(root);
    const result = await withCapturedConsole(() => main(["init"]));

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^Created renma\.config\.json$/m);
    assert.match(result.stdout, /^ {2}renma scan \.$/m);
    assert.equal(
      await readFile(path.join(root, "renma.config.json"), "utf8"),
      INITIAL_CONFIG_CONTENT,
    );
  } finally {
    process.chdir(previousCwd);
  }
});

test("init with an explicit root creates the config under that root", async () => {
  const root = await fixture();
  const result = await withCapturedConsole(() => main(["init", root]));

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    new RegExp(`^Created ${escapeRegExp(root)}/renma\\.config\\.json$`, "m"),
  );
  assert.match(
    result.stdout,
    new RegExp(`^ {2}renma scan ${escapeRegExp(root)}$`, "m"),
  );
});

test("initialized config is deterministic minimal JSON with a final newline", async () => {
  const root = await fixture();
  const result = await initializeRepository(root);
  const raw = await readFile(path.join(root, "renma.config.json"), "utf8");

  assert.equal(result.state, "created");
  assert.equal(raw, INITIAL_CONFIG_CONTENT);
  assert.ok(raw.endsWith("\n"));
  assert.deepEqual(JSON.parse(raw), { fail_on: "high", format: "text" });
});

test("re-running init leaves the generated config unchanged", async () => {
  const root = await fixture();
  const first = await withCapturedConsole(() => main(["init", root]));
  const configPath = path.join(root, "renma.config.json");
  const before = await stat(configPath);
  const content = await readFile(configPath, "utf8");
  const second = await withCapturedConsole(() => main(["init", root]));
  const after = await stat(configPath);

  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /Renma is already initialized with/);
  assert.match(second.stdout, /No files were changed\./);
  assert.equal(await readFile(configPath, "utf8"), content);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("existing customized, empty, and malformed primary configs are preserved", async (t) => {
  const cases = [
    '{"fail_on":"critical","custom-spacing":true}\n',
    "",
    "{ malformed\n",
  ];

  for (const content of cases) {
    await t.test(JSON.stringify(content), async () => {
      const root = await fixture();
      const configPath = path.join(root, "renma.config.json");
      await writeFile(configPath, content);

      const result = await withCapturedConsole(() => main(["init", root]));

      assert.equal(result.code, 0);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /Renma is already initialized with/);
      assert.match(result.stdout, /No files were changed\./);
      assert.equal(await readFile(configPath, "utf8"), content);
    });
  }
});

test("an existing legacy config prevents primary config creation", async () => {
  const root = await fixture();
  const legacyPath = path.join(root, ".renma.json");
  const legacyContent = '{"format":"json"}\n';
  await writeFile(legacyPath, legacyContent);

  const result = await withCapturedConsole(() => main(["init", root]));

  assert.equal(result.code, 0);
  assert.match(result.stdout, /already initialized with .*\.renma\.json/);
  assert.match(result.stdout, /No files were changed\./);
  assert.equal(await readFile(legacyPath, "utf8"), legacyContent);
  await assert.rejects(access(path.join(root, "renma.config.json")));
});

test("both conventional configs produce a precedence warning without changes", async () => {
  const root = await fixture();
  const primaryPath = path.join(root, "renma.config.json");
  const legacyPath = path.join(root, ".renma.json");
  await writeFile(primaryPath, "primary\n");
  await writeFile(legacyPath, "legacy\n");

  const result = await withCapturedConsole(() => main(["init", root]));

  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /Warning: both .*renma\.config\.json and .*\.renma\.json exist/,
  );
  assert.match(result.stdout, /renma\.config\.json takes precedence/);
  assert.match(result.stdout, /No files were changed\./);
  assert.equal(await readFile(primaryPath, "utf8"), "primary\n");
  assert.equal(await readFile(legacyPath, "utf8"), "legacy\n");
});

test("concurrent initialization uses exclusive creation", async () => {
  const root = await fixture();
  const results = await Promise.all([
    initializeRepository(root),
    initializeRepository(root),
  ]);

  assert.deepEqual(results.map((result) => result.state).sort(), [
    "created",
    "primary-existing",
  ]);
  assert.equal(
    await readFile(path.join(root, "renma.config.json"), "utf8"),
    INITIAL_CONFIG_CONTENT,
  );
});

test("init does not create a missing target root", async () => {
  const parent = await fixture();
  const root = path.join(parent, "missing", "repository");
  const result = await withCapturedConsole(() => main(["init", root]));

  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Could not initialize Renma/);
  await assert.rejects(access(root));
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-init-"));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function withCapturedConsole(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
