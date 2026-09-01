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
  ShieldCheck,
  TerminalSquare,
  Upload,
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
type StagedFile = { name: string; size: number; sha256: string };

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
  const fileInput = useRef<HTMLInputElement>(null);

  const demoReport = useMemo(
    () => buildReport(demoFixture, includeConflict),
    [includeConflict],
  );
  const report = liveReport ?? demoReport;

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
    setLiveReport(null);
    setLiveStatus("");
    setSelectedField("work_mode");
    setView("report");
  }

  async function stageFiles(files: FileList | null) {
    if (!files) return;
    const available = Math.max(0, 8 - stagedFiles.length);
    const next = await Promise.all(
      [...files].slice(0, available).map(async (file) => ({
        name: file.name,
        size: file.size,
        sha256: await sha256Hex(await file.arrayBuffer()),
      })),
    );
    setStagedFiles((current) => [...current, ...next]);
    setLiveStatus(
      "Screenshot evidence staged locally. Live URL acquisition remains separate.",
    );
  }

  async function runLiveCapture() {
    if (!url.trim() || solariState !== "ready") return;
    setLiveStatus("Solari Browser is acquiring the source…");
    try {
      const response = await fetch("/api/solari/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: [url.trim()] }),
      });
      const payload = (await response.json()) as {
        report?: RoleTruthReport;
        error?: string;
      };
      if (!response.ok || !payload.report) {
        throw new Error(payload.error || "The live acquisition did not finish.");
      }
      setLiveReport(payload.report);
      setSelectedField(payload.report.findings[0]?.field ?? "");
      setView("report");
      setLiveStatus("Live Solari acquisition and sandbox reconciliation complete.");
    } catch (error) {
      setLiveStatus(
        error instanceof Error ? error.message : "Live acquisition failed.",
      );
    }
  }

  function downloadReport() {
    const payload = JSON.stringify({ ...report, reportHash }, null, 2);
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
          <span>{liveReport ? "Solari live" : "Reproducible demo"}</span>
          <span className="rt-topbar-divider" />
          <span>{report.sources.length} sealed sources</span>
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
            <div className="rt-eyebrow">Evidence intake</div>
            <h1>What does the role actually say?</h1>
            <p>
              Reconcile direct sources into traceable decisions. Ambiguity stays
              visible.
            </p>
            <button className="rt-button rt-button--primary" onClick={resetDemo}>
              <Play aria-hidden="true" size={16} fill="currentColor" />
              Run hiring-post demo
            </button>
          </section>

          <section className="rt-panel-section" aria-labelledby="live-source">
            <div className="rt-section-heading">
              <div>
                <div className="rt-kicker">Live source</div>
                <h2 id="live-source">Acquire with Solari</h2>
              </div>
              <span
                className={`rt-key-state rt-key-state--${solariState}`}
                title={
                  solariState === "ready"
                    ? "SOLARI_API_KEY is configured server-side"
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
                {solariState === "ready" ? "Ready" : "Key needed"}
              </span>
            </div>
            <label className="rt-field-label" htmlFor="source-url">
              Public job-post URL
            </label>
            <div className="rt-url-row">
              <input
                id="source-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…"
                autoComplete="url"
              />
              <button
                className="rt-square-button"
                onClick={runLiveCapture}
                disabled={solariState !== "ready" || !url.trim()}
                aria-label="Analyze URL with Solari"
              >
                <ArrowUpRight aria-hidden="true" size={17} />
              </button>
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
            >
              <Upload aria-hidden="true" size={17} />
              <span>
                <strong>Stage screenshots</strong>
                <small>PNG, JPG or WebP · up to 8 sources</small>
              </span>
            </button>
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
                  </li>
                ))}
              </ul>
            )}
            {liveStatus && (
              <p className="rt-live-status" role="status" aria-live="polite">
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
                  setIncludeConflict(checked);
                  setSelectedField("work_mode");
                }}
                aria-label="Inject a synthetic onsite contradiction"
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
              <span>{report.sources.length}/8</span>
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
                      {source.author} · {source.authority}
                    </small>
                  </span>
                  <CheckCircle2
                    className="rt-source-ok"
                    aria-label="Evidence eligible"
                    size={16}
                  />
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="rt-report" aria-label="RoleTruth report">
          <header className="rt-report-header">
            <div>
              <div className="rt-eyebrow">
                Report / {report.id.replaceAll("-", " ")}
              </div>
              <h2>Solari SWE internship</h2>
              <p>
                Direct-source role terms · captured{" "}
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
              {report.sources.map((source, index) => {
                const sourceEvidence = report.evidence.filter(
                  (span) => span.sourceId === source.id,
                );
                return (
                  <article key={source.id} className="rt-ledger-entry">
                    <div className="rt-ledger-number">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="rt-ledger-main">
                      <div className="rt-ledger-title">
                        <SourceMark source={source} />
                        <div>
                          <h3>{source.label}</h3>
                          <p>
                            {source.author} · {source.publisher} ·{" "}
                            {source.authority}
                          </p>
                        </div>
                        {source.synthetic && (
                          <span className="rt-test-label">Test only</span>
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
                      </dl>
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
                    title: "Acquire",
                    text: "Solari Browser renders public sources, records the session, and captures final URL, text, screenshot, and time.",
                  },
                  {
                    number: "02",
                    Icon: Fingerprint,
                    title: "Seal",
                    text: "Every source receives a SHA-256 digest. Exact text spans remain attached to their source.",
                  },
                  {
                    number: "03",
                    Icon: TerminalSquare,
                    title: "Reconcile",
                    text: "Solari Sandbox runs the deterministic rules. The model may propose assertions; it cannot assign verdicts.",
                  },
                  {
                    number: "04",
                    Icon: ShieldCheck,
                    title: "Abstain",
                    text: "Explicit compatible evidence confirms. Incompatibility conflicts. Missing or ambiguous evidence stays unknown.",
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
