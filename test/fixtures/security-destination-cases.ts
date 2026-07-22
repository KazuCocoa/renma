import type {
  DestinationCandidateKind,
  NetworkDestination,
} from "../../src/security-diagnostics.js";

export type CandidateExpectation = {
  kind: DestinationCandidateKind;
  host?: string;
  path?: string;
};

export type DestinationExpectation = Pick<NetworkDestination, "host" | "path">;

export type DestinationCase = {
  name: string;
  input: string;
  expectedCandidates?: CandidateExpectation[];
  expectedNetwork: DestinationExpectation[];
  expectedUpload: DestinationExpectation[];
};

const destination = (host: string, path = ""): DestinationExpectation => ({
  host,
  path,
});

export const SECURITY_DESTINATION_CASES: readonly DestinationCase[] = [
  {
    name: "explicit HTTPS URL",
    input: "Fetch https://example.com/api.",
    expectedCandidates: [
      { kind: "explicit-url", host: "example.com", path: "/api" },
    ],
    expectedNetwork: [destination("example.com", "/api")],
    expectedUpload: [],
  },
  {
    name: "explicit URL with userinfo",
    input: "Fetch https://user:secret@example.com/private.",
    expectedCandidates: [
      { kind: "explicit-url", host: "example.com", path: "/private" },
    ],
    expectedNetwork: [destination("example.com", "/private")],
    expectedUpload: [],
  },
  {
    name: "internationalized hostname",
    input: "Fetch https://例え.テスト/data.",
    expectedCandidates: [
      {
        kind: "explicit-url",
        host: "xn--r8jz45g.xn--zckzah",
        path: "/data",
      },
    ],
    expectedNetwork: [destination("xn--r8jz45g.xn--zckzah", "/data")],
    expectedUpload: [],
  },
  {
    name: "IPv4 upload",
    input: "Upload results to https://192.168.1.20/upload.",
    expectedCandidates: [
      { kind: "explicit-url", host: "192.168.1.20", path: "/upload" },
    ],
    expectedNetwork: [destination("192.168.1.20", "/upload")],
    expectedUpload: [destination("192.168.1.20", "/upload")],
  },
  {
    name: "canonical bracketed IPv6",
    input: "Fetch https://[2001:0db8:0:0:0:0:0:20]:8443/data.",
    expectedCandidates: [
      { kind: "explicit-url", host: "2001:db8::20", path: "/data" },
    ],
    expectedNetwork: [destination("2001:db8::20", "/data")],
    expectedUpload: [],
  },
  {
    name: "protocol-relative URL",
    input: "Fetch //api.example.com/v1.",
    expectedCandidates: [
      { kind: "explicit-url", host: "api.example.com", path: "/v1" },
    ],
    expectedNetwork: [destination("api.example.com", "/v1")],
    expectedUpload: [],
  },
  {
    name: "UNC network share",
    input: String.raw`Copy the report to \\fileserver\drop.`,
    expectedCandidates: [
      { kind: "network-share", host: "fileserver", path: "/drop" },
    ],
    expectedNetwork: [destination("fileserver", "/drop")],
    expectedUpload: [destination("fileserver", "/drop")],
  },
  {
    name: "explicit single-label host",
    input: "Fetch http://artifact-server/data.",
    expectedCandidates: [
      { kind: "explicit-url", host: "artifact-server", path: "/data" },
    ],
    expectedNetwork: [destination("artifact-server", "/data")],
    expectedUpload: [],
  },
  {
    name: "explicit localhost",
    input: "Fetch http://localhost/health.",
    expectedCandidates: [
      { kind: "explicit-url", host: "localhost", path: "/health" },
    ],
    expectedNetwork: [destination("localhost", "/health")],
    expectedUpload: [],
  },
  {
    name: "unsupported explicit host",
    input: "Upload to http://[invalid-ipv6]/data.",
    expectedCandidates: [{ kind: "unsupported-host" }],
    expectedNetwork: [],
    expectedUpload: [],
  },
  {
    name: "common-TLD filename",
    input: "Validate package.json before release.",
    expectedCandidates: [{ kind: "local-filename" }],
    expectedNetwork: [],
    expectedUpload: [],
  },
  {
    name: "local dotted path",
    input: "Validate .github/workflows/npm-publish.yml.",
    expectedCandidates: [{ kind: "local-path" }],
    expectedNetwork: [],
    expectedUpload: [],
  },
  {
    name: "Renma asset ID",
    input: "Document context.release.notes locally.",
    expectedCandidates: [{ kind: "renma-asset-id" }],
    expectedNetwork: [],
    expectedUpload: [],
  },
  {
    name: "curl command file argument",
    input: "curl --data=@payload.json https://sink.example.com/upload",
    expectedCandidates: [
      { kind: "command-file-argument" },
      { kind: "explicit-url", host: "sink.example.com", path: "/upload" },
    ],
    expectedNetwork: [destination("sink.example.com", "/upload")],
    expectedUpload: [destination("sink.example.com", "/upload")],
  },
  {
    name: "candidate action masking",
    input: "Document upload.publish.example.com as a label.",
    expectedNetwork: [],
    expectedUpload: [],
  },
  {
    name: "mixed network source and upload sink",
    input: "Fetch from source.example.com and upload to sink.example.com.",
    expectedNetwork: [
      destination("source.example.com"),
      destination("sink.example.com"),
    ],
    expectedUpload: [destination("sink.example.com")],
  },
  {
    name: "coordinated destination list",
    input: "Upload to one.example.com, two.example.com, and three.example.com.",
    expectedNetwork: [
      destination("one.example.com"),
      destination("two.example.com"),
      destination("three.example.com"),
    ],
    expectedUpload: [
      destination("one.example.com"),
      destination("two.example.com"),
      destination("three.example.com"),
    ],
  },
  {
    name: "curl upload option before URL",
    input: "curl --data-binary @payload.json https://sink.example.com/upload",
    expectedNetwork: [destination("sink.example.com", "/upload")],
    expectedUpload: [destination("sink.example.com", "/upload")],
  },
  {
    name: "curl upload option after URL",
    input: "curl https://sink.example.com/upload --upload-file payload.json",
    expectedNetwork: [destination("sink.example.com", "/upload")],
    expectedUpload: [destination("sink.example.com", "/upload")],
  },
  {
    name: "shell command separator",
    input:
      "curl https://read.example.com && curl -X POST https://write.example.com",
    expectedNetwork: [
      destination("read.example.com"),
      destination("write.example.com"),
    ],
    expectedUpload: [destination("write.example.com")],
  },
  {
    name: "standalone ampersand separator",
    input:
      "curl https://read.example.com & curl --data @payload.json https://write.example.com",
    expectedNetwork: [
      destination("read.example.com"),
      destination("write.example.com"),
    ],
    expectedUpload: [destination("write.example.com")],
  },
  {
    name: "ampersand redirection is not a boundary",
    input:
      "curl https://sink.example.com/upload &> output.log --data @payload.json",
    expectedNetwork: [destination("sink.example.com", "/upload")],
    expectedUpload: [destination("sink.example.com", "/upload")],
  },
  {
    name: "curl transfer boundary",
    input:
      "curl --data @payload.json https://write.example.com --next https://read.example.com",
    expectedNetwork: [
      destination("write.example.com"),
      destination("read.example.com"),
    ],
    expectedUpload: [destination("write.example.com")],
  },
  {
    name: "multiline logical curl command",
    input:
      "curl https://sink.example.com/upload \\\n  --data-binary @payload.json",
    expectedNetwork: [destination("sink.example.com", "/upload")],
    expectedUpload: [destination("sink.example.com", "/upload")],
  },
  {
    name: "token-split curl option and hostname",
    input:
      "curl --data-bin\\\nary @payload.json https://sink.exam\\\nple.com/upload",
    expectedNetwork: [destination("sink.example.com", "/upload")],
    expectedUpload: [destination("sink.example.com", "/upload")],
  },
] as const;
