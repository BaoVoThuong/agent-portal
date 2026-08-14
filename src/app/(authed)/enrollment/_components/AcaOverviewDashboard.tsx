"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { ACA_OVERVIEW_THRESHOLD_DAYS, type AcaOverviewPerson, type AcaOverviewSnapshot, type AcaOverviewThresholdDays } from "@/lib/enrollment/aca-overview-types";
import { applyResponsibleAssignment, reconcileAssignedRow } from "@/lib/enrollment/aca-overview-assign";
import { AcaAssignPicker } from "./AcaAssignPicker";

type Props = { from: string; to: string; onOpenRecord: (id: string) => void };

export function AcaOverviewDashboard({ from, to, onOpenRecord }: Props) {
  const [snapshot, setSnapshot] = useState<AcaOverviewSnapshot | null>(null);
  const [matrixMode, setMatrixMode] = useState<"occupancy" | "speed">("occupancy");
  const [threshold, setThreshold] = useState<AcaOverviewThresholdDays | null>(null);
  const [editingQueue, setEditingQueue] = useState(false);
  const [updatingQueueEmail, setUpdatingQueueEmail] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const current = ++sequence.current; setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (threshold !== null) params.set("thresholdDays", String(threshold));
      if (from) params.set("from", from); if (to) params.set("to", to);
      const response = await fetch(`/api/enrollment/aca-overview?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as AcaOverviewSnapshot | { error?: string } | null;
      if (!response.ok) throw new Error(payload && "error" in payload ? payload.error : "Could not load ACA overview.");
      // Deliberately does NOT adopt the server threshold into state. Doing so
      // changed `load`'s identity on the first response and fired a second full
      // snapshot request on every mount. `threshold` holds the user's explicit
      // choice only; the control falls back to the server value for display.
      if (current === sequence.current) setSnapshot(payload as AcaOverviewSnapshot);
    } catch (cause) { if (current === sequence.current) setError(cause instanceof Error ? cause.message : "Could not load ACA overview."); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [from, threshold, to]);

  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);

  // Every hook must run before the guards below. These early returns fire while
  // the first snapshot is loading, so anything hook-shaped placed after them is
  // skipped on that render and called on the next one — which is exactly the
  // "rendered more hooks than during the previous render" crash.
  const handleToggleQueue = useCallback(async (email: string, enabled: boolean) => {
    setUpdatingQueueEmail(email); setQueueError(null);
    try {
      const response = await fetch("/api/enrollment/aca-overview/queue-members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, enabled }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not update the assignment queue.");
      await load();
    } catch (cause) {
      setQueueError(cause instanceof Error ? cause.message : "Could not update the assignment queue.");
    } finally { setUpdatingQueueEmail(null); }
  }, [load]);

  if (loading && !snapshot) return <Shell><Message>Loading ACA operations…</Message></Shell>;
  if (error && !snapshot) return <Shell><Message error={error} onRetry={() => void load()} /></Shell>;
  if (!snapshot) return <Shell><Message>No ACA overview data.</Message></Shell>;

  const s = snapshot.scorecards;
  const days = snapshot.thresholdDays;
  const period = snapshot.period.from && snapshot.period.to ? `${snapshot.period.from} → ${snapshot.period.to}` : "All dates";
  const people = snapshot.people.filter((row) => row.email).map((row) => ({ email: row.email!, name: row.name, canWork: true, queueEnabled: true }));

  // Coverage, not decoration: when the stage clock was never recorded, three of
  // the stage columns go blank and every row is flagged "est." — which looks
  // identical to "everything is fine" unless it is said out loud.
  const live = snapshot.stageTable.filter((row) => !row.isTerminal);
  const inStage = live.reduce((sum, row) => sum + row.inStage, 0);
  const estimated = live.reduce((sum, row) => sum + (row.estimatedCount ?? 0), 0);
  const estimatedShare = inStage ? estimated / inStage : 0;

  const handleAssigned = (recordId: string, email: string | null, updatedAt?: string) => setSnapshot((current) => {
    if (!current) return current;
    // Assigning moves a record out of the unassigned pool, so the tile, the
    // list, the team row and the Unassigned row all have to move together —
    // otherwise the count next to the table contradicts the table itself.
    const leftUnassignedPool = Boolean(email) && current.unassigned.some((row) => row.recordId === recordId);
    return {
      ...current,
      actions: reconcileAssignedRow(applyResponsibleAssignment(current.actions, recordId, email), recordId, updatedAt),
      unassigned: email ? current.unassigned.filter((row) => row.recordId !== recordId) : reconcileAssignedRow(current.unassigned, recordId, updatedAt),
      scorecards: leftUnassignedPool ? { ...current.scorecards, unassigned: Math.max(0, current.scorecards.unassigned - 1) } : current.scorecards,
      people: current.people.map((row) => {
        if (row.kind === "person" && row.email === email) return { ...row, holding: row.holding + 1 };
        if (!leftUnassignedPool) return row;
        if (row.kind === "unassigned") return { ...row, holding: Math.max(0, row.holding - 1) };
        if (row.kind === "team") return { ...row, holding: row.holding + 1 };
        return row;
      }),
    };
  });

  return (
    <Shell>
      <div className="filterbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="eyebrow">Stale after</span>
          <Seg value={String(threshold ?? snapshot.thresholdDays)} options={ACA_OVERVIEW_THRESHOLD_DAYS.map(String)} format={(v) => `${v}d`} onChange={(v) => setThreshold(Number(v) as AcaOverviewThresholdDays)} />
          <span className="chip info">{period}</span>
        </div>
        <button type="button" onClick={() => void load()} className="chip clickable">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {estimatedShare >= 0.5 ? (
        <div className="coverage-banner">
          <b>Stage timing is mostly estimated.</b> {estimated} of {inStage} open records have no
          recorded stage-entry time, so <b>Median wait</b>, <b>Longest</b> and <b>Stuck</b> read
          blank or zero rather than low. Run the stage-time backfill to populate them.
        </div>
      ) : null}

      <Glance
        tiles={[
          { label: "Open records", value: s.open, note: `${s.totalTasks} total in window`, tone: "neutral" },
          { label: "Unassigned", value: s.unassigned, note: "waiting for an owner", tone: s.unassigned ? "bad" : "good" },
          { label: `Stuck ≥ ${days}d`, value: s.stuckInStage, note: "no stage movement", tone: s.stuckInStage ? "bad" : "good" },
          { label: `No activity ≥ ${days}d`, value: s.noActivity, note: "no real work logged", tone: s.noActivity ? "bad" : "good" },
          { label: "Median open age", value: fmtDays(s.medianOpenAgeDays), note: "since created", tone: "neutral" },
        ]}
      />

      <div className="flow">
        <Section num="01" code="VOLUME" title="Where does the book stand?" desc="Every figure covers records created inside the selected window. Done, Open and Terminated partition that window exactly.">
          <div className="row row-5">
            <Metric label="Total tasks" value={s.totalTasks} />
            <Metric label="Done" value={s.done} sub="reached 10-DONE" />
            <Metric label="Terminated" value={s.terminated} sub="reached 11-Terminated" />
            <Metric label="Can't Contact" value={s.cantContact} sub="open, no route forward" />
            <Metric label="Can not get ID card" value={s.cannotGetIdCard} sub="open, blocked on ID" />
          </div>
          <div className="row row-5">
            <Metric label="Median time to done" value={fmtDays(s.medianTimeToDoneDays)} sub="creation → 10-DONE" />
            <Metric label="Slowest stage" value={s.slowestStage ? fmtDays(s.slowestStage.medianDays) : "—"} sub={s.slowestStage?.stageLabel ?? "not enough samples"} />
            <Metric label="Median time in stage" value={fmtDays(s.medianTimeInCurrentStageDays)} sub="open records" />
            <Metric label="Active people" value={s.activePeople} sub="holding ≥ 1 record" />
            <Metric label="Avg per person" value={s.avgTasksPerPerson == null ? "—" : s.avgTasksPerPerson.toFixed(1)} sub="assigned open ÷ people" />
          </div>
        </Section>

        <Section num="02" code="PIPELINE" title="Where does work pile up?" desc="One row per stage, ordered by the workflow. Unassigned work is lifted into its own row rather than hidden inside a stage.">
          <details className="expander">
            <summary><span className="caret">▸</span> What do these columns mean?</summary>
            <div className="exp-body">
              <dl style={{ display: "grid", gap: "0.5rem", margin: 0 }}>
                {Object.entries(STAGE_COLUMN_HELP).map(([term, meaning]) => (
                  <div key={term}>
                    <dt style={{ display: "inline", fontWeight: 700 }}>{term}: </dt>
                    <dd style={{ display: "inline", margin: 0, color: "var(--muted)" }}>{meaning.replace("the selected number of days", `${days} days`)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
          <div className="card chart-card">
            <div className="chart-head">
              <div>
                <div className="chart-title">Stage pipeline</div>
                <div className="chart-hint">Ordered by the workflow, not by insert order. Stages that end the pipeline show no waiting figures — nobody is waiting on those records.</div>
              </div>
              <span className="chip info">{inStage} open</span>
            </div>
            <div className="df-scroll">
            <table className="df">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="num" title={STAGE_COLUMN_HELP["In stage"]}>In stage</th>
                  <th className="num" title={STAGE_COLUMN_HELP.Share}>Share</th>
                  <th className="num" title={STAGE_COLUMN_HELP["Median wait"]}>Median wait</th>
                  <th className="num" title={STAGE_COLUMN_HELP.Longest}>Longest</th>
                  <th className="num" title={STAGE_COLUMN_HELP.Stuck}>Stuck</th>
                  <th className="num" title={STAGE_COLUMN_HELP.Silent}>Silent</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.stageTable.map((row) => {
                  const est = row.estimatedCount ?? 0;
                  const mostly = Boolean(est && row.inStage && est / row.inStage >= 0.5);
                  return (
                    <tr key={row.stageId ?? "unassigned"}>
                      <td>
                        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, marginRight: 8, background: row.stageColor ?? "var(--border)" }} />
                        {row.stageLabel}
                        {est ? <span className="chip" style={{ marginLeft: 8 }} title={`${est} of ${row.inStage} records predate stage-time tracking, so their stage age is estimated from the creation date.`}>{est} est.</span> : null}
                      </td>
                      <td className="num"><b>{row.inStage}</b></td>
                      <td className="num">{row.sharePercent == null ? "—" : `${row.sharePercent.toFixed(1)}%`}</td>
                      <td className="num" style={mostly ? { color: "var(--subtle)", fontStyle: "italic" } : undefined}>{fmtDays(row.medianWaitDays)}</td>
                      <td className="num" style={mostly ? { color: "var(--subtle)", fontStyle: "italic" } : undefined}>{fmtDays(row.longestWaitDays)}</td>
                      <td className="num">{row.stuckCount ?? "—"}</td>
                      <td className="num">{row.silentCount ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </Section>

        <Section num="03" code="ATTENTION" title="What needs a person today?" desc="Sorted worst-first by the larger of stage age and silence. A high stage age with recent activity is a blocked record, not a neglected one.">
          <RecordList title="Needs action" rows={snapshot.actions} onOpenRecord={onOpenRecord} />
        </Section>

        <Section num="04" code="PEOPLE" title="Who is carrying what?" desc="Read every per-person figure against the Team total row. A bad percentage is often a bad stage rather than a bad worker — the matrix below is how you tell them apart.">
          <div className="card chart-card">
            <div className="chart-head">
              <div>
                <div className="chart-title">Workload by person</div>
                <div className="chart-hint">Error counts carry their share of what that person is holding. The Team total row is the baseline to read them against.</div>
              </div>
              <span className="chip info">{snapshot.scorecards.activePeople} active</span>
            </div>
            <div className="df-scroll">
            <table className="df">
              <thead>
                <tr>
                  <th>Person</th><th className="num">Holding</th><th className="num">Stuck</th>
                  <th className="num">Silent</th><th className="num">Median wait</th><th className="num">Done</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.people.map((row) => {
                  const share = (value: number) => row.holding ? ` (${Math.round(value / row.holding * 100)}%)` : "";
                  const tone = row.kind === "team" ? { background: "var(--card)", fontWeight: 700 } : row.kind === "unassigned" ? { color: "var(--subtle)", fontStyle: "italic" } : undefined;
                  return (
                    <tr key={row.email ?? row.kind} style={tone}>
                      <td>{row.name ?? row.email ?? "Unassigned"}</td>
                      <td className="num"><b>{row.holding}</b></td>
                      <td className="num">{row.stuck}<span style={{ color: "var(--subtle)" }}>{share(row.stuck)}</span></td>
                      <td className="num">{row.silent}<span style={{ color: "var(--subtle)" }}>{share(row.silent)}</span></td>
                      <td className="num">{fmtDays(row.medianWaitDays)}</td>
                      <td className="num">{row.doneInPeriod}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="card chart-card">
            <div className="chart-head">
              <div>
                <div className="chart-title">Person × stage</div>
                <div className="chart-hint">
                  {matrixMode === "occupancy"
                    ? `Open records held right now, with the count stuck ≥ ${days}d beside it. Running stages only.`
                    : "Median completed dwell per person. Only cycles held by one person start to finish count; fewer than 10 samples shows —."}
                </div>
              </div>
              <Seg value={matrixMode} options={["occupancy", "speed"]} onChange={(v) => setMatrixMode(v as "occupancy" | "speed")} />
            </div>
            <div className="df-scroll">
              <table className="df">
                <thead>
                  <tr>
                    <th>Person</th>
                    {snapshot.matrix.stageIds.map((id, i) => <th key={id} className="num">{snapshot.matrix.stageLabels[i]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.matrix.rows.map((row) => (
                    <tr key={row.email ?? "unassigned"}>
                      <td>{row.name ?? "Unassigned"}</td>
                      {row.cells.map((cell, index) => {
                        const stageId = snapshot.matrix.stageIds[index];
                        return (
                          <td key={stageId} className="num">
                            {matrixMode === "occupancy"
                              ? <><b>{cell.tasks || ""}</b>{cell.stuck ? <span style={{ color: "var(--bad)", marginLeft: 4 }}>({cell.stuck})</span> : null}</>
                              : row.email
                                ? (snapshot.personStageTiming.cells[row.email]?.[stageId]?.medianDays == null ? "—" : `${snapshot.personStageTiming.cells[row.email][stageId].medianDays}d`)
                                : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* The baseline row is what separates "this person is slow" from
                      "this stage is slow for everyone". Not decoration. */}
                  <tr style={{ background: "var(--card)", fontWeight: 700 }}>
                    <td>Total</td>
                    {snapshot.matrix.stageIds.map((stageId, index) => (
                      <td key={stageId} className="num">
                        {matrixMode === "occupancy"
                          ? <><b>{snapshot.matrix.totals[index]?.tasks ?? 0}</b>{snapshot.matrix.totals[index]?.stuck ? <span style={{ color: "var(--bad)", marginLeft: 4 }}>({snapshot.matrix.totals[index].stuck})</span> : null}</>
                          : (snapshot.personStageTiming.stageBaseline[stageId]?.medianDays == null ? "—" : `${snapshot.personStageTiming.stageBaseline[stageId].medianDays}d`)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <Section num="05" code="QUEUE" title="Who gets the next record?" desc="Turn order first, then the records waiting for an owner — so the answer and the action sit in one place. Holding and Stuck are shown but do not affect the order; read them before you assign.">
          {queueError ? <div className="callout note"><span className="callout-lbl">Queue</span>{queueError}</div> : null}
          <div className="card" style={{ padding: "0.9rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <span className="eyebrow"><Activity size={13} /> {snapshot.queue.length} in rotation</span>
              <button type="button" className="chip clickable" onClick={() => { setEditingQueue((v) => !v); setQueueError(null); }}>{editingQueue ? "Done" : "Edit queue"}</button>
            </div>
            {editingQueue ? (
              <div className="row row-4" style={{ marginBottom: 14 }}>
                {snapshot.people.filter((person) => person.email).map((person) => {
                  const email = person.email!;
                  const enabled = snapshot.queue.some((card) => card.email === email);
                  return (
                    <label key={email} className="metric" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0.55rem 0.7rem", opacity: enabled ? 1 : 0.6 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.84rem", fontWeight: 600 }}>{person.name ?? email}</span>
                      <input type="checkbox" checked={enabled} disabled={updatingQueueEmail === email} onChange={(event) => void handleToggleQueue(email, event.target.checked)} />
                    </label>
                  );
                })}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
              {snapshot.queue.map((person, index) => (
                <div key={person.email} className="gtile" style={{ minWidth: 190, boxShadow: `inset 3px 0 0 ${index === 0 ? "var(--good)" : "var(--border)"}` }}>
                  <div className="gtile-lbl">{index + 1}. {person.name ?? person.email}</div>
                  <div className="gtile-val" style={{ fontSize: "1.1rem" }}>{person.lastAssignedAt ? new Date(person.lastAssignedAt).toLocaleDateString() : "Never assigned"}</div>
                  <div className="gtile-foot">
                    <span className="gtile-note">Holding {person.holding}</span>
                    <span className="gtile-note" style={person.stuck ? { color: "var(--bad)" } : undefined}>Stuck {person.stuck}</span>
                  </div>
                </div>
              ))}
              {snapshot.queue.length === 0 ? <p style={{ color: "var(--subtle)", fontSize: "0.85rem" }}>Nobody is enabled in the queue.</p> : null}
            </div>
          </div>

          <RecordList
            title="Unassigned — pick an owner"
            hint="Oldest in stage first. A record deep in the pipeline with nobody responsible is a data problem, not a queue item."
            rows={snapshot.unassigned}
            onOpenRecord={onOpenRecord}
            people={people}
            onAssigned={handleAssigned}
            assignable
          />
        </Section>
      </div>

      <footer className="foot">
        Window <code>{period}</code> · cohort <code>enrollment_records.created_at</code> ·
        grain <code>one record</code> · staleness threshold <code>{days} days</code> ·
        program <code>ACA</code> · as of{" "}
        <code>{new Date(snapshot.generatedAt).toLocaleString()}</code>.
        Silence excludes comments, attachments and cron activity. Stage medians need a recorded
        stage-entry time; per-person speed needs ten completed cycles held start to finish.
      </footer>
    </Shell>
  );
}

/* ── composition helpers ───────────────────────────────────────────── */

function Shell({ children }: { children: ReactNode }) {
  // Scopes the design-system tokens. Everything outside this wrapper — sidebar,
  // page header, tabs, date picker — keeps the portal's own styling untouched.
  return <div className="aca-dash" data-theme="light" data-density="regular">{children}</div>;
}

function Section({ num, code, title, desc, children }: { num: string; code: string; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="sec">
      <header className="sec-head">
        <div className="sec-head-top">
          <span className="sec-num">{num}</span>
          <span className="sec-code">{code}</span>
          <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>{title}</h2>
        </div>
        <p className="sec-desc">{desc}</p>
      </header>
      <div className="sec-body">{children}</div>
    </section>
  );
}

type GlanceTile = { label: string; value: ReactNode; note: string; tone: "good" | "bad" | "neutral" };

function Glance({ tiles }: { tiles: GlanceTile[] }) {
  const flagged = tiles.filter((t) => t.tone === "bad").length;
  return (
    <div className="glance">
      <div className="glance-head">
        <div className="eyebrow"><Activity size={13} /> At a glance</div>
        <span className={`chip ${flagged ? "bad" : "good"}`}>
          <span className="dot" style={{ background: flagged ? "var(--bad)" : "var(--good)" }} />
          {flagged ? `${flagged} need attention` : "Nothing flagged"}
        </span>
      </div>
      <div className="glance-grid">
        {tiles.map((tile) => (
          <div key={tile.label} className="gtile" style={{ boxShadow: `inset 3px 0 0 ${tile.tone === "good" ? "var(--good)" : tile.tone === "bad" ? "var(--bad)" : "var(--border)"}` }}>
            <div className="gtile-lbl">{tile.label}</div>
            <div className="gtile-val">{tile.value}</div>
            <div className="gtile-foot"><span className="gtile-note">{tile.note}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="metric">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

function Seg({ value, options, onChange, format }: { value: string; options: readonly string[]; onChange: (value: string) => void; format?: (value: string) => string }) {
  return (
    <div className="seg" role="tablist">
      {options.map((option) => (
        <button key={option} type="button" role="tab" aria-selected={value === option} className={value === option ? "on" : ""} onClick={() => onChange(option)}>
          {format ? format(option) : option}
        </button>
      ))}
    </div>
  );
}

function RecordList({ title, hint, rows, onOpenRecord, people, onAssigned, assignable = false }: {
  title: string;
  hint?: string;
  rows: AcaOverviewSnapshot["actions"];
  onOpenRecord: (id: string) => void;
  people?: readonly AcaOverviewPerson[];
  onAssigned?: (recordId: string, email: string | null, updatedAt?: string) => void;
  assignable?: boolean;
}) {
  const pageSize = 20;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { setPage((current) => Math.min(current, pageCount - 1)); }, [pageCount]);
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          <div className="chart-hint">{hint ?? "Worst first, by the larger of stage age and silence."}</div>
        </div>
        <span className="chip info">{rows.length} records</span>
      </div>
      <table className="df">
        <thead>
          <tr><th>Client</th><th>Stage</th><th className="num">Age</th>{assignable ? <th>Assign to</th> : null}</tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.recordId}>
              <td>
                <button type="button" onClick={() => onOpenRecord(row.recordId)} style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "var(--text)", fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                  {row.clientName ?? row.taskId ?? row.recordId}
                </button>
              </td>
              <td style={{ color: "var(--muted)" }}>{row.stageLabel ?? "No stage"}</td>
              <td className="num" title={`${row.daysInStage ?? "—"}d in stage · ${row.daysSilent ?? "—"}d silent`}>
                <b>{row.sortDays}d</b>{row.stageAgeEstimated ? <span style={{ color: "var(--subtle)" }}> est.</span> : null}
              </td>
              {assignable ? (
                <td>
                  <AcaAssignPicker recordId={row.recordId} expectedUpdatedAt={row.updatedAt} people={people ?? []} currentEmail={row.responsibleEmail} onAssigned={(email, updatedAt) => onAssigned?.(row.recordId, email, updatedAt)} />
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={assignable ? 4 : 3} style={{ color: "var(--subtle)" }}>Nothing currently matches.</td></tr> : null}
        </tbody>
      </table>
      {pageCount > 1 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 10, fontSize: "0.78rem", color: "var(--muted)" }}>
          <span>Page {page + 1} of {pageCount}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="chip clickable" disabled={page === 0} onClick={() => setPage((c) => c - 1)}>Previous</button>
            <button type="button" className="chip clickable" disabled={page >= pageCount - 1} onClick={() => setPage((c) => c + 1)}>Next</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Message({ children, error, onRetry }: { children?: ReactNode; error?: string; onRetry?: () => void }) {
  return (
    <div className={error ? "coverage-banner" : "card"} style={{ padding: "1.1rem 1.2rem", color: error ? undefined : "var(--muted)" }}>
      {error ?? children}
      {onRetry ? <button type="button" className="chip clickable" style={{ marginLeft: 12 }} onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

function fmtDays(value: number | null) {
  return value == null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}d`;
}

// Every one of these is a different question, and three of them go blank rather
// than showing zero when the underlying clock was never recorded — so the
// definitions have to be reachable, not folded into a tooltip nobody hovers.
const STAGE_COLUMN_HELP: Record<string, string> = {
  "In stage": "Records sitting on this stage right now. Unassigned work is lifted into its own row instead of being counted here.",
  Share: "This stage's portion of all open records. Blank on stages that end the pipeline, because those records are no longer waiting on anyone.",
  "Median wait": "Middle value of how long the records currently here have been here. Needs a recorded stage-entry time; shows — when that was never captured.",
  Longest: "The single oldest occupant of this stage, measured from when it entered.",
  Stuck: "Records that have been on this stage at least the selected number of days. Counts 0 when no stage-entry time was recorded.",
  Silent: "Records with no real work logged for at least the selected number of days. Comments, attachments and the reminder cron do not count as work; when no work timestamp exists the record's age is used instead.",
};
