import { useEffect, useRef, useState } from "react";

// Truth Agent page — claim verification through Gonka multi-model inference.
// Track checklist served here:
//   Claim Extraction        → step "extract" (claims normalized from input)
//   Decentralized Verif.    → step "verify" (N independent Gonka models)
//   Truth Score & Reasoning → "consensus" score 0–100 + per-model reasoning
//   Transparency UI         → Gonka request id on every inference
//
// Live trace arrives over SSE from the claim agent (src/a2a/claimAgent.js).
// Offline behavior (honest by design): replay the LAST REAL verification
// from GET /claims/demo under a REPLAY watermark — never fabricated scores.
// With no real run on record the page asks for a live run instead.

type SourceType = "auto" | "url" | "tweet" | "text";

interface StepEvent {
  step: string;
  status?: "running" | "done" | "failed";
  model?: string;
  requestId?: string | null;
  verdict?: string;
  score?: number | null;
  reasoning?: string;
  detail?: string;
  claims?: string[];
  atMs?: number;
  result?: unknown;
}

interface ModelAnswer {
  ok: boolean;
  model?: string;
  requestId?: string | null;
  verdict?: string;
  score?: number;
  reasoning?: string;
  error?: string;
}

interface FinalResult {
  score: number | null;
  verdict: string;
  confidenceBand?: [number, number] | null;
  agree?: string;
  claims?: string[];
  evidenceNotes?: string[];
  models?: ModelAnswer[];
  durationMs?: number;
}

const VERDICT_META: Record<string, { label: string; color: string; bg: string }> = {
  TRUE: { label: "Likely True", color: "#047857", bg: "#ecfdf5" },
  FALSE: { label: "Likely False", color: "#b91c1c", bg: "#fef2f2" },
  PARTLY_TRUE: { label: "Partly True", color: "#b45309", bg: "#fffbeb" },
  UNVERIFIABLE: { label: "Unverifiable", color: "#475467", bg: "#f2f4f7" },
};

// Track requirement checklist — lit by REAL trace steps as they happen.
const CHECKLIST: { key: string; label: string; hint: string }[] = [
  { key: "extract", label: "Claim Extraction", hint: "URL / tweet / text → verifiable claims" },
  { key: "live_data", label: "Live Data Verification", hint: "evidence fetched & fed to every model" },
  { key: "consensus", label: "Truth Score & Reasoning", hint: "0–100 score + per-model reasoning trace" },
  { key: "transparency", label: "Transparency (Request IDs)", hint: "Gonka Request ID on every inference" },
];

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#94a3b8";
  if (score >= 70) return "var(--ok)";
  if (score >= 40) return "var(--warn)";
  return "var(--bad)";
}

/* ---------------- pipeline visualization ---------------- */

const PIPE_STEPS = [
  { key: "received", label: "Input" },
  { key: "extract", label: "Extract" },
  { key: "live_data", label: "Evidence" },
  { key: "verify", label: "Models ×N" },
  { key: "consensus", label: "Consensus" },
];

