import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Activity,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Database,
  FileJson,
  FileSearch,
  Filter,
  FlaskConical,
  GitBranch,
  Layers3,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldAlert,
  TriangleAlert,
  X,
  ExternalLink,
  Factory,
  BookOpen,
  Eye,
} from "lucide-react";
import {
  BATCHES,
  SPECS,
  FIELDS,
  LIMITS,
  Problem,
  applyPatch,
  hash,
  validateImport,
  verifySnapshot,
} from "./domain.ts";
import type {
  Snapshot,
  Role,
  SourceRow,
  Field,
  Primitive,
  Proposal,
} from "./domain.ts";
import { SAMPLE, GAP_FILL, CORRECTION_EXAMPLE } from "./fixtures.ts";
import { api, loadSession, saveSession } from "./client.ts";
import type { Session, Result } from "./client.ts";
import { download, packBytes } from "./export.ts";
type View = "overview" | "intake" | "review" | "audit" | "method";
const nav: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Quality overview", icon: Activity },
  { id: "intake", label: "Source intake", icon: ArrowUpFromLine },
  { id: "review", label: "Correction review", icon: ClipboardCheck },
  { id: "audit", label: "Audit trail", icon: GitBranch },
  { id: "method", label: "Method & evidence", icon: BookOpen },
];
const labels: Record<Role, string> = {
  operator: "Operator",
  reviewer: "Reviewer",
  observer: "Observer",
};
const show = (v: unknown) =>
  v === null || v === undefined ? "Missing" : String(v);
const time = (v: string) =>
  new Date(v).toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " UTC";
