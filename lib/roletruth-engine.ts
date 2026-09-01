export type ClaimStatus =
  | "confirmed"
  | "conflicted"
  | "unknown"
  | "calculated";

export type SourceKind = "screenshot" | "url" | "synthetic";

export type AcquisitionStatus =
  | "usable"
  | "blocked"
  | "auth_required"
  | "not_job"
  | "empty"
  | "error";

export type DocumentType =
  | "job_post"
  | "company_profile"
  | "recruiter_message"
  | "clarification"
  | "unknown";

export interface EvidenceSource {
  id: string;
  label: string;
  publisher: string;
  author: string;
  kind: SourceKind;
  authority:
    | "direct"
    | "official"
    | "third-party"
    | "unclassified"
    | "test-only";
  image?: string;
  url?: string;
  requestedUrl?: string;
  finalUrl?: string;
  publishedAt?: string;
  capturedAt: string;
  sha256: string;
  textSha256?: string;
  screenshotSha256?: string;
  browserSessionId?: string;
  acquisitionStatus?: AcquisitionStatus;
  documentType?: DocumentType;
  eligibleForRoleTerms?: boolean;
  diagnostics?: string[];
  httpStatus?: number | null;
  textLength?: number;
  ocrConfidence?: number;
  synthetic?: boolean;
}

export interface EvidenceSpan {
  id: string;
  sourceId: string;
  quote: string;
  location: string;
  eligible: boolean;
  eligibilityReason?: string;
  synthetic?: boolean;
}

export interface Assertion {
  id: string;
  field: string;
  rawValue: string;
  normalizedValue: string;
  displayValue: string;
  evidenceId: string;
}

export interface ClaimDefinition {
  field: string;
  label: string;
  group:
    | "Role"
    | "Location"
    | "Compensation"
    | "Engagement"
    | "Requirements"
    | "Application";
  unknownReason: string;
  question?: string;
  contextEvidenceIds?: string[];
}

export interface Finding {
  field: string;
  label: string;
  group: ClaimDefinition["group"];
  status: ClaimStatus;
  conclusion: string;
  explanation: string;
  evidenceIds: string[];
  ruleId: string;
  question?: string;
}

export interface Calculation {
  id: string;
  label: string;
  formula: string;
  inputs: Array<{ label: string; value: string; evidenceId?: string }>;
  result: string;
  disclaimer: string;
}

export interface RoleTruthReport {
  id: string;
  engineVersion: string;
  createdAt: string;
  mode: "demo-local" | "solari-live";
  sources: EvidenceSource[];
  evidence: EvidenceSpan[];
  assertions: Assertion[];
  findings: Finding[];
  calculations: Calculation[];
  questions: string[];
  analysisStatus?: "complete" | "partial" | "insufficient";
  subject?: {
    roleTitle: string | null;
    companyName: string | null;
  };
  diagnostics?: string[];
  runtime: {
    browserSessionId: string | null;
    sandboxId: string | null;
    sandboxExitCode: number | null;
  };
}

