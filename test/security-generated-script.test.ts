import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeBoundedGeneratedScriptExecutions,
  analyzeGeneratedLogicalShellCommands,
  boundedGeneratedScriptExecutions,
  generatedLogicalShellCommands,
  MAX_GENERATED_SCRIPT_BYTES,
  MAX_GENERATED_SCRIPT_ALTERNATIVES,
  MAX_GENERATED_SCRIPT_COMMANDS,
  MAX_GENERATED_SCRIPT_EXECUTIONS,
  MAX_TRACKED_GENERATED_FILES,
} from "../src/security-command/generated-script.js";
import {
  resolveShellExecutableWords,
  shellCommandWords,
} from "../src/security-command/shell-command.js";

test("generated scripts retain reconstructed text, normalized paths, and outer spans", () => {
  const command =
    `echo 'echo ready' > ./run.sh; ` +
    `printf '%s\\n' 'rm -rf /tmp/example' >> run.sh; sh run.sh`;
  const [execution] = boundedGeneratedScriptExecutions(command);

  assert.deepEqual(execution, {
    path: "run.sh",
    shellText: "echo ready\nrm -rf /tmp/example\n",
    producerSpan: {
      start: 0,
      end: command.indexOf("; sh run.sh"),
    },
    consumerSpan: {
      start: command.lastIndexOf(";") + 1,
      end: command.length,
    },
  });
});

test("generated script overwrite replaces prior reconstructed content", () => {
  const [execution] = boundedGeneratedScriptExecutions(
    `echo 'rm -rf /tmp/example' > run.sh; echo 'echo ready' > run.sh; sh run.sh`,
  );
  assert.equal(execution?.shellText, "echo ready\n");

  const [teeExecution] = boundedGeneratedScriptExecutions(
    `echo 'rm -rf /tmp/example' > run.sh; printf '%s\\n' 'echo safe' | tee run.sh >/dev/null; sh run.sh`,
  );
  assert.equal(teeExecution?.shellText, "echo safe\n");
});

test("generated script correlation is path-exact and rejects dynamic or parent paths", () => {
  for (const command of [
    `echo 'rm -rf /tmp/example' > a.sh; sh b.sh`,
    `echo 'rm -rf /tmp/example' > "$SCRIPT"; sh run.sh`,
    `echo 'rm -rf /tmp/example' > a/../run.sh; sh run.sh`,
    `echo 'rm -rf /tmp/example' >> run.sh; sh run.sh`,
  ]) {
    assert.deepEqual(boundedGeneratedScriptExecutions(command), [], command);
  }
});

test("bounded exact mutations invalidate generated-file facts", () => {
  for (const mutation of [
    "cp safe.sh run.sh",
    "mv safe.sh run.sh",
    "rm run.sh",
    "install safe.sh run.sh",
    "sed -i 's/rm/echo/' run.sh",
    "truncate -s 0 run.sh",
    "unlink run.sh",
  ]) {
    const command = `echo 'rm -rf /tmp/example' > run.sh; ${mutation}; sh run.sh`;
    assert.deepEqual(boundedGeneratedScriptExecutions(command), [], mutation);
  }
});

test("unknown mutations fail closed while proven harmless commands preserve facts", () => {
  assert.deepEqual(
    boundedGeneratedScriptExecutions(
      `echo 'rm -rf /tmp/example' > run.sh; custom-tool; sh run.sh`,
    ),
    [],
  );
  assert.equal(
    boundedGeneratedScriptExecutions(
      `echo 'rm -rf /tmp/example' > run.sh; echo ready; sh run.sh`,
    ).length,
    1,
  );
});

test("cwd changes invalidate relative facts but preserve unaffected absolute facts", () => {
  for (const cwdChange of ["cd /tmp", "pushd /tmp", "popd"]) {
    assert.deepEqual(
      boundedGeneratedScriptExecutions(
        `echo 'rm -rf /tmp/example' > run.sh; ${cwdChange}; sh run.sh`,
      ),
      [],
      cwdChange,
    );
  }
  assert.equal(
    boundedGeneratedScriptExecutions(
      `echo 'rm -rf /tmp/example' > /tmp/run.sh; cd /; sh /tmp/run.sh`,
    ).length,
    1,
  );

  const [normalized] = boundedGeneratedScriptExecutions(
    `echo 'rm -rf /tmp/example' > a/./run.sh; sh a/run.sh`,
  );
  assert.equal(normalized?.path, "a/run.sh");
});

