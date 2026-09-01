/**
 * Deterministic evidence verifier and reconciler executed inside a Solari
 * Sandbox. The application may propose candidate assertions, but this script
 * admits one only when its exact quotation round-trips to a sealed source.
 */
export const SOLARI_RECONCILE_SCRIPT = String.raw`
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

INPUT_PATH = sys.argv[1]
OUTPUT_PATH = sys.argv[2]

with open(INPUT_PATH, "r", encoding="utf-8") as handle:
    captures = json.load(handle)

DEFINITIONS = [
    ("company_name", "Company", "Role", "The supplied sources do not explicitly name the company."),
    ("role_title", "Role", "Role", "The supplied sources do not explicitly name the role."),
    ("work_mode", "Work mode", "Location", "No eligible source explicitly states the work mode."),
    ("job_location", "Location", "Location", "No eligible source explicitly states the job location."),
    ("relocation_required", "Relocation", "Location", "Relocation expectations are not explicit."),
    ("compensation_basis", "Compensation basis", "Compensation", "No eligible source states compensation and its basis."),
    ("actual_paid_total", "Actual paid total", "Compensation", "The actual term, schedule, and payable total are not established."),
    ("duration", "Engagement duration", "Engagement", "A fixed engagement duration is not explicit."),
    ("employment_type", "Employment classification", "Engagement", "Employee, contractor, and schedule terms are not explicit."),
    ("experience_required", "Experience", "Requirements", "No explicit minimum experience requirement was found."),
    ("education_required", "Education", "Requirements", "No explicit education requirement was found."),
    ("application_materials", "Application materials", "Application", "Required application materials are not explicit."),
    ("application_steps", "Application steps", "Application", "A complete supported application path was not found."),
    ("deadline", "Deadline", "Application", "No eligible source explicitly addresses a deadline."),
    ("evaluation_signal", "Selection criteria", "Application", "Explicit selection criteria were not found."),
]

QUESTIONS = {
    "work_mode": "Can you confirm whether this may be performed fully remotely from Virginia and whether any onsite cadence applies?",
    "job_location": "What location restrictions or approved working states apply to this role?",
    "relocation_required": "Is relocation required at any point in the engagement?",
    "actual_paid_total": "What gross compensation applies to the actual engagement term and expected full-time equivalency?",
    "duration": "Is the engagement fixed-term or ongoing?",
    "employment_type": "Is this employee or contractor work, and is the schedule full-time or part-time?",
    "deadline": "Is there a target date for reviewing submissions?",
}

ALLOWED_FIELDS = {item[0] for item in DEFINITIONS}
sources = []
evidence = []
assertions = []
diagnostics = []

def compact(value):
    return re.sub(r"\s+", " ", str(value)).strip()

def safe_text(value, limit):
    return compact(value)[:limit]

def exact_text(value, limit):
    return str(value).strip()[:limit]

def verify_image(capture):
    image_path = capture.get("imagePath")
    expected = capture.get("screenshotSha256")
    if not image_path or not expected:
        return False, "No sealed source image was supplied to the Sandbox."
    if not os.path.isfile(image_path):
        return False, "The sealed source image was not present in the Sandbox."
    digest = hashlib.sha256()
    with open(image_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        return False, "The source image hash did not match the intake receipt."
    return True, None

def verify_text(capture):
    sealed_text = capture.get("sealedText", "")
    expected = capture.get("textSha256", "")
    actual = hashlib.sha256(sealed_text.encode("utf-8")).hexdigest()
    return bool(expected) and actual == expected

def candidate_value_is_consistent(field, raw, normalized):
    """Recompute safety-critical normalizations from the quoted raw phrase."""
    lowered = compact(raw).lower()
    if field == "work_mode":
        if re.search(r"not\s+(?:a\s+)?remote|not\s+eligible\s+for\s+remote|remote.+not\s+(?:available|permitted)|remote\s+candidates?.+not\s+(?:accepted|eligible|considered)|no\s+remote\s+candidates?|does\s+not\s+(?:allow|permit|support)\s+remote|cannot\s+work\s+remotely", lowered):
            expected = "not-remote"
        elif "hybrid" in lowered and not re.search(r"not\s+(?:a\s+)?hybrid", lowered):
            expected = "hybrid"
        elif "remote" in lowered or "work from home" in lowered:
            expected = "remote"
        elif re.search(r"on[- ]?site|in[- ]office", lowered):
            expected = "onsite"
        else:
            return False
        return normalized == expected
    if field == "relocation_required":
        expected = "not-required" if re.search(r"no\s+relocation|not\s+required|do\s+not\s+need", lowered) else "required"
        return normalized == expected
    return True

for index, capture in enumerate(captures, start=1):
    source_id = capture.get("sourceId") or f"src-live-{index}"
    sealed_text = capture.get("sealedText", "")[:300000]
    status = capture.get("acquisitionStatus", "error")
    document_type = capture.get("documentType", "unknown")
    image_verified, image_error = verify_image(capture)
    text_verified = verify_text(capture)
    source_diagnostics = [safe_text(item, 240) for item in capture.get("diagnostics", []) if item]

    if image_error:
        source_diagnostics.append(image_error)
    if not text_verified:
        source_diagnostics.append("The sealed text hash did not match the intake receipt.")
    integrity_verified = image_verified and text_verified
    if not integrity_verified and status == "usable":
        status = "error"

    for item in source_diagnostics:
        diagnostics.append(f"{capture.get('label') or source_id}: {item}")

    source = {
        "id": source_id,
        "label": safe_text(capture.get("label") or "Captured source", 140),
        "publisher": safe_text(capture.get("publisher") or "Uploaded evidence", 100),
        "author": safe_text(capture.get("author") or "Captured source", 100),
        "kind": capture.get("kind", "url"),
        "authority": capture.get("authority", "third-party"),
        "capturedAt": capture.get("capturedAt"),
        "sha256": capture.get("screenshotSha256") or capture.get("textSha256"),
        "textSha256": capture.get("textSha256"),
        "screenshotSha256": capture.get("screenshotSha256"),
        "browserSessionId": capture.get("browserSessionId"),
        "acquisitionStatus": status,
        "documentType": document_type,
        "eligibleForRoleTerms": bool(capture.get("eligibleForRoleTerms")) and status == "usable" and integrity_verified,
        "diagnostics": source_diagnostics,
        "httpStatus": capture.get("httpStatus"),
        "textLength": len(sealed_text),
        "ocrConfidence": capture.get("ocrConfidence"),
        "origin": capture.get("origin"),
        "discoveredVia": capture.get("discoveredVia"),
        "searchRank": capture.get("searchRank"),
        "identityMatch": capture.get("identityMatch"),
    }
    if capture.get("requestedUrl"):
        source["requestedUrl"] = capture["requestedUrl"]
    if capture.get("finalUrl"):
        source["finalUrl"] = capture["finalUrl"]
        source["url"] = capture["finalUrl"]
    sources.append(source)

    for candidate_index, candidate in enumerate(capture.get("candidateAssertions", []), start=1):
        field = candidate.get("field")
        quote = candidate.get("quote", "")
        normalized = safe_text(candidate.get("normalizedValue", ""), 180)
        display = safe_text(candidate.get("displayValue", ""), 240)
        raw = safe_text(candidate.get("rawValue", ""), 240)

        if field not in ALLOWED_FIELDS or not quote or not normalized or not display:
            continue
        company_context = field == "company_name" and document_type == "company_profile" and status == "not_job"
        if not (source["eligibleForRoleTerms"] or company_context):
            continue
        if not integrity_verified or quote not in sealed_text:
            diagnostics.append(f"Rejected unsupported {field} proposal from {source['label']}.")
            continue
        if compact(raw).lower() not in compact(quote).lower() or not candidate_value_is_consistent(field, raw, normalized):
            diagnostics.append(f"Rejected value-inconsistent {field} proposal from {source['label']}.")
            continue

        evidence_id = f"ev-{source_id}-{field}-{candidate_index}"
        evidence.append({
            "id": evidence_id,
            "sourceId": source_id,
            "quote": exact_text(quote, 520),
            "location": safe_text(candidate.get("location", "Sealed source text"), 180),
            "eligible": True,
        })
        assertions.append({
            "id": f"as-{source_id}-{field}-{candidate_index}",
            "field": field,
            "rawValue": raw,
            "normalizedValue": normalized,
            "displayValue": display,
            "evidenceId": evidence_id,
        })

findings = []
for field, label, group, unknown_reason in DEFINITIONS:
    field_assertions = [item for item in assertions if item["field"] == field]
    values = {}
    for assertion in field_assertions:
        values.setdefault(assertion["normalizedValue"], []).append(assertion)

    if not field_assertions:
        finding = {
            "field": field,
            "label": label,
            "group": group,
            "status": "unknown",
            "conclusion": "Not established",
            "explanation": unknown_reason,
            "evidenceIds": [],
            "ruleId": "RT-R3 · absence never becomes a conclusion",
        }
    elif len(values) == 1:
        finding = {
            "field": field,
            "label": label,
            "group": group,
            "status": "confirmed",
            "conclusion": field_assertions[0]["displayValue"],
            "explanation": "Every eligible assertion is explicit, source-linked, and compatible.",
            "evidenceIds": sorted({item["evidenceId"] for item in field_assertions}),
            "ruleId": "RT-R1 · explicit + verified + compatible",
        }
    else:
        display_values = [grouped[0]["displayValue"] for grouped in values.values()]
        finding = {
            "field": field,
            "label": label,
            "group": group,
            "status": "conflicted",
            "conclusion": " ↔ ".join(display_values),
            "explanation": "Verified evidence is materially incompatible; the disagreement remains visible.",
            "evidenceIds": sorted({item["evidenceId"] for item in field_assertions}),
            "ruleId": "RT-R2 · incompatible evidence preserved",
        }

    if finding["status"] in ("unknown", "conflicted") and field in QUESTIONS:
        finding["question"] = QUESTIONS[field]
    findings.append(finding)

def confirmed_value(field):
    finding = next((item for item in findings if item["field"] == field), None)
    return finding["conclusion"] if finding and finding["status"] == "confirmed" else None

usable_sources = [item for item in sources if item["acquisitionStatus"] == "usable"]
rejected_sources = [item for item in sources if item["acquisitionStatus"] != "usable"]
role_term_assertions = [item for item in assertions if item["field"] != "company_name"]

if not usable_sources or not role_term_assertions:
    analysis_status = "insufficient"
    if not usable_sources:
        diagnostics.append("No source supplied usable role terms. Add the actual job-post URL, screenshots, or recruiter message.")
else:
    analysis_status = "partial" if rejected_sources else "complete"

questions = [
    item["question"] for item in findings
    if item.get("question") and item["status"] in ("unknown", "conflicted")
]

source_fingerprint = "".join(sorted(item.get("sha256") or "" for item in sources))
report_suffix = hashlib.sha256(source_fingerprint.encode("utf-8")).hexdigest()[:12]
report = {
    "id": f"rt-live-{report_suffix}",
    "engineVersion": "0.3.0-discovery-sandbox",
    "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "mode": "solari-live",
    "analysisStatus": analysis_status,
    "subject": {
        "roleTitle": confirmed_value("role_title"),
        "companyName": confirmed_value("company_name"),
    },
    "diagnostics": list(dict.fromkeys(diagnostics)),
    "sources": sources,
    "evidence": evidence,
    "assertions": assertions,
    "findings": findings,
    "calculations": [],
    "questions": list(dict.fromkeys(questions)),
    "runtime": {
        "browserSessionId": next((item.get("browserSessionId") for item in captures if item.get("browserSessionId")), None),
        "sandboxId": None,
        "sandboxExitCode": None,
    },
}

with open(OUTPUT_PATH, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2, sort_keys=True, ensure_ascii=False)
`;
