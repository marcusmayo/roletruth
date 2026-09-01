import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

async function pipelineModules() {
  const [quality, extractor, intake, reconcile, securityHeaders] = await Promise.all([
    vite.ssrLoadModule("/lib/source-quality.ts"),
    vite.ssrLoadModule("/lib/job-extractor.ts"),
    vite.ssrLoadModule("/lib/evidence-intake.ts"),
    vite.ssrLoadModule("/lib/solari-reconcile-script.ts"),
    vite.ssrLoadModule("/lib/security-headers.ts"),
  ]);
  return { quality, extractor, intake, reconcile, securityHeaders };
}

function usableCapture(sealedText, overrides = {}) {
  return {
    sourceId: "src-test",
    kind: "url",
    label: "Test job",
    publisher: "jobs.example.com",
    author: "Rendered page",
    authority: "official",
    requestedUrl: "https://jobs.example.com/roles/42",
    finalUrl: "https://jobs.example.com/roles/42",
    capturedAt: "2026-09-01T12:00:00.000Z",
    sealedText,
    textSha256: "test-text-hash",
    screenshotSha256: "test-image-hash",
    acquisitionStatus: "usable",
    documentType: "job_post",
    eligibleForRoleTerms: true,
    diagnostics: [],
    ...overrides,
  };
}

function assertionByField(assertions, field) {
  return assertions.find((assertion) => assertion.field === field);
}

test("source classifier rejects the exact Glassdoor bot-detection redirect", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl:
      "https://www.glassdoor.com/Overview/Working-at-NIFCO-America-Corp-EI_IE282512.11,29.htm",
    finalUrl:
      "https://www.glassdoor.com/member/profile/login?reason=bot-detection&postLoginUrl=https%3A%2F%2Fwww.glassdoor.com%2FOverview%2FWorking-at-NIFCO-America-Corp-EI_IE282512.11%2C29.htm",
    title: "Just a moment...",
    heading: "Security check",
    text: "Just a moment... Checking your browser before accessing Glassdoor.",
    httpStatus: 401,
  });

  assert.equal(assessment.acquisitionStatus, "blocked");
  assert.equal(assessment.documentType, "unknown");
  assert.equal(assessment.eligibleForRoleTerms, false);
  assert.match(assessment.diagnostics.join(" "), /bot challenge|access-denied/i);
});

test("source classifier keeps a plain HTTP 401 as authentication-required", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl: "https://jobs.example.com/private-role",
    finalUrl: "https://jobs.example.com/private-role",
    title: "Authentication required",
    text: "This job posting requires an authenticated account before it can be viewed.",
    httpStatus: 401,
  });

  assert.equal(assessment.acquisitionStatus, "auth_required");
  assert.equal(assessment.documentType, "unknown");
  assert.equal(assessment.eligibleForRoleTerms, false);
  assert.match(assessment.diagnostics.join(" "), /401|authentication/i);
});

test("CSP enables React development diagnostics without weakening production", async () => {
  const { securityHeaders } = await pipelineModules();
  const development = securityHeaders.buildContentSecurityPolicy("development");
  const production = securityHeaders.buildContentSecurityPolicy("production");

  assert.match(development, /script-src[^;]*'unsafe-eval'/);
  assert.match(development, /connect-src[^;]*ws: wss:/);
  assert.doesNotMatch(production, /'unsafe-eval'/);
  assert.doesNotMatch(production, /connect-src[^;]*\bws:/);
  assert.match(production, /object-src 'none'/);
  assert.match(production, /frame-ancestors 'none'/);
});

test("source classifier distinguishes authentication walls from bot challenges", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl: "https://jobs.example.com/role/42",
    finalUrl: "https://jobs.example.com/login?next=%2Frole%2F42",
    title: "Sign in",
    text: "Sign in to continue to this member-only job posting.",
    httpStatus: 200,
  });

  assert.equal(assessment.acquisitionStatus, "auth_required");
  assert.equal(assessment.eligibleForRoleTerms, false);
  assert.match(assessment.diagnostics.join(" "), /sign-in|account wall/i);
});