export const CLAIM_DEFINITIONS: ClaimDefinition[] = [
  {
    field: "company_name",
    label: "Company",
    group: "Role",
    unknownReason: "The supplied sources do not explicitly name the company.",
  },
  {
    field: "role_title",
    label: "Role",
    group: "Role",
    unknownReason: "The supplied sources do not explicitly name the role.",
  },
  {
    field: "work_mode",
    label: "Work mode",
    group: "Location",
    unknownReason: "No eligible source explicitly states the work mode.",
    question:
      "Can you confirm whether this may be performed fully remotely from Virginia and whether any onsite cadence applies?",
  },
  {
    field: "job_location",
    label: "Location",
    group: "Location",
    unknownReason: "No eligible source explicitly states the job location.",
    question:
      "What location restrictions or approved working states apply to this role?",
  },
  {
    field: "relocation_required",
    label: "Relocation",
    group: "Location",
    unknownReason: "Relocation expectations are not explicit.",
    question: "Is relocation required at any point in the engagement?",
  },
  {
    field: "compensation_basis",
    label: "Compensation basis",
    group: "Compensation",
    unknownReason: "No eligible source states a compensation amount and basis.",
  },
  {
    field: "actual_paid_total",
    label: "Actual paid total",
    group: "Compensation",
    unknownReason:
      "The actual term and full-time equivalency are not established, so a total payout cannot be claimed.",
    question:
      "What gross compensation applies to the actual engagement term and expected full-time equivalency?",
    contextEvidenceIds: ["ev-pay-context"],
  },
  {
    field: "duration",
    label: "Engagement duration",
    group: "Engagement",
    unknownReason:
      "A conditional three-month example does not establish the actual engagement duration.",
    question: "Is the engagement fixed at three months or ongoing?",
    contextEvidenceIds: ["ev-pay-context"],
  },
  {
    field: "employment_type",
    label: "Employment classification",
    group: "Engagement",
    unknownReason:
      "The sources do not establish employee versus contractor status or a full-time schedule.",
    question:
      "Is the worker classification employee or contractor, and is the schedule full-time or part-time?",
  },
  {
    field: "experience_required",
    label: "Experience",
    group: "Requirements",
    unknownReason: "No explicit minimum experience requirement was found.",
  },
  {
    field: "education_required",
    label: "Education",
    group: "Requirements",
    unknownReason: "No explicit education requirement was found.",
  },
  {
    field: "application_materials",
    label: "Application materials",
    group: "Application",
    unknownReason: "Required application materials are not explicit.",
  },
  {
    field: "application_steps",
    label: "Application steps",
    group: "Application",
    unknownReason: "The sources do not provide a complete application path.",
  },
  {
    field: "deadline",
    label: "Deadline",
    group: "Application",
    unknownReason: "No eligible source explicitly addresses a deadline.",
    question: "Is there a target date for reviewing submissions?",
  },
  {
    field: "evaluation_signal",
    label: "What the build must prove",
    group: "Application",
    unknownReason: "The evaluation criteria are not explicit.",
  },
];

function eligibleAssertions(
  assertions: Assertion[],
  evidenceById: Map<string, EvidenceSpan>,
  field: string,
) {
  return assertions.filter(
    (assertion) =>
      assertion.field === field &&
      evidenceById.get(assertion.evidenceId)?.eligible === true,
  );
}

export function resolveFinding(
  definition: ClaimDefinition,
  assertions: Assertion[],
  evidence: EvidenceSpan[],
): Finding {
  const evidenceById = new Map(evidence.map((span) => [span.id, span]));
  const eligible = eligibleAssertions(
    assertions,
    evidenceById,
    definition.field,
  );

  if (eligible.length === 0) {
    return {
      field: definition.field,
      label: definition.label,
      group: definition.group,
      status: "unknown",
      conclusion: "Not established",
      explanation: definition.unknownReason,
      evidenceIds: definition.contextEvidenceIds ?? [],
      ruleId: "RT-R3 · absence never becomes a conclusion",
      question: definition.question,
    };
  }

  const byValue = new Map<string, Assertion[]>();
  for (const assertion of eligible) {
    const existing = byValue.get(assertion.normalizedValue) ?? [];
    existing.push(assertion);
    byValue.set(assertion.normalizedValue, existing);
  }

  if (byValue.size === 1) {
    return {
      field: definition.field,
      label: definition.label,
      group: definition.group,
      status: "confirmed",
      conclusion: eligible[0].displayValue,
      explanation:
        "At least one eligible explicit assertion exists and every other eligible assertion is compatible.",
      evidenceIds: [...new Set(eligible.map((item) => item.evidenceId))],
      ruleId: "RT-R1 · explicit + compatible",
    };
  }

  const displayValues = [...byValue.values()].map(
    (group) => group[0].displayValue,
  );

  return {
    field: definition.field,
    label: definition.label,
    group: definition.group,
    status: "conflicted",
    conclusion: displayValues.join(" ↔ "),
    explanation:
      "Eligible explicit assertions are materially incompatible. Source authority is shown, but it cannot erase a contradiction.",
    evidenceIds: [...new Set(eligible.map((item) => item.evidenceId))],
    ruleId: "RT-R2 · incompatible evidence preserved",
    question:
      definition.question ??
      `Which source reflects the current ${definition.label.toLowerCase()}?`,
  };
}

