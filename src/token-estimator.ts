/** A deterministic, model-neutral token estimate unit. */
export interface EstimatedTokenUnit {
  value: string;
  offset: number;
}

const CJK_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_RUN = /[\p{L}\p{N}_]/u;
const WORD_CONTINUATION = /[\p{L}\p{N}_./:+\-=]/u;

/**
 * Estimate tokens without claiming compatibility with a model tokenizer.
 *
 * Latin-like words, code identifiers, URLs, and repository paths are lexical
 * units. Consecutive Han, Hiragana, Katakana, and Hangul text is divided into
 * two-code-point units so unspaced Japanese is neither one token nor one token
 * per character. Other punctuation is grouped in runs of up to three code
 * points. The algorithm is Unicode-aware, dependency-free, and deterministic,
 * but is only suitable for stable repository thresholds and comparisons.
 */
export function estimateTokens(value: string): number {
  return estimatedTokenUnits(value).length;
}

/** Return the deterministic units used by estimateTokens. */
export function estimatedTokenUnits(value: string): EstimatedTokenUnit[] {
  const codePoints = [...value];
  const offsets: number[] = [];
  let utf16Offset = 0;
  for (const codePoint of codePoints) {
    offsets.push(utf16Offset);
    utf16Offset += codePoint.length;
  }

  const units: EstimatedTokenUnit[] = [];
  let index = 0;
  while (index < codePoints.length) {
    const current = codePoints[index] ?? "";
    if (/\s/u.test(current)) {
      index += 1;
      continue;
    }

    if (CJK_RUN.test(current)) {
      const start = index;
      index += 1;
      if (index < codePoints.length && CJK_RUN.test(codePoints[index] ?? "")) {
        index += 1;
      }
      units.push({
        value: codePoints.slice(start, index).join("").toLowerCase(),
        offset: offsets[start] ?? 0,
      });
      continue;
    }

    if (WORD_RUN.test(current)) {
      const start = index;
      index += 1;
      while (
        index < codePoints.length &&
        WORD_CONTINUATION.test(codePoints[index] ?? "") &&
        !CJK_RUN.test(codePoints[index] ?? "")
      ) {
        index += 1;
      }
      units.push({
        value: codePoints.slice(start, index).join("").toLowerCase(),
        offset: offsets[start] ?? 0,
      });
      continue;
    }

    const start = index;
    index += 1;
    while (
      index < codePoints.length &&
      index - start < 3 &&
      !/\s/u.test(codePoints[index] ?? "") &&
      !WORD_RUN.test(codePoints[index] ?? "") &&
      !CJK_RUN.test(codePoints[index] ?? "")
    ) {
      index += 1;
    }
    units.push({
      value: codePoints.slice(start, index).join(""),
      offset: offsets[start] ?? 0,
    });
  }
  return units;
}

/** Return Markdown after a complete leading YAML frontmatter block. */
export function markdownBody(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return value;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return end < 0 ? value : lines.slice(end + 1).join("\n");
}