test("Boolean and background branches retain only entry facts unaffected by the operand", () => {
  const positive = [
    `echo 'rm -rf /tmp/example' > run.sh; sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh && sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; false || sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; test -f other || sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; true & sh run.sh`,
  ];
  for (const command of positive) {
    assert.equal(boundedGeneratedScriptExecutions(command).length, 1, command);
  }

  const negative = [
    `echo 'rm -rf /tmp/example' > run.sh || sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh & sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; custom-tool & sh run.sh`,
  ];
  for (const command of negative) {
    assert.deepEqual(boundedGeneratedScriptExecutions(command), [], command);
  }
});

test("generated consumers share the canonical wrapper and sudo resolver", () => {
  const positive = [
    `echo 'rm -rf /tmp/example' > run.sh; env -i sh run.sh`,
    `echo 'rm -rf /tmp/example' > /tmp/run.sh; env -C /tmp sh /tmp/run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; sudo -u root sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; sudo --user=root sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; sudo --non-interactive sh run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; command env -- sh run.sh`,
  ];
  for (const command of positive) {
    assert.equal(boundedGeneratedScriptExecutions(command).length, 1, command);
  }

  for (const command of [
    `echo 'rm -rf /tmp/example' > run.sh; env source run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; sudo source run.sh`,
    `echo 'rm -rf /tmp/example' > run.sh; env -C /tmp sh run.sh`,
  ]) {
    assert.deepEqual(boundedGeneratedScriptExecutions(command), [], command);
  }
});

test("shell file consumers distinguish executing, inert, and unknown options", () => {
  const executing = [
    "bash --noprofile run.sh",
    "bash --norc run.sh",
    "sh -e run.sh",
    "zsh -f run.sh",
    "bash -O extglob run.sh",
    "bash -o errexit run.sh",
    "bash -euo pipefail run.sh",
    "bash --rcfile profile run.sh",
    "fish --no-config run.sh",
    `fish -C 'echo ready' run.sh`,
    "sh -- run.sh",
  ];
  for (const consumer of executing) {
    const analysis = analyzeBoundedGeneratedScriptExecutions(
      `echo unsafe > run.sh; ${consumer}`,
    );
    assert.equal(analysis.complete, true, consumer);
    assert.equal(analysis.values.length, 1, consumer);
  }

  for (const consumer of [
    "sh -n run.sh",
    "fish --no-execute run.sh",
    "sh -s run.sh",
    `bash -c 'source run.sh'`,
    "bash --command=source\\ run.sh",
    "bash --help run.sh",
  ]) {
    const analysis = analyzeBoundedGeneratedScriptExecutions(
      `echo unsafe > run.sh; ${consumer}`,
    );
    assert.equal(analysis.complete, true, consumer);
    assert.deepEqual(analysis.values, [], consumer);
  }

  for (const consumer of [
    "bash --future-option run.sh",
    "sh --noprofile run.sh",
    "zsh --norc run.sh",
  ]) {
    const unknown = analyzeBoundedGeneratedScriptExecutions(
      `echo unsafe > run.sh; ${consumer}`,
    );
    assert.equal(unknown.complete, false, consumer);
    assert.deepEqual(unknown.values, [], consumer);
    assert.ok(
      unknown.limitations.includes("unsupported-shell-syntax"),
      consumer,
    );
  }
});

test("canonical resolver remains synchronized for wrappers, options, paths, and sudo", () => {
  const commands = [
    "env -i /bin/sh run.sh",
    "env -C /tmp sh /tmp/run.sh",
    "sudo -u root /bin/sh run.sh",
    "sudo --user=root sh run.sh",
    "command env -- sh run.sh",
  ];
  for (const command of commands) {
    const words = shellCommandWords(command);
    assert.ok(words, command);
    const resolution = resolveShellExecutableWords(words);
    assert.equal(resolution.effectiveExecutable, "sh", command);
    assert.equal(
      words[resolution.effectiveIndex]?.endsWith("sh"),
      true,
      command,
    );
  }
});