function Pipeline({ events }: { events: StepEvent[] }) {
  const statusFor = (key: string): "pending" | "running" | "done" | "failed" => {
    const evs = events.filter((e) => e.step === key);
    if (evs.length === 0) return key === "received" ? "done" : "pending";
    const last = evs[evs.length - 1];
    if (last.status === "failed") return "failed";
    if (last.status === "done") return "done";
    return "running";
  };

  const doneCount = PIPE_STEPS.filter((s) => statusFor(s.key) === "done").length;

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>
          Agent thinking pipeline
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
          Step {Math.min(doneCount + 1, PIPE_STEPS.length)} of {PIPE_STEPS.length}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {PIPE_STEPS.map((s, i) => {
          const st = statusFor(s.key);
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  border: `1px solid ${st === "pending" ? "var(--line)" : st === "failed" ? "var(--bad)" : st === "running" ? "var(--accent)" : "var(--ok)"}`,
                  background:
                    st === "done" ? "var(--ok-soft)" : st === "running" ? "var(--accent-soft)" : st === "failed" ? "var(--bad-soft)" : "var(--bg)",
                  color: st === "pending" ? "var(--faint)" : st === "failed" ? "var(--bad-ink)" : st === "running" ? "var(--accent-ink)" : "var(--ok-ink)",
                }}
              >
                {st === "running" && (
                  <span
                    className="dot recovering"
                    style={{ width: 8, height: 8, animation: "spin 1s linear infinite" }}
                  />
                )}
                {s.label}
                {st === "done" && <span style={{ fontWeight: 800 }}>✓</span>}
              </div>
              {i < PIPE_STEPS.length - 1 && (
                <span style={{ color: "var(--faint)", fontSize: 12 }}>→</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- model answer cards ---------------- */

function ModelCards({ models }: { models: ModelAnswer[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginTop: 10 }}>
      {models.map((m, i) => {
        const meta = m.verdict ? VERDICT_META[m.verdict] : null;
        return (
          <div
            key={i}
            style={{
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 14px",
              background: "var(--bg)",
              animation: "fadeIn 0.25s ease both",
              animationDelay: `${i * 60}ms`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.model ?? "unknown model"}
              </span>
              {meta && (
                <span className="chip" style={{ color: meta.color, background: meta.bg, fontSize: 10, padding: "2px 6px", flexShrink: 0 }}>
                  {m.verdict}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--line-soft)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${m.score ?? 0}%`,
                    height: "100%",
                    borderRadius: 3,
                    background: scoreColor(m.score),
                    transition: "width .4s ease",
                  }}
                />
              </div>
              <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: scoreColor(m.score) }}>
                {m.score ?? "—"}
              </span>
            </div>
            {m.reasoning && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
                “{m.reasoning}”
              </div>
            )}
            {!m.ok && (
              <div style={{ fontSize: 11.5, color: "var(--bad-ink)", marginTop: 8 }}>
                {m.error ?? "inference failed"}
              </div>
            )}
            <div className="mono" style={{ color: "var(--faint)", fontSize: 10.5, marginTop: 8, wordBreak: "break-all" }}>
              id: {m.requestId ?? "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- score gauge ---------------- */

function ScoreGauge({ score, band }: { score: number | null; band?: [number, number] | null }) {
  const color = scoreColor(score);
  const angle = score == null ? 0 : (score / 100) * 180;
  return (
    <div style={{ textAlign: "center", flexShrink: 0 }}>
      <svg viewBox="0 0 120 70" style={{ width: 160 }} role="img" aria-label={`Truth score ${score ?? "unknown"} out of 100`}>
        <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="var(--line)" strokeWidth="10" strokeLinecap="round" />
        {score != null && (
          <path
            d="M 10 60 A 50 50 0 0 1 110 60"
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${(angle / 180) * 157} 157`}
          />
        )}
        <text x="60" y="54" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">
          {score == null ? "—" : score}
        </text>
      </svg>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>
        Truth Score{band ? ` · range ${band[0]}–${band[1]}` : ""}
      </div>
    </div>
  );
}

/* ---------------- requirement checklist panel ---------------- */

function ChecklistPanel({ events, active }: { events: StepEvent[]; active: boolean }) {
  const hasModelId = events.some((e) => e.step === "model_answer" && e.requestId);
  const lit: Record<string, boolean> = {
    extract: events.some((e) => e.step === "extract" && e.status === "done"),
    live_data: events.some((e) => e.step === "live_data" && e.status === "done"),
    consensus: events.some((e) => e.step === "consensus" && e.status === "done"),
    transparency: hasModelId,
  };

  return (
    <div
      className="card"
      style={{
        background: "var(--bg-subtle)",
        border: "1px dashed var(--line)",
      }}
    >
      <div className="pad" style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>
          Track requirements — proven live
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {CHECKLIST.map((c) => {
            const on = lit[c.key];
            return (
              <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    background: on ? "var(--ok)" : "var(--line)",
                    color: on ? "#fff" : "var(--faint)",
                    flexShrink: 0,
                    animation: on ? "fadeIn .3s ease" : undefined,
                  }}
                >
                  ✓
                </span>
                <b style={{ fontWeight: 700, color: on ? "var(--ink)" : "var(--muted)" }}>{c.label}</b>
                <span style={{ color: "var(--faint)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.hint}
                </span>
                {active && !on && <span className="dot recovering" style={{ width: 7, height: 7, marginLeft: "auto" }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

interface RunSummary {
  id: string;
  finishedAt: string;
  input: string;
  verdict?: string;
  score?: number;
}

export default function TruthAgentPage() {
  const [input, setInput] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("auto");
  const [running, setRunning] = useState(false);
  const [replay, setReplay] = useState<{ claimId: string; finishedAt: string } | null>(null);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [notice, setNotice] = useState("");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [inputOpen, setInputOpen] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  const reset = () => {
    esRef.current?.close();
    esRef.current = null;
    setEvents([]);
    setResult(null);
    setNotice("");
    setReplay(null);
  };

  const loadRunList = async (): Promise<RunSummary[]> => {
    try {
      const res = await fetch("/claims/history");
      if (!res.ok) return [];
      const body = (await res.json()) as { runs: RunSummary[] };
      setRuns(body.runs ?? []);
      return body.runs ?? [];
    } catch {
      return [];
    }
  };

  /** Shows one completed run's full agent log (trace + verdict + ledger). */
  const viewRun = async (id: string) => {
    reset();
    try {
      const res = await fetch(`/claims/${id}`);
      if (!res.ok) throw new Error(`/claims/${id} → ${res.status}`);
      const record = (await res.json()) as {
        createdAt: string;
        steps: StepEvent[];
        result: FinalResult | null;
      };
      if (!record.result) throw new Error("that run never completed");
      setReplay({ claimId: id, finishedAt: record.createdAt });
      setEvents(record.steps.filter((s) => s.step !== "done"));
      setResult(record.result);
    } catch (err) {
      setNotice(String((err as Error).message));
    }
  };

  // Agent-log-first: on page load, show the newest real run's log + the
  // history feed. No input needed just to READ what the agent did.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/claims/history");
        if (!alive) return;
        if (res.status === 404 || !res.ok) {
          setNotice(
            "No agent log yet — the Truth Agent records every real verification here. Start it with node scripts/start-all.mjs, then run one verification below."
          );
          return;
        }
        const body = (await res.json()) as { runs: RunSummary[] };
        if (!alive) return;
        setRuns(body.runs ?? []);
        if ((body.runs ?? []).length > 0) {
          await viewRun(body.runs[0].id);
        }
      } catch {
        if (alive) {
          setNotice(
            "Truth Agent unreachable. Start it with: node scripts/start-all.mjs — the log feed fills in automatically once it has completed runs."
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (!input.trim() || running) return;
    reset();
    setRunning(true);

    try {
      const res = await fetch("/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: input.trim(), sourceType }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `agent returned HTTP ${res.status}`);
      }

      const { claimId } = (await res.json()) as { claimId: string };
      const es = new EventSource(`/claims/${claimId}/events`);
      esRef.current = es;

      es.onmessage = (msg) => {
        const event: StepEvent = JSON.parse(msg.data);

        if (event.step === "done") {
          es.close();
          setResult(event.result as FinalResult);
          setRunning(false);
          void loadRunList();
          return;
        }
        if (event.step === "error") {
          es.close();
          setNotice(event.detail ?? "verification failed");
          setRunning(false);
          void loadRunList();
          return;
        }
        setEvents((prev) => [...prev, event]);
      };
      es.onerror = () => {
        es.close();
        setRunning(false);
        setNotice("connection to the Truth Agent dropped mid-run — try again");
      };
    } catch (err) {
      setRunning(false);
      setNotice(
        `Truth Agent unreachable (${String((err as Error).message).slice(0, 80)}). No simulated scores are shown — the log feed only ever shows real runs.`
      );
    }
  };

  const meta = result ? VERDICT_META[result.verdict] ?? VERDICT_META.UNVERIFIABLE : null;

  return (
    <div className="content full" style={{ paddingTop: 18, paddingBottom: 40 }}>
      <div>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Truth Agent — Verification Log</h1>
        <p style={{ color: "var(--muted)", margin: "0 0 14px", fontSize: 13.5, maxWidth: "72ch" }}>
          Live log of what the agent actually did: claim extraction, evidence gathering, independent
          Gonka model verdicts and consensus — with the Gonka Request ID of every inference.
        </p>
      </div>

      {/* Track requirement checklist */}
      <ChecklistPanel events={events} active={running} />

      {/* Agent thinking trace — the main view */}
      {(events.length > 0 || running) && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="pad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                {running ? "Agent thinking (live)" : replay ? `Run ${replay.claimId}` : "Agent log"}
              </div>
              {replay && !running && (
                <span className="chip amber" style={{ fontSize: 10.5 }}>
                  recorded run · {new Date(replay.finishedAt).toLocaleString()}
                </span>
              )}
              {running && <span className="chip blue" style={{ fontSize: 10.5 }}>streaming</span>}
            </div>
            <Pipeline events={events} />
            {events
              .filter((e) => e.step === "model_answer")
              .length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 2 }}>
                  Parallel model verdicts
                </div>
                <ModelCards
                  models={events
                    .filter((e) => e.step === "model_answer")
                    .map((e) => ({
                      ok: e.status !== "failed",
                      model: e.model,
                      requestId: e.requestId,
                      verdict: e.verdict,
                      score: e.score ?? undefined,
                      reasoning: e.reasoning,
                      error: e.detail,
                    }))}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="pad">
            <div className="card-title">Verdict</div>
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <ScoreGauge score={result.score} band={result.confidenceBand} />
              <div style={{ flex: 1, minWidth: 220 }}>
                {meta && (
                  <span className="chip" style={{ color: meta.color, background: meta.bg, fontSize: 13 }}>
                    {meta.label}
                  </span>
                )}
                <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8 }}>
                  Model agreement: {result.agree ?? "—"} · finished in{" "}
                  {result.durationMs ? (result.durationMs / 1000).toFixed(1) : "?"}s
                </div>
                {(result.claims ?? []).length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <b style={{ fontSize: 12 }}>Extracted claim(s):</b>
                    <ul style={{ margin: "4px 0 0 18px", padding: 0, color: "var(--muted)" }}>
                      {result.claims!.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(result.evidenceNotes ?? []).length > 0 && (
                  <div style={{ color: "var(--faint)", fontSize: 11.5, marginTop: 8 }}>
                    Evidence: {result.evidenceNotes!.join(" · ")}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transparency: per-inference request ids */}
      {result?.models && result.models.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="pad">
            <div className="card-title">Transparency — Gonka inference ledger</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Model</th>
                    <th style={{ padding: "6px 8px" }}>Verdict</th>
                    <th style={{ padding: "6px 8px" }}>Score</th>
                    <th style={{ padding: "6px 8px" }}>Gonka Request ID</th>
                  </tr>
                </thead>
                <tbody>
                  {result.models.map((m, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--line-soft)" }}>
                      <td style={{ padding: "7px 8px", fontWeight: 600 }}>{m.model ?? "—"}</td>
                      <td style={{ padding: "7px 8px" }}>{m.verdict ?? m.error ?? "—"}</td>
                      <td style={{ padding: "7px 8px", color: scoreColor(m.score) }}>{m.score ?? "—"}</td>
                      <td className="mono" style={{ padding: "7px 8px", color: "var(--faint)", wordBreak: "break-all" }}>
                        {m.requestId ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Recent runs feed — click any run to load its full log above */}
      {runs.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="pad">
            <div className="card-title">Recent verifications ({runs.length})</div>
            <div style={{ display: "grid", gap: 8 }}>
              {runs.map((r) => (
                <button
                  key={r.id}
                  className="row"
                  onClick={() => void viewRun(r.id)}
                  disabled={running}
                  style={{
                    width: "100%",
                    cursor: "pointer",
                    textAlign: "left",
                    background: replay?.claimId === r.id ? "var(--accent-soft)" : "var(--bg)",
                    border: `1px solid ${replay?.claimId === r.id ? "var(--accent)" : "var(--line-soft)"}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "9px 12px",
                  }}
                >
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="mono" style={{ fontSize: 11.5, fontWeight: 700 }}>{r.id}</span>
                      {r.verdict && (
                        <span
                          className="chip"
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            color: VERDICT_META[r.verdict]?.color ?? "var(--muted)",
                            background: VERDICT_META[r.verdict]?.bg ?? "var(--bg-subtle)",
                          }}
                        >
                          {VERDICT_META[r.verdict]?.label ?? r.verdict} · {r.score ?? "—"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                      {r.input}
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--faint)", flexShrink: 0, marginLeft: 10 }}>
                    {new Date(r.finishedAt).toLocaleTimeString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible input — the checklist's "Input URL / tweet / text" feed
          point, kept out of the way of the log view */}
      <div className="card" style={{ marginTop: 14, borderStyle: "dashed" }}>
        <div className="pad">
          <button
            className="btn link"
            style={{ padding: 0, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => setInputOpen(!inputOpen)}
            disabled={running}
          >
            <span>{inputOpen ? "▼" : "▶"}</span>
            Run a new verification (URL, tweet, or text snippet)
          </button>
          {inputOpen && (
            <div style={{ marginTop: 10 }}>
              <textarea
                className="input"
                rows={2}
                placeholder="https://example.com/news … or paste any tweet / claim text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={running}
                style={{ width: "100%", resize: "vertical", marginBottom: 10 }}
              />
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  className="input"
                  style={{ width: 130 }}
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as SourceType)}
                  disabled={running}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="url">URL</option>
                  <option value="tweet">Tweet</option>
                  <option value="text">Text</option>
                </select>
                <button className="btn primary sm" onClick={run} disabled={running || !input.trim()}>
                  {running ? "Agent thinking…" : "Run"}
                </button>
                {running && <span className="chip blue">live trace streaming above</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div className="card" style={{ marginTop: 14, borderColor: "var(--warn)" }}>
          <div className="pad" style={{ color: "var(--warn-ink)", fontSize: 13 }}>
            {notice}
          </div>
        </div>
      )}
    </div>
  );
}
