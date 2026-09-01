"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Braces,
  Calculator,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  FileSearch,
  Fingerprint,
  Globe2,
  Hash,
  KeyRound,
  LoaderCircle,
  Play,
  ScanText,
  ShieldCheck,
  TerminalSquare,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { demoFixture } from "@/lib/demo-data";
import {
  buildReport,
  canonicalReport,
  sha256Hex,
  type ClaimStatus,
  type EvidenceSource,
  type RoleTruthReport,
} from "@/lib/roletruth-engine";

type View = "report" | "evidence" | "method";
type SolariState = "checking" | "ready" | "unconfigured";
type RunState = "idle" | "running" | "complete" | "error";
type StagedFile = {
  file: File;
  name: string;
  size: number;
  sha256: string;
  previewUrl: string;
};

const statusMeta: Record<
  ClaimStatus,
  { label: string; Icon: typeof CheckCircle2 }
> = {
  confirmed: { label: "Confirmed", Icon: CheckCircle2 },
  conflicted: { label: "Conflicted", Icon: AlertTriangle },
  unknown: { label: "Unknown", Icon: CircleHelp },
  calculated: { label: "Calculated", Icon: Calculator },
};

function shortHash(hash: string) {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function reportTitle(report: RoleTruthReport) {
  if (report.mode === "demo-local") return "Solari SWE internship";
  const role = report.subject?.roleTitle;
  const company = report.subject?.companyName;
  if (role && company) return `${role} · ${company}`;
  if (role) return role;
  if (company) return `${company} — role not established`;
  return "Role not established";
}

function sourceStateLabel(source: EvidenceSource) {
  switch (source.acquisitionStatus) {
    case "usable":
      return "Verified";
    case "blocked":
      return "Blocked";
    case "auth_required":
      return "Sign-in required";
    case "not_job":
      return source.documentType === "company_profile"
        ? "Company context"
        : "Not a job post";
    case "irrelevant":
      return "Different opening";
    case "duplicate":
      return "Duplicate";
    case "empty":
      return "Unreadable";
    case "error":
      return "Failed";
    default:
      return "Reviewed";
  }
}

function sourceOriginLabel(source: EvidenceSource) {
  switch (source.origin) {
    case "submitted":
      return "Submitted";
    case "discovered":
      return source.discoveredVia
        ? `Discovered · ${source.discoveredVia}`
        : "Discovered";
    case "uploaded":
      return "Uploaded";
    case "synthetic":
      return "Test only";
    default:
      return null;
  }
}

function StatusPill({ status }: { status: ClaimStatus }) {
  const { Icon, label } = statusMeta[status];
  return (
    <span className={`rt-status rt-status--${status}`}>
      <Icon aria-hidden="true" size={15} strokeWidth={2.25} />
      {label}
    </span>
  );
}

function SourceMark({ source }: { source: EvidenceSource }) {
  const Icon =
    source.kind === "url"
      ? Globe2
      : source.kind === "synthetic"
        ? Braces
        : FileImage;
  return (
    <span className="rt-source-mark" aria-hidden="true">
      <Icon size={15} />
    </span>
  );
}

export function RoleTruthWorkspace() {
  const [view, setView] = useState<View>("report");
  const [includeConflict, setIncludeConflict] = useState(false);
  const [selectedField, setSelectedField] = useState("work_mode");
  const [reportHash, setReportHash] = useState("calculating…");
  const [copied, setCopied] = useState(false);
  const [solariState, setSolariState] = useState<SolariState>("checking");
  const [url, setUrl] = useState("");
  const [liveStatus, setLiveStatus] = useState("");
  const [liveReport, setLiveReport] = useState<RoleTruthReport | null>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [isStaging, setIsStaging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const runGeneration = useRef(0);

  const demoReport = useMemo(
    () => buildReport(demoFixture, includeConflict),
    [includeConflict],
  );
  const report = liveReport ?? demoReport;
  const usableSources = report.sources.filter(
    (source) =>
      source.acquisitionStatus === undefined ||
      source.acquisitionStatus === "usable",
  ).length;
  const discoveredSources = report.sources.filter(
    (source) => source.origin === "discovered",
  ).length;

  useEffect(() => {
    let active = true;
    fetch("/api/solari/status")
      .then((response) => response.json())
      .then((payload) => {
        if (active) {
          const configured =
            typeof payload === "object" &&
            payload !== null &&
            "configured" in payload &&
            payload.configured === true;
          setSolariState(configured ? "ready" : "unconfigured");
        }
      })
      .catch(() => {
        if (active) setSolariState("unconfigured");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    sha256Hex(canonicalReport(report)).then((hash) => {
      if (active) setReportHash(hash);
    });
    return () => {
      active = false;
    };
  }, [report]);

  const selectedFinding =
    report.findings.find((finding) => finding.field === selectedField) ??
    report.findings[0];
  const selectedEvidence = selectedFinding
    ? selectedFinding.evidenceIds
        .map((id) => report.evidence.find((span) => span.id === id))
        .filter(Boolean)
    : [];

  const counts = report.findings.reduce(
    (summary, finding) => {
      summary[finding.status] += 1;
      return summary;
    },
    { confirmed: 0, conflicted: 0, unknown: 0, calculated: 0 },
  );
  const unsupported = report.findings.filter(
    (finding) =>
      finding.status === "confirmed" && finding.evidenceIds.length === 0,
  ).length;

  function resetDemo() {
    runGeneration.current += 1;
    stagedFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    setStagedFiles([]);
    setUrl("");
    setLiveReport(null);
    setLiveStatus("");
    setRunState("idle");
    setSelectedField("work_mode");
    setView("report");
  }

  function markEvidenceChanged(message: string) {
    runGeneration.current += 1;
    setLiveReport(null);
    setRunState("idle");
    setLiveStatus(message);
  }

  async function stageFiles(files: FileList | null) {
    if (!files) return;
    setIsStaging(true);
    try {
      const available = Math.max(
        0,
        8 - stagedFiles.length - (url.trim() ? 1 : 0),
      );
      const selected = [...files]
        .filter((file) => file.size > 0 && file.size <= 6 * 1024 * 1024)
        .slice(0, available);
      const next = await Promise.all(
        selected.map(async (file) => ({
          file,
          name: file.name,
          size: file.size,
          sha256: await sha256Hex(await file.arrayBuffer()),
          previewUrl: URL.createObjectURL(file),
        })),
      );
      setStagedFiles((current) => {
        const existing = new Set(current.map((file) => file.sha256));
        const unique = next.filter((file) => !existing.has(file.sha256));
        next
          .filter((file) => existing.has(file.sha256))
          .forEach((file) => URL.revokeObjectURL(file.previewUrl));
        return [...current, ...unique];
      });
      markEvidenceChanged(
        selected.length < files.length
          ? "Some files were skipped. Use valid PNG, JPEG, or WebP screenshots under 6 MB."
          : "Screenshots ready. Analyze evidence to OCR and reconcile them with the URL.",
      );
      if (fileInput.current) fileInput.current.value = "";
    } finally {
      setIsStaging(false);
    }
  }

  function removeStagedFile(sha256: string) {
    setStagedFiles((current) => {
      const removed = current.find((file) => file.sha256 === sha256);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((file) => file.sha256 !== sha256);
    });
    markEvidenceChanged("Evidence changed. Run a new analysis when ready.");
  }

  async function runLiveCapture() {
    if (
      (!url.trim() && stagedFiles.length === 0) ||
      solariState !== "ready" ||
      runState === "running" ||
      isStaging
    )
      return;
    const generation = ++runGeneration.current;
    setLiveReport(null);
    setRunState("running");
    setLiveStatus(
      url.trim()
        ? "Inspecting the job URL, searching for matching public evidence, and preparing Solari verification…"
        : "OCRing screenshots and preparing exact evidence for Solari Sandbox verification…",
    );
    try {
      const form = new FormData();
      form.set("urls", JSON.stringify(url.trim() ? [url.trim()] : []));
      stagedFiles.forEach((item) => form.append("screenshots", item.file));
      const response = await fetch("/api/solari/analyze", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        report?: RoleTruthReport;
        error?: string;
      };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error || "The live acquisition did not finish.");
      }
      if (runGeneration.current !== generation) return;
      const previewsByHash = new Map(
        stagedFiles.map((file) => [file.sha256, file.previewUrl]),
      );
      const hydratedReport: RoleTruthReport = {
        ...payload.report,
        sources: payload.report.sources.map((source) => ({
          ...source,
          image:
            source.kind === "screenshot"
              ? previewsByHash.get(source.sha256)
              : source.image,
        })),
      };
      setLiveReport(hydratedReport);
      setSelectedField(
        hydratedReport.findings.find(
          (finding) => finding.status === "confirmed" || finding.status === "conflicted",
        )?.field ?? hydratedReport.findings[0]?.field ?? "",
      );
      setView("report");
      setRunState("complete");
      setLiveStatus(
        hydratedReport.analysisStatus === "insufficient"
          ? "No exact public match was established. Review the discovery trace or add the role title and a listing screenshot."
          : hydratedReport.analysisStatus === "partial"
            ? "Partial analysis complete. Usable evidence was reconciled; blocked or irrelevant sources remain visibly excluded."
            : "Evidence analysis complete. Every conclusion is linked to a verified source span.",
      );
    } catch (error) {
      if (runGeneration.current !== generation) return;
      setRunState("error");
      setLiveStatus(
        error instanceof Error ? error.message : "Live acquisition failed.",
      );
    }
  }

  function downloadReport() {
    const exportReport = {
      ...report,
      sources: report.sources.map((source) =>
        source.image?.startsWith("blob:")
          ? { ...source, image: undefined }
          : source,
      ),
      reportHash,
    };
    const payload = JSON.stringify(exportReport, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `${report.id}.json`;
    anchor.click();
    URL.revokeObjectURL(downloadUrl);
  }

  async function copyQuestions() {
    await navigator.clipboard.writeText(report.questions.join("\n\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="rt-shell">
      <header className="rt-topbar">
        <a className="rt-brand" href="#" aria-label="RoleTruth home">
          <span className="rt-brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>RoleTruth</span>
          <span className="rt-version">0.1</span>
        </a>

        <div className="rt-topbar-center" aria-label="Current execution mode">
          <span className="rt-live-dot" />
          <span>
            {runState === "running"
              ? "Analyzing evidence"
              : liveReport
                ? "Solari live"
                : "Reproducible demo"}
          </span>
          <span className="rt-topbar-divider" />
          <span>
            {liveReport && discoveredSources > 0
              ? `${discoveredSources} discovered · ${usableSources}/${report.sources.length} usable`
              : `${usableSources}/${report.sources.length} usable sources`}
          </span>
        </div>

        <div className="rt-top-actions">
          <a
            className="rt-icon-link"
            href="https://github.com/marcusmayo/roletruth"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
          <button className="rt-button rt-button--quiet" onClick={downloadReport}>
            <Download aria-hidden="true" size={15} />
            Export
          </button>
        </div>
      </header>

      <div className="rt-workspace">
        <aside className="rt-intake" aria-label="Evidence intake">
          <section className="rt-panel-section rt-intake-intro">
            <div className="rt-eyebrow">Evidence investigation</div>
            <h1>What does the role actually say?</h1>
            <p>
              Start with one job URL. The discovery agent finds matching public
              sources; Solari captures them; conflicts stay visible.
            </p>
            <button
              className="rt-button rt-button--primary"
              onClick={resetDemo}
              disabled={runState === "running" || isStaging}
            >
              <Play aria-hidden="true" size={16} fill="currentColor" />
              Run hiring-post demo
            </button>
          </section>

          <section className="rt-panel-section" aria-labelledby="live-source">
            <div className="rt-section-heading">
              <div>
                <div className="rt-kicker">URL-only discovery</div>
                <h2 id="live-source">Search with Solari Browser</h2>
              </div>
              <span
                className={`rt-key-state rt-key-state--${solariState}`}
                title={
                  solariState === "ready"
                    ? "SOLARI_API_KEY is present server-side; plan capabilities are checked when a run starts"
                    : "Add SOLARI_API_KEY to enable live acquisition"
                }
              >
                {solariState === "checking" ? (
                  <LoaderCircle className="rt-spin" size={14} />
                ) : solariState === "ready" ? (
                  <Check size={14} />
                ) : (
                  <KeyRound size={14} />
                )}
                {solariState === "ready" ? "Key detected" : "Key needed"}
              </span>
            </div>
            <label className="rt-field-label" htmlFor="source-url">
              Job-post URL
            </label>
            <div className="rt-url-row">
              <input
                id="source-url"
                type="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  markEvidenceChanged(
                    "Evidence changed. Analyze when the URL and screenshots are ready.",
                  );
                }}
                placeholder="https://…"
                autoComplete="url"
                disabled={runState === "running" || isStaging}
              />
            </div>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => stageFiles(event.target.files)}
            />
            <button
              className="rt-drop-button"
              onClick={() => fileInput.current?.click()}
              disabled={runState === "running" || isStaging}
            >
              <Upload aria-hidden="true" size={17} />
              <span>
                <strong>Add supporting screenshots</strong>
                <small>Optional · PNG, JPG or WebP</small>
              </span>
            </button>
            <p className="rt-upload-privacy">
              Screenshots are OCRed for this run. Review them for personal
              information before exporting or sharing a report.
            </p>
            {stagedFiles.length > 0 && (
              <ul className="rt-staged-list" aria-label="Staged screenshots">
                {stagedFiles.map((file) => (
                  <li key={`${file.name}-${file.sha256}`}>
                    <FileImage aria-hidden="true" size={15} />
                    <span>
                      {file.name}
                      <small>
                        {formatBytes(file.size)} · {shortHash(file.sha256)}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStagedFile(file.sha256)}
                      aria-label={`Remove ${file.name}`}
                      disabled={runState === "running" || isStaging}
                    >
                      <X aria-hidden="true" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="rt-button rt-button--analyze"
              onClick={runLiveCapture}
              aria-busy={runState === "running" || isStaging}
              aria-describedby={liveStatus ? "rt-live-status" : undefined}
              disabled={
                solariState !== "ready" ||
                runState === "running" ||
                isStaging ||
                (!url.trim() && stagedFiles.length === 0)
              }
            >
              {runState === "running" || isStaging ? (
                <LoaderCircle className="rt-spin" aria-hidden="true" size={16} />
              ) : (
                <ScanText aria-hidden="true" size={16} />
              )}
              <span>
                {isStaging
                  ? "Preparing screenshots…"
                  : runState === "running"
                    ? "Analyzing evidence…"
                    : "Search & reconcile evidence"}
              </span>
            </button>
            {liveStatus && (
              <p
                id="rt-live-status"
                className={`rt-live-status rt-live-status--${runState}`}
                role="status"
                aria-live="polite"
              >
                {liveStatus}
              </p>
            )}
          </section>

          <section className="rt-panel-section" aria-labelledby="test-control">
            <div className="rt-switch-row">
              <div>
                <div className="rt-kicker">Adversarial proof</div>
                <h2 id="test-control">Inject test conflict</h2>
              </div>
              <Switch
                checked={includeConflict}
                onCheckedChange={(checked) => {
                  setLiveReport(null);
                  setRunState("idle");
                  setLiveStatus("");
                  setIncludeConflict(checked);
                  setSelectedField("work_mode");
                }}
                aria-label="Inject a synthetic onsite contradiction"
                disabled={runState === "running" || isStaging}
                className="rt-switch"
              />
            </div>
            <p className="rt-helper">
              Adds a clearly labeled synthetic onsite claim. It is test data,
              never attributed to Solari.
            </p>
          </section>

          <section className="rt-panel-section rt-source-stack">
            <div className="rt-section-heading">
              <h2>Source manifest</h2>
              <span>
                {usableSources}/{report.sources.length} usable
              </span>
            </div>
            <ul>
              {report.sources.map((source, index) => (
                <li key={source.id}>
                  <span className="rt-source-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <SourceMark source={source} />
                  <span className="rt-source-copy">
                    <strong>{source.label}</strong>
                    <small>
                      {sourceOriginLabel(source)
                        ? `${sourceOriginLabel(source)} · `
                        : ""}
                      {sourceStateLabel(source)}
                    </small>
                  </span>
                  {source.acquisitionStatus === undefined ||
                  source.acquisitionStatus === "usable" ? (
                    <CheckCircle2
                      className="rt-source-ok"
                      aria-label="Evidence usable"
                      size={16}
                    />
                  ) : (
                    <AlertTriangle
                      className="rt-source-rejected"
                      aria-label={sourceStateLabel(source)}
                      size={16}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section
          className={`rt-report ${
            runState === "running" ? "rt-report--running" : ""
          }`}
          aria-label="RoleTruth report"
          aria-busy={runState === "running"}
        >
          {runState === "running" && (
            <div
              className="rt-run-banner rt-run-banner--running"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle className="rt-spin" aria-hidden="true" size={18} />
              <div className="rt-run-banner__copy">
                <strong className="rt-run-banner__title">
                  Building a new evidence report
                </strong>
                <p className="rt-run-banner__detail">
                  Inspect URL → discover matches → capture sources → Sandbox reconciliation
                </p>
              </div>
            </div>
          )}
          {runState === "error" && (
            <div className="rt-run-banner rt-run-banner--error" role="alert">
              <AlertTriangle aria-hidden="true" size={18} />
              <div className="rt-run-banner__copy">
                <strong className="rt-run-banner__title">
                  The new analysis failed
                </strong>
                <p className="rt-run-banner__detail">
                  No new report was created. The reproducible demo is shown
                  below; review the intake error and retry.
                </p>
              </div>
            </div>
          )}
          {liveReport && liveReport.analysisStatus !== "complete" && (
            <div
              className={`rt-run-banner rt-run-banner--${liveReport.analysisStatus}`}
              role="status"
              aria-live="polite"
            >
              <AlertTriangle aria-hidden="true" size={18} />
              <div className="rt-run-banner__copy">
                <strong className="rt-run-banner__title">
                  {liveReport.analysisStatus === "partial"
                    ? "Partial evidence report"
                    : "No usable job posting found"}
                </strong>
                <p className="rt-run-banner__detail">
                  {liveReport.diagnostics?.[0] ??
                    "Review source diagnostics before relying on this report."}
                </p>
              </div>
            </div>
          )}
          <header className="rt-report-header">
            <div>
              <div className="rt-eyebrow">
                Report / {report.id.replaceAll("-", " ")}
              </div>
              <h2>{reportTitle(report)}</h2>
              <p>
                {report.mode === "solari-live"
                  ? `${report.analysisStatus ?? "complete"} evidence report`
                  : "Direct-source role terms"}{" "}
                · captured{" "}
                {new Date(report.createdAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}{" "}
                UTC
              </p>
            </div>
            <div className="rt-integrity-seal">
              <ShieldCheck aria-hidden="true" size={23} />
              <span>
                <strong>{unsupported}</strong>
                unsupported claims
              </span>
            </div>
          </header>

          <div className="rt-summary-strip" aria-label="Report status summary">
            <div>
              <span className="rt-summary-value">{counts.confirmed}</span>
              <span>confirmed</span>
            </div>
            <div>
              <span className="rt-summary-value rt-summary-value--conflict">
                {counts.conflicted}
              </span>
              <span>conflicted</span>
            </div>
            <div>
              <span className="rt-summary-value rt-summary-value--unknown">
                {counts.unknown}
              </span>
              <span>unknown</span>
            </div>
            <div>
              <span className="rt-summary-value rt-summary-value--calculated">
                {counts.calculated}
              </span>
              <span>calculated</span>
            </div>
            <div className="rt-summary-proof">
              <Fingerprint aria-hidden="true" size={17} />
              <span>
                report fingerprint
                <strong>{shortHash(reportHash)}</strong>
              </span>
            </div>
          </div>

          <nav className="rt-view-tabs" aria-label="Report views">
            {(
              [
                ["report", "Claim matrix"],
                ["evidence", "Evidence ledger"],
                ["method", "How it works"],
              ] as Array<[View, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                aria-current={view === value ? "page" : undefined}
                className={view === value ? "is-active" : ""}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </nav>

          {view === "report" && (
            <div className="rt-claim-matrix">
              <div className="rt-matrix-head" aria-hidden="true">
                <span>Claim</span>
                <span>Conclusion</span>
                <span>State</span>
              </div>
              {report.findings.map((finding) => (
                <button
                  key={finding.field}
                  className={`rt-claim-row rt-claim-row--${finding.status} ${
                    selectedFinding?.field === finding.field ? "is-selected" : ""
                  }`}
                  onClick={() => setSelectedField(finding.field)}
                  aria-label={`${finding.label}: ${finding.conclusion}, ${
                    statusMeta[finding.status].label
                  }`}
                >
                  <span className="rt-claim-name">
                    <span className="rt-claim-dot" />
                    <span>
                      <small>{finding.group}</small>
                      <strong>{finding.label}</strong>
                    </span>
                  </span>
                  <span className="rt-claim-conclusion">
                    {finding.conclusion}
                    {finding.status === "calculated" && (
                      <small>scenario, not promised payout</small>
                    )}
                  </span>
                  <span className="rt-claim-state">
                    <StatusPill status={finding.status} />
                    <ExternalLink aria-hidden="true" size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {view === "evidence" && (
            <div className="rt-ledger">
              {report.discovery && (
                <section className="rt-discovery-trace" aria-labelledby="discovery-trace-title">
                  <div className="rt-discovery-trace__header">
                    <div>
                      <div className="rt-kicker">Agent provenance</div>
                      <h3 id="discovery-trace-title">Discovery trace</h3>
                    </div>
                    <span>
                      {report.discovery.candidatesScreened} screened · {report.discovery.candidatesCaptured} captured
                    </span>
                  </div>
                  <p>
                    Search results are leads only. A page becomes evidence only
                    after Solari opens it and the Sandbox verifies its sealed
                    text and image.
                  </p>
                  <dl className="rt-discovery-identity">
                    <div>
                      <dt>Role</dt>
                      <dd>{report.discovery.identity.roleTitle ?? "Not identified"}</dd>
                    </div>
                    <div>
                      <dt>Company</dt>
                      <dd>{report.discovery.identity.companyName ?? "Not identified"}</dd>
                    </div>
                    <div>
                      <dt>Job ID</dt>
                      <dd>{report.discovery.identity.jobId ?? "Not identified"}</dd>
                    </div>
                  </dl>
                  <ol className="rt-query-list">
                    {report.discovery.queries.map((query) => (
                      <li key={query.id}>
                        <span>{query.id}</span>
                        <div>
                          <code>{query.query}</code>
                          <small>
                            {query.reason} {query.provider ?? "No provider succeeded"} · {query.resultsScreened} screened · {query.candidatesAccepted} candidates
                          </small>
                          {query.diagnostic && <em>{query.diagnostic}</em>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {report.sources.map((source, index) => {
                const sourceEvidence = report.evidence.filter(
                  (span) => span.sourceId === source.id,
                );
                return (
                  <article
                    key={source.id}
                    className={`rt-ledger-entry rt-ledger-entry--${
                      source.acquisitionStatus ?? "reviewed"
                    }`}
                  >
                    <div className="rt-ledger-number">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="rt-ledger-main">
                      <div className="rt-ledger-title">
                        <SourceMark source={source} />
                        <div>
                          <h3>{source.label}</h3>
                          <p>
                            {sourceOriginLabel(source)
                              ? `${sourceOriginLabel(source)} · `
                              : ""}
                            {source.author} · {source.publisher} ·{" "}
                            {sourceStateLabel(source)}
                          </p>
                        </div>
                        {source.synthetic && (
                          <span className="rt-test-label">Test only</span>
                        )}
                        {source.acquisitionStatus && (
                          <span
                            className={`rt-source-quality rt-source-quality--${source.acquisitionStatus}`}
                          >
                            {sourceStateLabel(source)}
                          </span>
                        )}
                      </div>
                      <dl className="rt-ledger-meta">
                        <div>
                          <dt>Captured</dt>
                          <dd>{source.capturedAt}</dd>
                        </div>
                        <div>
                          <dt>SHA-256</dt>
                          <dd>{shortHash(source.sha256)}</dd>
                        </div>
                        <div>
                          <dt>Eligible spans</dt>
                          <dd>{sourceEvidence.length}</dd>
                        </div>
                        {typeof source.ocrConfidence === "number" && (
                          <div>
                            <dt>OCR confidence</dt>
                            <dd>{source.ocrConfidence.toFixed(0)}%</dd>
                          </div>
                        )}
                        {source.requestedUrl && (
                          <div>
                            <dt>Requested URL</dt>
                            <dd title={source.requestedUrl}>
                              {source.requestedUrl}
                            </dd>
                          </div>
                        )}
                        {source.discoveredVia && (
                          <div>
                            <dt>Discovered via</dt>
                            <dd>
                              {source.discoveredVia}
                              {source.searchRank ? ` · result ${source.searchRank}` : ""}
                            </dd>
                          </div>
                        )}
                        {source.identityMatch && (
                          <div>
                            <dt>Identity match</dt>
                            <dd>{source.identityMatch.replaceAll("-", " ")}</dd>
                          </div>
                        )}
                        {source.finalUrl &&
                          source.finalUrl !== source.requestedUrl && (
                            <div>
                              <dt>Final URL</dt>
                              <dd title={source.finalUrl}>{source.finalUrl}</dd>
                            </div>
                          )}
                      </dl>
                      {source.diagnostics?.map((diagnostic) => (
                        <p className="rt-ledger-diagnostic" key={diagnostic}>
                          {diagnostic}
                        </p>
                      ))}
                      {sourceEvidence.map((span) => (
                        <blockquote key={span.id}>“{span.quote}”</blockquote>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {view === "method" && (
            <div className="rt-method">
              <div className="rt-method-flow" aria-label="RoleTruth pipeline">
                {[
                  {
                    number: "01",
                    Icon: Globe2,
                    title: "Discover",
                    text: "A bounded search agent uses the submitted job identity to find candidate public sources. Search snippets remain ineligible leads.",
                  },
                  {
                    number: "02",
                    Icon: Globe2,
                    title: "Acquire",
                    text: "Solari Browser opens submitted and discovered pages, records the session, and captures final URL, text, screenshot, and time.",
                  },
                  {
                    number: "03",
                    Icon: Fingerprint,
                    title: "Seal",
                    text: "Every captured source receives SHA-256 receipts. Duplicates, unrelated openings, and inaccessible pages cannot vote.",
                  },
                  {
                    number: "04",
                    Icon: TerminalSquare,
                    title: "Reconcile",
                    text: "Solari Sandbox verifies exact quotes. Compatible claims confirm, differing claims conflict, and ambiguous or missing evidence stays unknown.",
                  },
                ].map(({ number, Icon, title, text }) => (
                  <article key={number}>
                    <span className="rt-method-number">{number}</span>
                    <Icon aria-hidden="true" size={20} />
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>

              <section className="rt-rulebook">
                <div>
                  <div className="rt-kicker">Deterministic rulebook</div>
                  <h3>Authority informs. It never hides disagreement.</h3>
                </div>
                <ul>
                  <li>
                    <span>RT-R1</span>
                    Confirm only with eligible explicit and compatible evidence.
                  </li>
                  <li>
                    <span>RT-R2</span>
                    Preserve materially incompatible evidence as a conflict.
                  </li>
                  <li>
                    <span>RT-R3</span>
                    Treat absence, ambiguity, and failed capture as unknown.
                  </li>
                  <li>
                    <span>RT-C1</span>
                    Label every derived value and expose its full formula.
                  </li>
                </ul>
              </section>
            </div>
          )}

          <section className="rt-questions" aria-labelledby="questions-title">
            <div>
              <div className="rt-kicker">Decision-ready follow-up</div>
              <h2 id="questions-title">
                {report.questions.length} questions close the remaining gaps
              </h2>
            </div>
            <button className="rt-button rt-button--quiet" onClick={copyQuestions}>
              {copied ? (
                <Check aria-hidden="true" size={15} />
              ) : (
                <Copy aria-hidden="true" size={15} />
              )}
              {copied ? "Copied" : "Copy questions"}
            </button>
            <ol>
              {report.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
          </section>
        </section>

        <aside className="rt-inspector" aria-label="Evidence inspector">
          {selectedFinding && (
            <>
              <header>
                <div className="rt-eyebrow">Evidence inspector</div>
                <StatusPill status={selectedFinding.status} />
                <h2>{selectedFinding.label}</h2>
                <p className="rt-inspector-conclusion">
                  {selectedFinding.conclusion}
                </p>
              </header>

              <section className="rt-inspector-rule">
                <span>Rule fired</span>
                <strong>{selectedFinding.ruleId}</strong>
                <p>{selectedFinding.explanation}</p>
              </section>

              {selectedFinding.status === "calculated" && (
                <section className="rt-calculation">
                  <div className="rt-kicker">Calculation inspector</div>
                  <code>{report.calculations[0]?.formula}</code>
                  <div className="rt-calculation-result">
                    <span>=</span>
                    <strong>{report.calculations[0]?.result}</strong>
                  </div>
                  <p>{report.calculations[0]?.disclaimer}</p>
                </section>
              )}

              <div className="rt-evidence-stack">
                {selectedEvidence.length === 0 ? (
                  <div className="rt-empty-evidence">
                    <CircleHelp aria-hidden="true" size={22} />
                    <strong>No explicit supporting span</strong>
                    <p>
                      That is why RoleTruth abstained. Missing evidence is not a
                      negative claim.
                    </p>
                  </div>
                ) : (
                  selectedEvidence.map((span) => {
                    if (!span) return null;
                    const source = report.sources.find(
                      (item) => item.id === span.sourceId,
                    );
                    return (
                      <article key={span.id} className="rt-evidence-card">
                        {source?.image ? (
                          <div className="rt-evidence-image">
                            {/* User-provided source screenshot; no remote tracking. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={source.image} alt={source.label} />
                            <span>sealed source</span>
                          </div>
                        ) : source?.kind === "url" ? (
                          <div className="rt-live-source-card">
                            <Globe2 aria-hidden="true" size={24} />
                            <span>Live Solari capture</span>
                          </div>
                        ) : (
                          <div className="rt-synthetic-card">
                            <Braces aria-hidden="true" size={24} />
                            <span>Synthetic contradiction</span>
                          </div>
                        )}
                        <div className="rt-evidence-body">
                          <div className="rt-evidence-source">
                            <SourceMark
                              source={
                                source ?? {
                                  id: "missing",
                                  label: "Unknown",
                                  publisher: "",
                                  author: "",
                                  kind: "synthetic",
                                  authority: "test-only",
                                  capturedAt: "",
                                  sha256: "",
                                }
                              }
                            />
                            <span>
                              <strong>{source?.label}</strong>
                              <small>{span.location}</small>
                            </span>
                          </div>
                          <blockquote>“{span.quote}”</blockquote>
                          <dl>
                            <div>
                              <dt>
                                <Clock3 aria-hidden="true" size={13} /> Captured
                              </dt>
                              <dd>{source?.capturedAt}</dd>
                            </div>
                            <div>
                              <dt>
                                <Hash aria-hidden="true" size={13} /> Source hash
                              </dt>
                              <dd>{shortHash(source?.sha256 ?? "")}</dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {selectedFinding.question && (
                <section className="rt-question-card">
                  <span>Clarify</span>
                  <p>{selectedFinding.question}</p>
                </section>
              )}

              <footer className="rt-inspector-footer">
                <span>
                  <FileSearch aria-hidden="true" size={14} />
                  {selectedFinding.evidenceIds.length} linked span
                  {selectedFinding.evidenceIds.length === 1 ? "" : "s"}
                </span>
                <span>
                  <ShieldCheck aria-hidden="true" size={14} />
                  deterministic verdict
                </span>
              </footer>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
