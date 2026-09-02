import type {
  AcquisitionStatus,
  DocumentType,
  EvidenceOrigin,
  IdentityMatch,
  SourceKind,
} from "./roletruth-engine";

export interface StructuredJobPosting {
  title?: string;
  companyName?: string;
  workMode?: string;
  employmentType?: string;
  location?: string;
  salary?: string;
  validThrough?: string;
  description?: string;
}

export interface CandidateAssertion {
  field: string;
  rawValue: string;
  normalizedValue: string;
  displayValue: string;
  quote: string;
  location: string;
}

export interface LiveCaptureData {
  sourceId: string;
  kind: Exclude<SourceKind, "synthetic">;
  label: string;
  publisher: string;
  author: string;
  authority: "direct" | "official" | "third-party" | "unclassified";
  requestedUrl?: string;
  finalUrl?: string;
  capturedAt: string;
  sealedText: string;
  textSha256: string;
  screenshotSha256: string;
  browserSessionId?: string;
  acquisitionStatus: AcquisitionStatus;
  documentType: DocumentType;
  eligibleForRoleTerms: boolean;
  diagnostics: string[];
  httpStatus?: number | null;
  ocrConfidence?: number;
  origin?: EvidenceOrigin;
  discoveredVia?: string;
  searchRank?: number;
  identityMatch?: IdentityMatch;
  imagePath?: string;
  structuredJobs?: StructuredJobPosting[];
  candidateAssertions?: CandidateAssertion[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (record && typeof record.name === "string") return record.name.trim();
  return undefined;
}

function collectJobPostingNodes(value: unknown, output: unknown[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJobPostingNodes(item, output));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const rawType = record["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  if (types.some((item) => String(item).toLowerCase() === "jobposting")) {
    output.push(record);
  }
  if (record["@graph"]) collectJobPostingNodes(record["@graph"], output);
}

function formatLocation(value: unknown) {
  const locations = Array.isArray(value) ? value : [value];
  const formatted = locations
    .map((item) => {
      const location = asRecord(item);
      const address = asRecord(location?.address);
      if (!address) return textValue(item);
      return [
        textValue(address.addressLocality),
        textValue(address.addressRegion),
        textValue(address.addressCountry),
      ]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean);
  return [...new Set(formatted)].join(" · ") || undefined;
}

function formatSalary(value: unknown) {
  const salary = asRecord(value);
  if (!salary) return undefined;
  const rawCurrency = (textValue(salary.currency) ?? "USD").toUpperCase();
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : "USD";
  const amount = asRecord(salary.value) ?? salary;
  const min = Number(amount.minValue ?? amount.value);
  const max = Number(amount.maxValue ?? amount.value);
  const unit = textValue(amount.unitText)?.toLowerCase() ?? "year";
  if (!Number.isFinite(min)) return undefined;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(min) && Number.isInteger(max) ? 0 : 2,
  });
  return Number.isFinite(max) && max !== min
    ? `${formatter.format(min)}–${formatter.format(max)} per ${unit}`
    : `${formatter.format(min)} per ${unit}`;
}

function stripHtml(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 100_000);
}

