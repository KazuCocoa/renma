export type ShellToken = {
  kind: "word" | "operator";
  value: string;
  raw: string;
  start: number;
  end: number;
  quoted: boolean;
  commandSubstitution: boolean;
  processSubstitution: boolean;
};

export type ShellTokenization = {
  tokens: readonly ShellToken[];
  supported: boolean;
};

const OPERATOR_CHARACTERS = new Set(["|", "&", ";", ">", "<"]);

export function tokenizeBoundedShell(input: string): ShellTokenization {
  const tokens: ShellToken[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    while (/\s/u.test(input[cursor] ?? "")) cursor += 1;
    if (cursor >= input.length) break;
    if (
      input[cursor] === "#" &&
      (cursor === 0 || /\s/u.test(input[cursor - 1] ?? ""))
    ) {
      break;
    }

    const operator = shellOperatorAt(input, cursor);
    if (operator !== undefined) {
      const processSubstitution =
        (operator === "<" || operator === ">") &&
        input[cursor + operator.length] === "(";
      tokens.push({
        kind: "operator",
        value: operator,
        raw: operator,
        start: cursor,
        end: cursor + operator.length,
        quoted: false,
        commandSubstitution: false,
        processSubstitution,
      });
      cursor += operator.length;
      continue;
    }

    const start = cursor;
    let value = "";
    let quote: "'" | '"' | undefined;
    let quoted = false;
    let commandSubstitution = false;
    while (cursor < input.length) {
      const character = input[cursor] ?? "";
      if (quote !== undefined) {
        if (character === quote) {
          quote = undefined;
          cursor += 1;
          continue;
        }
        if (quote === '"' && character === "\\") {
          const next = input[cursor + 1];
          if (next === undefined) {
            return { tokens, supported: false };
          }
          value += next;
          cursor += 2;
          continue;
        }
        if (
          quote === '"' &&
          (character === "`" ||
            (character === "$" && input[cursor + 1] === "("))
        ) {
          commandSubstitution = true;
        }
        value += character;
        cursor += 1;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        quoted = true;
        cursor += 1;
        continue;
      }
      if (character === "\\") {
        const next = input[cursor + 1];
        if (next === undefined) {
          return { tokens, supported: false };
        }
        value += next;
        cursor += 2;
        continue;
      }
      if (
        character === "`" ||
        (character === "$" && input[cursor + 1] === "(")
      ) {
        commandSubstitution = true;
      }
      if (/\s/u.test(character) || OPERATOR_CHARACTERS.has(character)) {
        break;
      }
      value += character;
      cursor += 1;
    }
    if (quote !== undefined) return { tokens, supported: false };
    if (cursor === start) return { tokens, supported: false };
    tokens.push({
      kind: "word",
      value,
      raw: input.slice(start, cursor),
      start,
      end: cursor,
      quoted,
      commandSubstitution,
      processSubstitution: false,
    });
  }

  return { tokens, supported: true };
}

export function hasBoundedShellOperationalSubstitution(input: string): boolean {
  const tokenization = tokenizeBoundedShell(input);
  return (
    !tokenization.supported ||
    tokenization.tokens.some(
      ({ commandSubstitution, processSubstitution }) =>
        commandSubstitution || processSubstitution,
    )
  );
}

function shellOperatorAt(input: string, offset: number): string | undefined {
  const character = input[offset];
  if (character === undefined || !OPERATOR_CHARACTERS.has(character)) {
    return undefined;
  }
  const pair = input.slice(offset, offset + 2);
  if (
    pair === "&&" ||
    pair === "||" ||
    pair === ">>" ||
    pair === "<<" ||
    pair === "&>"
  ) {
    return pair;
  }
  return character;
}