test("reconstructed physical lines become logical commands with continuations", () => {
  const shellText = [
    "#!/bin/sh",
    "",
    "echo ready",
    "rm -rf \\",
    "  /tmp/example",
    "# trailing comment",
    'printf "%s\\n" "sudo some-command"',
  ].join("\n");

  assert.deepEqual(generatedLogicalShellCommands(shellText), [
    "echo ready",
    "rm -rf   /tmp/example",
    'printf "%s\\n" "sudo some-command"',
  ]);
});

test("printf reconstruction preserves multi-line comments, shebangs, and script bytes", () => {
  const [execution] = boundedGeneratedScriptExecutions(
    `printf '%s\\n' '#!/bin/sh' 'echo ready' 'rm -rf /tmp/example' > run.sh; sh run.sh`,
  );
  assert.equal(
    execution?.shellText,
    "#!/bin/sh\necho ready\nrm -rf /tmp/example\n",
  );
  assert.deepEqual(generatedLogicalShellCommands(execution?.shellText ?? ""), [
    "echo ready",
    "rm -rf /tmp/example",
  ]);
});

test("generated-script reconstruction has deterministic resource bounds", () => {
  const oversized = "x".repeat(MAX_GENERATED_SCRIPT_BYTES + 1);
  assert.deepEqual(
    boundedGeneratedScriptExecutions(
      `printf '%s' '${oversized}' > run.sh; sh run.sh`,
    ),
    [],
  );
  const oversizedProjection = analyzeGeneratedLogicalShellCommands(oversized);
  assert.equal(oversizedProjection.complete, false);
  assert.deepEqual(oversizedProjection.limitations, ["bytes"]);
  const ordinaryLiteral = analyzeBoundedGeneratedScriptExecutions(
    `printf '%s' '${oversized}'`,
  );
  assert.equal(ordinaryLiteral.complete, true);
  assert.deepEqual(ordinaryLiteral.values, []);
  const boundedCommands = generatedLogicalShellCommands(
    [
      "rm -rf /tmp/early-evidence",
      ...Array.from({ length: MAX_GENERATED_SCRIPT_COMMANDS }, () => "echo ok"),
    ].join("\n"),
  );
  assert.equal(boundedCommands.length, MAX_GENERATED_SCRIPT_COMMANDS);
  assert.equal(boundedCommands[0], "rm -rf /tmp/early-evidence");
  const commandLimitAnalysis = analyzeGeneratedLogicalShellCommands(
    [
      ...Array.from({ length: MAX_GENERATED_SCRIPT_COMMANDS }, () => "echo ok"),
      "rm -rf /tmp/after-limit",
    ].join("\n"),
  );
  assert.equal(commandLimitAnalysis.complete, false);
  assert.deepEqual(commandLimitAnalysis.limitations, ["commands"]);
  assert.equal(
    commandLimitAnalysis.values.includes("rm -rf /tmp/after-limit"),
    false,
  );
  const files = Array.from(
    { length: MAX_TRACKED_GENERATED_FILES + 1 },
    (_, index) =>
      `echo '${index === 0 ? "rm -rf /tmp/early-evidence" : "ok"}' > f${index}.sh`,
  );
  const retainedFileExecution = boundedGeneratedScriptExecutions(
    `${files.join(";")}; sh f0.sh`,
  );
  assert.equal(retainedFileExecution.length, 1);
  assert.equal(
    retainedFileExecution[0]?.shellText,
    "rm -rf /tmp/early-evidence\n",
  );
  const trackedFileAnalysis = analyzeBoundedGeneratedScriptExecutions(
    `${files.join(";")}; sh f0.sh`,
  );
  assert.equal(trackedFileAnalysis.complete, false);
  assert.ok(trackedFileAnalysis.limitations.includes("tracked-files"));
  const executionPairs = Array.from(
    { length: MAX_GENERATED_SCRIPT_EXECUTIONS + 1 },
    (_, index) => `echo unsafe > e${index}.sh; sh e${index}.sh`,
  );
  const boundedExecutions = boundedGeneratedScriptExecutions(
    executionPairs.join(";"),
  );
  assert.equal(boundedExecutions.length, MAX_GENERATED_SCRIPT_EXECUTIONS);
  assert.equal(boundedExecutions[0]?.shellText, "unsafe\n");
  const executionLimitAnalysis = analyzeBoundedGeneratedScriptExecutions(
    executionPairs.join(";"),
  );
  assert.equal(executionLimitAnalysis.complete, false);
  assert.ok(executionLimitAnalysis.limitations.includes("executions"));
});