export function buildReport(
  fixture: Pick<
    RoleTruthReport,
    "sources" | "evidence" | "assertions" | "createdAt"
  >,
  includeSyntheticConflict = false,
): RoleTruthReport {
  const sources = fixture.sources.filter(
    (source) => includeSyntheticConflict || !source.synthetic,
  );
  const evidence = fixture.evidence.filter(
    (span) => includeSyntheticConflict || !span.synthetic,
  );
  const assertions = fixture.assertions.filter((assertion) => {
    const span = evidence.find((item) => item.id === assertion.evidenceId);
    return Boolean(span);
  });

  const findings = CLAIM_DEFINITIONS.map((definition) =>
    resolveFinding(definition, assertions, evidence),
  );

  const compensationIndex = findings.findIndex(
    (finding) => finding.field === "actual_paid_total",
  );
  const scenario: Finding = {
    field: "three_month_full_time_scenario",
    label: "3-month full-time scenario",
    group: "Compensation",
    status: "calculated",
    conclusion: "$75,000",
    explanation:
      "A transparent scenario derived from the annualized rate. It is not a quoted or promised payout.",
    evidenceIds: ["ev-compensation"],
    ruleId: "RT-C1 · 300,000 × 3/12 × 1.0 FTE",
  };
  findings.splice(Math.max(0, compensationIndex), 0, scenario);

  const questions = findings
    .filter(
      (finding) =>
        (finding.status === "unknown" || finding.status === "conflicted") &&
        finding.question,
    )
    .map((finding) => finding.question as string);

  return {
    id: includeSyntheticConflict
      ? "rt-solari-hiring-conflict"
      : "rt-solari-hiring-golden",
    engineVersion: "0.1.0",
    createdAt: fixture.createdAt,
    mode: "demo-local",
    sources,
    evidence,
    assertions,
    findings,
    calculations: [
      {
        id: "calc-three-month",
        label: "Three-month full-time scenario",
        formula: "$300,000 / year × 3 / 12 × 1.0 FTE",
        inputs: [
          {
            label: "Annualized rate",
            value: "$300,000",
            evidenceId: "ev-compensation",
          },
          { label: "Scenario term", value: "3 months" },
          { label: "Scenario FTE", value: "1.0" },
        ],
        result: "$75,000",
        disclaimer:
          "Derived scenario only. Actual duration and schedule remain unknown.",
      },
    ],
    questions,
    analysisStatus: "complete",
    subject: {
      roleTitle: "SWE intern",
      companyName: "Pinetree Research",
    },
    diagnostics: [],
    runtime: {
      browserSessionId: null,
      sandboxId: null,
      sandboxExitCode: null,
    },
  };
}

export function canonicalReport(report: RoleTruthReport) {
  return JSON.stringify({
    id: report.id,
    engineVersion: report.engineVersion,
    mode: report.mode,
    sourceHashes: report.sources.map((source) => source.sha256).sort(),
    findings: report.findings.map((finding) => ({
      field: finding.field,
      status: finding.status,
      conclusion: finding.conclusion,
      evidenceIds: [...finding.evidenceIds].sort(),
      ruleId: finding.ruleId,
    })),
    calculations: report.calculations,
  });
}

export async function sha256Hex(value: string | ArrayBuffer) {
  const input =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", input);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return sha256Fallback(input);
}

function sha256Fallback(input: Uint8Array) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const byteLength = input.length;
  const paddedLength = Math.ceil((byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[byteLength] = 0x80;
  const bitLength = byteLength * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const words = new Uint32Array(64);
  const rotateRight = (value: number, shift: number) =>
    (value >>> shift) | (value << (32 - shift));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] =
        (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 =
        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + sigma1 + choice + constants[index] + words[index]) >>> 0;
      const sigma0 =
        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}