function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`tag ${tone}`}>
      <span />
      {children}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">TRACEABILITY LAB</span>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession()),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [role, setRole] = useState<Role>("operator"),
    [view, setView] = useState<View>("overview"),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [selectedBatch, setSelectedBatch] = useState("all"),
    [search, setSearch] = useState(""),
    [rowId, setRowId] = useState<string | null>(null),
    [fresh, setFresh] = useState(false),
    [integrity, setIntegrity] = useState<Awaited<
      ReturnType<typeof verifySnapshot>
    > | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    findingsRef = useRef<HTMLElement>(null);
  const accept = (s: Snapshot) => {
    setSnapshot((old) =>
      old &&
      old.workspace.id === s.workspace.id &&
      old.workspace.revision > s.workspace.revision
        ? old
        : s,
    );
    setIntegrity(null);
  };
  const work = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The action could not be completed.",
      );
    } finally {
      setBusy(null);
    }
  };
  const refresh = async (s = session, r = role) => {
    if (!s) return;
    const result = await api<Result>(`/api/workspaces/${s.workspaceId}`, s, r);
    accept(result.snapshot);
  };
  useEffect(() => {
    const initial = loadSession();
    if (initial)
      void work("Restoring workspace", () => refresh(initial, "operator"));
  }, []);
  const go = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const start = async () => {
    const created = await api<Session & Result>(
      "/api/workspaces",
      null,
      "operator",
      {},
    );
    const saved: Session = {
      workspaceId: created.workspaceId,
      expiresAt: created.expiresAt,
      capabilities: created.capabilities,
    };
    setSession(saved);
    accept(created.snapshot);
    if (!saveSession(saved))
      setMessage(
        "Browser storage is unavailable. This workspace remains open in memory; export before closing.",
      );
    return { session: saved, snapshot: created.snapshot };
  };
  const ingest = async (file: typeof SAMPLE) => {
    if (role !== "operator")
      throw new Error("Switch to the Operator demo role to ingest data.");
    const current = session && snapshot ? { session, snapshot } : await start();
    const result = await api<Result>(
      `/api/workspaces/${current.session.workspaceId}/imports`,
      current.session,
      role,
      {
        revision: current.snapshot.workspace.revision,
        requestId: await hash(file),
        file,
        actorLabel: "Demo operator",
      },
    );
    accept(result.snapshot);
    setMessage(
      result.replayed
        ? "This file was already received. Its existing evidence was retained."
        : `${file.records.length} source ${file.records.length === 1 ? "row" : "rows"} ingested. Quality checks and lineage are recorded.`,
    );
    setView("overview");
    setSelectedBatch("all");
  };
  const exportPack = () =>
    work("Preparing evidence", async () => {
      if (!snapshot) return;
      const bytes = await packBytes(snapshot);
      download("traceability-evidence.zip", bytes, "application/zip");
      setMessage(
        "Evidence verified and exported. Workspace access keys are excluded.",
      );
    });
  const changeRole = (r: Role) => {
    setRole(r);
    setMessage(
      `${labels[r]} demo role selected. Server permissions apply to each action.`,
    );
    if (session) void work("Refreshing role view", () => refresh(session, r));
  };
  const summary = snapshot?.quality.summary ?? {
    received: 0,
    usable: 0,
    quarantined: 0,
    duplicates: 0,
    observed: 0,
    expected: 9,
    errors: 0,
    notices: 0,
    coveragePercent: 0,
  };
  const pending =
    snapshot?.proposals.filter((p) => p.status === "pending").length ?? 0;
  const activeRow = snapshot?.rows.find((r) => r.id === rowId);
  const filteredFindings =
    snapshot?.findings.filter(
      (f) =>
        f.status === "open" &&
        (selectedBatch === "all" || f.batchCode === selectedBatch) &&
        (!search ||
          [f.code, f.message, f.batchCode, f.field]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase())),
    ) ?? [];
  const batchRows =
    snapshot?.quality.batches ??
    BATCHES.map((b) => ({
      ...b,
      observed: 0,
      expected: 3,
      usable: 0,
      errors: 0,
      notices: 0,
      state: "awaiting",
    }));
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to workbench
      </a>
      <div className="top-strip">
        <span>
          <FlaskConical size={13} /> SYNTHETIC MANUFACTURING DATA
        </span>
        <span>A working demonstration. No product release decisions.</span>
      </div>
      <header className="app-header">
        <a href="/" className="brand" aria-label="Traceability Lab home">
          <span className="brand-symbol">
            <Factory size={23} strokeWidth={1.5} />
          </span>
          <span>
            Traceability<span className="brand-light">Lab.</span>
          </span>
        </a>
        <div className="header-actions">
          <span className="connection">
            <span className={snapshot ? "online" : ""} />
            {snapshot
              ? `Workspace · revision ${snapshot.workspace.revision}`
              : "Ready for a synthetic run"}
          </span>
          <button
            className="secondary compact"
            onClick={() => void work("Refreshing workspace", () => refresh())}
            disabled={!session || !!busy}
            aria-label="Refresh workspace"
          >
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
          <button
            className="primary compact"
            onClick={() => void exportPack()}
            disabled={!snapshot?.imports.length || !!busy}
          >
            <ArrowDownToLine size={16} />
            <span>Export evidence</span>
          </button>
        </div>
      </header>
      <div className="navigation-wrap">
        <nav className="navigation" aria-label="Workbench sections">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={view === n.id ? "selected" : ""}
              aria-current={view === n.id ? "page" : undefined}
            >
              <n.icon size={16} />
              {n.label}
              {n.id === "review" && pending > 0 && (
                <span className="count-badge">{pending}</span>
              )}
            </button>
          ))}
        </nav>
        <label className="role-control">
          <span>Demo role</span>
          <select
            aria-label="Demo role"
            value={role}
            onChange={(e) => changeRole(e.target.value as Role)}
            disabled={!!busy}
          >
            {(["operator", "reviewer", "observer"] as Role[]).map((r) => (
              <option key={r} value={r}>
                {labels[r]}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      <main id="main" className="shell">
        {message && (
          <div className="notification" role="status">
            <CheckCheck size={17} />
            <span>{message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setMessage("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {error && (
          <div className="notification error" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
            <button className="text-button" onClick={() => setFresh(true)}>
              Start a new workspace
            </button>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {busy && (
          <div className="busy-status" role="status">
            <LoaderCircle className="spin" size={14} />
            {busy}
          </div>
        )}
        {view === "overview" && (
          <>
            <section className="hero">
              <div>
                <span className="eyebrow">
                  <span className="little-line" /> SOURCE → QUALITY →
                  TRACEABILITY
                </span>
                <h1>
                  Every reading.
                  <br />
                  <span>An accountable trail.</span>
                </h1>
                <p>
                  Find the defect. Follow it to its source.
                  <br className="desktop-break" /> Review the correction without
                  losing the original.
                </p>
                <div className="hero-actions">
                  <button
                    className="primary"
                    disabled={!!busy || role !== "operator"}
                    onClick={() =>
                      void work("Ingesting synthetic run", () => ingest(SAMPLE))
                    }
                  >
                    <Plus size={17} />
                    {snapshot?.imports.length
                      ? "Recheck sample import"
                      : "Ingest sample run"}
                    <ArrowRight size={17} />
                  </button>
                  <button className="text-button" onClick={() => go("method")}>
                    How this lab works <ArrowUpRight size={15} />
                  </button>
                </div>
                {role !== "operator" && !snapshot?.imports.length && (
                  <small className="helper">
                    Choose Operator to start ingestion.
                  </small>
                )}
              </div>
              <div className="hero-schematic" aria-label="Pipeline overview">
                <div className="schematic-label">
                  <span className="live-dot" /> AN INSPECTABLE DATA PIPELINE{" "}
                  <span>01 / 04</span>
                </div>
                <div className="schematic-nodes">
                  <div>
                    <span className="node-icon">
                      <FileJson size={22} />
                    </span>
                    <strong>Source records</strong>
                    <small>Retain the original</small>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <span className="node-icon accent">
                      <ShieldCheck size={22} />
                    </span>
                    <strong>Quality checks</strong>
                    <small>Explain each finding</small>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <span className="node-icon">
                      <Database size={22} />
                    </span>
                    <strong>Curated data</strong>
                    <small>Review every change</small>
                  </div>
                </div>
                <div className="schematic-footer">
                  <GitBranch size={15} />
                  <span>Lineage is attached, not reconstructed later.</span>
                </div>
              </div>
            </section>
            <section
              className="metric-grid"
              aria-label="Current quality metrics"
            >
              <div className="metric">
                <span>
                  <Layers3 size={15} /> Source rows received
                </span>
                <strong>
                  {summary.received}
                  <small>rows</small>
                </strong>
                <p>
                  <b>{summary.usable}</b> usable <i /> {summary.quarantined}{" "}
                  quarantined <i /> {summary.duplicates} duplicates
                </p>
              </div>
              <div className="metric">
                <span>
                  <TriangleAlert size={15} /> Open findings
                </span>
                <strong>
                  {summary.errors + summary.notices}
                  <small>findings</small>
                </strong>
                <p>
                  <b className="rust">{summary.errors} errors</b>
                  <i />
                  {summary.notices} duplicate notice
                  {summary.notices === 1 ? "" : "s"}
                </p>
              </div>
              <div className="metric">
                <span>
                  <Activity size={15} /> Expected sample coverage
                </span>
                <strong>
                  {summary.observed}
                  <small>/ {summary.expected}</small>
                  <em>{summary.coveragePercent}%</em>
                </strong>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="Expected measurements observed"
                  aria-valuemin={0}
                  aria-valuemax={9}
                  aria-valuenow={summary.observed}
                >
                  <span style={{ width: summary.coveragePercent + "%" }} />
                </div>
                <p>Observed includes quarantined readings</p>
              </div>
              <div className="metric">
                <span>
                  <ClipboardCheck size={15} /> Reviewed corrections
                </span>
                <strong>
                  {snapshot?.proposals.filter((p) => p.status === "approved")
                    .length ?? 0}
                  <small>approved</small>
                </strong>
                <p>
                  <b>{pending}</b> pending review <i /> Original rows retained
                </p>
              </div>
            </section>
            <section className="panel batch-panel">
              <div className="section-head">
                <div>
                  <span className="eyebrow">PRODUCTION PLAN / FICTIONAL</span>
                  <h2>Three batches. Full context.</h2>
                </div>
                <Tag tone={snapshot?.imports.length ? "green" : "neutral"}>
                  {snapshot?.imports.length
                    ? "Checks evaluated"
                    : "Awaiting ingestion"}
                </Tag>
              </div>
              <div className="table-scroll">
                <table className="batch-table">
                  <thead>
                    <tr>
                      <th>Batch / material</th>
                      <th>Production line</th>
                      <th>Expected samples</th>
                      <th>Usable measurements</th>
                      <th>Quality state</th>
                      <th>
                        <span className="sr-only">Inspect</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchRows.map((b) => (
                      <tr key={b.code}>
                        <td>
                          <button
                            className="batch-link"
                            onClick={() => {
                              setSelectedBatch(b.code);
                              findingsRef.current?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }}
                          >
                            {b.code}
                            <ArrowUpRight size={14} />
                          </button>
                          <small>{b.material}</small>
                        </td>
                        <td>
                          <span className="line-pill">
                            <span />
                            {b.line}
                          </span>
                          <small>Forming · sample S01</small>
                        </td>
                        <td>
                          <b>
                            {b.observed} / {b.expected}
                          </b>
                          <small>Received at the declared grain</small>
                        </td>
                        <td>
                          <b>{b.usable}</b>
                          <small>Pass all row checks</small>
                        </td>
                        <td>
                          <Tag
                            tone={
                              b.state === "clear"
                                ? "green"
                                : b.state === "attention"
                                  ? "amber"
                                  : "neutral"
                            }
                          >
                            {b.state === "clear"
                              ? "No open findings"
                              : b.state === "attention"
                                ? "Investigation required"
                                : "No data received"}
                          </Tag>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Inspect batch ${b.code}`}
                            onClick={() => {
                              setSelectedBatch(b.code);
                              findingsRef.current?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-foot">
                <span>
                  <Link2 size={14} /> Each expected slot is batch + sample +
                  stage + parameter.
                </span>
                <button className="text-button" onClick={() => go("method")}>
                  Inspect the rules <ArrowRight size={14} />
                </button>
              </div>
            </section>
            <div className="investigation-layout">
              <section className="panel findings-panel" ref={findingsRef}>
                <div className="section-head">
                  <div>
                    <span className="eyebrow">INVESTIGATION QUEUE</span>
                    <h2>Make the exception explainable.</h2>
                  </div>
                  <span className="number-chip">{filteredFindings.length}</span>
                </div>
                <div className="filter-bar">
                  <label className="search">
                    <Search size={15} />
                    <input
                      aria-label="Search findings"
                      placeholder="Search findings..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <label className="select-filter">
                    <Filter size={14} />
                    <select
                      aria-label="Filter batch"
                      value={selectedBatch}
                      onChange={(e) => setSelectedBatch(e.target.value)}
                    >
                      <option value="all">All batches</option>
                      {BATCHES.map((b) => (
                        <option key={b.code}>{b.code}</option>
                      ))}
                      <option value="AX-9999">Unplanned AX-9999</option>
                    </select>
                  </label>
                </div>
                {!snapshot?.imports.length ? (
                  <div className="empty">
                    <span className="empty-icon">
                      <FileSearch size={30} />
                    </span>
                    <h3>Start with the source.</h3>
                    <p>
                      Ingest the synthetic run to evaluate 11 rows against nine
                      expected measurement slots. Every finding has a specific
                      reason.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => go("intake")}
                    >
                      Explore source intake <ArrowRight size={15} />
                    </button>
                  </div>
                ) : filteredFindings.length === 0 ? (
                  <div className="empty">
                    <CheckCheck size={30} />
                    <h3>No open findings in this view.</h3>
                    <p>
                      Use the audit trail to inspect resolved findings and
                      reviewed corrections.
                    </p>
                  </div>
                ) : (
                  <div className="findings-list">
                    {filteredFindings.map((f) => (
                      <article className="finding" key={f.id}>
                        <span className={`finding-icon ${f.severity}`}>
                          <TriangleAlert size={17} />
                        </span>
                        <div>
                          <div className="finding-title">
                            <strong>
                              {f.code.toLowerCase().replaceAll("_", " ")}
                            </strong>
                            <Tag
                              tone={f.severity === "error" ? "red" : "amber"}
                            >
                              {f.severity}
                            </Tag>
                          </div>
                          <p>{f.message}</p>
                          <div className="finding-meta">
                            <span>{f.batchCode}</span>
                            <i />
                            {f.rowId ? (
                              <span>
                                {show(
                                  snapshot.rows.find((r) => r.id === f.rowId)
                                    ?.raw.sourceRecordId,
                                )}
                              </span>
                            ) : (
                              <span>Expected sampling plan</span>
                            )}
                          </div>
                        </div>
                        {f.rowId ? (
                          <button
                            className="text-button"
                            onClick={() => setRowId(f.rowId)}
                            aria-label={`Trace ${f.code} for ${show(snapshot.rows.find((r) => r.id === f.rowId)?.raw.sourceRecordId)}`}
                          >
                            Trace row <ArrowRight size={15} />
                          </button>
                        ) : (
                          <button
                            className="text-button"
                            onClick={() => go("intake")}
                          >
                            Inspect gap <ArrowRight size={15} />
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <aside className="side-stack">
                <section className="dark-panel">
                  <span className="eyebrow">THE FIVE-MINUTE INVESTIGATION</span>
                  <h2>
                    From exception
                    <br />
                    to evidence.
                  </h2>
                  <ol>
                    <li>
                      <span>01</span>
                      <div>
                        <strong>Ingest the run</strong>
                        <p>Keep every source row, including failures.</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <strong>Follow MES-004</strong>
                        <p>Inspect its unit mismatch and raw payload.</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <strong>Propose, then review</strong>
                        <p>
                          Switch demo roles to approve a sourced correction.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>04</span>
                      <div>
                        <strong>Export the trail</strong>
                        <p>Reconcile the original with the current value.</p>
                      </div>
                    </li>
                  </ol>
                  <button
                    onClick={() => {
                      const r = snapshot?.rows.find(
                        (r) =>
                          r.raw.sourceRecordId === "MES-004" && !r.duplicateOf,
                      );
                      if (r) setRowId(r.id);
                      else
                        void work("Ingesting synthetic run", () =>
                          ingest(SAMPLE),
                        );
                    }}
                    disabled={
                      !!busy ||
                      (!snapshot?.imports.length && role !== "operator")
                    }
                  >
                    Investigate the unit mismatch <ArrowUpRight size={16} />
                  </button>
                </section>
                <section className="note-panel">
                  <ShieldCheck size={24} />
                  <h3>The original stays original.</h3>
                  <p>
                    Approved changes update a versioned measurement overlay. Raw
                    rows, source hashes and the review history remain available.
                  </p>
                  <button className="text-button" onClick={() => go("audit")}>
                    Open audit trail <ArrowRight size={15} />
                  </button>
                </section>
              </aside>
            </div>
          </>
        )}
        {view === "intake" && (
          <>
            <PageIntro
              eyebrow="01 / SOURCE INTAKE"
              title="Quality begins at the source."
              description="Import a bounded synthetic JSON run. Every received row is retained before the service evaluates its measurement quality."
            />
            <div className="intake-layout">
              <section className="panel intake-card">
                <div className="upload-illustration">
                  <ArrowUpFromLine size={38} />
                  <span>JSON</span>
                </div>
                <h2>Bring a synthetic run into view.</h2>
                <p>
                  The sample deliberately contains missing values, a unit
                  mismatch, duplicate/conflicting readings, an unplanned batch
                  and an out-of-range temperature.
                </p>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={!!busy || role !== "operator"}
                    onClick={() =>
                      void work("Ingesting synthetic run", () => ingest(SAMPLE))
                    }
                  >
                    <Plus size={16} />
                    Ingest sample run
                  </button>
                  <button
                    className="secondary"
                    disabled={!!busy || role !== "operator"}
                    onClick={() => fileInput.current?.click()}
                  >
                    <ArrowUpFromLine size={16} />
                    Import JSON file
                  </button>
                </div>
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept="application/json,.json"
                  aria-label="Synthetic source file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void work("Validating source file", async () => {
                        if (file.size > LIMITS.importBytes)
                          throw new Error(
                            "Import files must be 64 KiB or smaller.",
                          );
                        let parsed: unknown;
                        try {
                          parsed = JSON.parse(await file.text());
                        } catch {
                          throw new Error(
                            "The selected file is not valid JSON.",
                          );
                        }
                        await ingest(validateImport(parsed));
                      });
                    e.target.value = "";
                  }}
                />
                <small>
                  Operator role required · 25 rows per import · 64 KiB ·
                  synthetic data only
                </small>
              </section>
              <aside className="panel sample-card">
                <span className="eyebrow">A DECLARED, TESTABLE FIXTURE</span>
                <h2>Know what the sample contains.</h2>
                <dl>
                  <div>
                    <dt>Production plan</dt>
                    <dd>3 batches · 3 parameters · sample S01</dd>
                  </div>
                  <div>
                    <dt>Raw rows</dt>
                    <dd>11, including 2 duplicate rows</dd>
                  </div>
                  <div>
                    <dt>Expected coverage</dt>
                    <dd>8 of 9 slots received</dd>
                  </div>
                  <div>
                    <dt>Initial row outcomes</dt>
                    <dd>4 usable · 5 quarantined · 2 duplicates</dd>
                  </div>
                </dl>
                <button
                  className="text-button"
                  onClick={() =>
                    download(
                      "synthetic-press-run.json",
                      JSON.stringify(SAMPLE, null, 2),
                    )
                  }
                >
                  <ArrowDownToLine size={15} />
                  Download sample JSON
                </button>
                <div className="followup">
                  <span className="eyebrow">CLOSE THE COMPLETENESS GAP</span>
                  <p>
                    A separate pressure reading supplies the missing AX-1103
                    slot. It improves coverage while preserving the existing
                    findings.
                  </p>
                  <button
                    className="secondary"
                    disabled={
                      !!busy || role !== "operator" || !snapshot?.imports.length
                    }
                    onClick={() =>
                      void work("Ingesting follow-up reading", () =>
                        ingest(GAP_FILL),
                      )
                    }
                  >
                    Ingest follow-up reading <ArrowRight size={15} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      download(
                        "synthetic-pressure-followup.json",
                        JSON.stringify(GAP_FILL, null, 2),
                      )
                    }
                  >
                    Download follow-up JSON <ArrowDownToLine size={13} />
                  </button>
                </div>
              </aside>
            </div>
            <section className="panel">
              <div className="section-head">
                <div>
                  <span className="eyebrow">RECEIPTS & SOURCE LINEAGE</span>
                  <h2>Received imports</h2>
                </div>
                <Tag>
                  {snapshot?.imports.length ?? 0} / {LIMITS.imports} import
                  limit
                </Tag>
              </div>
              {!snapshot?.imports.length ? (
                <div className="empty">
                  <Database size={27} />
                  <p>No source data has been ingested in this workspace.</p>
                </div>
              ) : (
                snapshot.imports.map((i) => (
                  <div className="import-receipt" key={i.id}>
                    <FileJson size={25} />
                    <div>
                      <strong>{i.source}</strong>
                      <p>
                        {i.rows} retained rows · {time(i.createdAt)}
                      </p>
                      <code>Canonical SHA-256: {i.digest}</code>
                    </div>
                    <Tag tone="green">Received</Tag>
                  </div>
                ))
              )}
            </section>
            {!!snapshot?.rows.length && (
              <section className="panel raw-table">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">RETAINED SOURCE ROWS</span>
                    <h2>Open the original evidence.</h2>
                  </div>
                  <span>{snapshot.rows.length} rows</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Source record</th>
                        <th>Batch</th>
                        <th>Parameter</th>
                        <th>Original value</th>
                        <th>Disposition</th>
                        <th>Lineage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{show(r.raw.sourceRecordId)}</strong>
                            <small>Row {r.ordinal}</small>
                          </td>
                          <td>{show(r.raw.batchCode)}</td>
                          <td>{show(r.raw.parameter)}</td>
                          <td>
                            {show(r.raw.value)} {show(r.raw.unit)}
                          </td>
                          <td>
                            <Tag
                              tone={
                                r.duplicateOf
                                  ? "amber"
                                  : snapshot.quality.findings.some(
                                        (f) => f.rowId === r.id,
                                      )
                                    ? "red"
                                    : "green"
                              }
                            >
                              {r.duplicateOf
                                ? "Duplicate retained"
                                : snapshot.quality.findings.some(
                                      (f) => f.rowId === r.id,
                                    )
                                  ? "Quarantined"
                                  : "Usable"}
                            </Tag>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setRowId(r.id)}
                              aria-label={`Inspect ${show(r.raw.sourceRecordId)} source row ${r.ordinal}`}
                            >
                              Trace row <ArrowUpRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
        {view === "review" && (
          <>
            <PageIntro
              eyebrow="02 / CONTROLLED CORRECTIONS"
              title="A correction needs a reason."
              description="An operator proposes a change against a specific measurement version. A reviewer records the decision. The service enforces both demo roles."
            />
            <div className="role-notice">
              <ShieldCheck size={21} />
              <div>
                <strong>
                  Role simulation, with server-enforced permissions.
                </strong>
                <p>
                  One visitor can switch roles. Labels are unverified and do not
                  establish separate people or independent approval.
                </p>
              </div>
              <Tag>{labels[role]} view</Tag>
            </div>
            {!snapshot?.proposals.length ? (
              <section className="panel empty large">
                <ClipboardCheck size={34} />
                <h2>No corrections proposed yet.</h2>
                <p>
                  Open the MES-004 unit finding and prepare a sourced
                  correction. Current measurements do not change until approval.
                </p>
                <button className="primary" onClick={() => go("overview")}>
                  Find a measurement <ArrowRight size={16} />
                </button>
              </section>
            ) : (
              <section className="review-list">
                {snapshot.proposals.map((p) => (
                  <ReviewCard
                    key={p.id}
                    proposal={p}
                    snapshot={snapshot}
                    role={role}
                    busy={!!busy}
                    onInspect={() => setRowId(p.rowId)}
                    onReview={(decision, reason) =>
                      void work("Recording review", async () => {
                        const result = await api<Result>(
                          `/api/workspaces/${session!.workspaceId}/review`,
                          session,
                          role,
                          {
                            revision: snapshot.workspace.revision,
                            proposalId: p.id,
                            decision,
                            reason,
                            actorLabel: "Demo reviewer",
                          },
                        );
                        accept(result.snapshot);
                        setMessage(
                          decision === "approved"
                            ? "Correction approved. The current measurement changed; the raw source and resolved finding remain in the trail."
                            : "Correction rejected. The decision is recorded; measurement values are unchanged.",
                        );
                      })
                    }
                  />
                ))}
              </section>
            )}
          </>
        )}
        {view === "audit" && (
          <>
            <PageIntro
              eyebrow="03 / INVESTIGATION HISTORY"
              title="The trail is part of the data."
              description="Inspect actual server-recorded imports, proposals and review decisions. Verify that source hashes, finding history and current values reconcile."
            />
            <div className="audit-grid">
              <section className="panel">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">WORKSPACE LEDGER</span>
                    <h2>{snapshot?.audit.length ?? 0} recorded events</h2>
                  </div>
                  <Tag>Revision {snapshot?.workspace.revision ?? 0}</Tag>
                </div>
                {!snapshot?.audit.length ? (
                  <div className="empty">
                    <GitBranch size={30} />
                    <p>Ingest a synthetic run to start its evidence trail.</p>
                  </div>
                ) : (
                  <div className="audit-timeline">
                    {[...snapshot.audit].reverse().map((e) => (
                      <article key={e.id}>
                        <span
                          className={`audit-dot ${e.body.action === "APPROVE" ? "approved" : ""}`}
                        >
                          {e.body.action === "APPROVE" ? (
                            <Check size={15} />
                          ) : (
                            <GitBranch size={15} />
                          )}
                        </span>
                        <div>
                          <div className="audit-title">
                            <h3>
                              {e.body.action === "IMPORT"
                                ? "Source run ingested"
                                : e.body.action === "PROPOSE"
                                  ? "Correction proposed"
                                  : e.body.action === "APPROVE"
                                    ? "Correction approved"
                                    : "Correction rejected"}
                            </h3>
                            <Tag
                              tone={
                                e.body.action === "APPROVE"
                                  ? "green"
                                  : "neutral"
                              }
                            >
                              REV {e.body.revision}
                            </Tag>
                          </div>
                          <p>
                            {e.body.actorLabel} · {e.body.role} demo role ·{" "}
                            {time(e.body.at)}
                          </p>
                          <details>
                            <summary>
                              Inspect event and hash chain{" "}
                              <ChevronDown size={14} />
                            </summary>
                            <pre>{JSON.stringify(e.body.details, null, 2)}</pre>
                            <dl className="hash-details">
                              <dt>Previous SHA-256</dt>
                              <dd>{e.previousHash}</dd>
                              <dt>Event SHA-256</dt>
                              <dd>{e.eventHash}</dd>
                            </dl>
                          </details>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <aside className="side-stack">
                <section className="dark-panel verify-card">
                  <ShieldCheck size={30} />
                  <h2>
                    Verify the evidence,
                    <br />
                    not just the count.
                  </h2>
                  <p>
                    Recompute canonical source hashes and import digests. Replay
                    the audit to check finding history and approved measurement
                    overlays.
                  </p>
                  <button
                    disabled={!snapshot || !!busy}
                    onClick={() =>
                      void work("Verifying evidence", async () => {
                        const result = await verifySnapshot(snapshot!);
                        setIntegrity(result);
                        setMessage(
                          result.valid
                            ? "Source rows, audit history and current values reconcile."
                            : "An evidence mismatch was found. Export is blocked.",
                        );
                      })
                    }
                  >
                    Verify evidence <ArrowRight size={16} />
                  </button>
                  {integrity && (
                    <div className="verification-result">
                      <strong>
                        {integrity.valid
                          ? "All integrity checks pass"
                          : "Evidence mismatch"}
                      </strong>
                      <span>
                        {integrity.rawChecked} raw rows ·{" "}
                        {integrity.auditChecked} events ·{" "}
                        {integrity.effectiveChecked} current measurements
                      </span>
                      {integrity.failures.map((f) => (
                        <p key={f}>{f}</p>
                      ))}
                    </div>
                  )}
                </section>
                <section className="note-panel">
                  <h3>A hash chain has limits.</h3>
                  <p>
                    It detects inconsistent exports. It is not a digital
                    signature, proof of human identity or protection against a
                    database administrator rewriting data and hashes.
                  </p>
                </section>
                <section className="panel resolved-card">
                  <span className="eyebrow">FINDING HISTORY</span>
                  <h3>
                    {snapshot?.findings.filter((f) => f.status === "resolved")
                      .length ?? 0}{" "}
                    resolved findings retained
                  </h3>
                  {snapshot?.findings
                    .filter((f) => f.status === "resolved")
                    .map((f) => (
                      <div key={f.id}>
                        <CheckCheck size={15} />
                        <span>
                          {f.code}
                          <small>
                            {f.batchCode} ·{" "}
                            {f.resolvedAt ? time(f.resolvedAt) : ""}
                          </small>
                        </span>
                      </div>
                    ))}
                </section>
              </aside>
            </div>
          </>
        )}
        {view === "method" && (
          <>
            <PageIntro
              eyebrow="04 / METHOD & EVIDENCE"
              title="The assumptions are visible."
              description="A deliberately small manufacturing model with real ingestion, SQL persistence and review controls. Every seeded defect has an expected outcome."
            />
            <div className="method-grid">
              <section className="panel prose">
                <span className="eyebrow">MEASUREMENT GRAIN</span>
                <h2>A fixed, inspectable sampling plan.</h2>
                <p>
                  Three fictional batches each require temperature, thickness
                  and pressure for sample S01 at the Forming stage. The first
                  received row at batch + sample + stage + parameter remains
                  canonical. Exact repeats and conflicting repeats are retained
                  separately.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>Exact unit</th>
                        <th>Fictional range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SPECS.map((s) => (
                        <tr key={s.parameter}>
                          <td>{s.label}</td>
                          <td>{s.unit}</td>
                          <td>
                            {s.min} to {s.max}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Numeric strings are not converted. Unit aliases are not
                  inferred. Ranges are tested only with the declared unit. UTC
                  timestamps must include milliseconds and fall within 10
                  November 2026, 07:00-15:00. Equipment must be P-01 or P-02.
                  These limits and process rules are invented fixtures.
                </p>
                <h3>Counts that reconcile</h3>
                <p>
                  Received rows = usable + quarantined + duplicate rows. A
                  usable row passes all row checks. Coverage measures expected
                  slots observed, including quarantined readings. It is not a
                  pass rate. Unknown-batch rows do not count towards the nine
                  expected slots.
                </p>
                <h3>Corrections preserve provenance</h3>
                <p>
                  Only value, unit, timestamp and equipment can be proposed for
                  correction. A change must resolve an existing finding without
                  introducing another. Approvals use both the workspace revision
                  and the original measurement version. Rejected and stale
                  proposals remain visible. Missing slots are resolved by a
                  separate source import.
                </p>
                <h3>Data and retention</h3>
                <p>
                  The service stores synthetic data in an isolated SQL
                  workspace. Access keys remain in this browser and are excluded
                  from exports. The workspace expires after 24 hours; the
                  service refuses access then, and physically removes expired
                  workspaces during a later creation. Up to four imports, 100
                  rows and 30 proposals are accepted per workspace. Imports are
                  bounded to 25 rows and 64 KiB.
                </p>
                <p>
                  Browser storage loss removes your access. Export before
                  starting a new workspace. The ZIP retains evidence but cannot
                  restore access. Use synthetic data only.
                </p>
              </section>
              <aside className="side-stack">
                <section className="dark-panel">
                  <span className="eyebrow">
                    A WORKING TECHNICAL DEMONSTRATOR
                  </span>
                  <h2>
                    Built to be
                    <br />
                    questioned.
                  </h2>
                  <p>
                    The public API runs in a Cloudflare Worker with D1. Local
                    development uses the same service with SQLite. SQL
                    transactions protect ingestion and review from partial
                    writes.
                  </p>
                  <a
                    href="https://github.com/Simonsbs/manufacturing-traceability-demo"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Explore the source <ArrowUpRight size={16} />
                  </a>
                  <a
                    href="/docs/VALIDATION.md"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Read validation results <ArrowUpRight size={16} />
                  </a>
                  <a
                    href="/docs/BUILD_NOTES.md"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Architecture & decisions <ArrowUpRight size={16} />
                  </a>
                  <a
                    href="/docs/CONTRACT.md"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    HTTP contract & schema <ArrowUpRight size={16} />
                  </a>
                </section>
                <section className="note-panel">
                  <FlaskConical size={25} />
                  <h3>Clear scope, clear limits.</h3>
                  <p>
                    This is not a production quality platform, a validated
                    pharmaceutical system or regulatory approval. Demo role
                    labels are not verified human identities. The lab makes no
                    product release decision.
                  </p>
                </section>
                <section className="panel workspace-card">
                  <span className="eyebrow">YOUR DEMO WORKSPACE</span>
                  <h3>{session ? "Visitor workspace" : "Not started"}</h3>
                  {session && (
                    <>
                      <p className="mono">{session.workspaceId}</p>
                      <p>Expires {time(session.expiresAt)}</p>
                    </>
                  )}
                  <button
                    className="secondary"
                    onClick={() => setFresh(true)}
                    disabled={!!busy}
                  >
                    Start a fresh workspace <Plus size={15} />
                  </button>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer className="footer shell">
        <a
          href="https://bestdev.co.il/"
          target="_blank"
          rel="noopener noreferrer"
        >
          A technical demonstration by Simon Stirling <ArrowUpRight size={13} />
        </a>
        <span>Synthetic records. Inspectable decisions.</span>
        <a
          href="https://github.com/Simonsbs/manufacturing-traceability-demo"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source & setup <ArrowUpRight size={13} />
        </a>
      </footer>
      {activeRow && snapshot && (
        <RowDialog
          row={activeRow}
          snapshot={snapshot}
          role={role}
          busy={!!busy}
          onClose={() => setRowId(null)}
          onPropose={async (field, value, reason) => {
            await work("Submitting correction proposal", async () => {
              const current = snapshot.measurements.find(
                (m) => m.rowId === activeRow.id,
              )!;
              const result = await api<Result>(
                `/api/workspaces/${session!.workspaceId}/proposals`,
                session,
                role,
                {
                  revision: snapshot.workspace.revision,
                  rowId: activeRow.id,
                  baseVersion: current.version,
                  field,
                  value,
                  reason,
                  actorLabel: "Demo operator",
                },
              );
              accept(result.snapshot);
              setRowId(null);
              go("review");
              setMessage(
                "Correction proposed. Current values remain unchanged until a reviewer approves it.",
              );
            });
          }}
        />
      )}
      {fresh && (
        <Modal title="Start a fresh workspace?" onClose={() => setFresh(false)}>
          <div className="modal-body">
            <p>
              Export the current evidence first. A new workspace replaces this
              browser's saved access; the previous SQL workspace expires on its
              existing schedule.
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  void work("Creating workspace", async () => {
                    await start();
                    setRole("operator");
                    setSelectedBatch("all");
                    setFresh(false);
                    go("overview");
                    setMessage(
                      "A new empty workspace is ready. Ingest a synthetic run to begin.",
                    );
                  })
                }
              >
                Start new workspace <Plus size={16} />
              </button>
              <button className="secondary" onClick={() => setFresh(false)}>
                Keep current workspace
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="page-intro">
      <span className="eyebrow">
        <span className="little-line" />
        {eyebrow}
      </span>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
function RowDialog({
  row,
  snapshot,
  role,
  busy,
  onClose,
  onPropose,
}: {
  row: SourceRow;
  snapshot: Snapshot;
  role: Role;
  busy: boolean;
  onClose: () => void;
  onPropose: (field: Field, value: Primitive, reason: string) => Promise<void>;
}) {
  const m = snapshot.measurements.find((m) => m.rowId === row.id),
    current = m?.effective ?? row.raw,
    source = snapshot.imports.find((i) => i.id === row.importId)!,
    findings = snapshot.findings.filter((f) => f.rowId === row.id),
    [field, setField] = useState<Field>("unit"),
    [value, setValue] = useState(""),
    [reason, setReason] = useState(""),
    [correction, setCorrection] = useState(false);
  const parsed: Primitive =
    field === "value" ? (value.trim() === "" ? NaN : Number(value)) : value;
  let problem = "";
  try {
    if (correction) applyPatch(current, field, parsed);
  } catch (e) {
    problem = e instanceof Error ? e.message : "Invalid proposal.";
  }
  return (
    <Modal
      wide
      title={`${show(row.raw.sourceRecordId)} · ${show(row.raw.parameter)}`}
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="row-context">
          <Tag
            tone={
              row.duplicateOf
                ? "amber"
                : snapshot.quality.findings.some((f) => f.rowId === row.id)
                  ? "red"
                  : "green"
            }
          >
            {row.duplicateOf
              ? "Duplicate source row"
              : snapshot.quality.findings.some((f) => f.rowId === row.id)
                ? "Quarantined measurement"
                : "Usable measurement"}
          </Tag>
          <span>
            {show(row.raw.batchCode)} · {show(row.raw.sampleId)} ·{" "}
            {show(row.raw.stage)}
          </span>
        </div>
        <section className="lineage-chain" aria-label="Record lineage">
          <div>
            <FileJson size={20} />
            <strong>Source import</strong>
            <small>{source.source}</small>
          </div>
          <ArrowRight size={15} />
          <div>
            <Layers3 size={20} />
            <strong>Retained row {row.ordinal}</strong>
            <small>records[{row.ordinal - 1}]</small>
          </div>
          <ArrowRight size={15} />
          <div>
            <ShieldCheck size={20} />
            <strong>Rule evaluation</strong>
            <small>
              {findings.filter((f) => f.status === "open").length} open findings
            </small>
          </div>
          <ArrowRight size={15} />
          <div>
            <Database size={20} />
            <strong>
              {row.duplicateOf ? "Excluded duplicate" : "Current overlay"}
            </strong>
            <small>
              {m
                ? `Measurement version ${m.version}`
                : "Canonical row retained separately"}
            </small>
          </div>
        </section>
        <div className="row-columns">
          <section>
            <span className="eyebrow">ORIGINAL → CURRENT</span>
            <h3>The source is never overwritten.</h3>
            <div className="table-scroll">
              <table className="value-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Raw source</th>
                    <th>Current value</th>
                  </tr>
                </thead>
                <tbody>
                  {["value", "unit", "measuredAt", "equipment"].map((f) => (
                    <tr
                      key={f}
                      className={
                        show(row.raw[f]) !== show(current[f]) ? "changed" : ""
                      }
                    >
                      <td>{f}</td>
                      <td>{show(row.raw[f])}</td>
                      <td>
                        {show(current[f])}
                        {show(row.raw[f]) !== show(current[f]) && (
                          <Check size={13} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="raw-payload">
              <summary>
                Inspect retained source JSON <ChevronDown size={14} />
              </summary>
              <pre>{JSON.stringify(row.raw, null, 2)}</pre>
            </details>
            <div className="source-hash">
              <span>Raw canonical SHA-256</span>
              <code>{row.rawHash}</code>
              <span>Ingested {time(row.createdAt)}</span>
            </div>
            {row.duplicateOf && (
              <p className="inline-note">
                Duplicate of retained row <code>{row.duplicateOf}</code>. It
                cannot be corrected into the canonical reading; investigate the
                conflict with the source owner.
              </p>
            )}
          </section>
          <section>
            <span className="eyebrow">RULE RESULTS & REVIEW</span>
            <h3>Understand the finding.</h3>
            {findings.length === 0 ? (
              <p className="inline-note">
                This reading passes all current row checks. No correction is
                required.
              </p>
            ) : (
              findings.map((f) => (
                <div
                  className={`row-finding ${f.status === "resolved" ? "resolved" : ""}`}
                  key={f.id}
                >
                  {f.status === "resolved" ? (
                    <CheckCheck size={17} />
                  ) : (
                    <TriangleAlert size={17} />
                  )}
                  <div>
                    <strong>{f.code.replaceAll("_", " ")}</strong>
                    <p>{f.message}</p>
                    <small>
                      {f.status === "resolved"
                        ? "Resolved, retained in history"
                        : "Open finding"}
                    </small>
                  </div>
                </div>
              ))
            )}
            {m && findings.some((f) => f.status === "open") && !correction && (
              <>
                <button
                  className="primary full"
                  disabled={role !== "operator" || busy}
                  onClick={() => setCorrection(true)}
                >
                  <Plus size={15} />
                  Propose a correction
                </button>
                {role !== "operator" && (
                  <p className="helper">
                    Switch to Operator to propose. Only Reviewer can approve.
                  </p>
                )}
              </>
            )}
            {correction && (
              <div className="correction-form">
                <h3>Propose a sourced correction</h3>
                <p>
                  Identity fields stay fixed. The change must resolve a finding
                  without adding another.
                </p>
                {row.raw.sourceRecordId === "MES-004" &&
                  current.unit === "degC" && (
                    <button
                      className="text-button example"
                      onClick={() => {
                        setField("unit");
                        setValue("°C");
                        setReason(CORRECTION_EXAMPLE.reason);
                      }}
                    >
                      Use the fictional source clarification{" "}
                      <ArrowDownToLine size={14} />
                    </button>
                  )}
                <label>
                  Field to correct
                  <select
                    value={field}
                    onChange={(e) => {
                      setField(e.target.value as Field);
                      setValue("");
                    }}
                  >
                    {FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Proposed value
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    inputMode={field === "value" ? "decimal" : undefined}
                    maxLength={100}
                  />
                </label>
                <label>
                  Source evidence and reason
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={600}
                    rows={4}
                    placeholder="Explain the source evidence for this correction..."
                  />
                </label>
                {problem && value && <p className="form-error">{problem}</p>}
                <button
                  className="primary full"
                  disabled={
                    !!problem ||
                    reason.trim().length < 10 ||
                    !value ||
                    busy ||
                    role !== "operator"
                  }
                  onClick={() => void onPropose(field, parsed, reason)}
                >
                  Submit for review <ArrowRight size={16} />
                </button>
                <small>
                  Proposal targets measurement version {m?.version}. Current
                  values remain unchanged.
                </small>
              </div>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
function ReviewCard({
  proposal: p,
  snapshot,
  role,
  busy,
  onInspect,
  onReview,
}: {
  proposal: Proposal;
  snapshot: Snapshot;
  role: Role;
  busy: boolean;
  onInspect: () => void;
  onReview: (decision: "approved" | "rejected", reason: string) => void;
}) {
  const [reason, setReason] = useState(""),
    r = snapshot.rows.find((r) => r.id === p.rowId)!,
    m = snapshot.measurements.find((m) => m.rowId === p.rowId)!,
    stale = m.version !== p.baseVersion;
  return (
    <article className="panel review-card">
      <div className="review-card-head">
        <div>
          <span className="eyebrow">
            {show(r.raw.batchCode)} / {show(r.raw.sourceRecordId)}
          </span>
          <h2>
            {p.field} correction <span>{show(r.raw.parameter)}</span>
          </h2>
        </div>
        <Tag
          tone={
            p.status === "approved"
              ? "green"
              : p.status === "rejected"
                ? "red"
                : "amber"
          }
        >
          {p.status === "pending"
            ? stale
              ? "Pending · stale version"
              : "Pending review"
            : p.status}
        </Tag>
      </div>
      <div className="review-content">
        <div>
          <div className="change-preview">
            <span>
              <small>Raw source</small>
              <strong>{show(r.raw[p.field])}</strong>
            </span>
            <ArrowRight size={22} />
            <span>
              <small>Proposed value</small>
              <strong>{show(p.value)}</strong>
            </span>
          </div>
          <h3>Operator's source evidence</h3>
          <p>{p.reason}</p>
          <span className="helper">
            {p.submittedBy} · {time(p.submittedAt)} · unverified demo label
          </span>
          <button className="text-button" onClick={onInspect}>
            Inspect source and lineage <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="review-decision">
          {p.status === "pending" ? (
            <>
              <h3>Record the review</h3>
              <p>
                Check the source evidence before accepting or rejecting the
                proposed change.
              </p>
              <label>
                Review rationale for {show(r.raw.sourceRecordId)}
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={600}
                  placeholder="Record the evidence behind your decision..."
                  disabled={role !== "reviewer" || busy}
                />
              </label>
              {stale && (
                <p className="form-error">
                  The current measurement is version {m.version}. This proposal
                  cannot be approved; reject it and propose against the current
                  version.
                </p>
              )}
              <div className="button-row">
                <button
                  className="primary"
                  disabled={
                    role !== "reviewer" ||
                    reason.trim().length < 10 ||
                    busy ||
                    stale
                  }
                  onClick={() => onReview("approved", reason)}
                >
                  <Check size={15} />
                  Approve correction
                </button>
                <button
                  className="secondary"
                  disabled={
                    role !== "reviewer" || reason.trim().length < 10 || busy
                  }
                  onClick={() => onReview("rejected", reason)}
                >
                  Reject
                </button>
              </div>
              {role !== "reviewer" && (
                <small>Switch to Reviewer to record a decision.</small>
              )}
            </>
          ) : (
            <>
              <CheckCheck size={23} />
              <h3>
                {p.status === "approved"
                  ? "Approved overlay recorded"
                  : "Proposal rejected"}
              </h3>
              <p>{p.reviewReason}</p>
              <span className="helper">
                {p.reviewedBy} · {p.reviewedAt ? time(p.reviewedAt) : ""}
              </span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
