import type { LiveCaptureData } from "./job-extractor";
import type { IdentityMatch } from "./roletruth-engine";
import { validatePublicUrl } from "./url-security";

export const MAX_DISCOVERY_QUERIES = 3;
export const MAX_DISCOVERY_CAPTURES = 4;
export const MAX_RESULTS_PER_QUERY = 20;

const SEARCH_HOSTS = new Set([
  "bing.com",
  "www.bing.com",
  "duckduckgo.com",
  "html.duckduckgo.com",
  "google.com",
  "www.google.com",
]);

const KNOWN_JOB_HOST_MARKERS = [
  "ashbyhq.com",
  "glassdoor.",
  "greenhouse.io",
  "indeed.",
  "jobvite.com",
  "lever.co",
  "linkedin.",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "workdayjobs.com",
  "ziprecruiter.",
];

const STABLE_JOB_ID_KEYS = new Set([
  "gh_jid",
  "id",
  "job",
  "job_id",
  "jobid",
  "jid",
  "jk",
  "positionid",
  "req",
  "reqid",
  "requisitionid",
]);

const TRACKING_KEYS = [
  /^utm_/i,
  /^trk$/i,
  /^tracking/i,
  /^ref$/i,
  /^referrer$/i,
  /^source$/i,
  /^campaign$/i,
  /^session$/i,
  /^token$/i,
  /^access[_-]?token$/i,
  /^invite/i,
  /^email$/i,
];

const ROLE_NOUNS = new Set([
  "accountant",
  "administrator",
  "analyst",
  "architect",
  "consultant",
  "coordinator",
  "designer",
  "developer",
  "director",
  "engineer",
  "executive",
  "intern",
  "lead",
  "manager",
  "owner",
  "recruiter",
  "scientist",
  "specialist",
  "technician",
]);

const TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "careers",
  "career",
  "company",
  "corp",
  "corporation",
  "for",
  "inc",
  "job",
  "jobs",
  "llc",
  "ltd",
  "of",
  "position",
  "role",
  "the",
  "view",
]);

export interface DiscoverySeed {
  startingUrl: string;
  safeStartingUrl: string;
  sourceHost: string;
  roleTitle: string | null;
  companyName: string | null;
  jobId: string | null;
}

export interface DiscoveryQuery {
  id: string;
  query: string;
  reason: string;
}

export interface SearchAnchor {
  href: string;
  title: string;
  snippet: string;
}

export interface SearchCandidate extends SearchAnchor {
  url: string;
  queryId: string;
  rank: number;
  score: number;
  reason: string;
}

export interface CaptureIdentityAssessment {
  match: IdentityMatch;
  eligible: boolean;
  diagnostic: string;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedTokens(value: string | null | undefined) {
  if (!value) return [];
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length > 1 &&
            !TOKEN_STOPWORDS.has(token) &&
            !/^\d+$/.test(token),
        ),
    ),
  ];
}

function tokenCoverage(needle: string | null, haystack: string) {
  const expected = normalizedTokens(needle);
  if (expected.length === 0) return 0;
  const actual = new Set(normalizedTokens(haystack));
  return expected.filter((token) => actual.has(token)).length / expected.length;
}

function valueForField(capture: LiveCaptureData, field: string) {
  return (
    capture.candidateAssertions?.find((candidate) => candidate.field === field)
      ?.displayValue ?? null
  );
}

function stripSensitiveQuery(parsed: URL) {
  for (const key of [...parsed.searchParams.keys()]) {
    if (
      !STABLE_JOB_ID_KEYS.has(key.toLowerCase()) ||
      TRACKING_KEYS.some((pattern) => pattern.test(key))
    ) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hash = "";
  return parsed;
}

export function sanitizeJobUrlForSearch(value: string) {
  const parsed = new URL(validatePublicUrl(value));
  stripSensitiveQuery(parsed);
  return parsed.toString();
}

export function canonicalCandidateUrl(value: string) {
  const parsed = new URL(validatePublicUrl(value));
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_KEYS.some((pattern) => pattern.test(key))) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }
  return parsed.toString();
}

export function extractStableJobId(value: string) {
  const parsed = new URL(value);
  for (const [key, raw] of parsed.searchParams) {
    if (
      STABLE_JOB_ID_KEYS.has(key.toLowerCase()) &&
      /^[a-z0-9_-]{5,80}$/i.test(raw) &&
      /\d/.test(raw)
    ) {
      return raw;
    }
  }
  const pathMatches = [
    /\b(?:jobs?|positions?|requisitions?|req)[\/_-]([a-z0-9_-]{5,80})/i,
    /\b(?:view|listing)[\/_-]([a-z0-9_-]{5,80})/i,
    /\b([a-z]{0,4}\d{5,}[a-z0-9_-]*)\b/i,
  ];
  for (const pattern of pathMatches) {
    const match = pattern.exec(decodeURIComponent(parsed.pathname));
    if (match?.[1] && /\d/.test(match[1])) return match[1];
  }
  return null;
}