test("source classifier labels the supplied NIFCO company page as context, not a role", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "screenshot",
    title: "NIFCO America Corp",
    heading: "NIFCO America Corp Snapshot",
    text: [
      "NIFCO America Corp Snapshot",
      "3.2 based on 106 ratings",
      "57% approve of CEO",
      "58% would recommend to a friend",
      "Add a review",
      "Pay & benefits",
    ].join("\n"),
  });

  assert.equal(assessment.acquisitionStatus, "not_job");
  assert.equal(assessment.documentType, "company_profile");
  assert.equal(assessment.eligibleForRoleTerms, false);
  assert.match(assessment.diagnostics.join(" "), /company context/i);
});

test("source classifier accepts a generic, non-Solari job description", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl: "https://careers.example.com/senior-product-manager",
    finalUrl: "https://careers.example.com/senior-product-manager",
    title: "Senior Product Manager | Example Corp",
    heading: "Senior Product Manager",
    text: [
      "Job description",
      "Responsibilities",
      "Qualifications",
      "This is a full-time remote position.",
      "Salary range: $140,000-$175,000 per year.",
      "Apply now",
    ].join("\n"),
    httpStatus: 200,
  });

  assert.equal(assessment.acquisitionStatus, "usable");
  assert.equal(assessment.documentType, "job_post");
  assert.equal(assessment.eligibleForRoleTerms, true);
});

test("source classifier does not mistake an ordinary security-check job for a bot challenge", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl: "https://careers.example.com/security-check-engineer",
    finalUrl: "https://careers.example.com/security-check-engineer",
    title: "Security Check Engineer | Example Corp",
    heading: "Security Check Engineer",
    text: [
      "Job description",
      "Responsibilities",
      "Qualifications",
      "This full-time position builds security-check automation.",
      "Apply now",
    ].join("\n"),
    httpStatus: 200,
  });

  assert.equal(assessment.acquisitionStatus, "usable");
  assert.equal(assessment.documentType, "job_post");
  assert.equal(assessment.eligibleForRoleTerms, true);
});

test("source classifier does not reject a legitimate role merely because its URL contains challenge", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl: "https://careers.example.com/jobs/customer-challenge-lead",
    finalUrl: "https://careers.example.com/jobs/customer-challenge-lead",
    title: "Customer Challenge Lead | Example Corp",
    heading: "Customer Challenge Lead",
    text: [
      "Job description",
      "Responsibilities",
      "Qualifications",
      "This is a full-time role with benefits.",
      "Apply now",
    ].join("\n"),
    httpStatus: 200,
  });

  assert.equal(assessment.acquisitionStatus, "usable");
  assert.equal(assessment.documentType, "job_post");
});

test("source classifier rejects a blog template that happens to discuss remote-work requirements and benefits", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl: "https://example.com/blog/remote-work-guide",
    finalUrl: "https://example.com/blog/remote-work-guide",
    title: "A Practical Guide to Remote Work | Example Blog",
    heading: "A Practical Guide to Remote Work",
    text: [
      "Home · Products · Blog · Contact",
      "A Practical Guide to Remote Work",
      "This article explains the technical requirements for distributed teams.",
      "It also reviews the benefits of remote collaboration and secure access.",
      "Subscribe for future articles.",
    ].join("\n"),
    httpStatus: 200,
  });

  assert.equal(assessment.acquisitionStatus, "not_job");
  assert.equal(assessment.documentType, "unknown");
  assert.equal(assessment.eligibleForRoleTerms, false);
});

test("source classifier does not treat an article about the role of technology as a hiring message", async () => {
  const { quality } = await pipelineModules();
  const assessment = quality.assessSource({
    kind: "url",
    requestedUrl: "https://example.com/insights/technology-in-healthcare",
    finalUrl: "https://example.com/insights/technology-in-healthcare",
    title: "The Role of Technology in Modern Healthcare",
    heading: "About the role of technology in modern healthcare",
    text: [
      "The role of technology in modern healthcare continues to grow.",
      "This research article covers patient outcomes, security, and operations.",
      "Read our other insights and subscribe to the newsletter.",
    ].join("\n"),
    httpStatus: 200,
  });

  assert.equal(assessment.acquisitionStatus, "not_job");
  assert.equal(assessment.eligibleForRoleTerms, false);
});