export function parseStructuredJobScripts(scripts: string[]) {
  const nodes: unknown[] = [];
  for (const script of scripts) {
    try {
      collectJobPostingNodes(JSON.parse(script), nodes);
    } catch {
      // Malformed third-party JSON-LD is ignored; visible text remains available.
    }
  }

  return nodes.slice(0, 5).map((node): StructuredJobPosting => {
    const job = asRecord(node) ?? {};
    const hiringOrganization = asRecord(job.hiringOrganization);
    const applicantLocation = Array.isArray(job.applicantLocationRequirements)
      ? job.applicantLocationRequirements.map(textValue).filter(Boolean).join(", ")
      : textValue(job.applicantLocationRequirements);
    const remote = String(job.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE";
    const location = formatLocation(job.jobLocation);
    const employment = Array.isArray(job.employmentType)
      ? job.employmentType.map(String).join(" · ")
      : textValue(job.employmentType);
    return {
      title: textValue(job.title),
      companyName: textValue(hiringOrganization?.name),
      workMode: remote ? "Remote" : textValue(job.jobLocationType),
      employmentType: employment,
      location: remote && applicantLocation
        ? `Remote — ${applicantLocation}`
        : location,
      salary: formatSalary(job.baseSalary),
      validThrough: textValue(job.validThrough),
      description: stripHtml(job.description),
    };
  });
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  eighteen: 18,
  twenty: 20,
  twentyfour: 24,
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function slug(value: string) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function quoteAround(text: string, start: number, length: number) {
  const radius = 120;
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, start + length + radius);
  return text.slice(from, to);
}

function numberFrom(value: string) {
  const compactValue = value.toLowerCase().replace(/[\s-]+/g, "");
  return Number(value) || WORD_NUMBERS[compactValue] || 0;
}

function moneyValue(value: string, thousands?: string) {
  const base = Number(value.replaceAll(",", ""));
  return Math.round(base * (thousands ? 1000 : 1));
}

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US")}`;
}

function periodLabel(value: string) {
  const period = value.toLowerCase();
  if (/hour|hr/.test(period)) return "hour";
  if (/month|mo/.test(period)) return "month";
  if (/week|wk/.test(period)) return "week";
  if (/day/.test(period)) return "day";
  return "year";
}

function addFromMatch(
  candidates: CandidateAssertion[],
  text: string,
  match: RegExpExecArray,
  field: string,
  rawValue: string,
  normalizedValue: string,
  displayValue: string,
  label: string,
) {
  const start = match.index;
  candidates.push({
    field,
    rawValue: compact(rawValue),
    normalizedValue,
    displayValue: compact(displayValue),
    quote: quoteAround(text, start, match[0].length),
    location: `${label} · characters ${start}–${start + match[0].length}`,
  });
}

function addFromTextSlice(
  candidates: CandidateAssertion[],
  text: string,
  start: number,
  value: string,
  field: string,
  label: string,
) {
  candidates.push({
    field,
    rawValue: compact(value),
    normalizedValue: slug(value),
    displayValue: compact(value),
    quote: quoteAround(text, start, value.length),
    location: `${label} · characters ${start}–${start + value.length}`,
  });
}

function inferScreenshotRoleBeforeSection(
  text: string,
  companyName?: string,
) {
  const lines = text.split("\n");
  let cursor = 0;
  const indexed = lines.map((raw) => {
    const start = cursor;
    cursor += raw.length + 1;
    return { raw, value: compact(raw), start };
  });
  const section = indexed.findIndex(({ value }) =>
    /^(?:job description|responsibilities|qualifications|requirements|position summary|about the role)\s*:?$/i.test(
      value,
    ),
  );
  if (section < 1) return null;

  for (let index = section - 1; index >= Math.max(0, section - 4); index -= 1) {
    const candidate = indexed[index];
    if (!candidate.value) continue;
    if (companyName && slug(candidate.value) === slug(companyName)) continue;
    if (
      /^(?:remote|hybrid|on[- ]?site|in[- ]office|full[- ]time|part[- ]time|contract|job location\b.*|location\b.*)$/i.test(
        candidate.value,
      )
    ) {
      continue;
    }
    const words = candidate.value.split(/\s+/);
    if (
      candidate.value.length >= 3 &&
      candidate.value.length <= 90 &&
      words.length <= 10 &&
      !/[.!?]$/.test(candidate.value) &&
      !/\b(?:Corporation|Corp\.?|Inc\.?|LLC|Ltd\.?|Company|Co\.?)$/i.test(
        candidate.value,
      )
    ) {
      return candidate;
    }
  }
  return null;
}

