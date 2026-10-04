import clsx from "clsx";
import L from "leaflet";
import { Ban, Plus, RotateCcw, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MapOverlay, MapView } from "../components/MapView";
import { Badge, Button, ErrorNote, Legend, Meter, MockTag, PageHeader, Panel, Slider, Tabs } from "../components/ui";
import { useApi } from "../lib/api";
import { useDemo } from "../lib/demo";
import { C, CHARGER_STATUS, fmtInt, fmtUsd, titleCase } from "../lib/format";
import { useLive } from "../lib/live";
import { CITY_VIEWS, HeatLayer, chargerIcon, plannedIcon, siteIcon } from "../lib/map";
import type { Charger, Plan, Scenario } from "../lib/types";

const BASELINE: Scenario = { ev_growth_pct: 30, avg_daily_km: 40, fast_charging_adoption_pct: 45, peak_concentration_pct: 50 };
type Heat = "none" | "travel_density" | "charging_demand" | "charger_capacity";
const HEAT_RAMP: Record<Exclude<Heat, "none">, [string, string]> = {
  travel_density: ["#12325E", "#9EC5F4"],
  charging_demand: ["#7A2E10", "#FFB98A"],
  charger_capacity: ["#0B4A36", "#7FE0BC"],
};
const FACTOR_LABEL: Record<string, string> = {
  route_density: "Route density",
  charging_demand: "Charging demand",
  distance_gap: "Distance gap",
  predicted_ev_growth: "EV growth",
  accessibility: "Accessibility",
};

const row = (label: string, value: string | number) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;padding:2px 0"><span style="color:#64748B">${label}</span><span style="font-family:'JetBrains Mono',monospace;color:#E8EEF7">${value}</span></div>`;

function stationPopup(c: Charger, available: number, action?: { action: string; detail: string }): string {
  const status = CHARGER_STATUS[c.status];
  return `<div style="min-width:216px">
    <div style="font-weight:600;font-size:13px">${c.name}</div>
    <div style="margin:2px 0 8px;display:flex;align-items:center;gap:6px;font-size:11px;color:${status.color}"><span style="width:7px;height:7px;border-radius:2px;background:${status.color}"></span>${status.label} · ${c.power_kw} kW</div>
    ${row("Chargers", c.ports)}${row("Available", available)}${row("Current utilization", `${Math.round(c.utilization * 100)}%`)}
    ${row("Average daily sessions", c.avg_daily_sessions)}${row("Peak", c.peak_window)}${row("Forecast 90 days", `+${Math.round(c.forecast_90d_pct)}%`)}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #263347">
      <div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:#3BC9F5">AI RECOMMENDATION</div>
      <div style="margin-top:3px;font-size:12px">${action ? `<b>${action.action}</b> — ${action.detail}` : c.recommendation ?? "—"}</div>
    </div></div>`;
}

