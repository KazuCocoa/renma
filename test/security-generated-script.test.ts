import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedGeneratedScriptExecutions,
  generatedLogicalShellCommands,
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
