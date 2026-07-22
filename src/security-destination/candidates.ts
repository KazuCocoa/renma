import { isIP } from "node:net";

import { parse as parseDomain } from "tldts";

import { normalizeNetworkDestination } from "./matching.js";
import type { DestinationCandidate } from "./types.js";

const DNS_HOST_SOURCE = String.raw`(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?`;
const IPV4_HOST_SOURCE = String.raw`(?:\d{1,3}\.){3}\d{1,3}`;
const EXPLICIT_URL_CANDIDATE_RE = /(?:https?:\/\/|\/\/)[^\s"'`<>{}]+/giu;
const NETWORK_SHARE_CANDIDATE_RE = /\\\\[^\s"'`<>{}]+/gu;
const BARE_DESTINATION_CANDIDATE_RE = new RegExp(
  String.raw`(?:${DNS_HOST_SOURCE}|${IPV4_HOST_SOURCE})(?::\d+)?(?:[\\/][^\s"'\x60<>{}[\]]*)?`,
  "gi",
);
const RENMA_ASSET_ID_RE = /^(?:context|skill|lens)(?:\.[a-z0-9][a-z0-9-]*)+$/i;
const TRAILING_DESTINATION_PUNCTUATION_RE = /[),.;:!?]+$/;

export function classifyDestinationCandidates(
  line: string,
): DestinationCandidate[] {
  const candidates: DestinationCandidate[] = [];

  for (const match of line.matchAll(EXPLICIT_URL_CANDIDATE_RE)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    const destination = normalizeNetworkDestination(raw);
    const explicitTransport = explicitNetworkTransport(raw);
    candidates.push({
      raw,
      start,
      end: start + raw.length,
      kind: destination === undefined ? "unsupported-host" : "explicit-url",
      ...(explicitTransport === undefined ? {} : { explicitTransport }),
      ...(destination === undefined ? {} : { destination }),
    });
  }

  for (const match of line.matchAll(NETWORK_SHARE_CANDIDATE_RE)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (overlapsDestinationCandidate(candidates, start, end)) continue;
    const destination = normalizeNetworkDestination(raw);
    candidates.push({
      raw,
      start,
      end,
      kind: destination === undefined ? "unsupported-host" : "network-share",
      ...(destination === undefined ? {} : { destination }),
    });
  }

  for (const match of line.matchAll(BARE_DESTINATION_CANDIDATE_RE)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (overlapsDestinationCandidate(candidates, start, end)) continue;

    if (isCommandFileArgument(line, start)) {
      candidates.push({ raw, start, end, kind: "command-file-argument" });
      continue;
    }

    if (isLocalPathCandidate(line, start)) {
      candidates.push({ raw, start, end, kind: "local-path" });
      continue;
    }

    const normalizedRaw = raw.replace(TRAILING_DESTINATION_PUNCTUATION_RE, "");
    if (line[start - 1] === "." || RENMA_ASSET_ID_RE.test(normalizedRaw)) {
      candidates.push({
        raw,
        start,
        end,
        kind: RENMA_ASSET_ID_RE.test(normalizedRaw)
          ? "renma-asset-id"
          : "local-filename",
      });
      continue;
    }

    const destination = normalizeNetworkDestination(raw);
    if (destination === undefined) {
      candidates.push({ raw, start, end, kind: "unsupported-host" });
      continue;
    }

    if (isIP(destination.host) === 4) {
      candidates.push({ raw, start, end, kind: "bare-host", destination });
      continue;
    }

    if (parseDomain(destination.host).isIcann === true) {
      candidates.push({
        raw,
        start,
        end,
        kind: hasBareDestinationSyntax(normalizedRaw)
          ? "bare-host"
          : "ambiguous-dotted-token",
        destination,
      });
      continue;
    }

    candidates.push({ raw, start, end, kind: "local-filename" });
  }

  return candidates.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
}

export function maskDestinationCandidates(
  line: string,
  candidates: DestinationCandidate[],
): string {
  const projection = line.split("");
  for (const candidate of candidates) {
    projection.fill(" ", candidate.start, candidate.end);
  }
  return projection.join("");
}

function overlapsDestinationCandidate(
  candidates: DestinationCandidate[],
  start: number,
  end: number,
): boolean {
  return candidates.some(
    (candidate) => start < candidate.end && candidate.start < end,
  );
}

function hasBareDestinationSyntax(candidate: string): boolean {
  return /[\\/]/.test(candidate) || /:\d+(?:[\\/]|$)/.test(candidate);
}

function explicitNetworkTransport(
  candidate: string,
): DestinationCandidate["explicitTransport"] {
  if (/^https:\/\//i.test(candidate)) return "https";
  if (/^http:\/\//i.test(candidate)) return "http";
  return candidate.startsWith("//") ? "protocol-relative" : undefined;
}

function isCommandFileArgument(line: string, start: number): boolean {
  if (line[start - 1] === "@") return true;
  const before = line.slice(0, start);
  const tokenStart = Math.max(
    before.lastIndexOf(" "),
    before.lastIndexOf("\t"),
    before.lastIndexOf("`"),
    before.lastIndexOf('"'),
    before.lastIndexOf("'"),
  );
  return /^--?[a-z0-9][a-z0-9-]*=$/i.test(before.slice(tokenStart + 1));
}

function isLocalPathCandidate(line: string, start: number): boolean {
  const preceding = line[start - 1];
  if (preceding !== "/" && preceding !== "\\") return false;
  return line[start - 2] !== preceding;
}