test("source classifier excludes job-looking 404 and 500 response bodies", async (t) => {
  const { quality } = await pipelineModules();
  for (const status of [404, 500]) {
    await t.test(`HTTP ${status}`, () => {
      const assessment = quality.assessSource({
        kind: "url",
        requestedUrl: "https://careers.example.com/jobs/missing",
        finalUrl: "https://careers.example.com/jobs/missing",
        title: status === 404 ? "Job not found" : "Server error",
        heading: "Senior Product Manager",
        text: [
          "Job description",
          "Responsibilities and qualifications",
          "This is a full-time remote role.",
          "Apply now",
        ].join("\n"),
        httpStatus: status,
      });

      assert.equal(assessment.acquisitionStatus, "error");
      assert.equal(assessment.documentType, "unknown");
      assert.equal(assessment.eligibleForRoleTerms, false);
      assert.match(assessment.diagnostics.join(" "), new RegExp(String(status)));
    });
  }
});

test("generic extractor never turns an explicit remote negation into Remote", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Director of Operations",
    "Job description",
    "This is not a remote role. Work is required in office.",
    "Responsibilities and qualifications follow.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const workMode = assertionByField(assertions, "work_mode");

  assert.ok(workMode, "an explicit work-mode statement should be extracted");
  assert.equal(workMode.normalizedValue, "not-remote");
  assert.equal(workMode.displayValue, "Not remote");
  assert.equal(
    assertions.some(
      (item) => item.field === "work_mode" && item.normalizedValue === "remote",
    ),
    false,
  );
});

test("generic extractor handles remote negation expressed as ineligibility", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Finance Manager",
    "Job description and responsibilities",
    "This position is not eligible for remote work.",
    "Employees must work in office five days per week.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const workMode = assertionByField(assertions, "work_mode");

  assert.ok(workMode, "an explicit remote exclusion should be extracted");
  assert.notEqual(workMode.normalizedValue, "remote");
  assert.match(workMode.displayValue, /not remote|onsite/i);
});

test("generic extractor treats rejected remote candidates as an explicit remote exclusion", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Plant Operations Manager",
    "Job description and responsibilities",
    "Remote candidates are not accepted for this position.",
    "The successful candidate will work at the manufacturing site.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const workMode = assertionByField(assertions, "work_mode");

  assert.ok(workMode);
  assert.equal(workMode.normalizedValue, "not-remote");
  assert.equal(workMode.displayValue, "Not remote");
});

test("generic extractor distinguishes company-wide remote employees from an onsite role", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Facilities Director",
    "Job description and requirements",
    "The company has remote employees, but this position is onsite.",
    "The role reports to our Virginia office.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const workMode = assertionByField(assertions, "work_mode");

  assert.ok(workMode);
  assert.equal(workMode.normalizedValue, "onsite");
  assert.equal(workMode.displayValue, "Onsite");
  assert.equal(
    assertions.some(
      (item) => item.field === "work_mode" && item.normalizedValue === "remote",
    ),
    false,
  );
});

test("generic extractor ignores a negated hybrid mention when fully remote is explicit", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Product Operations Lead",
    "Job description and responsibilities",
    "This is not a hybrid role; the position is fully remote.",
    "Applicants may work from anywhere in the United States.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const workMode = assertionByField(assertions, "work_mode");

  assert.ok(workMode);
  assert.equal(workMode.normalizedValue, "remote");
  assert.equal(workMode.displayValue, "Remote");
});

test("generic extractor preserves a salary range and annual basis", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Senior Product Manager",
    "Job description and responsibilities",
    "Salary range: $120,000–$150,000 per year.",
    "This is a full-time remote position.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const compensation = assertionByField(assertions, "compensation_basis");

  assert.ok(compensation);
  assert.equal(compensation.normalizedValue, "usd-120000-150000-per-year");
  assert.equal(compensation.displayValue, "$120,000–$150,000 per year");
  assert.match(compensation.quote, /\$120,000–\$150,000 per year/);
});

test("generic extractor handles a natural $85/hour six-month W-2 contract", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Technical Program Manager",
    "Job description and requirements",
    "This is a six-month W-2 contract paying $85/hour.",
    "The position is fully remote.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));

  assert.equal(
    assertionByField(assertions, "compensation_basis")?.displayValue,
    "$85 per hour",
  );
  assert.equal(assertionByField(assertions, "duration")?.displayValue, "6 months");
  assert.equal(assertionByField(assertions, "employment_type")?.displayValue, "W-2 contract");
});

test("generic extractor handles a labeled contract duration with the noun first", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Cloud Program Manager",
    "Job description and requirements",
    "Contract duration: 6 months",
    "Employment type: W-2 contract",
    "Compensation: $90/hour",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));

  assert.equal(assertionByField(assertions, "duration")?.displayValue, "6 months");
  assert.equal(
    assertionByField(assertions, "employment_type")?.displayValue,
    "W-2 contract",
  );
});