function addStructured(
  candidates: CandidateAssertion[],
  text: string,
  field: string,
  label: string,
  rawValue: string | undefined,
  displayValue = rawValue,
) {
  if (!rawValue || !displayValue) return;
  const marker = `${label}: ${rawValue}`;
  const index = text.indexOf(marker);
  if (index < 0) return;
  candidates.push({
    field,
    rawValue,
    normalizedValue: normalizeStructuredValue(field, displayValue),
    displayValue,
    quote: marker,
    location: `Structured JobPosting · ${label}`,
  });
}

function normalizeStructuredValue(field: string, value: string) {
  if (field === "work_mode") {
    if (/hybrid/i.test(value)) return "hybrid";
    if (/remote|telecommute/i.test(value)) return "remote";
    if (/on[- ]?site|in[- ]office/i.test(value)) return "onsite";
  }
  if (field === "compensation_basis") {
    const range = /\$\s*([0-9][0-9,]*(?:\.\d+)?)\s*(?:-|–|—|to)\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s+per\s+(year|hour|month|week|day)/i.exec(
      value,
    );
    if (range) {
      return `usd-${moneyValue(range[1])}-${moneyValue(range[2])}-per-${periodLabel(range[3])}`;
    }
    const single = /\$\s*([0-9][0-9,]*(?:\.\d+)?)\s+per\s+(year|hour|month|week|day)/i.exec(
      value,
    );
    if (single) {
      return `usd-${moneyValue(single[1])}-per-${periodLabel(single[2])}`;
    }
  }
  return slug(value);
}

