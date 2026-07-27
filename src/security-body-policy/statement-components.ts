import { BODY_POLICY_DOMAIN_ORDER } from "./fact-projection.js";
import {
  CONDITIONAL_OR_SUBORDINATE_PREDICATE_START_RE,
  DOMAIN_EVIDENCE_PATTERNS,
  DOMAIN_PREDICATE_START_RE,
  EXPLICIT_CHANGED_SUBJECT_START_RE,
  EXPLICIT_SUPPORTED_PREDICATE_PREFIX_START_RE,
  INHERITED_STATEMENT_SEPARATOR_RE,
  LEADING_WORKFLOW_SUBJECT_RE,
  ORDINARY_STATEMENT_SEPARATOR_RE,
  PAIRED_OBJECT_RELATIVE_MODIFIER_RE,
  PROHIBITED_PATTERNS,
  SECURITY_ACTION_CHANGED_SUBJECT_START_RE,
  STRONG_CHANGED_SUBJECT_START_RE,
  SUBJECTLESS_PREDICATE_START_RE,
  WORKFLOW_SCOPE_RE,
  recognizeCandidateRanges,
  recognizeEvidenceRange,
} from "./lexical-recognition.js";
import type {
  EnclosureProvenance,
  EnclosureRange,
  EvidenceRange,
  PolicyContextMatch,
  PredicateSegment,
  PredicateStartClassification,
  RelativePredicateComponent,
  StatementAnalysisState,
  StatementGroup,
  SubjectRelationship,
  WorkflowSubjectMatch,
} from "./model.js";
import {
  outerPrefixSupportsEmbeddedWorkflowSubject,
  prefixClassificationProvidesPolicyContext,
  standalonePolicyPrefixClassification,
} from "./policy-context.js";
import { transitionStatementState } from "./statement-state.js";

/** Build bounded predicate segments before any domain semantic decision. */
export function bodyPolicyStatementGroups(
  text: string,
  clauseRanges: readonly EvidenceRange[],
  initialState: StatementAnalysisState,
): readonly StatementGroup[] {
  const enclosures = quoteEnclosureRanges(text);
  const relativeEnclosures = pairedRelativeEnclosureRanges(text, clauseRanges);
  const predicateRanges = mergeOpaqueClauseRanges(
    text,
    clauseRanges,
    enclosures,
    relativeEnclosures,
  )
    .filter(
      ({ start, end }) =>
        !/^[ \t]*[;:,.!?–—-]+[ \t]*$/u.test(text.slice(start, end)),
    )
    .flatMap((range) => splitOrdinaryPredicateRanges(text, range, enclosures))
    .map((range) => trimPredicateRange(text, range))
    .filter(({ start, end }) => start < end)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const groups: StatementGroup[] = [];
  let state = initialState;
  let predicates: PredicateSegment[] = [];
  let groupStart = 0;
  for (const [index, range] of predicateRanges.entries()) {
    const previous = predicateRanges[index - 1];
    const separator = {
      start: previous?.end ?? range.start,
      end: range.start,
    };
    const separatorText = text.slice(separator.start, separator.end);
    const enclosure = rangeStartEnclosureProvenance(text, range, enclosures);
    const separatorEnclosure = rangeStartEnclosureProvenance(
      text,
      separator,
      enclosures,
    );
    const boundary =
      previous === undefined
        ? "start"
        : separatorEnclosure !== "unenclosed" && enclosure !== "unenclosed"
          ? "opaque"
          : separatorEnclosure === "unenclosed" &&
              statementSeparatorSupportsInheritance(separatorText)
            ? "inherited"
            : "hard";
    const explicitPolicyContext =
      enclosure === "unenclosed"
        ? supportedPolicyContextInRange(text, range)
        : undefined;
    const explicitSubject =
      enclosure === "unenclosed"
        ? supportedWorkflowSubjectInRange(text, range)
        : undefined;
    const startClassification = classifyPredicateStart(
      text.slice(explicitPolicyContext?.range.end ?? range.start, range.end),
      explicitSubject !== undefined,
    );
    const transition = transitionStatementState(state, {
      boundary,
      enclosure,
      startClassification,
      explicitSubject,
      explicitPolicyContext,
      initialComponent: previous === undefined,
    });
    const { inheritedSubject, policyContext } = transition;
    const previousPredicate = predicates[predicates.length - 1];
    const independentBareSemicolon =
      boundary === "inherited" &&
      bareSemicolonSeparatesIndependentPolicies(text, separator);
    const independentPrefixedPolicy =
      independentBareSemicolon &&
      directlySupportedPrefixedProhibitionStartsText(
        text.slice(range.start, range.end),
      );
    const independentStandaloneBoundary =
      explicitSubject === undefined &&
      enclosure === "unenclosed" &&
      boundary === "inherited" &&
      previousPredicate !== undefined &&
      (independentPrefixedPolicy ||
        (state.subject === undefined &&
          (independentBareSemicolon ||
            predicateAllowsIndependentPolicyContinuation(
              text,
              previousPredicate,
            ))));
    if (boundary === "hard") {
      if (predicates.length > 0) {
        groups.push(
          statementGroup(text, predicates, groupStart, previous?.end),
        );
      }
      predicates = [];
      groupStart = range.start;
    } else if (predicates.length === 0) {
      groupStart = range.start;
    }
    predicates.push({
      range,
      separator,
      enclosure,
      boundary,
      startClassification,
      explicitSubject,
      inheritedSubject,
      policyContext,
      independentStandaloneBoundary,
    });
    state = transition.state;
  }
  if (predicates.length > 0) {
    groups.push(
      statementGroup(
        text,
        predicates,
        groupStart,
        predicateRanges[predicateRanges.length - 1]?.end,
      ),
    );
  }
  return groups;
}

