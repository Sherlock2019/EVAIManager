import { CalendarCheck, CalendarClock, Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, ErrorNote, Kpi, Loading, Meter, PageHeader, Panel, Tabs } from "../components/ui";
import { post, useApi } from "../lib/api";
import { fmtInt, riskTone, toneColor } from "../lib/format";
import { useLive } from "../lib/live";
import type { Prediction, Risk, SchedulePlan } from "../lib/types";

type Filter = "FLAGGED" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
const BANDS: { level: Risk; range: string }[] = [
  { level: "LOW", range: "0–30%" },
  { level: "MEDIUM", range: "31–60%" },
  { level: "HIGH", range: "61–80%" },
  { level: "CRITICAL", range: "81–100%" },
];
const FEATURES = ["Battery degradation", "Temperature anomalies", "Charging frequency", "Odometer", "Tire pressure trend", "Motor temperature", "Fault codes"];

export default function Maintenance() {
  const [filter, setFilter] = useState<Filter>("FLAGGED");
  const flagged = useApi<Prediction[]>("/api/maintenance/predictions?min_risk=MEDIUM&limit=500");
  const healthy = useApi<Prediction[]>(filter === "LOW" ? "/api/maintenance/predictions?min_risk=LOW&limit=2000" : null);
  const summary = useLive((s) => s.summary);
  const refresh = useLive((s) => s.refresh);
  const navigate = useNavigate();
  const [plan, setPlan] = useState<SchedulePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (filter === "LOW") return (healthy.data ?? []).filter((p) => p.maintenance_risk === "LOW").slice(0, 25);
    const all = flagged.data ?? [];
    return filter === "FLAGGED" ? all : all.filter((p) => p.maintenance_risk === filter);
  }, [filter, flagged.data, healthy.data]);

  const optimize = async () => {
    setPlanning(true);
    try {
      const [result] = await Promise.all([post<SchedulePlan>("/api/maintenance/optimize-schedule"), new Promise((r) => setTimeout(r, 900))]);
      setPlan(result);
    } finally {
      setPlanning(false);
    }
  };
  const book = async (vehicleId: string) => {
    setBooking(vehicleId);
    try {
      await post(`/api/maintenance/schedule/${vehicleId}`);
      refresh();
    } finally {
      setBooking(null);
    }
  };

  const risk = summary?.risk_counts;
  const avgHealth = flagged.data?.length ? Math.round(flagged.data.reduce((a, p) => a + p.health_score, 0) / flagged.data.length) : null;

  return (
    <div>
      <PageHeader
        kicker="Fleet · Predictive maintenance"
        title="Maintenance Control Center"
        description="Instead of waiting for failures, an interpretable risk model scores every vehicle from its telemetry and explains each prediction with reason codes."
      >
        <Button variant="primary" onClick={optimize} disabled={planning}>
          <Sparkles size={13} /> {planning ? "Optimizing…" : "Optimize Service Schedule"}
        </Button>
      </PageHeader>
      {flagged.error && <ErrorNote message={flagged.error} />}

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Critical" value={risk?.CRITICAL ?? "—"} sub="service within days" tone="crit" />
        <Kpi label="High" value={risk?.HIGH ?? "—"} sub="inspect soon" tone="serious" />
        <Kpi label="Medium" value={risk?.MEDIUM ?? "—"} sub="schedule a check" tone="warn" />
        <Kpi label="Low" value={risk ? fmtInt(risk.LOW) : "—"} sub="monitor only" tone="good" />
        <Kpi label="Avg health · flagged" value={avgHealth ?? "—"} unit="/100" sub="health score" />
      </div>

      {plan && (
        <Panel
          className="mb-3 animate-slide-in"
          title="Optimized Service Schedule"
          kicker="AI plan"
          action={
            <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>
              Dismiss
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {[
              { l: "Vehicles scheduled", v: plan.summary.vehicles_scheduled },
              { l: "Service centers", v: plan.summary.service_centers },
              { l: "Critical pulled in today", v: plan.summary.critical_same_day },
              { l: "Inside service window", v: `${plan.summary.within_window_pct}%` },
              { l: "Workshop hours", v: plan.summary.total_service_hours },
            ].map((x) => (
              <div key={x.l}>
                <div className="label">{x.l}</div>
                <div className="num text-lg font-medium">{x.v}</div>
              </div>
            ))}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="label">Grouped by</span>
              {plan.grouping.map((g) => (
                <Badge key={g} tone="accent">{g}</Badge>
              ))}
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {plan.centers.map((c) => (
              <div key={c.id} className="rounded-md border border-line bg-raised/50">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{c.name}</div>
                    <div className="text-3xs text-ink-3">
                      {c.city} · {c.bays} bays · {c.vehicles} vehicles
                    </div>
                  </div>
                  <span className="num text-2xs text-ink-2">peak {c.peak_load_pct}%</span>
                </div>
                <div className="max-h-[188px] space-y-2 overflow-y-auto p-2.5">
                  {c.days.map((d) => (
                    <div key={d.date}>
                      <div className="label flex justify-between">
                        <span>{d.day_offset === 0 ? "Today" : `Day +${d.day_offset}`} · {d.date}</span>
                        <span>{d.hours}h</span>
                      </div>
                      {d.jobs.map((j) => (
                        <button key={j.vehicle_id} onClick={() => navigate(`/fleet/health?vehicle=${j.vehicle_id}`)} className="mt-1 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-raised">
                          <span className="h-4 w-0.5 rounded" style={{ background: toneColor[riskTone[j.risk]] }} />
                          <span className="num text-2xs">{j.vehicle_id.slice(-4)}</span>
                          <span className="min-w-0 flex-1 truncate text-2xs text-ink-2">{j.component}</span>
                          <span className="num text-3xs text-ink-3">{j.duration_h}h · {j.parts}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel
          title="Predicted Maintenance"
          kicker={`${rows.length} vehicles`}
          bodyClassName="p-0"
          action={
            <Tabs
              value={filter}
              onChange={setFilter}
              options={[
                { value: "FLAGGED", label: "All flagged" },
                { value: "CRITICAL", label: "Critical" },
                { value: "HIGH", label: "High" },
                { value: "MEDIUM", label: "Medium" },
                { value: "LOW", label: "Healthy sample" },
              ]}
            />
          }
        >
          {flagged.loading || (filter === "LOW" && healthy.loading) ? (
            <Loading />
          ) : (
            <div className="max-h-[640px] overflow-auto">
              <table className="table-grid w-full text-xs">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr>
                    <th>Vehicle</th>
                    <th>Model</th>
                    <th>Health</th>
                    <th>Risk</th>
                    <th>Predicted issue</th>
                    <th>Service window</th>
                    <th>Recommended action</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const tone = riskTone[p.maintenance_risk];
                    return (
                      <tr key={p.vehicle_id} className="cursor-pointer" onClick={() => navigate(`/fleet/health?vehicle=${p.vehicle_id}`)}>
                        <td className="whitespace-nowrap">
                          <div className="num font-medium">{p.vehicle_id}</div>
                          <div className="text-3xs text-ink-3">{p.city}</div>
                        </td>
                        <td className="text-ink-2">{p.model}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="num w-6">{p.health_score}</span>
                            <div className="w-14">
                              <Meter value={p.health_score} max={100} tone={tone} />
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge tone={tone}>{p.maintenance_risk} {p.maintenance_probability.toFixed(0)}%</Badge>
                        </td>
                        <td>
                          <div>{p.predicted_component}</div>
                          {p.reason_codes[0] && <div className="max-w-[260px] truncate text-3xs text-ink-3">+ {p.reason_codes[0]}</div>}
                        </td>
                        <td className="num">{p.predicted_days_to_service ? `${p.predicted_days_to_service} days` : "—"}</td>
                        <td className="text-ink-2">{p.recommended_action}</td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          {p.maintenance_risk === "LOW" ? null : p.booked ? (
                            <span className="inline-flex items-center gap-1 text-2xs text-good">
                              <Check size={12} /> Booked
                            </span>
                          ) : (
                            <Button size="sm" onClick={() => void book(p.vehicle_id)} disabled={booking === p.vehicle_id}>
                              <CalendarClock size={11} /> {booking === p.vehicle_id ? "Booking…" : "Book"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Scoring Model" kicker="Interpretable by design">
            <p className="text-2xs leading-relaxed text-ink-2">
              Each component gets a 0–1 risk from telemetry. The maintenance probability blends the worst component, the second worst, wear and an IsolationForest anomaly score.
            </p>
            <div className="mt-3 space-y-1.5">
              {BANDS.map((b) => (
                <div key={b.level} className="flex items-center justify-between">
                  <Badge tone={riskTone[b.level]}>{b.level}</Badge>
                  <span className="num text-2xs text-ink-2">{b.range}</span>
                </div>
              ))}
            </div>
            <div className="label mb-1.5 mt-4">Features</div>
            <div className="flex flex-wrap gap-1">
              {FEATURES.map((f) => (
                <span key={f} className="rounded border border-line px-1.5 py-0.5 text-3xs text-ink-2">{f}</span>
              ))}
            </div>
            <div className="label mb-1.5 mt-4">Outputs</div>
            <div className="space-y-0.5 font-mono text-3xs text-ink-2">
              <div>maintenance_probability</div>
              <div>predicted_component</div>
              <div>predicted_days_to_service</div>
              <div>reason_codes</div>
            </div>
          </Panel>
          <Panel title="Workflow" kicker="Telemetry to service">
            <ol className="space-y-2">
              {["EV telemetry", "IoT ingestion", "Vehicle digital health profile", "AI anomaly detection", "Predictive maintenance", "Service scheduling"].map((step, i) => (
                <li key={step} className="flex items-center gap-2.5 text-xs text-ink-2">
                  <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-3xs text-ink-3">{i + 1}</span>
                  {step}
                  {i === 5 && <CalendarCheck size={12} className="text-accent" />}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