function extractCompanyOnly(capture: LiveCaptureData) {
  const candidates: CandidateAssertion[] = [];
  const text = capture.sealedText;
  const structured = capture.structuredJobs?.[0];
  addStructured(
    candidates,
    text,
    "company_name",
    "Company",
    structured?.companyName,
  );
  if (candidates.length > 0) return candidates;

  const company = /(?:^|\n)\s*([A-Z][A-Za-z0-9&'’., -]{2,80}\b(?:Corporation|Corp\.?|Incorporated|Inc\.?|LLC|Ltd\.?|Company|Co\.?))\s*(?:\n|$)/m.exec(
    text,
  );
  const contextualCompany = /\b(?:[Ww]orking at|[Aa]bout)\s+([A-Z][A-Za-z0-9&'’., -]{2,80}?(?:Corporation|Corp\.?|Incorporated|Inc\.?|LLC|Ltd\.?|Company|Co\.?))(?=\s+(?:in|on|is|has|Snapshot|Overview)\b)/.exec(
    text,
  );
  const snapshotCompany = /\b((?:[A-Z][A-Za-z0-9&'’.-]*\s+){0,5}(?:Corporation|Corp\.?|Incorporated|Inc\.?|LLC|Ltd\.?|Company|Co\.?))\s+(?:Snapshot|Overview|About)\b/.exec(
    text,
  );
  const companyMatch = contextualCompany ?? company ?? snapshotCompany;
  if (companyMatch) {
    addFromMatch(
      candidates,
      text,
      companyMatch,
      "company_name",
      companyMatch[1],
      slug(companyMatch[1]),
      companyMatch[1],
      "OCR text",
    );
  }
  return candidates;
}

export function extractJobCandidates(capture: LiveCaptureData) {
  if (capture.acquisitionStatus !== "usable") {
    return capture.documentType === "company_profile"
      ? extractCompanyOnly(capture)
      : [];
  }

  const candidates = extractCompanyOnly(capture);
  const text = capture.sealedText;
  const structured = capture.structuredJobs?.[0];

  addStructured(candidates, text, "role_title", "Role", structured?.title);
  addStructured(
    candidates,
    text,
    "job_location",
    "Location",
    structured?.location,
  );
  addStructured(
    candidates,
    text,
    "work_mode",
    "Work mode",
    structured?.workMode,
  );
  addStructured(
    candidates,
    text,
    "employment_type",
    "Employment type",
    structured?.employmentType,
  );
  addStructured(
    candidates,
    text,
    "compensation_basis",
    "Compensation",
    structured?.salary,
  );
  addStructured(
    candidates,
    text,
    "deadline",
    "Valid through",
    structured?.validThrough,
  );

  const atsPageTitle = /(?:^|\n)Page title:\s*([^\n|]{3,100}?)(?:\s+Job Details?)?\s*\|\s*([^\n|]{2,100})\s*(?:\n|$)/i.exec(
    text,
  );
  if (
    atsPageTitle &&
    !candidates.some((item) => item.field === "company_name")
  ) {
    addFromMatch(
      candidates,
      text,
      atsPageTitle,
      "company_name",
      atsPageTitle[2],
      slug(atsPageTitle[2]),
      atsPageTitle[2],
      "Page metadata",
    );
  }

  if (!candidates.some((item) => item.field === "role_title")) {
    const labeledRole = /(?:^|\n)\s*(?:job title|position title|role)\s*[:\-]\s*([^\n|]{3,100})/im.exec(
      text,
    );
    const hiringRole = /\b(?:we(?:'re| are) hiring|hiring)\s+(?:a|an)\s+([^.,;\n]{3,90}?)(?=\s+(?:to\s+join|who\s+will|that\s+will|for\s+our)|\s+[-–—]\s+|\s*\(|[.,;\n]|$)/i.exec(
      text,
    );
    const metadataHeading = /(?:^|\n)Heading:\s*([^\n]{3,100})/i.exec(text);
    const metadataTitle = atsPageTitle;
    const screenshotHeading =
      capture.kind === "screenshot"
        ? /(?:^|\n)[ \t]*((?:(?:Senior|Sr\.?|Junior|Jr\.?|Lead|Principal|Staff|Associate|Assistant|Head|Chief)[ \t]+)?(?:[A-Z][A-Za-z0-9+/#.&'-]*[ \t]+){0,6}(?:Engineer|Manager|Analyst|Coordinator|Designer|Director|Developer|Architect|Scientist|Specialist|Consultant|Administrator|Technician|Recruiter|Executive|Counsel|Accountant|Intern))[ \t]*(?:\n|$)/m.exec(
            text,
          )
        : null;
    const genericHeadings =
      /^(?:jobs?|careers?|join us|open positions?|opportunities|about us)$/i;
    const role =
      labeledRole ??
      hiringRole ??
      metadataTitle ??
      (metadataHeading && !genericHeadings.test(compact(metadataHeading[1]))
        ? metadataHeading
        : null) ??
      screenshotHeading;
    if (role) {
      addFromMatch(
        candidates,
        text,
        role,
        "role_title",
        role[1],
        slug(role[1]),
        role[1],
        capture.kind === "screenshot" ? "OCR text" : "Rendered text",
      );
    } else if (capture.kind === "screenshot") {
      const companyName = candidates.find(
        (candidate) => candidate.field === "company_name",
      )?.displayValue;
      const inferred = inferScreenshotRoleBeforeSection(text, companyName);
      if (inferred) {
        addFromTextSlice(
          candidates,
          text,
          inferred.start,
          inferred.value,
          "role_title",
          "OCR heading",
        );
      }
    }
  }

  if (!candidates.some((item) => item.field === "company_name")) {
    const company = /\b(?:at|company\s*[:\-])\s+([A-Z][A-Za-z0-9&'’., -]{2,80})(?=\s*(?:\n|\||—|-|$))/m.exec(
      text,
    );
    if (company) {
      addFromMatch(
        candidates,
        text,
        company,
        "company_name",
        company[1],
        slug(company[1]),
        company[1],
        "Rendered text",
      );
    }
  }

  if (!candidates.some((item) => item.field === "work_mode")) {
    const labeledWorkMode = /(?:^|\n)\s*(?:remote\s*\/\s*hybrid\s*\/\s*on[- ]?site|work\s*mode|workplace\s*type)\s*[:\-]\s*(remote|hybrid|on[- ]?site|in[- ]?office)\b/im.exec(
      text,
    );
    const hybrid = /\bhybrid(?:\s+(?:role|position|schedule))?(?:[^.\n]{0,60}(\d+)\s+days?[^.\n]{0,30}(?:on[- ]?site|in[- ]office))?/i.exec(
      text,
    );
    const notHybrid = /\bnot\s+(?:a\s+)?hybrid\s+(?:role|position|schedule)\b/i.exec(
      text,
    );
    const notRemote = /\b(?:not\s+(?:a\s+)?remote\s+(?:role|position)|not\s+eligible\s+for\s+remote\s+work|remote\s+(?:work\s+)?(?:is\s+)?not\s+(?:available|permitted)|remote\s+candidates?\s+(?:are\s+)?not\s+(?:accepted|eligible|considered)|no\s+remote\s+candidates?|does\s+not\s+(?:allow|permit|support)\s+remote\s+work|cannot\s+work\s+remotely)\b/i.exec(
      text,
    );
    const remote = /\b(?:fully\s+remote|remote\s+(?:role|position|work)|work\s+from\s+home)\b|(?:^|\n)\s*remote\s*(?:\n|$)/i.exec(
      text,
    );
    const onsite = /\b(?:on[- ]?site|in[- ]office)(?:\s+(?:role|position|work|required))?\b/i.exec(
      text,
    );
    const positiveHybrid = notHybrid ? null : hybrid;
    const workMode = labeledWorkMode ?? notRemote ?? positiveHybrid ?? remote ?? onsite;
    if (workMode) {
      const labeledValue = labeledWorkMode?.[1] ?? null;
      const normalized = labeledValue
        ? /remote/i.test(labeledValue)
          ? "remote"
          : /hybrid/i.test(labeledValue)
            ? "hybrid"
            : "onsite"
        : positiveHybrid
        ? "hybrid"
        : notRemote
          ? "not-remote"
          : remote
            ? "remote"
            : "onsite";
      const display = labeledValue
        ? normalized === "onsite"
          ? "Onsite"
          : normalized === "hybrid"
            ? "Hybrid"
            : "Remote"
        : positiveHybrid
        ? positiveHybrid[1]
          ? `Hybrid — ${positiveHybrid[1]} days onsite`
          : "Hybrid"
        : notRemote
          ? "Not remote"
          : remote
            ? "Remote"
            : "Onsite";
      addFromMatch(
        candidates,
        text,
        workMode,
        "work_mode",
        labeledValue ?? workMode[0],
        normalized,
        display,
        "Rendered text",
      );
    }
  }

  if (!candidates.some((item) => item.field === "job_location")) {
    const location = /(?:^|\n)\s*(?:job\s+)?location\s*[:\-]\s*([^\n]{2,100})/im.exec(
      text,
    );
    if (location) {
      addFromMatch(
        candidates,
        text,
        location,
        "job_location",
        location[1],
        slug(location[1]),
        location[1],
        "Rendered text",
      );
    }
  }

  if (!candidates.some((item) => item.field === "relocation_required")) {
    const noRelocation = /\b(?:no\s+relocation\s+(?:is\s+)?required|relocation\s+(?:is\s+)?not\s+required|do\s+not\s+need\s+to\s+relocate)\b/i.exec(
      text,
    );
    const relocation = /\b(?:relocation\s+(?:is\s+)?required|must\s+relocate|required\s+to\s+relocate)\b/i.exec(
      text,
    );
    const result = noRelocation ?? relocation;
    if (result) {
      addFromMatch(
        candidates,
        text,
        result,
        "relocation_required",
        result[0],
        noRelocation ? "not-required" : "required",
        noRelocation ? "Not required" : "Required",
        "Rendered text",
      );
    }
  }

  if (!candidates.some((item) => item.field === "compensation_basis")) {
    const range = /(?:USD\s*)?\$\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kK])?\s*(?:-|–|—|to)\s*(?:USD\s*)?\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kK])?\s*(?:per|\/)?\s*(year|annum|annual(?:ized|ly)?|hour|hr|month|mo|week|wk|day)\b/i.exec(
      text,
    );
    const single = /(?:USD\s*)?\$\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kK])?\s*(?:per|\/)?\s*(year|annum|annual(?:ized|ly)?|hour|hr|month|mo|week|wk|day)\b/i.exec(
      text,
    );
    if (range) {
      const min = moneyValue(range[1], range[2]);
      const max = moneyValue(range[3], range[4]);
      const period = periodLabel(range[5]);
      addFromMatch(
        candidates,
        text,
        range,
        "compensation_basis",
        range[0],
        `usd-${min}-${max}-per-${period}`,
        `${formatUsd(min)}–${formatUsd(max)} per ${period}`,
        "Rendered text",
      );
    } else if (single) {
      const amount = moneyValue(single[1], single[2]);
      const period = periodLabel(single[3]);
      addFromMatch(
        candidates,
        text,
        single,
        "compensation_basis",
        single[0],
        `usd-${amount}-per-${period}`,
        `${formatUsd(amount)} per ${period}`,
        "Rendered text",
      );
    }
  }

  if (!candidates.some((item) => item.field === "duration")) {
    const durationForward = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen|twenty(?:[ -]?four)?)\s*[- ]?\s*(month|week|year)s?\s+(?:(?:W-?2|1099)\s+)?(?:contract|engagement|assignment|term|internship)\b/i.exec(
      text,
    );
    const durationLabeled = /\b(?:contract|engagement|assignment|term|internship)\s+(?:duration|length)\s*[:\-]?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen|twenty(?:[ -]?four)?)\s*[- ]?\s*(month|week|year)s?\b/i.exec(
      text,
    );
    const duration = durationForward ?? durationLabeled;
    if (duration) {
      const amount = numberFrom(duration[1]);
      const unit = duration[2].toLowerCase();
      addFromMatch(
        candidates,
        text,
        duration,
        "duration",
        duration[0],
        `${amount}-${unit}`,
        `${amount} ${unit}${amount === 1 ? "" : "s"}`,
        "Rendered text",
      );
    }
  }

  if (!candidates.some((item) => item.field === "employment_type")) {
    const labeledEmployment = /(?:^|\n)\s*(?:employment|contract)\s+type\s*[:\-]\s*(?:(W-?2|1099)\s+)?(full[- ]time|part[- ]time|contract(?:or)?|temporary|permanent|internship)\b/im.exec(
      text,
    );
    const classifiedEmployment = /\b(W-?2|1099)\s+(full[- ]time|part[- ]time|contract(?:or)?|temporary|permanent|internship)\b/i.exec(
      text,
    );
    const genericEmployment = /\b(?:(W-?2|1099)\s+)?(full[- ]time|part[- ]time|contract(?:or)?|temporary|permanent|internship)\b/i.exec(
      text,
    );
    const employment =
      labeledEmployment ?? classifiedEmployment ?? genericEmployment;
    if (employment) {
      const classification = employment[1]
        ? employment[1].replace("-", "").toUpperCase() === "W2"
          ? "W-2"
          : "1099"
        : undefined;
      const employmentKind = compact(employment[2]).toLowerCase();
      const display = compact(
        [classification, employmentKind].filter(Boolean).join(" "),
      );
      addFromMatch(
        candidates,
        text,
        employment,
        "employment_type",
        employment[0],
        [classification?.replace("-", "").toLowerCase(), slug(employmentKind)]
          .filter(Boolean)
          .join("-"),
        display,
        "Rendered text",
      );
    }
  }

  const experiencePrefix = /\b(?:minimum(?:\s+of)?|requires?|required|must\s+have|need(?:ed)?)\s*[:\-]?\s*((\d+\+?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+\s*)?years?(?:\s+(?:of\s+)?(?:relevant\s+|professional\s+)?experience)?)\b/i.exec(
    text,
  );
  const experienceSuffix = /\b((\d+\+?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+\s*)?years?(?:\s+(?:of\s+)?(?:relevant\s+|professional\s+)?experience)?)\s+(?:is\s+)?(?:required|minimum|must-have)\b/i.exec(
    text,
  );
  const experienceSection = /(?:^|\n)\s*Experience\s*:\s*(?:\n\s*)?(?:[•\-*]\s*)?((?:\+\s*)?(\d+)\s*years?\s+in\s+[^.\n]{2,100})/im.exec(
    text,
  );
  const experience = experiencePrefix ?? experienceSuffix ?? experienceSection;
  if (experience) {
    const amount = numberFrom(experience[2]);
    const display = `${amount} years experience`;
    addFromMatch(
      candidates,
      text,
      experience,
      "experience_required",
      experience[1],
      slug(display),
      display,
      "Rendered text",
    );
  }

  const educationPrefix = /\b(?:requires?|required|minimum|must\s+have|need(?:ed)?)\s*[:\-]?\s+(?:a\s+)?((?:bachelor(?:'s)?|master(?:'s)?|associate(?:'s)?|doctoral|ph\.?d\.?|high school)(?:\s+(?:degree|diploma))?(?:\s+in\s+[^.;\n]{2,70})?)/i.exec(
    text,
  );
  const educationSuffix = /\b((?:bachelor(?:'s)?|master(?:'s)?|associate(?:'s)?|doctoral|ph\.?d\.?|high school)(?:\s+(?:degree|diploma))?(?:\s+in\s+[^.;\n]{2,70})?)\s+(?:is\s+)?(?:required|minimum|must-have)\b/i.exec(
    text,
  );
  const educationSection = /(?:Requirements\s+for\s+the\s+job[\s\S]{0,500}?Education[^:\n]*:\s*(?:\n\s*)?(?:[•\-*]\s*)?)((?:Degree|Diploma)\s+in\s+[^.\n]{2,100})/i.exec(
    text,
  );
  const education = educationPrefix ?? educationSuffix ?? educationSection;
  if (education) {
    addFromMatch(
      candidates,
      text,
      education,
      "education_required",
      education[1],
      slug(education[1]),
      education[1],
      "Rendered text",
    );
  }

  if (!candidates.some((item) => item.field === "application_materials")) {
    const noResume = /\b(?:do\s+not|don't|dont)\s+(?:require|need|want)[^.\n]{0,90}(?:resume|résumé|cv)\b/i.exec(
      text,
    );
    const resume = /\b(?:submit|upload|include|attach)[^.\n]{0,50}(?:resume|résumé|cv|cover\s+letter|portfolio)\b/i.exec(
      text,
    );
    const materials = noResume ?? resume;
    if (materials) {
      addFromMatch(
        candidates,
        text,
        materials,
        "application_materials",
        materials[0],
        noResume ? "resume-not-required" : "application-materials-requested",
        noResume ? "Résumé/CV not required" : "Application materials requested",
        "Rendered text",
      );
    }
  }

  if (!candidates.some((item) => item.field === "deadline")) {
    const noDeadline = /\b(?:no\s+(?:fixed\s+)?deadline|applications?\s+accepted\s+until\s+filled)\b/i.exec(
      text,
    );
    if (noDeadline) {
      addFromMatch(
        candidates,
        text,
        noDeadline,
        "deadline",
        noDeadline[0],
        "open-until-filled",
        "Open until filled",
        "Rendered text",
      );
    }
  }

  return candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (item) =>
          item.field === candidate.field &&
          item.normalizedValue === candidate.normalizedValue &&
          item.quote === candidate.quote,
      ) === index,
  );
}

export function structuredJobsToSealedText(jobs: StructuredJobPosting[]) {
  return jobs
    .map((job, index) =>
      [
        `[Structured JobPosting ${index + 1}]`,
        job.title ? `Role: ${job.title}` : "",
        job.companyName ? `Company: ${job.companyName}` : "",
        job.location ? `Location: ${job.location}` : "",
        job.workMode ? `Work mode: ${job.workMode}` : "",
        job.employmentType ? `Employment type: ${job.employmentType}` : "",
        job.salary ? `Compensation: ${job.salary}` : "",
        job.validThrough ? `Valid through: ${job.validThrough}` : "",
        job.description ? `Description: ${job.description}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}
