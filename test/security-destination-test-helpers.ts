import {
  analyzeDestinations,
  networkDestinations,
  uploadDestinations,
} from "../src/security-destination/index.js";

export function associatedNetworkDestinations(input: string) {
  return networkDestinations(analyzeDestinations(input));
}

export function associatedUploadDestinations(input: string) {
  return uploadDestinations(analyzeDestinations(input));
}
