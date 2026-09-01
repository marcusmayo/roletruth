import type {
  Assertion,
  EvidenceSource,
  EvidenceSpan,
} from "./roletruth-engine";

export const DEMO_CAPTURED_AT = "2026-09-01T19:35:39Z";

export const demoSources: EvidenceSource[] = [
  {
    id: "src-hiring-post",
    label: "Original hiring post",
    publisher: "X",
    author: "Harry Chow",
    kind: "screenshot",
    authority: "direct",
    image: "/evidence/solari-hiring-post.webp",
    publishedAt: "Aug 31, 2026",
    capturedAt: DEMO_CAPTURED_AT,
    sha256: "64a3d144af91d453e6ec1dbdf727151605a7fe41b44af6b946cd9430e82f771f",
  },
  {
    id: "src-faq",
    label: "Direct role FAQ",
    publisher: "X",
    author: "Harry Chow",
    kind: "screenshot",
    authority: "direct",
    image: "/evidence/solari-faq.webp",
    publishedAt: "Aug 31, 2026",
    capturedAt: DEMO_CAPTURED_AT,
    sha256: "894139cd2010a03c5c71321fe234860005618dd16a3ee62111425191f0285366",
  },
  {
    id: "src-use-case",
    label: "Use-case guidance",
    publisher: "X",
    author: "Harry Chow",
    kind: "screenshot",
    authority: "direct",
    image: "/evidence/solari-use-case.webp",
    publishedAt: "Sep 1, 2026",
    capturedAt: DEMO_CAPTURED_AT,
    sha256: "4fdb569407408bb9c374ce56b75b8606ac82e4b981d9dd74243ab8d4b3eb088c",
  },
  {
    id: "src-comp-context",
    label: "Compensation clarification",
    publisher: "X",
    author: "Harry Chow",
    kind: "screenshot",
    authority: "direct",
    image: "/evidence/solari-compensation-context.webp",
    publishedAt: "Aug 31, 2026",
    capturedAt: DEMO_CAPTURED_AT,
    sha256: "2a7e37caf7c3845f565130ab229f867dfd48c78f0919a5ac56c25282937bc406",
  },
  {
    id: "src-synthetic-onsite",
    label: "Synthetic onsite contradiction",
    publisher: "RoleTruth test fixture",
    author: "Synthetic data",
    kind: "synthetic",
    authority: "test-only",
    capturedAt: DEMO_CAPTURED_AT,
    sha256: "synthetic-not-source-evidence",
    synthetic: true,
  },
];

export const demoEvidence: EvidenceSpan[] = [
  {
    id: "ev-role",
    sourceId: "src-hiring-post",
    quote:
      "I'm hiring a SWE intern for Pinetree Research, and the salary is $300K",
    location: "Hiring post · opening sentence",
    eligible: true,
  },
  {
    id: "ev-compensation",
    sourceId: "src-hiring-post",
    quote: "Before you ask: 300K annualized.",
    location: "Hiring post · compensation qualifier",
    eligible: true,
  },
  {
    id: "ev-materials",
    sourceId: "src-hiring-post",
    quote: "And no, we don't want your resume, coverletter, or grades",
    location: "Hiring post · application materials",
    eligible: true,
  },
  {
    id: "ev-steps",
    sourceId: "src-hiring-post",
    quote:
      "1. Fork the Solari repo\n2. Build a real use case with Solari (browsers, sandboxes, and/or desktops)\n3. Publish it on a public Github account\n4. Share it in a post on Linkedin or X\nTag @harrychow_ and @getsolari",
    location: "Hiring post · numbered application steps",
    eligible: true,
  },
  {
    id: "ev-ai",
    sourceId: "src-hiring-post",
    quote: "Use AI to build it. Seriously, we insist.",
    location: "Hiring post · build guidance",
    eligible: true,
  },
  {
    id: "ev-remote",
    sourceId: "src-faq",
    quote:
      "Do i have to be based in SF/relocate? This is a remote role",
    location: "Direct FAQ · question 1",
    eligible: true,
  },
  {
    id: "ev-deadline",
    sourceId: "src-faq",
    quote:
      "Is there a deadline? No, when we find the right person, we'll hire them.",
    location: "Direct FAQ · question 3",
    eligible: true,
  },
  {
    id: "ev-use-case",
    sourceId: "src-use-case",
    quote:
      "What we want to see is people create genuine uses that solves problems",
    location: "Use-case guidance · opening",
    eligible: true,
  },
  {
    id: "ev-pay-context",
    sourceId: "src-comp-context",
    quote:
      "300K annualized, if someone works part time / 3 months, its not 300K obv",
    location: "Direct reply · decision factors",
    eligible: true,
  },
  {
    id: "ev-synthetic-onsite",
    sourceId: "src-synthetic-onsite",
    quote: "This role requires three days each week onsite in San Francisco.",
    location: "Synthetic test fixture · not a claim about Solari",
    eligible: true,
    synthetic: true,
  },
];

export const demoAssertions: Assertion[] = [
  {
    id: "as-role",
    field: "role_title",
    rawValue: "SWE intern",
    normalizedValue: "swe-intern",
    displayValue: "SWE intern",
    evidenceId: "ev-role",
  },
  {
    id: "as-remote",
    field: "work_mode",
    rawValue: "remote role",
    normalizedValue: "remote",
    displayValue: "Remote",
    evidenceId: "ev-remote",
  },
  {
    id: "as-no-relocation",
    field: "relocation_required",
    rawValue: "Do i have to be based in SF/relocate? This is a remote role",
    normalizedValue: "not-required",
    displayValue: "Not required",
    evidenceId: "ev-remote",
  },
  {
    id: "as-compensation",
    field: "compensation_basis",
    rawValue: "300K annualized",
    normalizedValue: "usd-300000-annualized",
    displayValue: "$300,000 annualized",
    evidenceId: "ev-compensation",
  },
  {
    id: "as-materials",
    field: "application_materials",
    rawValue: "don't want your resume, coverletter, or grades",
    normalizedValue: "resume-cover-letter-grades-not-requested",
    displayValue: "Résumé, cover letter, and grades not requested",
    evidenceId: "ev-materials",
  },
  {
    id: "as-steps",
    field: "application_steps",
    rawValue: "fork, build, publish, share and tag",
    normalizedValue: "fork-build-publish-share-tag",
    displayValue: "Fork → build → publish → post + tag",
    evidenceId: "ev-steps",
  },
  {
    id: "as-deadline",
    field: "deadline",
    rawValue: "Is there a deadline? No",
    normalizedValue: "no-fixed-deadline",
    displayValue: "No fixed deadline",
    evidenceId: "ev-deadline",
  },
  {
    id: "as-evaluation",
    field: "evaluation_signal",
    rawValue: "genuine uses that solves problems",
    normalizedValue: "genuine-problem-and-market-fit",
    displayValue: "A genuine problem and evidence people want it",
    evidenceId: "ev-use-case",
  },
  {
    id: "as-synthetic-onsite",
    field: "work_mode",
    rawValue: "three days each week onsite",
    normalizedValue: "hybrid-three-days-onsite",
    displayValue: "Hybrid — 3 days onsite in San Francisco",
    evidenceId: "ev-synthetic-onsite",
  },
];

export const demoFixture = {
  sources: demoSources,
  evidence: demoEvidence,
  assertions: demoAssertions,
  createdAt: DEMO_CAPTURED_AT,
};
