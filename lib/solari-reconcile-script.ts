/**
 * Pure-Python, stdlib-only reconciliation executed inside a Solari Sandbox.
 *
 * The sandbox receives browser captures and emits the same report contract as
 * the local golden fixture. Extraction is deliberately narrow; unsupported
 * language remains Unknown instead of being guessed.
 */
export const SOLARI_RECONCILE_SCRIPT = String.raw`
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

INPUT_PATH = sys.argv[1]
OUTPUT_PATH = sys.argv[2]

with open(INPUT_PATH, "r", encoding="utf-8") as handle:
    captures = json.load(handle)

sources = []
evidence = []
assertions = []

def compact(value):
    return re.sub(r"\s+", " ", value).strip()

def quote_for(text, match, radius=105):
    start = max(0, match.start() - radius)
    end = min(len(text), match.end() + radius)
    return compact(text[start:end])[:420]

def add_assertion(source_id, text, field, pattern, normalized, display, suffix, flags=re.I):
    match = re.search(pattern, text, flags)
    if not match:
        return False
    evidence_id = f"ev-{source_id}-{suffix}"
    evidence.append({
        "id": evidence_id,
        "sourceId": source_id,
        "quote": quote_for(text, match),
        "location": f"Rendered body text · characters {match.start()}–{match.end()}",
        "eligible": True,
    })
    assertions.append({
        "id": f"as-{source_id}-{suffix}",
        "field": field,
        "rawValue": compact(match.group(0)),
        "normalizedValue": normalized,
        "displayValue": display,
        "evidenceId": evidence_id,
    })
    return True

for index, capture in enumerate(captures, start=1):
    source_id = f"src-live-{index}"
    text = capture["text"][:200000]
    final_url = capture["finalUrl"]
    host = urlparse(final_url).hostname or "Captured page"
    sources.append({
        "id": source_id,
        "label": capture.get("title") or host,
        "publisher": host,
        "author": "Rendered page",
        "kind": "url",
        "authority": "third-party",
        "url": final_url,
        "requestedUrl": capture["requestedUrl"],
        "finalUrl": final_url,
        "capturedAt": capture["capturedAt"],
        "sha256": capture["textSha256"],
        "textSha256": capture["textSha256"],
        "screenshotSha256": capture["screenshotSha256"],
        "browserSessionId": capture["browserSessionId"],
    })

    add_assertion(
        source_id, text, "role_title",
        r"\b(?:SWE|software\s+engineering|software\s+engineer)\s+intern(?:ship)?\b",
        "swe-intern", "SWE intern", "role"
    )

    add_assertion(
        source_id, text, "work_mode",
        r"\b(?:fully\s+remote|remote\s+(?:role|position|work))\b",
        "remote", "Remote", "remote"
    )
    add_assertion(
        source_id, text, "work_mode",
        r"\b(?:hybrid|(?:one|two|three|four|five|\d+)\s+days?[^.\n]{0,24}(?:onsite|on-site|in[- ]office))\b",
        "hybrid-onsite", "Hybrid / onsite cadence", "hybrid"
    )

    add_assertion(
        source_id, text, "relocation_required",
        r"\b(?:no\s+relocation\s+(?:is\s+)?required|do\s+i\s+have\s+to\s+be\s+based[^?]{0,80}\?[^.\n]{0,80}remote\s+role)\b",
        "not-required", "Not required", "relocation"
    )

    compensation = re.search(
        r"\$?\s*([0-9]{2,3}(?:,[0-9]{3})?|[0-9]{2,3})\s*([kK])?[^.\n]{0,28}\bannuali[sz]ed\b",
        text,
        re.I,
    )
    if compensation:
        amount = int(compensation.group(1).replace(",", ""))
        if compensation.group(2):
            amount *= 1000
        display = "$" + format(amount, ",.0f") + " annualized"
        add_assertion(
            source_id, text, "compensation_basis",
            re.escape(compensation.group(0)),
            f"usd-{amount}-annualized", display, "compensation", flags=0
        )

    add_assertion(
        source_id, text, "duration",
        r"\b(?:the\s+)?(?:engagement|internship|term)\s+(?:is|lasts|runs)\s+(?:for\s+)?([0-9]+)\s+months?\b",
        "explicit-fixed-term", "Explicit fixed term", "duration"
    )

    add_assertion(
        source_id, text, "application_materials",
        r"\b(?:do\s+not|don't|dont)\s+(?:want|require|need)[^.\n]{0,70}(?:resume|résumé)[^.\n]{0,90}(?:grades|cover\s*letter)\b",
        "resume-cover-letter-grades-not-requested",
        "Résumé, cover letter, and grades not requested",
        "materials"
    )

    if all(term in text.lower() for term in ["fork", "build", "publish", "linkedin"]):
        add_assertion(
            source_id, text, "application_steps",
            r"(?is)fork[^\n]{0,100}\n.{0,60}build.{0,170}\n.{0,60}publish.{0,170}\n.{0,60}(?:share|post).{0,100}(?:linkedin|\bx\b)",
            "fork-build-publish-share-tag",
            "Fork → build → publish → post + tag",
            "steps"
        )

    add_assertion(
        source_id, text, "deadline",
        r"\bis\s+there\s+a\s+deadline\s*\?\s*no\b|\bno\s+(?:fixed\s+)?deadline\b",
        "no-fixed-deadline", "No fixed deadline", "deadline"
    )

    add_assertion(
        source_id, text, "evaluation_signal",
        r"\bgenuine\s+uses?[^.\n]{0,80}solv(?:e|es|ing)\s+problems?\b",
        "genuine-problem-and-market-fit",
        "A genuine problem and evidence people want it",
        "evaluation"
    )

definitions = [
    ("role_title", "Role", "Role", "The rendered source does not explicitly name a supported role."),
    ("work_mode", "Work mode", "Location", "No eligible source explicitly states a supported work mode."),
    ("relocation_required", "Relocation", "Location", "Relocation expectations are not explicit."),
    ("compensation_basis", "Compensation basis", "Compensation", "No eligible source states a supported compensation amount and basis."),
    ("actual_paid_total", "Actual paid total", "Compensation", "The actual term and full-time equivalency are not established."),
    ("duration", "Engagement duration", "Engagement", "A fixed engagement duration is not explicit."),
    ("employment_type", "Employment classification", "Engagement", "Employee versus contractor status and schedule are not explicit."),
    ("application_materials", "Application materials", "Application", "Required application materials are not explicit."),
    ("application_steps", "Application steps", "Application", "A complete supported application path was not found."),
    ("deadline", "Deadline", "Application", "No eligible source explicitly addresses a deadline."),
    ("evaluation_signal", "What the build must prove", "Application", "The supported evaluation signal was not found."),
]

questions_by_field = {
    "work_mode": "Can you confirm whether this may be performed fully remotely and whether any onsite cadence applies?",
    "relocation_required": "Is relocation required at any point in the engagement?",
    "actual_paid_total": "What gross compensation applies to the actual engagement term and expected full-time equivalency?",
    "duration": "Is the engagement fixed-term or ongoing?",
    "employment_type": "Is the worker classification employee or contractor, and is the schedule full-time or part-time?",
    "deadline": "Is there a target date for reviewing submissions?",
}

findings = []
for field, label, group, unknown_reason in definitions:
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
            "explanation": "At least one eligible explicit assertion exists and every other eligible assertion is compatible.",
            "evidenceIds": sorted(set(item["evidenceId"] for item in field_assertions)),
            "ruleId": "RT-R1 · explicit + compatible",
        }
    else:
        finding = {
            "field": field,
            "label": label,
            "group": group,
            "status": "conflicted",
            "conclusion": " ↔ ".join(group[0]["displayValue"] for group in values.values()),
            "explanation": "Eligible explicit assertions are materially incompatible. Authority cannot erase a contradiction.",
            "evidenceIds": sorted(set(item["evidenceId"] for item in field_assertions)),
            "ruleId": "RT-R2 · incompatible evidence preserved",
        }

    if finding["status"] in ("unknown", "conflicted") and field in questions_by_field:
        finding["question"] = questions_by_field[field]
    findings.append(finding)

calculations = []
comp_assertions = [item for item in assertions if item["field"] == "compensation_basis"]
if comp_assertions and "usd-300000-annualized" in {item["normalizedValue"] for item in comp_assertions}:
    scenario = {
        "field": "three_month_full_time_scenario",
        "label": "3-month full-time scenario",
        "group": "Compensation",
        "status": "calculated",
        "conclusion": "$75,000",
        "explanation": "A transparent scenario derived from the annualized rate. It is not a quoted or promised payout.",
        "evidenceIds": [comp_assertions[0]["evidenceId"]],
        "ruleId": "RT-C1 · 300,000 × 3/12 × 1.0 FTE",
    }
    insert_at = next((i for i, item in enumerate(findings) if item["field"] == "actual_paid_total"), len(findings))
    findings.insert(insert_at, scenario)
    calculations.append({
        "id": "calc-three-month",
        "label": "Three-month full-time scenario",
        "formula": "$300,000 / year × 3 / 12 × 1.0 FTE",
        "inputs": [
            {"label": "Annualized rate", "value": "$300,000", "evidenceId": comp_assertions[0]["evidenceId"]},
            {"label": "Scenario term", "value": "3 months"},
            {"label": "Scenario FTE", "value": "1.0"},
        ],
        "result": "$75,000",
        "disclaimer": "Derived scenario only. Actual duration and schedule remain unknown.",
    })

questions = [
    item["question"] for item in findings
    if item.get("question") and item["status"] in ("unknown", "conflicted")
]

report = {
    "id": "rt-solari-live",
    "engineVersion": "0.1.0-sandbox",
    "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "mode": "solari-live",
    "sources": sources,
    "evidence": evidence,
    "assertions": assertions,
    "findings": findings,
    "calculations": calculations,
    "questions": questions,
    "runtime": {
        "browserSessionId": captures[0]["browserSessionId"] if captures else None,
        "sandboxId": None,
        "sandboxExitCode": None,
    },
}

with open(OUTPUT_PATH, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2, sort_keys=True, ensure_ascii=False)
`;
