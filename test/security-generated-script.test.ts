import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedGeneratedScriptExecutions,
  generatedLogicalShellCommands,
  MAX_GENERATED_SCRIPT_BYTES,
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
  const boundedCommands = generatedLogicalShellCommands(
    [
      "rm -rf /tmp/early-evidence",
      ...Array.from({ length: MAX_GENERATED_SCRIPT_COMMANDS }, () => "echo ok"),
    ].join("\n"),
  );
  assert.equal(boundedCommands.length, MAX_GENERATED_SCRIPT_COMMANDS);
  assert.equal(boundedCommands[0], "rm -rf /tmp/early-evidence");
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
  const executionPairs = Array.from(
    { length: MAX_GENERATED_SCRIPT_EXECUTIONS + 1 },
    (_, index) => `echo unsafe > e${index}.sh; sh e${index}.sh`,
  );
  const boundedExecutions = boundedGeneratedScriptExecutions(
    executionPairs.join(";"),
  );
  assert.equal(boundedExecutions.length, MAX_GENERATED_SCRIPT_EXECUTIONS);
  assert.equal(boundedExecutions[0]?.shellText, "unsafe\n");
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