test("generic extractor abstains when a bachelor's degree is preferred but explicitly not required", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Customer Success Manager",
    "Job description and qualifications",
    "A bachelor's degree is preferred but not required.",
    "Equivalent practical experience is welcomed.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));

  assert.equal(assertionByField(assertions, "education_required"), undefined);
});

test("generic extractor selects the required experience rather than a larger preferred value", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "Job title: Program Manager",
    "Job description and requirements",
    "Five years experience preferred; 2 years experience required.",
    "Apply now",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const experience = assertionByField(assertions, "experience_required");

  assert.ok(experience);
  assert.equal(experience.displayValue, "2 years experience");
  assert.match(experience.rawValue, /^2 years experience$/i);
});

test("screenshot extractor infers diverse role headings when company and role occupy separate lines", async (t) => {
  const { extractor } = await pipelineModules();
  const layouts = [
    ["Product Owner", "Job Description"],
    ["VP of Sales", "Responsibilities"],
    ["Head of Growth", "Position Summary"],
    ["Customer Success Lead", "Qualifications"],
    ["UX Researcher", "About the Role"],
  ];

  for (const [role, section] of layouts) {
    await t.test(role, () => {
      const text = [
        "Northstar Systems, Inc.",
        role,
        "Remote",
        "Full-time",
        section,
        "Build and improve products for customers.",
      ].join("\n");
      const assertions = extractor.extractJobCandidates(
        usableCapture(text, {
          kind: "screenshot",
          label: `${role}.png`,
          publisher: "Uploaded screenshot",
          author: "User-provided evidence",
          authority: "direct",
        }),
      );

      assert.equal(
        assertionByField(assertions, "company_name")?.displayValue,
        "Northstar Systems, Inc.",
      );
      const extractedRole = assertionByField(assertions, "role_title");
      assert.ok(extractedRole, `${role} should be inferred from its OCR heading`);
      assert.equal(extractedRole.displayValue, role);
      assert.match(extractedRole.location, /OCR heading|OCR text/i);
    });
  }
});

test("hiring-language extraction stops the role title before 'to join'", async () => {
  const { extractor } = await pipelineModules();
  const text = [
    "We're hiring a Senior Product Owner to join our platform team.",
    "Job description and responsibilities",
    "This is a full-time remote role.",
  ].join("\n");
  const assertions = extractor.extractJobCandidates(usableCapture(text));
  const role = assertionByField(assertions, "role_title");

  assert.ok(role);
  assert.equal(role.displayValue, "Senior Product Owner");
  assert.equal(role.normalizedValue, "senior-product-owner");
  assert.doesNotMatch(role.rawValue, /to join/i);
});

test("JSON-LD JobPosting data produces generic, source-linked candidate values", async () => {
  const { extractor } = await pipelineModules();
  const scripts = [
    JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Unrelated node" },
        {
          "@type": ["Thing", "JobPosting"],
          title: "Principal AI Product Manager",
          hiringOrganization: {
            "@type": "Organization",
            name: "Example Systems, Inc.",
          },
          jobLocationType: "TELECOMMUTE",
          applicantLocationRequirements: {
            "@type": "Country",
            name: "United States",
          },
          employmentType: ["FULL_TIME", "W2"],
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "USD",
            value: {
              "@type": "QuantitativeValue",
              minValue: 170000,
              maxValue: 210000,
              unitText: "YEAR",
            },
          },
          validThrough: "2026-10-31",
          description: "<p>Lead the AI product portfolio.</p>",
        },
      ],
    }),
    "{ malformed json-ld",
  ];
  const jobs = extractor.parseStructuredJobScripts(scripts);

  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    title: "Principal AI Product Manager",
    companyName: "Example Systems, Inc.",
    workMode: "Remote",
    employmentType: "FULL_TIME · W2",
    location: "Remote — United States",
    salary: "$170,000–$210,000 per year",
    validThrough: "2026-10-31",
    description: "Lead the AI product portfolio.",
  });

  const sealedText = extractor.structuredJobsToSealedText(jobs);
  const assertions = extractor.extractJobCandidates(
    usableCapture(sealedText, { structuredJobs: jobs }),
  );
  assert.equal(assertionByField(assertions, "role_title")?.displayValue, jobs[0].title);
  assert.equal(
    assertionByField(assertions, "company_name")?.displayValue,
    jobs[0].companyName,
  );
  assert.equal(assertionByField(assertions, "work_mode")?.displayValue, "Remote");
  assert.equal(
    assertionByField(assertions, "job_location")?.displayValue,
    "Remote — United States",
  );
  assert.equal(
    assertionByField(assertions, "compensation_basis")?.displayValue,
    "$170,000–$210,000 per year",
  );
});

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNW4gAAAAASUVORK5CYII=",
  "base64",
);