test("ambiguous multiline quotes and heredocs are not projected as generated commands", () => {
  assert.deepEqual(
    generatedLogicalShellCommands("echo 'safe\nrm -rf /tmp/x'"),
    [],
  );
  assert.deepEqual(
    generatedLogicalShellCommands("cat <<EOF\nrm -rf /tmp/x\nEOF\n"),
    [],
  );
  const unsupportedPrefix = analyzeGeneratedLogicalShellCommands(
    "echo safe\ncat <<EOF\nsafe\nEOF\nrm -rf /tmp/x\n",
  );
  assert.equal(unsupportedPrefix.complete, false);
  assert.deepEqual(unsupportedPrefix.values, ["echo safe"]);
  assert.deepEqual(unsupportedPrefix.limitations, ["unsupported-shell-syntax"]);
});

test("a successful left side remains a possible state after || completes", () => {
  assert.equal(
    boundedGeneratedScriptExecutions(
      `echo 'rm -rf /tmp/x' > run.sh || true; sh run.sh`,
    ).length,
    1,
  );
  assert.deepEqual(
    boundedGeneratedScriptExecutions(
      `echo 'rm -rf /tmp/x' > run.sh || sh run.sh`,
    ),
    [],
  );
});

test("non-executing resolver modes and unsupported tee options do not correlate", () => {
  for (const producer of [
    `command -v echo 'rm -rf /tmp/x' > run.sh; sh run.sh`,
    `command --help printf '%s' 'rm -rf /tmp/x' > run.sh; sh run.sh`,
    `echo 'rm -rf /tmp/x' | env --help tee run.sh; sh run.sh`,
  ]) {
    assert.deepEqual(boundedGeneratedScriptExecutions(producer), [], producer);
  }
  for (const consumer of [
    "command -v sh run.sh",
    "command -V sh run.sh",
    "command -pv sh run.sh",
    "command --help sh run.sh",
    "env --help sh run.sh",
    "env --version sh run.sh",
    "env --unknown sh run.sh",
    "sudo -V sh run.sh",
    "sudo -l sh run.sh",
    "sudo -h sh run.sh",
    "sudo -nv sh run.sh",
    "sudo -Vh sh run.sh",
    "sudo --list=user sh run.sh",
    "sudo --validate=true sh run.sh",
    "sudo --login=bogus sh run.sh",
    "sudo --set-home=x sh run.sh",
    "sudo --non-interactive=x sh run.sh",
    "sudo --stdin=x sh run.sh",
    "sudo --shell=x sh run.sh",
    "sudo --user= sh run.sh",
    "sudo --chdir= sh run.sh",
  ]) {
    assert.deepEqual(
      boundedGeneratedScriptExecutions(`echo unsafe > run.sh; ${consumer}`),
      [],
      consumer,
    );
  }
  assert.deepEqual(
    boundedGeneratedScriptExecutions(
      `echo unsafe | tee --not-a-real-option run.sh; sh run.sh`,
    ),
    [],
  );
  for (const consumer of [
    `sudo --user '' sh /run.sh`,
    `sudo -u '' sh /run.sh`,
    `sudo --group '' sh /run.sh`,
    `sudo --chroot '' sh /run.sh`,
    `env --chdir= sh /run.sh`,
    `env -C '' sh /run.sh`,
    `env --unset '' sh /run.sh`,
    `env --split-string '' sh /run.sh`,
  ]) {
    assert.deepEqual(
      boundedGeneratedScriptExecutions(`echo unsafe > /run.sh; ${consumer}`),
      [],
      consumer,
    );
  }
});