export function inferRoleFromJobUrl(value: string) {
  const parsed = new URL(value);
  const path = decodeURIComponent(parsed.pathname).toLowerCase();
  if (/\b(?:overview|company|working-at|employers?)\b/.test(path)) return null;
  const isJobPath =
    /\b(?:job|jobs|career|careers|position|positions|listing|view)\b/.test(
      path.replace(/[^a-z]+/g, " "),
    ) || KNOWN_JOB_HOST_MARKERS.some((marker) => parsed.hostname.includes(marker));
  if (!isJobPath) return null;

  const candidates = parsed.pathname
    .split("/")
    .map((segment) =>
      compact(
        decodeURIComponent(segment)
          .replace(/[-_]+/g, " ")
          .replace(/\b(?:JV|JR|REQ|ID)[a-z0-9_-]*\b/gi, " ")
          .replace(/\b\d{4,}\b/g, " "),
      ),
    )
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const candidate = candidates.find((item) => {
    const tokens = normalizedTokens(item);
    return (
      tokens.length >= 2 &&
      tokens.length <= 10 &&
      tokens.some((token) => ROLE_NOUNS.has(token))
    );
  });
  if (!candidate) return null;
  return candidate.replace(/\b(?:job|jobs|listing|view)\b/gi, " ").replace(/\s+/g, " ").trim();
}

export function buildDiscoverySeed(captures: LiveCaptureData[]): DiscoverySeed {
  const submitted = captures.find(
    (capture) => capture.kind === "url" && capture.requestedUrl,
  );
  if (!submitted?.requestedUrl) {
    throw new Error("Evidence discovery requires a submitted public URL.");
  }
  const roleTitle =
    captures.map((capture) => valueForField(capture, "role_title")).find(Boolean) ??
    inferRoleFromJobUrl(submitted.requestedUrl);
  const companyName =
    captures
      .map((capture) => valueForField(capture, "company_name"))
      .find(Boolean) ?? null;
  const safeStartingUrl = sanitizeJobUrlForSearch(submitted.requestedUrl);
  return {
    startingUrl: submitted.requestedUrl,
    safeStartingUrl,
    sourceHost: new URL(submitted.requestedUrl).hostname.toLowerCase(),
    roleTitle: roleTitle || null,
    companyName,
    jobId: extractStableJobId(safeStartingUrl),
  };
}

export function buildDiscoveryQueries(seed: DiscoverySeed) {
  const proposals: Array<Omit<DiscoveryQuery, "id">> = [];
  if (seed.jobId) {
    proposals.push({
      query: `"${seed.jobId}" ${seed.companyName ? `"${seed.companyName}" ` : ""}job`,
      reason: "Find the same stable job or requisition identifier.",
    });
  }
  proposals.push({
    query: `"${seed.safeStartingUrl}"`,
    reason: "Find indexed copies and references to the submitted job URL.",
  });
  if (seed.roleTitle && seed.companyName) {
    proposals.push({
      query: `"${seed.roleTitle}" "${seed.companyName}" job`,
      reason: "Find employer and third-party pages for the same named opening.",
    });
  } else if (seed.roleTitle) {
    proposals.push({
      query: `"${seed.roleTitle}" job ${seed.sourceHost}`,
      reason: "Find pages matching the role encoded in the job URL.",
    });
  }

  return proposals
    .filter(
      (proposal, index, all) =>
        all.findIndex((item) => item.query === proposal.query) === index,
    )
    .slice(0, MAX_DISCOVERY_QUERIES)
    .map((proposal, index) => ({
      ...proposal,
      id: `Q${String(index + 1).padStart(2, "0")}`,
    }));
}

function unwrapSearchRedirect(value: string, baseUrl: string) {
  const parsed = new URL(value, baseUrl);
  const host = parsed.hostname.toLowerCase();
  if (host.includes("duckduckgo.com")) {
    const target = parsed.searchParams.get("uddg");
    if (target) return decodeURIComponent(target);
  }
  if (host.includes("google.com") && parsed.pathname === "/url") {
    return parsed.searchParams.get("q") ?? parsed.searchParams.get("url") ?? value;
  }
  return parsed.toString();
}

function looksLikeJobUrl(value: string) {
  const parsed = new URL(value);
  return (
    KNOWN_JOB_HOST_MARKERS.some((marker) => parsed.hostname.includes(marker)) ||
    /\/(?:job|jobs|career|careers|position|positions|requisition|vacancy|opening)(?:\/|-|_)/i.test(
      parsed.pathname,
    ) ||
    [...parsed.searchParams.keys()].some((key) =>
      STABLE_JOB_ID_KEYS.has(key.toLowerCase()),
    )
  );
}