function screenshotFile(name = "job.png", bytes = onePixelPng, type = "image/png") {
  return new File([bytes], name, { type });
}

function multipartRequest({ urls = [], screenshots = [] } = {}) {
  const form = new FormData();
  form.set("urls", JSON.stringify(urls));
  screenshots.forEach((file) => form.append("screenshots", file));
  return new Request("http://roletruth.test/api/solari/analyze", {
    method: "POST",
    body: form,
  });
}

test("multipart intake accepts screenshot-only evidence and trusts magic bytes, not the declared MIME", async () => {
  const { intake } = await pipelineModules();
  const request = multipartRequest({
    screenshots: [screenshotFile("role-evidence.bin", onePixelPng, "text/plain")],
  });
  const parsed = await intake.parseEvidenceRequest(request);

  assert.deepEqual(parsed.urls, []);
  assert.equal(parsed.screenshots.length, 1);
  assert.equal(parsed.screenshots[0].name, "role-evidence.bin");
  assert.equal(parsed.screenshots[0].mimeType, "image/png");
  assert.equal(
    parsed.screenshots[0].sha256,
    createHash("sha256").update(onePixelPng).digest("hex"),
  );
});

test("multipart intake rejects declared images with invalid image bytes", async () => {
  const { intake } = await pipelineModules();
  const request = multipartRequest({
    screenshots: [screenshotFile("fake.png", Buffer.from("not an image"))],
  });

  await assert.rejects(
    intake.parseEvidenceRequest(request),
    /not a valid PNG, JPEG, or WebP image/i,
  );
});

