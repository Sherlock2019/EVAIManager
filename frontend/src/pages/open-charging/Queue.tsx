import clsx from "clsx";
import { Pause, Play, Plus, RotateCcw, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, ErrorNote, Loading, Panel, Tabs } from "../../components/ui";
import { post } from "../../lib/api";
import { C } from "../../lib/format";
import { GROUPS, GROUP_COLOR, GROUP_LABEL, clock, type Group, type QueuePolicy, type QueueResult, useOc } from "../../lib/openCharging";
import { Check, GroupBadge, ProvenanceTags } from "./shared";

const MODEL: Record<Group, { model: string; kwh: number; max_kw: number }> = {
  vinfast: { model: "VinFast VF 8", kwh: 45, max_kw: 150 },
  tesla: { model: "Tesla Model Y", kwh: 40, max_kw: 250 },
  other: { model: "Hyundai Ioniq 5", kwh: 40, max_kw: 220 },
};

interface Extra { vehicle_id: string; group: Group; model: string; arrive_min: number; kwh: number; max_kw: number }

export default function Queue({ defaults }: { defaults: QueuePolicy }) {
  const demoNonce = useOc((s) => s.demoNonce);
  const [policy, setPolicy] = useState<QueuePolicy>(defaults);
  const [step, setStep] = useState(1);
  const [extra, setExtra] = useState<Extra[]>([]);
  const [res, setRes] = useState<QueueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pauseOnAlert, setPauseOnAlert] = useState(true);
  const [addGroup, setAddGroup] = useState<Group>("tesla");

  // Load Demo Scenario resets the simulator to the seeded busy period
  useEffect(() => {
    setPolicy(defaults);
    setExtra([]);
    setT(0);
  }, [demoNonce, defaults]);

  const run = useCallback(() => {
    post<QueueResult>("/api/open-charging/queue/simulate", { policy, step_min: step, horizon_min: 180, extra_arrivals: extra })
      .then((r) => (setRes(r), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, [policy, step, extra]);
  useEffect(run, [run]);

  useEffect(() => {
    if (!playing || !res) return;
    const id = window.setInterval(() => {
      setT((prev) => {
        const next = Math.min(res.horizon_min, prev + res.step_min);
        if (pauseOnAlert && res.alerts.some((a) => a.t > prev && a.t <= next)) setPlaying(false);
        if (next >= res.horizon_min) setPlaying(false);
        return next;
      });
    }, 220);
    return () => window.clearInterval(id);
  }, [playing, res, pauseOnAlert]);

  const snap = useMemo(() => {
    if (!res) return null;
    let s = res.snapshots[0];
    for (const x of res.snapshots) if (x.t <= t) s = x;
    return s;
  }, [res, t]);

  const patch = (p: Partial<QueuePolicy>) => setPolicy((prev) => ({ ...prev, ...p }));
  const addVehicle = () => {
    const m = MODEL[addGroup];
    setExtra((xs) => [...xs, { vehicle_id: `NEW-${xs.length + 1}`, group: addGroup, model: m.model, arrive_min: t, kwh: m.kwh, max_kw: m.max_kw }]);
  };

  if (error) return <ErrorNote message={error} />;
  if (!res || !snap) return <Loading />;
  const visibleAlerts = res.alerts.filter((a) => a.t <= t);
  const log = res.log.filter((e) => e.t <= t).slice(-14).reverse();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceTags items={["SYNTHETIC SITE", "SIMULATED ARRIVALS", "PROPOSED POLICY"]} />
        <span className="text-2xs text-ink-3">{res.note}</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Queue policy" kicker="Operator-configurable · re-simulates on change">
          <div className="space-y-3 text-2xs">
            <div>
              <div className="label mb-1">Priority classes</div>
              {GROUPS.map((g) => (
                <div key={g} className="flex items-center justify-between py-0.5">
                  <GroupBadge group={g} />
                  <select value={policy.priority[g]} onChange={(e) => patch({ priority: { ...policy.priority, [g]: Number(e.target.value) } })} className="h-6 rounded border border-line-strong bg-abyss px-1 font-mono text-2xs">
                    {[1, 2, 3].map((p) => <option key={p} value={p}>P{p}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <div className="label mb-1">Anti-starvation (ageing)</div>
              <Tabs value={String(policy.anti_starvation_min ?? "off")} onChange={(v) => patch({ anti_starvation_min: v === "off" ? null : Number(v) })} options={[{ value: "off", label: "Off" }, { value: "20", label: "20 min" }, { value: "30", label: "30 min" }, { value: "45", label: "45 min" }]} />
              <p className="mt-1 text-3xs text-ink-3">Each interval waited lifts a driver one class (never above P1).</p>
            </div>
            <div>
              <div className="label mb-1">Reserved VinFast ports (shared ports)</div>
              <Tabs value={String(policy.reserved_vinfast_ports)} onChange={(v) => patch({ reserved_vinfast_ports: Number(v) })} options={["0", "1", "2"].map((v) => ({ value: v, label: v }))} />
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-ink-3">Release after idle</span>
                <input type="number" min={0} max={120} value={policy.reserve_release_idle_min} onChange={(e) => patch({ reserve_release_idle_min: Number(e.target.value) })} className="h-6 w-14 rounded border border-line-strong bg-abyss px-1 font-mono" />
                <span className="text-ink-3">min, if no VinFast waiting</span>
              </div>
            </div>
            <div>
              <div className="label mb-1">Third-party cap (simultaneous ports)</div>
              <Tabs value={String(policy.third_party_max_ports ?? "off")} onChange={(v) => patch({ third_party_max_ports: v === "off" ? null : Number(v) })} options={[{ value: "off", label: "Off" }, { value: "2", label: "2" }, { value: "3", label: "3" }]} />
            </div>
            <Check label="Admit unverified compatibility (not recommended)" checked={policy.allow_unverified} onChange={(v) => patch({ allow_unverified: v })} />
            <div className="grid grid-cols-2 gap-2">
              <label>
                <div className="text-ink-3">VinFast avg target</div>
                <input type="number" value={policy.target_avg_wait_vinfast_min} onChange={(e) => patch({ target_avg_wait_vinfast_min: Number(e.target.value) })} className="h-6 w-full rounded border border-line-strong bg-abyss px-1 font-mono" />
              </label>
              <label>
                <div className="text-ink-3">VinFast p90 target</div>
                <input type="number" value={policy.target_p90_wait_vinfast_min} onChange={(e) => patch({ target_p90_wait_vinfast_min: Number(e.target.value) })} className="h-6 w-full rounded border border-line-strong bg-abyss px-1 font-mono" />
              </label>
            </div>
            <Check label="Pause playback when a VinFast target is exceeded" checked={pauseOnAlert} onChange={setPauseOnAlert} />
            <div>
              <div className="label mb-1">Time step</div>
              <Tabs value={String(step)} onChange={(v) => setStep(Number(v))} options={["1", "2", "5"].map((v) => ({ value: v, label: `${v} min` }))} />
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPolicy(defaults)}><RotateCcw size={11} /> Default policy</Button>
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel
            title={`Simulated site · ${snap.clock}`}
            kicker={`Busy period ${res.start_clock}–${clock(res.horizon_min)} · ${res.ports.length} DC ports`}
            action={
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="primary" onClick={() => { if (t >= res.horizon_min) setT(0); setPlaying((p) => !p); }}>{playing ? <Pause size={11} /> : <Play size={11} />} {playing ? "Pause" : "Play"}</Button>
                <Button size="sm" onClick={() => setT((x) => Math.min(res.horizon_min, x + res.step_min))}><SkipForward size={11} /></Button>
                <Button size="sm" variant="ghost" onClick={() => { setT(0); setPlaying(false); }}><RotateCcw size={11} /></Button>
              </div>
            }
          >
            <input type="range" min={0} max={res.horizon_min} step={res.step_min} value={t} onChange={(e) => setT(Number(e.target.value))} className="w-full" style={{ ["--fill" as string]: `${(t / res.horizon_min) * 100}%` }} aria-label="Simulation time" />
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
              {snap.ports.map((p) => {
                const meta = res.ports.find((x) => x.port_id === p.port_id)!;
                const color = p.status === "offline" ? C.crit : p.group ? GROUP_COLOR[p.group] : p.status === "reserved_idle" ? C.s1 : C.idle;
                return (
                  <div key={p.port_id} className="rounded-md border bg-raised px-2.5 py-2" style={{ borderColor: `${color}88` }}>
                    <div className="flex items-center justify-between">
                      <span className="num text-xs font-medium">{p.port_id}</span>
                      <span className="num text-3xs text-ink-3">{meta.power_kw} kW</span>
                    </div>
                    <div className="mt-1 text-2xs" style={{ color }}>
                      {p.status === "charging" ? `${p.vehicle_id} · ${Math.max(0, Math.ceil((p.end_min ?? 0) - t))} min left` : p.status === "offline" ? "OFFLINE (outage)" : p.status === "reserved_idle" ? "Reserved · idle" : "Free"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-3xs text-ink-3">
                      {p.reserved && <span>reserved VinFast</span>}
                      {p.pending_outage && <span className="text-warn">outage after session</span>}
                      {GROUPS.filter((g) => meta.compat[g] !== "incompatible").map((g) => <span key={g} style={{ color: meta.compat[g] === "unverified" ? C.warn : undefined }}>{g === "vinfast" ? "VF" : g === "tesla" ? "T" : "O"}{meta.compat[g] === "unverified" ? "?" : ""}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-2xs">
              {GROUPS.map((g) => <span key={g}><GroupBadge group={g}>{GROUP_LABEL[g]} waiting {snap.queue_counts[g]}</GroupBadge></span>)}
              <span className="ml-auto flex items-center gap-2">
                <select value={addGroup} onChange={(e) => setAddGroup(e.target.value as Group)} className="h-7 rounded border border-line-strong bg-abyss px-1 text-2xs">
                  {GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                </select>
                <Button size="sm" onClick={addVehicle}><Plus size={11} /> Add arrival at {snap.clock}</Button>
              </span>
            </div>
            {visibleAlerts.length > 0 && (
              <div className="mt-3 space-y-1">
                {visibleAlerts.map((a) => <div key={a.kind} className="rounded border border-crit/40 bg-crit/10 px-2 py-1 text-2xs text-crit">{a.clock} · {a.text}</div>)}
              </div>
            )}
          </Panel>

          <Panel title="Current queue" kicker="Order = compatibility → priority class (with ageing if on) → arrival time" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="table-grid w-full text-2xs">
                <thead><tr><th>Pos</th><th>Vehicle</th><th>Class</th><th>Waited</th><th>Est. wait</th><th>Compatible ports</th><th>Reason</th></tr></thead>
                <tbody>
                  {snap.queue.length === 0 && <tr><td colSpan={7} className="text-ink-3">Queue empty</td></tr>}
                  {snap.queue.map((q) => (
                    <tr key={q.vehicle_id} className={clsx(q.blocked && "opacity-70")}>
                      <td className="num">{q.position}</td>
                      <td><div className="font-medium">{q.vehicle_id}</div><div className="text-ink-3">{q.model} · {q.kwh.toFixed(0)} kWh</div></td>
                      <td><GroupBadge group={q.group}>P{q.priority}{q.promoted ? ` → P${q.effective_priority}` : ""}</GroupBadge></td>
                      <td className="num">{Math.max(0, t - q.arrive_min).toFixed(0)} min</td>
                      <td className="num">{q.blocked ? "—" : q.est_start_min === null ? "> 10 h" : `${Math.max(0, q.est_start_min - t).toFixed(0)} min`}</td>
                      <td className="num">{q.compatible_ports.join(", ") || "none"}</td>
                      <td>{q.blocked ? <span className="text-warn">{q.blocked}</span> : q.promoted ? <span className="text-accent">{q.reason}</span> : <span className="text-ink-2">{q.reason}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Waits by group (whole simulated period)" kicker="Served drivers · minutes" bodyClassName="p-0">
          <table className="table-grid w-full text-2xs">
            <thead><tr><th>Group</th><th>Arrived</th><th>Served</th><th>Absent</th><th>Cancelled</th><th>Still waiting</th><th>Avg</th><th>p90</th><th>Max</th></tr></thead>
            <tbody>
              {GROUPS.map((g) => {
                const s = res.stats[g];
                const vf = g === "vinfast";
                return (
                  <tr key={g}>
                    <td><GroupBadge group={g} /></td>
                    <td className="num">{s.arrived}</td><td className="num">{s.served}</td><td className="num">{s.absent}</td><td className="num">{s.cancelled}</td><td className="num">{s.waiting_at_end}</td>
                    <td className="num" style={{ color: vf && (s.avg_wait ?? 0) > policy.target_avg_wait_vinfast_min ? C.crit : undefined }}>{s.avg_wait ?? "—"}</td>
                    <td className="num" style={{ color: vf && (s.p90_wait ?? 0) > policy.target_p90_wait_vinfast_min ? C.crit : undefined }}>{s.p90_wait ?? "—"}</td>
                    <td className="num">{s.max_wait ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-3xs text-ink-3">{res.wait_method}</p>
        </Panel>
        <Panel title="Event log" kicker="Latest first · every event re-computes the ETAs" bodyClassName="p-0">
          <ul className="max-h-[260px] divide-y divide-line overflow-y-auto">
            {log.map((e, i) => (
              <li key={i} className="flex gap-3 px-4 py-1.5 text-2xs">
                <span className="num text-ink-3">{e.clock}</span>
                <Badge tone={e.type === "start" ? "good" : e.type === "outage" ? "crit" : e.type === "absent" || e.type === "cancel" ? "warn" : "idle"}>{e.type}</Badge>
                <span className="text-ink-2">{e.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <p className="text-3xs text-ink-3">Rules: safety and compatibility first · an active session is never interrupted · priority class, then first-come first-served · absent drivers are skipped · a scheduled outage starts when the current session ends. Brand priority is not claimed to be current practice of VinFast or V-Green.</p>
    </div>
  );
}