export default function ChargingNetwork() {
  const [params] = useSearchParams();
  const [scenario, setScenario] = useState<Scenario>(BASELINE);
  const [applied, setApplied] = useState<Scenario>(BASELINE);
  const [optimized, setOptimized] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [heat, setHeat] = useState<Heat>("none");
  const [map, setMap] = useState<L.Map | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const demoOpen = useDemo((s) => s.open); // the docked demo panel narrows the map

  const chargers = useApi<Charger[]>("/api/chargers");
  const heatData = useApi<Record<string, number[][]>>("/api/routes/heatmap");
  const query = new URLSearchParams(Object.entries(applied).map(([k, v]) => [k, String(v)])).toString();
  const plan = useApi<Plan>(`/api/chargers/recommendations?${query}`);
  const planRef = useRef<Plan | null>(null);
  planRef.current = plan.data;

  // debounce slider drags before re-running the optimizer
  useEffect(() => {
    const t = setTimeout(() => setApplied(scenario), 220);
    return () => clearTimeout(t);
  }, [scenario]);

  const optimize = () => {
    setOptimizing(true);
    setOptimized(false);
    window.setTimeout(() => {
      setOptimizing(false);
      setOptimized(true);
    }, 1500);
  };
  useEffect(() => {
    if (params.get("optimize")) optimize();
  }, [params]);

  // existing stations
  useEffect(() => {
    if (!map || !chargers.data) return;
    const group = L.layerGroup();
    chargers.data.forEach((c, idx) => {
      const action = optimized ? plan.data?.station_actions[c.station_id] : undefined;
      const expand = action?.action === "EXPAND";
      const marker = L.marker([c.latitude, c.longitude], { icon: chargerIcon(c.status, { expand, highlight: expand, size: expand ? 22 : 18 }), zIndexOffset: expand ? 400 : 0 });
      marker.bindTooltip(c.name, { direction: "top", offset: [0, -10] });
      marker.bindPopup(() => {
        const live = useLive.getState().chargerAvailability[idx] ?? c.available;
        const a = optimized ? planRef.current?.station_actions[c.station_id] : undefined;
        return stationPopup(c, live, a);
      });
      marker.addTo(group);
    });
    group.addTo(map);
    return () => void group.remove();
  }, [map, chargers.data, optimized, plan.data]);

  // AI proposals: new sites and planned sites
  useEffect(() => {
    if (!map || !plan.data || !optimized) return;
    const group = L.layerGroup();
    for (const s of plan.data.sites) {
      L.marker([s.latitude, s.longitude], { icon: siteIcon(s.score, s.recommended), zIndexOffset: s.recommended ? 600 : 100 })
        .bindPopup(
          `<div style="min-width:216px"><div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:${s.recommended ? C.info : "#64748B"}">${s.recommended ? "ADD — RECOMMENDED NEW SITE" : "CANDIDATE — NOT RECOMMENDED"}</div>
          <div style="font-weight:600;font-size:13px;margin:3px 0 8px">${s.name}</div>
          ${row("AI score", `${s.score}/100`)}${row("Expected sessions/day", s.expected_sessions_per_day)}${row("Recommended ports", `+${s.recommended_ports}`)}${row("Nearest fast charger", `${s.nearest_fast_km} km`)}
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid #263347;font-size:11px;color:#A3B2C7">${s.reasons.join("<br/>")}</div></div>`,
        )
        .bindTooltip(`${s.name} · score ${s.score}`, { direction: "top", offset: [0, -14] })
        .addTo(group);
    }
    for (const p of plan.data.planned_sites) {
      const skip = p.action === "DO NOT EXPAND";
      L.marker([p.latitude, p.longitude], { icon: plannedIcon(skip), zIndexOffset: 500 })
        .bindPopup(
          `<div style="min-width:216px"><div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:${skip ? "#A3B2C7" : C.good}">PLANNED SITE — ${p.action}</div>
          <div style="font-weight:600;font-size:13px;margin:3px 0 8px">${p.name}</div>
          ${row("Nearby utilization", `${Math.round(p.nearby_utilization * 100)}%`)}${row("Nearby capacity", `${p.nearby_chargers} chargers`)}${row("Predicted demand growth", `${p.predicted_demand_growth_pct}%`)}${row("Planned ports", p.planned_ports)}
          ${skip ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #263347;font-size:12px">Estimated avoided investment: <b>${fmtUsd(p.avoided_investment_usd)}*</b><div style="color:#64748B;font-size:10px">*illustrative mock estimate</div></div>` : ""}</div>`,
        )
        .bindTooltip(`${p.name} · ${p.action}`, { direction: "top", offset: [0, -12] })
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, plan.data, optimized]);

  // heat layer
  useEffect(() => {
    if (!map || !heatData.data || heat === "none") return;
    const [low, high] = HEAT_RAMP[heat];
    const layer = new HeatLayer(map, low, high, heat === "charger_capacity" ? 20 : 28);
    layer.setPoints(heatData.data[heat]);
    return () => layer.destroy();
  }, [map, heatData.data, heat]);

  const s = plan.data?.summary;
  const actions = useMemo(() => {
    if (!plan.data) return [];
    const p = plan.data;
    return [
      ...p.sites.filter((x) => x.recommended).slice(0, 3).map((x) => ({
        kind: "ADD" as const, name: x.name, lat: x.latitude, lon: x.longitude,
        lines: [`AI score ${x.score}/100 · ${x.expected_sessions_per_day} sessions/day expected`, `Recommended: +${x.recommended_ports} fast chargers`],
      })),
      ...p.expansions.slice(0, 3).map((x) => ({
        kind: "EXPAND" as const, name: x.name, lat: x.latitude, lon: x.longitude,
        lines: [`Current utilization ${Math.round(x.utilization * 100)}% → projected ${Math.round(x.projected_utilization * 100)}%`, `Predicted demand +${Math.round(x.forecast_90d_pct)}% · add +${x.add_ports} ports`],
      })),
      ...p.planned_sites.filter((x) => x.action === "DO NOT EXPAND").slice(0, 3).map((x) => ({
        kind: "DO NOT EXPAND" as const, name: x.name, lat: x.latitude, lon: x.longitude,
        lines: [`Current utilization ${Math.round(x.nearby_utilization * 100)}% · ${x.nearby_chargers} chargers nearby`, `Potential CAPEX avoided: ${fmtUsd(x.avoided_investment_usd)}*`],
      })),
    ];
  }, [plan.data]);

  const focusOn = (a: { name: string; lat: number; lon: number }) => {
    setFocus(a.name);
    map?.flyTo([a.lat, a.lon], 13.5, { duration: 0.7 });
  };
  const changed = JSON.stringify(scenario) !== JSON.stringify(BASELINE);

  return (
    <div>
      <PageHeader
        kicker="Energy · Charging intelligence"
        title="Charging Network"
        description="Vehicle journeys show where charging demand actually exists. The planning engine scores new sites, sizes expansions — and flags planned capacity that demand does not justify."
      >
        <MockTag />
        <Button variant="primary" onClick={optimize} disabled={optimizing}>
          <Sparkles size={13} /> {optimizing ? "Optimizing…" : optimized ? "Re-run AI Optimize" : "AI Optimize Network"}
        </Button>
      </PageHeader>
      {plan.error && <ErrorNote message={plan.error} />}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_372px]">
        <section className="panel overflow-hidden">
          <MapView center={CITY_VIEWS["Ho Chi Minh City"].center} zoom={11.5} onMap={setMap} className="h-full min-h-[620px]">
            <MapOverlay position="tl" className="flex items-center gap-2 p-1.5">
              <span className="label pl-1.5">Heatmap</span>
              <Tabs
                value={heat}
                onChange={setHeat}
                options={[
                  { value: "none", label: "Off" },
                  { value: "travel_density", label: "Travel density" },
                  { value: "charging_demand", label: "Charging demand" },
                  { value: "charger_capacity", label: "Charger capacity" },
                ]}
              />
            </MapOverlay>
            <MapOverlay position="tr" className={clsx("p-1", demoOpen && "hidden")}>
              <div className="flex gap-0.5">
                {["Ho Chi Minh City", "Hanoi", "Da Nang", "Vietnam"].map((name) => (
                  <button key={name} onClick={() => map?.flyTo(CITY_VIEWS[name].center, name === "Ho Chi Minh City" ? 11.5 : CITY_VIEWS[name].zoom, { duration: 0.8 })} className="rounded px-2 py-1 text-2xs text-ink-2 hover:bg-raised hover:text-ink">
                    {name === "Ho Chi Minh City" ? "HCMC" : name}
                  </button>
                ))}
              </div>
            </MapOverlay>
            <MapOverlay position="bl" className="px-3 py-2">
              <Legend
                items={[
                  ...["normal", "high", "overloaded", "low"].map((k) => ({ label: CHARGER_STATUS[k].label, color: CHARGER_STATUS[k].color, shape: "square" as const })),
                  { label: "Recommended future charger", color: C.info, shape: "diamond" as const },
                ]}
              />
              {optimized && (
                <div className="mt-1.5 flex flex-wrap gap-x-3.5 text-2xs text-ink-2">
                  <span><span className="num text-ink">+</span> expand station</span>
                  <span><span className="num text-ink">✕</span> planned site not needed</span>
                  <span><span className="num text-ink">✓</span> planned site justified</span>
                  <span>number = AI site score</span>
                </div>
              )}
              {heat !== "none" && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="label">{titleCase(heat)}</span>
                  <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(to right, ${HEAT_RAMP[heat][0]}55, ${HEAT_RAMP[heat][1]})` }} />
                  <span className="text-3xs text-ink-3">low → high</span>
                </div>
              )}
            </MapOverlay>
            {optimizing && (
              <div className="absolute inset-0 z-[600] flex items-center justify-center bg-abyss/55 backdrop-blur-[2px]">
                <div className="rounded-lg border border-accent/40 bg-panel px-6 py-4 text-center shadow-2xl">
                  <Sparkles size={18} className="mx-auto animate-pulse-dot text-accent" />
                  <div className="mt-2 text-sm font-medium">Optimizing network…</div>
                  <div className="label mt-1">Scoring {plan.data?.sites.length ?? 14} candidate sites · evaluating {s?.current_stations ?? 186} stations</div>
                </div>
              </div>
            )}
          </MapView>
        </section>

        <div className="flex flex-col gap-3 xl:row-span-2">
          <Panel title="Network Plan" kicker={optimized ? "AI recommendation" : "Current network"}>
            <div className="flex items-end justify-between">
              <div>
                <div className="label">Current network</div>
                <div className="num mt-0.5 text-2xl font-medium leading-none">
                  {s?.current_stations ?? "—"} <span className="text-xs text-ink-3">stations · {s ? fmtInt(s.current_ports) : "—"} ports</span>
                </div>
              </div>
              {s && <Badge tone={s.demand_multiplier > 1.05 ? "warn" : s.demand_multiplier < 0.95 ? "idle" : "good"}>Demand ×{s.demand_multiplier.toFixed(2)}</Badge>}
            </div>
            {optimized && s ? (
              <div className="mt-3 grid animate-slide-in grid-cols-3 gap-2">
                {[
                  { n: `+${s.new_stations}`, l: "new stations", c: C.info },
                  { n: `+${s.added_ports}`, l: "ports at existing", c: C.warn },
                  { n: String(s.unnecessary_planned_sites), l: "planned sites unnecessary", c: C.idle },
                ].map((x) => (
                  <div key={x.l} className="rounded-md border border-line bg-raised px-2.5 py-2">
                    <div className="num text-lg font-medium leading-none" style={{ color: x.c === C.idle ? C.ink : x.c }}>{x.n}</div>
                    <div className="mt-1 text-3xs leading-tight text-ink-3">{x.l}</div>
                  </div>
                ))}
              </div>
            ) : (
              <button onClick={optimize} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent/5 py-4 text-xs text-accent transition-colors hover:bg-accent/10">
                <Sparkles size={13} /> Run AI Optimize Network to see recommendations
              </button>
            )}
            {optimized && s && s.avoided_investment_usd > 0 && (
              <p className="mt-2.5 text-2xs text-ink-2">
                Estimated avoided investment: <span className="num text-ink">{fmtUsd(s.avoided_investment_usd)}*</span>
                <span className="text-ink-3"> · *illustrative mock estimate</span>
              </p>
            )}
          </Panel>

          {optimized && (
            <Panel title="AI Actions" kicker="Click to locate on map" className="min-h-0 flex-1" bodyClassName="p-2 space-y-1.5 overflow-y-auto xl:max-h-[520px]">
              {actions.map((a, i) => (
                <button
                  key={a.kind + a.name}
                  onClick={() => focusOn(a)}
                  style={{ animationDelay: `${i * 90}ms` }}
                  className={clsx("block w-full animate-slide-in rounded-md border px-3 py-2 text-left transition-colors hover:bg-raised", focus === a.name ? "border-accent/60 bg-raised" : "border-line")}
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={a.kind === "ADD" ? "info" : a.kind === "EXPAND" ? "warn" : "idle"}>
                      {a.kind === "ADD" ? <Plus size={9} /> : a.kind === "EXPAND" ? <TrendingUp size={9} /> : <Ban size={9} />}
                      {a.kind}
                    </Badge>
                    <span className="truncate text-xs font-medium">{a.name}</span>
                  </div>
                  {a.lines.map((l) => (
                    <div key={l} className="mt-1 text-2xs text-ink-2">{l}</div>
                  ))}
                </button>
              ))}
            </Panel>
          )}
        </div>

        <Panel
          className="xl:col-start-1 xl:row-start-2"
          title="What-If Simulator"
          kicker="Move a slider — demand, recommendations and the map recalculate"
          action={
              changed && (
                <Button size="sm" variant="ghost" onClick={() => setScenario(BASELINE)}>
                  <RotateCcw size={11} /> Reset
                </Button>
              )
            }
          >
            <div className="grid gap-x-6 gap-y-3.5 md:grid-cols-2 2xl:grid-cols-4">
              <Slider label="Projected EV growth" unit="+%" min={0} max={100} value={scenario.ev_growth_pct} baseline={BASELINE.ev_growth_pct} onChange={(v) => { setScenario((p) => ({ ...p, ev_growth_pct: v })); setOptimized(true); }} />
              <Slider label="Average distance" unit=" km/day" min={0} max={100} value={scenario.avg_daily_km} baseline={BASELINE.avg_daily_km} onChange={(v) => { setScenario((p) => ({ ...p, avg_daily_km: v })); setOptimized(true); }} />
              <Slider label="Fast charging adoption" unit="%" min={0} max={100} value={scenario.fast_charging_adoption_pct} baseline={BASELINE.fast_charging_adoption_pct} onChange={(v) => { setScenario((p) => ({ ...p, fast_charging_adoption_pct: v })); setOptimized(true); }} />
              <Slider label="Peak-hour concentration" unit="%" min={0} max={100} value={scenario.peak_concentration_pct} baseline={BASELINE.peak_concentration_pct} onChange={(v) => { setScenario((p) => ({ ...p, peak_concentration_pct: v })); setOptimized(true); }} />
            </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Top AI Recommended Sites" kicker="Site score 0–100" bodyClassName="p-0" action={<span className="hidden font-mono text-3xs text-ink-3 lg:inline">{plan.data?.formula}</span>}>
          <div className="overflow-x-auto">
            <table className="table-grid w-full text-xs">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Site</th>
                  <th>AI score</th>
                  <th className="min-w-[220px]">Score contributions</th>
                  <th>Sessions/day</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {plan.data?.sites.slice(0, 9).map((site) => (
                  <tr key={site.name} className="cursor-pointer" onClick={() => { setOptimized(true); focusOn({ name: site.name, lat: site.latitude, lon: site.longitude }); }}>
                    <td className="num text-ink-3">{site.rank}</td>
                    <td>
                      <div className="font-medium">{site.name}</div>
                      <div className="text-2xs text-ink-3">{site.reasons[0]} · {site.city}</div>
                    </td>
                    <td>
                      <span className="num text-base font-medium" style={{ color: site.recommended ? C.ink : C.ink3 }}>{site.score}</span>
                    </td>
                    <td>
                      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-sm" title={Object.entries(site.contributions).map(([k, v]) => `${FACTOR_LABEL[k]} ${v}`).join(" · ")}>
                        {Object.entries(site.contributions).map(([k, v], i) => (
                          <span key={k} style={{ width: `${v}%`, background: [C.s1, C.s2, C.s3, C.s4, "#D55181"][i], opacity: site.recommended ? 1 : 0.45 }} />
                        ))}
                      </div>
                    </td>
                    <td className="num">{site.expected_sessions_per_day}</td>
                    <td>
                      <Badge tone={site.recommended ? "info" : "idle"}>{site.recommended ? `ADD +${site.recommended_ports}` : "MONITOR"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-2">
            <Legend items={Object.values(FACTOR_LABEL).map((label, i) => ({ label, color: [C.s1, C.s2, C.s3, C.s4, "#D55181"][i], shape: "square" as const }))} />
          </div>
        </Panel>

        <Panel title="Excess Capacity Check" kicker="AI does not always say build more" action={<MockTag>$ illustrative</MockTag>} bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {plan.data?.planned_sites.map((p) => {
              const skip = p.action === "DO NOT EXPAND";
              return (
                <li key={p.name} className="cursor-pointer px-4 py-2.5 hover:bg-raised" onClick={() => { setOptimized(true); focusOn({ name: p.name, lat: p.latitude, lon: p.longitude }); }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{p.name}</span>
                    <Badge tone={skip ? "idle" : p.action === "PROCEED" ? "good" : "warn"}>{p.action}</Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="w-28">
                      <Meter value={p.projected_utilization} tone={skip ? "idle" : "good"} marker={0.35} />
                    </div>
                    <span className="num text-2xs text-ink-2">
                      {Math.round(p.nearby_utilization * 100)}% util · {p.nearby_chargers} chargers nearby · growth {p.predicted_demand_growth_pct}%
                    </span>
                  </div>
                  {skip && (
                    <div className="mt-1 text-2xs text-ink-3">
                      Estimated avoided investment: <span className="num text-ink">{fmtUsd(p.avoided_investment_usd)}*</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line px-4 py-2 text-2xs text-ink-3">
            Decisions across existing stations:{" "}
            {s && Object.entries(s.action_counts).map(([k, v]) => `${titleCase(k.toLowerCase())} ${v}`).join(" · ")}
          </div>
        </Panel>
      </div>
    </div>
  );
}
