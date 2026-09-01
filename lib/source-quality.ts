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

export interface SourceAssessmentInput {
  requestedUrl?: string;
  finalUrl?: string;
  title?: string;
  heading?: string;
  text: string;
  httpStatus?: number | null;
  structuredJobCount?: number;
  kind: "url" | "screenshot";
}

export interface SourceAssessment {
  acquisitionStatus: AcquisitionStatus;
  documentType: DocumentType;
  eligibleForRoleTerms: boolean;
  diagnostics: string[];
}

const BLOCKED_URL_MARKERS = [
  "bot-detection",
  "/captcha",
  "captcha=",
  "cdn-cgi/challenge",
  "/challenge-platform/",
  "verify-human",
];

const BLOCKED_TEXT_MARKERS = [
  "just a moment",
  "verify you are human",
  "checking your browser",
  "unusual traffic",
  "complete the captcha",
];

const BLOCKED_TITLES = [
  "access denied",
  "security check",
  "verify you are human",
  "just a moment",
];

const AUTH_URL_MARKERS = [
  "/login",
  "/signin",
  "/sign-in",
  "postloginurl=",
  "authwall",
];

const AUTH_TEXT_MARKERS = [
  "sign in to continue",
  "log in to continue",
  "create an account to continue",
  "members only",
];

const COMPANY_PROFILE_MARKERS = [
  "company snapshot",
  "approve of ceo",
  "would recommend to a friend",
  "add a review",
  "followed companies",
  "based on ratings",
  "pay & benefits",
  "company overview",
];

const STRONG_JOB_MARKERS = [
  "job description",
  "responsibilities",
  "qualifications",
  "requirements",
  "employment type",
  "apply now",
  "apply for this job",
  "salary range",
  "full-time",
  "part-time",
];

function includesAny(value: string, markers: string[]) {
  return markers.some((marker) => value.includes(marker));
}

function meaningfulText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function assessSource(input: SourceAssessmentInput): SourceAssessment {
  const title = (input.title ?? "").toLowerCase();
  const finalUrl = (input.finalUrl ?? input.requestedUrl ?? "").toLowerCase();
  const text = meaningfulText(input.text);
  const searchable = `${title}\n${(input.heading ?? "").toLowerCase()}\n${text.toLowerCase()}`;
  const diagnostics: string[] = [];

  const hasBlockedSignals =
    includesAny(finalUrl, BLOCKED_URL_MARKERS) ||
    BLOCKED_TITLES.some(
      (marker) => title === marker || title.startsWith(`${marker} |`),
    ) ||
    includesAny(title, BLOCKED_TEXT_MARKERS) ||
    includesAny(searchable, BLOCKED_TEXT_MARKERS);

  // A challenge page can itself return 401. Strong, explicit challenge
  // markers describe the captured evidence more accurately than status alone.
  if (hasBlockedSignals) {
    return {
      acquisitionStatus: "blocked",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: [
        "A bot challenge or access-denied page was captured instead of the requested evidence.",
      ],
    };
  }

  if (input.httpStatus === 401) {
    return {
      acquisitionStatus: "auth_required",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: ["The source returned HTTP 401 and requires authentication."],
    };
  }

  if (input.httpStatus === 403 || input.httpStatus === 429) {
    return {
      acquisitionStatus: "blocked",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: [
        `The source returned HTTP ${input.httpStatus} and blocked automated acquisition.`,
      ],
    };
  }

  if (typeof input.httpStatus === "number" && input.httpStatus >= 400) {
    return {
      acquisitionStatus: "error",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: [
        `The source returned HTTP ${input.httpStatus}; its error page was excluded from role evidence.`,
      ],
    };
  }

  if (
    includesAny(finalUrl, AUTH_URL_MARKERS) ||
    includesAny(searchable, AUTH_TEXT_MARKERS)
  ) {
    return {
      acquisitionStatus: "auth_required",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: [
        "The source redirected to a sign-in or account wall instead of the requested evidence.",
      ],
    };
  }

  if (text.length < 40) {
    return {
      acquisitionStatus: "empty",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: ["The captured source did not contain enough readable text."],
    };
  }

  if ((input.structuredJobCount ?? 0) > 0) {
    return {
      acquisitionStatus: "usable",
      documentType: "job_post",
      eligibleForRoleTerms: true,
      diagnostics: ["A schema.org JobPosting record was found."],
    };
  }

  const companyMarkerCount = COMPANY_PROFILE_MARKERS.filter((marker) =>
    searchable.includes(marker),
  ).length;
  if (companyMarkerCount >= 2) {
    return {
      acquisitionStatus: "not_job",
      documentType: "company_profile",
      eligibleForRoleTerms: false,
      diagnostics: [
        "This appears to be company context rather than a job posting.",
      ],
    };
  }

  const strongJobMarkerCount = STRONG_JOB_MARKERS.filter((marker) =>
    searchable.includes(marker),
  ).length;
  const hiringLanguage =
    /\b(?:we(?:'re| are) hiring|hiring (?:a|an)|open (?:role|position)|position summary)\b/i.test(
      searchable,
    );

  if (
    strongJobMarkerCount >= 2 ||
    hiringLanguage
  ) {
    diagnostics.push(
      input.kind === "screenshot"
        ? "OCR text contains job-posting signals."
        : "Rendered text contains job-posting signals.",
    );
    return {
      acquisitionStatus: "usable",
      documentType: hiringLanguage ? "recruiter_message" : "job_post",
      eligibleForRoleTerms: true,
      diagnostics,
    };
  }

  return {
    acquisitionStatus: "not_job",
    documentType: "unknown",
    eligibleForRoleTerms: false,
    diagnostics: [
      "No reliable job-posting structure or role-description signals were found.",
    ],
  };
}