test("multipart intake rejects empty submissions and more than eight screenshots", async () => {
  const { intake } = await pipelineModules();
  await assert.rejects(
    intake.parseEvidenceRequest(multipartRequest()),
    /at least one public URL or screenshot/i,
  );

  const tooMany = Array.from({ length: 9 }, (_, index) =>
    screenshotFile(`page-${index + 1}.png`),
  );
  await assert.rejects(
    intake.parseEvidenceRequest(multipartRequest({ screenshots: tooMany })),
    /at most 8 screenshots/i,
  );
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function runReconciler(script, captureSpecs) {
  const directory = await mkdtemp(join(tmpdir(), "roletruth-reconcile-"));
  try {
    const captures = [];
    for (const [index, spec] of captureSpecs.entries()) {
      const imageBytes = spec.imageBytes ?? Buffer.from(`sealed-image-${index + 1}`);
      const imagePath = join(directory, `source-${index + 1}.png`);
      await writeFile(imagePath, imageBytes);
      const { imageBytes: _imageBytes, ...serializable } = spec;
      void _imageBytes;
      captures.push({
        sourceId: `src-${index + 1}`,
        kind: "url",
        label: `Source ${index + 1}`,
        publisher: "jobs.example.com",
        author: "Captured source",
        authority: "official",
        capturedAt: "2026-09-01T12:00:00.000Z",
        sealedText: "",
        acquisitionStatus: "usable",
        documentType: "job_post",
        eligibleForRoleTerms: true,
        diagnostics: [],
        candidateAssertions: [],
        ...serializable,
        imagePath,
        screenshotSha256:
          serializable.screenshotSha256 ?? sha256(imageBytes),
        textSha256:
          serializable.textSha256 ?? sha256(serializable.sealedText ?? ""),
      });
    }

    const scriptPath = join(directory, "reconcile.py");
    const inputPath = join(directory, "input.json");
    const outputPath = join(directory, "output.json");
    await Promise.all([
      writeFile(scriptPath, script, "utf8"),
      writeFile(inputPath, JSON.stringify(captures), "utf8"),
    ]);
    await execFileAsync("python3", [scriptPath, inputPath, outputPath], {
      timeout: 15_000,
    });
    return JSON.parse(await readFile(outputPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function candidate(field, quote, normalizedValue, displayValue) {
  return {
    field,
    rawValue: quote,
    normalizedValue,
    displayValue,
    quote,
    location: "Adversarial fixture",
  };
}

test("Sandbox reconciler cannot promote assertions from a blocked challenge page", async () => {
  const { reconcile } = await pipelineModules();
  const sealedText = "Just a moment... Remote role. Job title: Fake Administrator";
  const report = await runReconciler(reconcile.SOLARI_RECONCILE_SCRIPT, [
    {
      label: "Just a moment...",
      finalUrl: "https://example.com/login?reason=bot-detection",
      sealedText,
      acquisitionStatus: "blocked",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: ["A bot challenge was captured."],
      candidateAssertions: [
        candidate("work_mode", "Remote role", "remote", "Remote"),
        candidate(
          "role_title",
          "Job title: Fake Administrator",
          "fake-administrator",
          "Fake Administrator",
        ),
      ],
    },
  ]);

  assert.equal(report.analysisStatus, "insufficient");
  assert.equal(report.sources[0].acquisitionStatus, "blocked");
  assert.equal(report.sources[0].eligibleForRoleTerms, false);
  assert.deepEqual(report.assertions, []);
  assert.deepEqual(report.evidence, []);
  assert.equal(
    report.findings.find((finding) => finding.field === "role_title").status,
    "unknown",
  );
});

test("Sandbox reconciler preserves company-profile context without inventing a role", async () => {
  const { reconcile } = await pipelineModules();
  const sealedText = "NIFCO America Corp\nCompany Snapshot\n57% approve of CEO";
  const report = await runReconciler(reconcile.SOLARI_RECONCILE_SCRIPT, [
    {
      kind: "screenshot",
      label: "NIFCO America Corp Snapshot",
      sealedText,
      acquisitionStatus: "not_job",
      documentType: "company_profile",
      eligibleForRoleTerms: false,
      diagnostics: ["This is company context rather than a job posting."],
      candidateAssertions: [
        candidate(
          "company_name",
          "NIFCO America Corp",
          "nifco-america-corp",
          "NIFCO America Corp",
        ),
      ],
    },
  ]);

  const company = report.findings.find(
    (finding) => finding.field === "company_name",
  );
  const role = report.findings.find((finding) => finding.field === "role_title");
  assert.equal(report.analysisStatus, "insufficient");
  assert.equal(company.status, "confirmed");
  assert.equal(company.conclusion, "NIFCO America Corp");
  assert.equal(role.status, "unknown");
  assert.equal(report.subject.companyName, "NIFCO America Corp");
  assert.equal(report.subject.roleTitle, null);
});

test("Sandbox reconciler exposes URL-versus-screenshot work-mode conflict with both spans", async () => {
  const { reconcile } = await pipelineModules();
  const report = await runReconciler(reconcile.SOLARI_RECONCILE_SCRIPT, [
    {
      sealedText: "This is a Remote role.",
      candidateAssertions: [
        candidate("work_mode", "Remote role", "remote", "Remote"),
      ],
    },
    {
      kind: "screenshot",
      label: "Recruiter clarification.png",
      publisher: "Uploaded screenshot",
      authority: "direct",
      sealedText: "The current schedule is Hybrid.",
      candidateAssertions: [
        candidate("work_mode", "Hybrid", "hybrid", "Hybrid"),
      ],
    },
  ]);

  const workMode = report.findings.find(
    (finding) => finding.field === "work_mode",
  );
  assert.equal(report.analysisStatus, "complete");
  assert.equal(workMode.status, "conflicted");
  assert.match(workMode.conclusion, /Remote/);
  assert.match(workMode.conclusion, /Hybrid/);
  assert.equal(workMode.evidenceIds.length, 2);
  assert.equal(report.evidence.length, 2);
  assert.deepEqual(
    new Set(report.evidence.map((span) => span.sourceId)),
    new Set(["src-1", "src-2"]),
  );
});

test("Sandbox reconciler rejects a usable source when either integrity receipt is wrong", async () => {
  const { reconcile } = await pipelineModules();
  const sealedText = "This is a Remote role.";
  const report = await runReconciler(reconcile.SOLARI_RECONCILE_SCRIPT, [
    {
      sealedText,
      textSha256: "0".repeat(64),
      candidateAssertions: [
        candidate("work_mode", "Remote role", "remote", "Remote"),
      ],
    },
  ]);

  assert.equal(report.analysisStatus, "insufficient");
  assert.equal(report.sources[0].acquisitionStatus, "error");
  assert.equal(report.sources[0].eligibleForRoleTerms, false);
  assert.deepEqual(report.assertions, []);
  assert.match(report.diagnostics.join(" "), /text hash did not match/i);
});

test("Sandbox verifier rejects a source-backed quote whose proposed value contradicts the quote", async () => {
  const { reconcile } = await pipelineModules();
  const sealedText = "Job title: Site Reliability Engineer\nWork mode: Onsite";
  const report = await runReconciler(reconcile.SOLARI_RECONCILE_SCRIPT, [
    {
      sealedText,
      candidateAssertions: [
        {
          field: "work_mode",
          rawValue: "Onsite",
          normalizedValue: "remote",
          displayValue: "Remote",
          quote: "Work mode: Onsite",
          location: "Adversarial value-fidelity fixture",
        },
      ],
    },
  ]);

  const workMode = report.findings.find(
    (finding) => finding.field === "work_mode",
  );
  assert.equal(workMode.status, "unknown");
  assert.equal(workMode.evidenceIds.length, 0);
  assert.deepEqual(report.assertions, []);
  assert.deepEqual(report.evidence, []);
  assert.match(
    report.diagnostics.join(" "),
    /value|semantic|contradict|unsupported/i,
  );
});

test("TypeScript extraction and Sandbox verification agree on common remote exclusions", async (t) => {
  const { extractor, reconcile } = await pipelineModules();
  for (const phrase of [
    "Employees cannot work remotely.",
    "This employer does not allow remote work for this position.",
  ]) {
    await t.test(phrase, async () => {
      const sealedText = [
        "Job title: Site Operations Manager",
        "Job description and requirements",
        phrase,
      ].join("\n");
      const extracted = extractor.extractJobCandidates(
        usableCapture(sealedText),
      );
      const candidateWorkMode = assertionByField(extracted, "work_mode");
      assert.equal(candidateWorkMode?.normalizedValue, "not-remote");

      const report = await runReconciler(reconcile.SOLARI_RECONCILE_SCRIPT, [
        {
          sealedText,
          candidateAssertions: extracted,
        },
      ]);
      const workMode = report.findings.find(
        (finding) => finding.field === "work_mode",
      );
      assert.equal(workMode.status, "confirmed");
      assert.equal(workMode.conclusion, "Not remote");
      assert.equal(workMode.evidenceIds.length, 1);
    });
  }
});

test("word/digit experience and W2/W-2 spellings remain compatible across sources", async () => {
  const { extractor, reconcile } = await pipelineModules();
  const texts = [
    [
      "Job title: Delivery Lead",
      "Job description and requirements",
      "Minimum five years experience.",
      "Employment type: W2 contract",
    ].join("\n"),
    [
      "Job title: Delivery Lead",
      "Job description and requirements",
      "5 years experience required.",
      "Employment type: W-2 contract",
    ].join("\n"),
  ];
  const extracted = texts.map((text) =>
    extractor.extractJobCandidates(usableCapture(text)),
  );

  for (const assertions of extracted) {
    assert.equal(
      assertionByField(assertions, "experience_required")?.normalizedValue,
      "5-years-experience",
    );
    assert.equal(
      assertionByField(assertions, "employment_type")?.normalizedValue,
      "w2-contract",
    );
  }

  const report = await runReconciler(reconcile.SOLARI_RECONCILE_SCRIPT, [
    { sealedText: texts[0], candidateAssertions: extracted[0] },
    {
      kind: "screenshot",
      label: "Recruiter terms.png",
      publisher: "Uploaded screenshot",
      authority: "direct",
      sealedText: texts[1],
      candidateAssertions: extracted[1],
    },
  ]);
  const experience = report.findings.find(
    (finding) => finding.field === "experience_required",
  );
  const employment = report.findings.find(
    (finding) => finding.field === "employment_type",
  );
  assert.equal(experience.status, "confirmed");
  assert.equal(experience.conclusion, "5 years experience");
  assert.equal(experience.evidenceIds.length, 2);
  assert.equal(employment.status, "confirmed");
  assert.equal(employment.conclusion, "W-2 contract");
  assert.equal(employment.evidenceIds.length, 2);
});
