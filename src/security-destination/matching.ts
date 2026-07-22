import { isIP } from "node:net";

import type { NetworkDestination } from "./types.js";

const TRAILING_DESTINATION_PUNCTUATION_RE = /[),.;:!?]+$/;

export function normalizeNetworkDestination(
  candidate: string,
): NetworkDestination | undefined {
  const raw = candidate.trim().replace(TRAILING_DESTINATION_PUNCTUATION_RE, "");
  if (raw.length === 0) return undefined;

  const explicitUrl = /^https?:\/\//i.test(raw) || raw.startsWith("//");
  const networkShare = raw.startsWith("\\\\");
  const parseable = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith("//")
      ? `https:${raw}`
      : raw.startsWith("\\\\")
        ? `https://${raw.slice(2).replaceAll("\\", "/")}`
        : `https://${raw}`;
  try {
    const url = new URL(parseable);
    const canonicalHostname = url.hostname.toLowerCase();
    const host =
      canonicalHostname.startsWith("[") && canonicalHostname.endsWith("]")
        ? canonicalHostname.slice(1, -1)
        : canonicalHostname;
    const ipVersion = isIP(host);
    if (
      (ipVersion === 6 && !explicitUrl) ||
      (ipVersion === 0 && !host.includes(".") && !explicitUrl && !networkShare)
    ) {
      return undefined;
    }
    const path = url.pathname.replace(/\/+$/, "");
    return { raw, host, path: path === "/" ? "" : path };
  } catch {
    return undefined;
  }
}

export function networkDestinationMatches(
  candidate: NetworkDestination,
  approved: NetworkDestination,
): boolean {
  if (approved.path.length > 0) {
    return (
      candidate.host === approved.host &&
      (candidate.path === approved.path ||
        candidate.path.startsWith(`${approved.path}/`))
    );
  }

  if (
    isIP(candidate.host) !== 0 ||
    isIP(approved.host) !== 0 ||
    !candidate.host.includes(".") ||
    !approved.host.includes(".")
  ) {
    return candidate.host === approved.host;
  }

  return (
    candidate.host === approved.host ||
    candidate.host.endsWith(`.${approved.host}`)
  );
}

export function unapprovedDestinations(
  destinations: NetworkDestination[],
  approvedDestinations: string[],
  invalidAllowlist = false,
): NetworkDestination[] {
  if (invalidAllowlist) return destinations;

  const approved = approvedDestinations
    .map((destination) => normalizeNetworkDestination(destination))
    .filter(
      (destination): destination is NetworkDestination =>
        destination !== undefined,
    );
  if (approved.length === 0) return [];

  return destinations.filter(
    (destination) =>
      !approved.some((approvedDestination) =>
        networkDestinationMatches(destination, approvedDestination),
      ),
  );
}
