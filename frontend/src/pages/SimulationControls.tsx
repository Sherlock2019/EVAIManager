import { AlertTriangle, ExternalLink, Pause, Play, RotateCcw, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, PageHeader, Panel, Stat, Tabs } from "../components/ui";
import { post, useApi } from "../lib/api";
import { DEMO_TITLES, runDemo, useDemo } from "../lib/demo";
import { fmtInt, riskTone } from "../lib/format";
import { reloadFleet, useLive } from "../lib/live";
import type { Prediction, SimState } from "../lib/types";

const ISSUES = [
  { value: "thermal", label: "Battery cooling" },
  { value: "tire", label: "Tire pressure" },
  { value: "motor", label: "Motor temperature" },
  { value: "battery", label: "Battery SOH" },
  { value: "brakes", label: "Brakes" },
  { value: "charging", label: "Charging" },
];
const SPEEDS = ["0.5", "1", "2", "4"] as const;

export default function SimulationControls() {
  const state = useApi<SimState>("/api/sim/state");
  const { connected, transport, tick, summary, refresh } = useLive();
  const demoRunning = useDemo((s) => s.running);
  const navigate = useNavigate();
  const [issue, setIssue] = useState("thermal");
  const [target, setTarget] = useState("");
  const [injected, setInjected] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const { reload } = state;
  useEffect(() => {
    if (tick % 3 === 0) reload();
  }, [tick, reload]);

  const sim = state.data;
  const control = async (body: { running?: boolean; speed?: number }) => {
    await post("/api/sim/control", body);
    reload();
  };
  const inject = async () => {
    setBusy("inject");
    setError(null);
    try {
      const digits = target.replace(/\D/g, "");
      const p = await post<Prediction>("/api/sim/inject", { issue, vehicle_id: digits ? `VF-EV-${digits.padStart(4, "0")}` : null });
      setInjected(p);
      reloadFleet();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    setBusy("reset");
    try {
      await post("/api/sim/reset");
      setInjected(null);
      setConfirmReset(false);
      reloadFleet();
      refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader kicker="System · Demo controls" title="Simulation Controls" description="Drive the mock real-time world: pause or speed up the simulator, inject a fault and watch the maintenance AI react, or run the guided demo." />

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Live Simulator" kicker="scripts/generate_telemetry.py · backend tick loop">
          <div className="flex items-center justify-between">
            <Badge tone={!connected ? "crit" : sim?.running ? "good" : "warn"}>{!connected ? "Disconnected" : sim?.running ? "Running" : "Paused"}</Badge>
            <Button variant={sim?.running ? "outline" : "primary"} onClick={() => void control({ running: !sim?.running })} disabled={!sim}>
              {sim?.running ? <Pause size={13} /> : <Play size={13} />} {sim?.running ? "Pause simulation" : "Resume simulation"}
            </Button>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-ink-2">Simulation speed</span>
            <Tabs value={String(sim?.speed ?? 1) as (typeof SPEEDS)[number]} onChange={(v) => void control({ speed: Number(v) })} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <Stat label="Tick" value={sim ? `#${fmtInt(sim.seq)}` : "—"} />
            <Stat label="Tick interval" value={sim ? `${(sim.tick_seconds / sim.speed).toFixed(1)} s` : "—"} />
            <Stat label="Simulated time per tick" value={sim ? `${sim.sim_seconds_per_tick} s` : "—"} />
            <Stat label="Transport" value={transport} />
            <Stat label="Connected clients" value={sim?.clients ?? "—"} />
          </div>
          <p className="mt-3 text-2xs leading-relaxed text-ink-3">Every tick updates vehicle positions, battery SOC, battery temperature, charger availability and ADAS events, then pushes the delta over WebSocket.</p>
        </Panel>

        <Panel title="Inject a Fault" kicker="Test the maintenance AI">
          <div className="grid grid-cols-3 gap-1.5">
            {ISSUES.map((i) => (
              <button key={i.value} onClick={() => setIssue(i.value)} className={`rounded-md border px-2 py-1.5 text-2xs transition-colors ${issue === i.value ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-ink-2 hover:border-line-strong"}`}>
                {i.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Vehicle no. (blank = random healthy)" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 font-mono text-xs text-ink placeholder:text-ink-3" />
            <Button variant="primary" onClick={inject} disabled={busy === "inject"}>
              <Zap size={13} /> {busy === "inject" ? "Injecting…" : "Inject"}
            </Button>
          </div>
          {error && <p className="mt-2 text-2xs text-crit">{error}</p>}
          {injected ? (
            <div className="mt-3 animate-slide-in rounded-md border border-line-strong bg-raised p-3">
              <div className="flex items-center justify-between">
                <span className="num text-sm font-medium">{injected.vehicle_id}</span>
                <Badge tone={riskTone[injected.maintenance_risk]}>{injected.maintenance_risk} {injected.maintenance_probability.toFixed(0)}%</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-2">
                Detected: <span className="text-ink">{injected.predicted_component}</span> · service within {injected.predicted_days_to_service ?? "—"} days
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {injected.reason_codes.map((r) => (
                  <li key={r} className="text-2xs text-ink-3">+ {r}</li>
                ))}
              </ul>
              <Link to={`/fleet/health?vehicle=${injected.vehicle_id}`} className="mt-2 inline-block text-2xs text-accent hover:underline">
                Open vehicle health →
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-2xs leading-relaxed text-ink-3">The fault changes the vehicle's telemetry; the scoring model then re-evaluates it and returns component, probability and reason codes.</p>
          )}
        </Panel>

        <Panel title="Guided AI Demo" kicker={`${DEMO_TITLES.length} steps · about 40 seconds`}>
          <ol className="space-y-1">
            {DEMO_TITLES.map((t, i) => (
              <li key={t} className="flex gap-2 text-2xs text-ink-2">
                <span className="num w-4 shrink-0 text-right text-ink-3">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          <Button variant="primary" className="mt-3 w-full" onClick={() => void runDemo(navigate)} disabled={demoRunning}>
            <Play size={13} fill="currentColor" /> {demoRunning ? "DEMO RUNNING…" : "RUN AI DEMO"}
          </Button>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Panel title="World State" kicker="Synthetic data">
          <Stat label="Vehicles" value={summary ? fmtInt(summary.fleet_total) : "—"} />
          <Stat label="Charging stations" value={summary?.charging_stations ?? "—"} />
          <Stat label="Frames awaiting review" value={summary ? fmtInt(summary.review_queue) : "—"} />
          <Stat label="Predicted maintenance cases" value={summary?.predicted_maintenance_cases ?? "—"} />
          <div className="mt-3 border-t border-line pt-3">
            {confirmReset ? (
              <div className="rounded-md border border-warn/40 bg-warn/5 p-3">
                <p className="flex items-start gap-2 text-2xs text-ink-2">
                  <AlertTriangle size={13} className="mt-px shrink-0 text-warn" />
                  Regenerates all synthetic data from the seed. Reviews, bookings and injected faults are discarded.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <Button variant="danger" size="sm" onClick={reset} disabled={busy === "reset"}>
                    {busy === "reset" ? "Regenerating…" : "Yes, reset world"}
                  </Button>
                  <Button size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setConfirmReset(true)}>
                <RotateCcw size={13} /> Reset synthetic world
              </Button>
            )}
          </div>
        </Panel>

        <Panel title="API" kicker="FastAPI · REST + WebSocket" className="xl:col-span-2">
          <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            {[
              "GET /api/dashboard/summary",
              "GET /api/vehicles",
              "GET /api/vehicles/{id}",
              "GET /api/vehicles/{id}/telemetry",
              "GET /api/vehicles/{id}/route",
              "GET /api/maintenance/predictions",
              "GET /api/chargers",
              "GET /api/chargers/recommendations",
              "GET /api/routes",
              "GET /api/adas/frames",
              "GET /api/adas/review-queue",
              "POST /api/adas/review/{frame_id}",
              "GET /api/adas/edge-cases",
              "GET /api/adas/model-metrics",
              "GET /api/datasets",
              "WS /ws/live",
            ].map((e) => {
              const [method, path] = e.split(" ");
              return (
                <div key={e} className="flex items-center gap-2 font-mono text-2xs">
                  <span className={`w-9 shrink-0 ${method === "POST" ? "text-warn" : method === "WS" ? "text-accent" : "text-good"}`}>{method}</span>
                  <span className="truncate text-ink-2">{path}</span>
                </div>
              );
            })}
          </div>
          <a href="/api/docs" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-2xs text-accent hover:underline">
            Open interactive API docs <ExternalLink size={11} />
          </a>
        </Panel>
      </div>
    </div>
  );
}