export function rankSearchCandidates(
  anchors: SearchAnchor[],
  queryId: string,
  seed: DiscoverySeed,
  excludedUrls: string[],
) {
  const excluded = new Set(
    excludedUrls.map((url) => {
      try {
        return canonicalCandidateUrl(url);
      } catch {
        return url;
      }
    }),
  );
  const candidates: SearchCandidate[] = [];
  for (const [index, anchor] of anchors.slice(0, 200).entries()) {
    let url: string;
    try {
      url = canonicalCandidateUrl(
        unwrapSearchRedirect(anchor.href, "https://html.duckduckgo.com/"),
      );
    } catch {
      continue;
    }
    const host = new URL(url).hostname.toLowerCase();
    if (SEARCH_HOSTS.has(host) || excluded.has(url)) continue;
    const searchable = `${anchor.title} ${anchor.snippet} ${url}`;
    const idMatch = Boolean(seed.jobId && searchable.includes(seed.jobId));
    const roleCoverage = tokenCoverage(seed.roleTitle, searchable);
    const companyCoverage = tokenCoverage(seed.companyName, searchable);
    const jobSignal = looksLikeJobUrl(url);
    const strongRole = Boolean(
      seed.roleTitle && normalizedTokens(seed.roleTitle).length >= 2 && roleCoverage >= 0.8,
    );
    const strongCompany = Boolean(seed.companyName && companyCoverage >= 0.5);
    const eligibleLead = seed.jobId
      ? idMatch || (strongRole && strongCompany)
      : seed.roleTitle && seed.companyName
        ? strongRole && strongCompany
        : seed.roleTitle
          ? strongRole && jobSignal
          : false;
    if (!eligibleLead) continue;
    const score =
      (idMatch ? 100 : 0) +
      Math.round(roleCoverage * 35) +
      Math.round(companyCoverage * 25) +
      (jobSignal ? 15 : 0) +
      (host === seed.sourceHost ? 8 : 0) -
      Math.min(index, 20);
    candidates.push({
      ...anchor,
      url,
      queryId,
      rank: index + 1,
      score,
      reason: idMatch
        ? "Stable job ID matched."
        : strongRole && strongCompany
          ? "Role and company matched."
          : "Role terms and a job-page URL matched.",
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .filter(
      (candidate, index, all) =>
        all.findIndex((item) => item.url === candidate.url) === index,
    )
    .slice(0, MAX_RESULTS_PER_QUERY);
}

export function assessCaptureIdentity(
  capture: LiveCaptureData,
  seed: DiscoverySeed,
): CaptureIdentityAssessment {
  if ((capture.structuredJobs?.length ?? 0) > 1) {
    return {
      match: "ambiguous",
      eligible: false,
      diagnostic:
        "The discovered page contains multiple JobPosting records and cannot be tied to one opening.",
    };
  }
  const searchable = `${capture.finalUrl ?? ""} ${capture.sealedText}`;
  if (seed.jobId && searchable.includes(seed.jobId)) {
    return {
      match: "exact-job-id",
      eligible: capture.acquisitionStatus === "usable",
      diagnostic: "The stable job identifier matches the submitted opening.",
    };
  }
  const role = valueForField(capture, "role_title");
  const company = valueForField(capture, "company_name");
  const roleCoverage = tokenCoverage(seed.roleTitle, role ?? "");
  const companyCoverage = tokenCoverage(seed.companyName, company ?? "");
  const roleMatch = Boolean(seed.roleTitle && role && roleCoverage >= 0.8);
  const companyMatch = Boolean(
    seed.companyName && company && companyCoverage >= 0.5,
  );
  if (roleMatch && companyMatch) {
    return {
      match: "role-company",
      eligible: capture.acquisitionStatus === "usable",
      diagnostic: "The discovered page matches both the role and company.",
    };
  }
  if (roleMatch && !seed.companyName && normalizedTokens(seed.roleTitle).length >= 3) {
    return {
      match: "role-only",
      eligible: capture.acquisitionStatus === "usable",
      diagnostic:
        "The discovered page exactly matches the specific role encoded in the submitted URL.",
    };
  }
  if (!seed.roleTitle && !seed.jobId) {
    return {
      match: "ambiguous",
      eligible: false,
      diagnostic:
        "The submitted URL did not identify a specific role or stable job ID, so discovered openings were not merged automatically.",
    };
  }
  return {
    match: "mismatch",
    eligible: false,
    diagnostic:
      "The discovered page could not be tied to the same company and role as the submitted opening.",
  };
}

export function deduplicateCandidates(candidates: SearchCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}