test("execution disposition separates executing, non-executing, and unknown wrapper modes", () => {
  const cases = [
    ["env -v rm -rf /tmp/x", "proven"],
    ["env --debug rm -rf /tmp/x", "proven"],
    ["sudo -A rm -rf /tmp/x", "proven"],
    ["sudo -b rm -rf /tmp/x", "proven"],
    ["command -v rm -rf /tmp/x", "not-executed"],
    ["env --help rm -rf /tmp/x", "not-executed"],
    ["sudo -V rm -rf /tmp/x", "not-executed"],
    ["env --future-option rm -rf /tmp/x", "unknown"],
    ["sudo --future-option rm -rf /tmp/x", "unknown"],
  ] as const;

  for (const [command, expected] of cases) {
    const words = shellCommandWords(command);
    assert.ok(words, command);
    assert.equal(
      resolveShellExecutableWords(words).executionDisposition,
      expected,
      command,
    );
  }
});

test("env value-taking execution options resolve the actual command", () => {
  for (const command of ["env -a sh true", "env -S 'sh run.sh'"]) {
    const words = shellCommandWords(command);
    assert.ok(words, command);
    const resolution = resolveShellExecutableWords(words);
    assert.notEqual(resolution.effectiveExecutable, "sh", command);
  }
});

test("inert comment and quoted heredoc text do not hide later commands", () => {
  assert.deepEqual(
    generatedLogicalShellCommands("# reviewer's note\nrm -rf /tmp/example\n"),
    ["rm -rf /tmp/example"],
  );
  assert.deepEqual(
    generatedLogicalShellCommands("echo 'cat <<EOF'\nrm -rf /tmp/example\n"),
    ["echo 'cat <<EOF'", "rm -rf /tmp/example"],
  );
});

test("branch merges retain bounded alternative generated contents", () => {
  const executions = boundedGeneratedScriptExecutions(
    `echo 'rm -rf /tmp/example' > run.sh || echo 'echo safe' > run.sh; sh run.sh`,
  );
  assert.deepEqual(
    executions.map(({ shellText }) => shellText).sort(),
    ["echo safe\n", "rm -rf /tmp/example\n"].sort(),
  );
  assert.ok(MAX_GENERATED_SCRIPT_ALTERNATIVES > 1);
});

test("branch alternative truncation is explicit", () => {
  const producers = Array.from(
    { length: MAX_GENERATED_SCRIPT_ALTERNATIVES + 1 },
    (_, index) => `echo 'echo ${index}' > run.sh`,
  );
  const analysis = analyzeBoundedGeneratedScriptExecutions(
    `${producers.join(" || ")}; sh run.sh`,
  );
  assert.equal(analysis.complete, false);
  assert.ok(analysis.limitations.includes("alternatives"));
  assert.equal(analysis.values.length, MAX_GENERATED_SCRIPT_ALTERNATIVES);
});

test("tee operands honor wrapper cwd and root path identity", () => {
  for (const command of [
    `echo unsafe | env -C /tmp tee run.sh; sh run.sh`,
    `echo unsafe | sudo -R /sandbox tee /tmp/run.sh; sh /tmp/run.sh`,
  ]) {
    assert.deepEqual(boundedGeneratedScriptExecutions(command), [], command);
  }

  assert.equal(
    boundedGeneratedScriptExecutions(
      `echo unsafe | env -C /tmp tee /tmp/run.sh; sh /tmp/run.sh`,
    ).length,
    1,
  );
});

test("path correlation rejects search, root, cwd, and directory ambiguities", () => {
  for (const command of [
    `echo unsafe > run.sh; source run.sh`,
    `echo unsafe > /run.sh; sudo -R /tmp sh /run.sh`,
    `echo unsafe > run.sh; sudo --login sh run.sh`,
    `echo unsafe > run.sh; sudo -i sh run.sh`,
    `echo unsafe > run.sh; env -C/tmp cp safe run.sh; sh run.sh`,
    `echo unsafe > run.sh; sudo -D/tmp mv safe run.sh; sh run.sh`,
    `echo unsafe > dir/run.sh; cp safe dir; sh dir/run.sh`,
  ]) {
    assert.deepEqual(boundedGeneratedScriptExecutions(command), [], command);
  }
});
