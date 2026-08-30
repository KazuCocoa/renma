import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect, stripVTControlCharacters } from "node:util";

const DEFAULT_MAX_FAILURES = 20;
const DEFAULT_MAX_FAILURE_CHARS = 12_000;

function positiveInteger(value, fallback) {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function compactWorkspacePaths(value) {
  const workspace = `${process.cwd()}${path.sep}`;
  const workspaceUrl = pathToFileURL(workspace).href;
  return stripVTControlCharacters(value)
    .replaceAll(workspaceUrl, "")
    .replaceAll(workspace, "");
}

function failureText(error, maxChars) {
  let current = error;
  const seen = new Set();
  const errorChain = [];

  while (
    current !== null &&
    typeof current === "object" &&
    "cause" in current &&
    current.cause !== undefined &&
    !seen.has(current)
  ) {
    errorChain.push(current);
    seen.add(current);
    current = current.cause;
  }
  if (current !== null && typeof current === "object") {
    errorChain.push(current);
  }

  const metadata = [];
  const metadataKeys = current === error ? ["failureType", "code"] : [];
  metadataKeys.push("exitCode", "signal");
  for (const key of metadataKeys) {
    for (const candidate of errorChain) {
      if (
        key in candidate &&
        candidate[key] !== undefined &&
        candidate[key] !== null
      ) {
        metadata.push(`${key}: ${inspect(candidate[key], { colors: false })}`);
        break;
      }
    }
  }

  if (
    current !== null &&
    typeof current === "object" &&
    "stack" in current &&
    typeof current.stack === "string"
  ) {
    return compactWorkspacePaths([current.stack, ...metadata].join("\n"));
  }

  if (typeof current === "string") {
    return compactWorkspacePaths([current, ...metadata].join("\n"));
  }

  const inspected = inspect(current, {
    breakLength: 100,
    colors: false,
    depth: 8,
    maxArrayLength: 100,
    maxStringLength: maxChars,
  });
  return compactWorkspacePaths([inspected, ...metadata].join("\n"));
}

function locationText(data) {
  if (typeof data.file !== "string") {
    return undefined;
  }

  const relative = path.relative(process.cwd(), data.file);
  const file =
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
      ? relative
      : data.file;
  const line = Number.isInteger(data.line) ? `:${data.line}` : "";
  const column = Number.isInteger(data.column) ? `:${data.column}` : "";
  return `${file}${line}${column}`;
}

function truncate(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }

  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n... [${omitted} failure characters omitted]`;
}

function formatFailure(event, index, maxChars) {
  const { data } = event;
  const location = locationText(data);
  const detail = truncate(failureText(data.details?.error, maxChars), maxChars);
  return [
    `FAIL ${index}: ${data.name}`,
    ...(location === undefined ? [] : [`  at ${location}`]),
    ...detail.split("\n").map((line) => `  ${line}`),
  ].join("\n");
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

export default async function* llmTestReporter(source) {
  const maxFailures = positiveInteger(
    process.env.RENMA_TEST_MAX_FAILURES,
    DEFAULT_MAX_FAILURES,
  );
  const maxFailureChars = positiveInteger(
    process.env.RENMA_TEST_MAX_FAILURE_CHARS,
    DEFAULT_MAX_FAILURE_CHARS,
  );
  const failures = [];
  let observedFailures = 0;
  let summary;
  let passed = 0;
  let skipped = 0;
  let todo = 0;

  for await (const event of source) {
    if (event.type === "test:summary") {
      summary = event.data;
      continue;
    }

    if (event.type === "test:fail") {
      if (event.data.details?.type !== "suite") {
        observedFailures += 1;
        if (failures.length < maxFailures) {
          failures.push(event);
        }
      }
      continue;
    }

    if (event.type !== "test:pass") {
      continue;
    }

    if (event.data.skip !== undefined) {
      skipped += 1;
    } else if (event.data.todo !== undefined) {
      todo += 1;
    } else {
      passed += 1;
    }
  }

  const failed = summary?.counts.failed ?? observedFailures;
  const total = summary?.counts.tests ?? passed + failed + skipped + todo;
  passed = summary?.counts.passed ?? passed;
  skipped = summary?.counts.skipped ?? skipped;
  todo = summary?.counts.todo ?? todo;
  const cancelled = summary?.counts.cancelled ?? 0;
  const successful = summary?.success ?? (failed === 0 && cancelled === 0);
  const qualifiers = [
    skipped > 0 ? plural(skipped, "skipped") : undefined,
    todo > 0 ? plural(todo, "todo") : undefined,
    cancelled > 0 ? plural(cancelled, "cancelled") : undefined,
  ].filter(Boolean);
  const suffix = qualifiers.length > 0 ? `; ${qualifiers.join(", ")}` : "";

  if (successful) {
    yield `PASS: ${plural(total, "test")} (${plural(passed, "passed", "passed")}${suffix})\n`;
    return;
  }

  const visibleFailures = failures;
  for (let index = 0; index < visibleFailures.length; index += 1) {
    if (index > 0) {
      yield "\n";
    }
    yield `${formatFailure(visibleFailures[index], index + 1, maxFailureChars)}\n`;
  }

  const hiddenFailures = Math.max(0, failed - visibleFailures.length);
  if (hiddenFailures > 0) {
    yield `\n... [${plural(hiddenFailures, "additional failure")} omitted]\n`;
  }

  const outcome =
    failed > 0
      ? `${failed}/${total} ${total === 1 ? "test" : "tests"} failed`
      : "test run unsuccessful";
  yield `\nFAIL: ${outcome} (${plural(passed, "passed", "passed")}${suffix}).\n`;
  yield "Run `npm run test:verbose` for complete test output.\n";
}