function statementGroup(
  text: string,
  predicates: readonly PredicateSegment[],
  start: number,
  end: number | undefined,
): StatementGroup {
  const range = { start, end: end ?? start };
  return {
    sourceText: text.slice(range.start, range.end),
    range,
    explicitSubject: [...predicates]
      .reverse()
      .find(({ explicitSubject }) => explicitSubject !== undefined)
      ?.explicitSubject,
    predicates,
  };
}

function supportedPolicyContextInRange(
  text: string,
  range: EvidenceRange,
): PolicyContextMatch | undefined {
  const source = text.slice(range.start, range.end);
  let supportedEnd: number | undefined;
  for (let end = 1; end <= Math.min(source.length, 160); end += 1) {
    if (
      prefixClassificationProvidesPolicyContext(
        standalonePolicyPrefixClassification(source.slice(0, end)),
      )
    ) {
      supportedEnd = end;
    }
  }
  if (supportedEnd === undefined) return undefined;
  return {
    range: { start: range.start, end: range.start + supportedEnd },
    evidenceStart: range.start,
  };
}

function mergeOpaqueClauseRanges(
  text: string,
  clauseRanges: readonly EvidenceRange[],
  quoteEnclosures: readonly EnclosureRange[],
  relativeEnclosures: readonly EvidenceRange[],
): readonly EvidenceRange[] {
  const ordered = [...clauseRanges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: EvidenceRange[] = [];
  for (const range of ordered) {
    const current = merged[merged.length - 1];
    if (current === undefined) {
      merged.push({ ...range });
      continue;
    }
    const separator = { start: current.end, end: range.start };
    const opaque = [...quoteEnclosures, ...relativeEnclosures].some(
      (enclosure) => separatorIsWithinRange(text, separator, enclosure),
    );
    if (opaque) {
      merged[merged.length - 1] = {
        start: current.start,
        end: Math.max(current.end, range.end),
      };
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function separatorIsWithinRange(
  text: string,
  separator: EvidenceRange,
  enclosure: EvidenceRange,
): boolean {
  const source = text.slice(separator.start, separator.end);
  const leading = /^[ \t]*/u.exec(source)?.[0].length ?? 0;
  const trailing = /[ \t]*$/u.exec(source)?.[0].length ?? 0;
  const meaningfulStart = separator.start + leading;
  const meaningfulEnd = Math.max(meaningfulStart, separator.end - trailing);
  return (
    meaningfulStart >= enclosure.start &&
    meaningfulEnd <= enclosure.end &&
    meaningfulStart < meaningfulEnd
  );
}

interface PairedCommaModifier {
  readonly range: EvidenceRange;
  readonly contentRange: EvidenceRange;
}

function pairedCommaModifierAfterSubject(
  text: string,
  subjectEnd: number,
  sourceEnd: number,
): PairedCommaModifier | undefined {
  let cursor = subjectEnd;
  while (cursor < sourceEnd && /[ \t\n]/u.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  if (text[cursor] !== ",") return undefined;
  const start = cursor;
  const enclosures = quoteEnclosureRanges(text);
  let parenthesisDepth = 0;
  for (cursor += 1; cursor < sourceEnd && cursor - start <= 400; cursor += 1) {
    if (quoteEnclosureProvenanceAtOffset(enclosures, cursor) !== "unenclosed") {
      continue;
    }
    const character = text[cursor];
    if (character === "(") {
      parenthesisDepth += 1;
      continue;
    }
    if (character === ")" && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
      continue;
    }
    if (parenthesisDepth === 0 && /[.!?]/u.test(character ?? "")) {
      return undefined;
    }
    if (parenthesisDepth === 0 && character === ",") {
      if (
        commaContinuesRelativePredicate(text, cursor, sourceEnd, enclosures)
      ) {
        continue;
      }
      return {
        range: { start, end: cursor + 1 },
        contentRange: { start: start + 1, end: cursor },
      };
    }
  }
  return undefined;
}

function commaContinuesRelativePredicate(
  text: string,
  comma: number,
  sourceEnd: number,
  enclosures: readonly EnclosureRange[],
): boolean {
  const suffix = text.slice(comma + 1, sourceEnd);
  const connector =
    /^[ \t\n]*(?:(?:and|but|yet|then)\b[ \t\n]*|however[ \t\n]*,[ \t\n]*)?/iu.exec(
      suffix,
    );
  if (connector === null) return false;
  const predicate = suffix.slice(connector[0].length);
  if (!startsStatementPredicate(predicate)) return false;
  for (
    let cursor = comma + 1 + connector[0].length;
    cursor < sourceEnd;
    cursor += 1
  ) {
    if (quoteEnclosureProvenanceAtOffset(enclosures, cursor) !== "unenclosed") {
      continue;
    }
    const character = text[cursor];
    if (/[.!?]/u.test(character ?? "")) return false;
    if (character === ",") return true;
  }
  return false;
}

function pairedRelativeEnclosureRanges(
  text: string,
  clauseRanges: readonly EvidenceRange[],
): readonly EvidenceRange[] {
  const ranges: EvidenceRange[] = [];
  for (const clauseRange of clauseRanges) {
    const subject = supportedWorkflowSubjectInRange(text, {
      start: clauseRange.start,
      end: text.length,
    });
    if (subject === undefined || subject.range.start >= clauseRange.end) {
      continue;
    }
    const paired = pairedCommaModifierAfterSubject(
      text,
      subject.range.end,
      text.length,
    );
    if (paired === undefined) continue;
    const content = text.slice(
      paired.contentRange.start,
      paired.contentRange.end,
    );
    if (!/^[ \t\n]*(?:that|which)\b/iu.test(content)) continue;
    ranges.push(paired.range);
  }
  return ranges.filter(
    (range, index) =>
      ranges.findIndex(
        (candidate) =>
          candidate.start === range.start && candidate.end === range.end,
      ) === index,
  );
}

function predicateAllowsIndependentPolicyContinuation(
  text: string,
  predicate: PredicateSegment,
): boolean {
  if (
    predicate.explicitSubject !== undefined ||
    predicate.inheritedSubject !== undefined
  ) {
    return false;
  }
  if (predicate.startClassification === "supported-subjectless") return true;
  return directlySupportedProhibitionStartsText(
    text.slice(predicate.range.start, predicate.range.end),
  );
}

function bareSemicolonSeparatesIndependentPolicies(
  text: string,
  separator: EvidenceRange,
): boolean {
  const separatorText = text.slice(separator.start, separator.end);
  const semicolonOffset = separatorText.indexOf(";");
  return (
    !separatorText.includes("\n") &&
    /^[ \t]*;[ \t]*$/u.test(separatorText) &&
    semicolonOffset >= 0 &&
    !quotePairEnclosesOffset(text, separator.start + semicolonOffset)
  );
}

function splitOrdinaryPredicateRanges(
  text: string,
  sourceRange: EvidenceRange,
  enclosures: readonly EnclosureRange[],
): readonly EvidenceRange[] {
  const ranges: EvidenceRange[] = [];
  let start = sourceRange.start;
  const source = text.slice(sourceRange.start, sourceRange.end);
  const pairedCommaModifier = leadingPairedCommaModifierRange(
    text,
    sourceRange,
  );
  for (const match of source.matchAll(ORDINARY_STATEMENT_SEPARATOR_RE)) {
    if (match.index === undefined) continue;
    const separatorStart = sourceRange.start + match.index;
    const separatorEnd = separatorStart + match[0].length;
    if (
      rangeStartEnclosureProvenance(
        text,
        { start: separatorStart, end: separatorEnd },
        enclosures,
      ) !== "unenclosed"
    ) {
      continue;
    }
    if (
      pairedCommaModifier !== undefined &&
      separatorStart >= pairedCommaModifier.start &&
      separatorStart < pairedCommaModifier.end
    ) {
      continue;
    }
    const commaPrefixClassification = standalonePolicyPrefixClassification(
      source.slice(0, match.index),
    );
    if (
      /^,[ \t]*$/u.test(match[0]) &&
      prefixClassificationProvidesPolicyContext(commaPrefixClassification)
    ) {
      continue;
    }
    if (!startsStatementPredicate(text.slice(separatorEnd, sourceRange.end))) {
      continue;
    }
    if (separatorStart > start) ranges.push({ start, end: separatorStart });
    start = separatorEnd;
  }
  if (start < sourceRange.end) ranges.push({ start, end: sourceRange.end });
  return ranges;
}

function leadingPairedCommaModifierRange(
  text: string,
  sourceRange: EvidenceRange,
): EvidenceRange | undefined {
  const subject = supportedWorkflowSubjectInRange(text, sourceRange);
  if (subject === undefined) return undefined;
  return pairedCommaModifierAfterSubject(
    text,
    subject.range.end,
    sourceRange.end,
  )?.range;
}

export function pairedRelativeSubjectRelationship(
  content: string,
): SubjectRelationship {
  const normalized = content.trim();
  const relativePrefix = /^(?:that|which)[ \t\n]+/iu.exec(normalized);
  if (relativePrefix === null) return "unsupported";
  const predicateText = normalized.slice(relativePrefix[0].length);
  const firstConnector =
    /(?:,[ \t]*)?\b(?:and|but|yet|however|then)\b|;/iu.exec(predicateText);
  const firstPredicate =
    firstConnector === null
      ? predicateText
      : predicateText.slice(0, firstConnector.index);
  if (
    classifyPredicateStart(firstPredicate, false) === "supported-subjectless"
  ) {
    return "subject-relative";
  }
  return PAIRED_OBJECT_RELATIVE_MODIFIER_RE.test(normalized)
    ? "object-relative"
    : "unsupported";
}

function trimEvidenceRange(text: string, range: EvidenceRange): EvidenceRange {
  const source = text.slice(range.start, range.end);
  const leading = /^[ \t\n]*/u.exec(source)?.[0].length ?? 0;
  const trailing = /[ \t\n]*$/u.exec(source)?.[0].length ?? 0;
  return {
    start: range.start + leading,
    end: Math.max(range.start + leading, range.end - trailing),
  };
}

function pairedRelativeModifierAfterSubject(
  text: string,
  subjectEnd: number,
  sourceEnd: number,
):
  | {
      readonly paired: PairedCommaModifier;
      readonly relationship: SubjectRelationship;
      readonly predicateRange: EvidenceRange | undefined;
    }
  | undefined {
  const paired = pairedCommaModifierAfterSubject(text, subjectEnd, sourceEnd);
  if (paired === undefined) return undefined;
  const contentRange = trimEvidenceRange(text, paired.contentRange);
  const content = text.slice(contentRange.start, contentRange.end);
  const relativePrefix = /^(?:that|which)[ \t\n]+/iu.exec(content);
  const relationship = pairedRelativeSubjectRelationship(content);
  const predicateRange =
    relationship === "subject-relative" && relativePrefix !== null
      ? trimEvidenceRange(text, {
          start: contentRange.start + relativePrefix[0].length,
          end: contentRange.end,
        })
      : undefined;
  return { paired, relationship, predicateRange };
}

export function leadingBoundedPairedRelativeRange(
  text: string,
): EvidenceRange | undefined {
  const sourceRange = { start: 0, end: text.length };
  const subject = supportedWorkflowSubjectInRange(text, sourceRange);
  if (subject === undefined) return undefined;
  const relative = pairedRelativeModifierAfterSubject(
    text,
    subject.range.end,
    sourceRange.end,
  );
  if (relative === undefined || relative.relationship === "unsupported") {
    return undefined;
  }
  return relative.paired.range;
}

export function pairedRelativePredicateComponent(
  text: string,
  sourceRange: EvidenceRange,
): RelativePredicateComponent | undefined {
  const subject = supportedWorkflowSubjectInRange(text, sourceRange);
  if (subject === undefined) return undefined;
  const relative = pairedRelativeModifierAfterSubject(
    text,
    subject.range.end,
    sourceRange.end,
  );
  if (relative === undefined) return undefined;
  const mainRange = trimPredicateRange(text, {
    start: relative.paired.range.end,
    end: sourceRange.end,
  });
  return {
    relationship: relative.relationship,
    predicateRange: relative.predicateRange,
    mainPredicateRange: mainRange.start < mainRange.end ? mainRange : undefined,
  };
}

function startsStatementPredicate(text: string): boolean {
  const range = { start: 0, end: text.length };
  const startClassification = classifyPredicateStart(
    text,
    supportedWorkflowSubjectInRange(text, range) !== undefined,
  );
  return (
    startClassification === "explicit-workflow-subject" ||
    directlySupportedProhibitionStartsText(text) ||
    DOMAIN_PREDICATE_START_RE.test(text) ||
    ((startClassification === "supported-subjectless" ||
      startClassification === "explicit-changed-subject") &&
      BODY_POLICY_DOMAIN_ORDER.some((domain) =>
        DOMAIN_EVIDENCE_PATTERNS[domain].test(text),
      ))
  );
}

export function directlySupportedProhibitionStartsText(text: string): boolean {
  return BODY_POLICY_DOMAIN_ORDER.some((domain) =>
    recognizeCandidateRanges(
      text,
      PROHIBITED_PATTERNS[domain],
      "supported-prohibition",
    ).some((candidate) => text.slice(0, candidate.start).trim().length === 0),
  );
}

function directlySupportedPrefixedProhibitionStartsText(text: string): boolean {
  return BODY_POLICY_DOMAIN_ORDER.some((domain) =>
    recognizeCandidateRanges(
      text,
      PROHIBITED_PATTERNS[domain],
      "supported-prohibition",
    ).some((candidate) => {
      if (
        supportedWorkflowSubjectInRange(text, {
          start: candidate.start,
          end: candidate.end,
        }) !== undefined
      ) {
        return false;
      }
      return outerPrefixSupportsEmbeddedWorkflowSubject(
        standalonePolicyPrefixClassification(text.slice(0, candidate.start)),
      );
    }),
  );
}

function quoteEnclosureRanges(text: string): readonly EnclosureRange[] {
  const ranges: EnclosureRange[] = [];
  let straightDoubleStart:
    | { readonly index: number; readonly escaped: boolean }
    | undefined;
  let straightSingleStart:
    | { readonly index: number; readonly escaped: boolean }
    | undefined;
  let curlyDoubleStart: number | undefined;
  let curlySingleStart: number | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      const escaped = characterIsBackslashEscaped(text, index);
      if (straightDoubleStart === undefined) {
        straightDoubleStart = { index, escaped };
      } else if (escaped && !straightDoubleStart.escaped) {
        continue;
      } else {
        ranges.push({
          start: straightDoubleStart.index,
          end: index + 1,
          provenance:
            straightDoubleStart.escaped || escaped
              ? "escaped-visible-quoted"
              : "straight-double-quoted",
        });
        straightDoubleStart = undefined;
      }
      continue;
    }
    if (character === "'") {
      const escaped = characterIsBackslashEscaped(text, index);
      const previousIsWord = asciiWordCharacter(text[index - 1]);
      const nextIsWord = asciiWordCharacter(text[index + 1]);
      if (
        (!escaped && previousIsWord && nextIsWord) ||
        (straightSingleStart === undefined && !escaped && previousIsWord)
      ) {
        continue;
      }
      if (straightSingleStart === undefined) {
        straightSingleStart = { index, escaped };
      } else if (escaped && !straightSingleStart.escaped) {
        continue;
      } else {
        ranges.push({
          start: straightSingleStart.index,
          end: index + 1,
          provenance:
            straightSingleStart.escaped || escaped
              ? "escaped-visible-quoted"
              : "straight-single-quoted",
        });
        straightSingleStart = undefined;
      }
      continue;
    }
    if (character === "“") {
      curlyDoubleStart = index;
      continue;
    }
    if (character === "”" && curlyDoubleStart !== undefined) {
      ranges.push({
        start: curlyDoubleStart,
        end: index + 1,
        provenance: "curly-double-quoted",
      });
      curlyDoubleStart = undefined;
      continue;
    }
    if (character === "‘") {
      curlySingleStart = index;
      continue;
    }
    if (character === "’" && curlySingleStart !== undefined) {
      ranges.push({
        start: curlySingleStart,
        end: index + 1,
        provenance: "curly-single-quoted",
      });
      curlySingleStart = undefined;
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function quoteEnclosureProvenanceAtOffset(
  enclosures: readonly EnclosureRange[],
  offset: number,
): EnclosureProvenance {
  return (
    enclosures.find(({ start, end }) => start < offset && offset < end - 1)
      ?.provenance ?? "unenclosed"
  );
}

function quotePairEnclosesOffset(text: string, offset: number): boolean {
  return (
    quoteEnclosureProvenanceAtOffset(quoteEnclosureRanges(text), offset) !==
    "unenclosed"
  );
}

function rangeStartEnclosureProvenance(
  text: string,
  range: EvidenceRange,
  enclosures: readonly EnclosureRange[],
): EnclosureProvenance {
  const leading = /^[ \t]*/u.exec(text.slice(range.start, range.end))?.[0]
    .length;
  return quoteEnclosureProvenanceAtOffset(
    enclosures,
    range.start + (leading ?? 0),
  );
}

function asciiWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/u.test(character);
}

function characterIsBackslashEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && text[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function classifyPredicateStart(
  text: string,
  hasExplicitWorkflowSubject: boolean,
): PredicateStartClassification {
  if (hasExplicitWorkflowSubject) return "explicit-workflow-subject";
  if (CONDITIONAL_OR_SUBORDINATE_PREDICATE_START_RE.test(text)) {
    return "conditional-or-subordinate";
  }
  if (EXPLICIT_SUPPORTED_PREDICATE_PREFIX_START_RE.test(text)) {
    return "supported-subjectless";
  }
  if (DOMAIN_PREDICATE_START_RE.test(text)) {
    return "supported-subjectless";
  }
  if (SECURITY_ACTION_CHANGED_SUBJECT_START_RE.test(text)) {
    return "explicit-changed-subject";
  }
  if (STRONG_CHANGED_SUBJECT_START_RE.test(text)) {
    return "explicit-changed-subject";
  }
  if (SUBJECTLESS_PREDICATE_START_RE.test(text)) {
    return "supported-subjectless";
  }
  if (EXPLICIT_CHANGED_SUBJECT_START_RE.test(text)) {
    return "explicit-changed-subject";
  }
  return "unsupported";
}

function trimPredicateRange(text: string, range: EvidenceRange): EvidenceRange {
  const source = text.slice(range.start, range.end);
  const leading = /^[ \t]*(?:,[ \t]*)?/u.exec(source)?.[0].length ?? 0;
  const trailing = /(?:,[ \t]*|[ \t]+)$/u.exec(source)?.[0].length ?? 0;
  return {
    start: range.start + leading,
    end: Math.max(range.start + leading, range.end - trailing),
  };
}

function statementSeparatorSupportsInheritance(separator: string): boolean {
  return (
    !separator.includes("\n") &&
    INHERITED_STATEMENT_SEPARATOR_RE.test(separator)
  );
}

export function supportedWorkflowSubjectInRange(
  text: string,
  range: EvidenceRange,
): WorkflowSubjectMatch | undefined {
  const source = text.slice(range.start, range.end);
  const match = LEADING_WORKFLOW_SUBJECT_RE.exec(source);
  const subject = match?.groups?.subject;
  if (match !== null && subject !== undefined) {
    const subjectOffset = match[0]
      .toLowerCase()
      .lastIndexOf(subject.toLowerCase());
    if (subjectOffset >= 0) {
      const start = range.start + subjectOffset;
      return {
        range: { start, end: start + subject.length },
        evidenceStart: start,
      };
    }
  }

  const embeddedSubject = recognizeEvidenceRange(source, WORKFLOW_SCOPE_RE);
  if (embeddedSubject === undefined) return undefined;
  const prefixClassification = standalonePolicyPrefixClassification(
    source.slice(0, embeddedSubject.start),
  );
  if (!outerPrefixSupportsEmbeddedWorkflowSubject(prefixClassification)) {
    return undefined;
  }
  return {
    range: {
      start: range.start + embeddedSubject.start,
      end: range.start + embeddedSubject.end,
    },
    evidenceStart: range.start,
  };
}
