import clsx from "clsx";
import L from "leaflet";
import { Ban, PlugZap, Plus, RotateCcw, Sparkles, TrendingUp, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapOverlay, MapView } from "../components/MapView";
import { Badge, Button, ErrorNote, Legend, Meter, MockTag, PageHeader, Panel, Slider, Tabs } from "../components/ui";
import { useApi } from "../lib/api";
import { useDemo } from "../lib/demo";
import { C, CHARGER_STATUS, fmtInt, fmtUsd, titleCase } from "../lib/format";
import { useLive } from "../lib/live";
import { CITY_VIEWS, GRID_STATUS, HeatLayer, chargerIcon, gridNodeIcon, pilotIcon, plannedIcon, siteIcon } from "../lib/map";
import { PILOT_STATIONS, pickPilot, pilotPopup, pilotTeslaPorts } from "../lib/pilot";
import type { Charger, GridNode, GridView, Plan, Scenario } from "../lib/types";

const fmtMw = (kw: number) => `${(kw / 1000).toFixed(1)} MW`;

// Typical relative charging load by hour of day (illustrative); each station's own peak window adds a bump.
const HOUR_SHAPE = [0.3, 0.25, 0.22, 0.2, 0.2, 0.25, 0.45, 0.7, 0.85, 0.9, 0.95, 1.0, 1.0, 0.95, 0.9, 0.92, 1.0, 1.1, 1.2, 1.15, 1.0, 0.8, 0.6, 0.4];
const PEAK_BUMP = 0.6;

/** Network occupancy per hour: each station's curve averages to its utilization; ports-weighted across stations. */
function occupancy24h(chargers: Charger[]) {
  const hours = Array(24).fill(0);
  let ports = 0;
  for (const c of chargers) {
    const start = Number(c.peak_window.slice(0, 2));
    const w = HOUR_SHAPE.map((b, h) => b * (h >= start && h < start + 3 ? 1 + PEAK_BUMP : 1));
    const mean = w.reduce((a, b) => a + b, 0) / 24;
    w.forEach((x, h) => (hours[h] += c.ports * Math.min(1, (c.utilization * x) / mean)));
    ports += c.ports;
  }
  const occ = hours.map((x) => x / (ports || 1));
  const peak = Math.max(...occ);
  return { hours: occ, avg: occ.reduce((a, b) => a + b, 0) / 24, peak, peakHour: occ.indexOf(peak) };
}

function gridPopup(n: GridNode): string {
  const st = GRID_STATUS[n.status];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return `<div style="min-width:230px">
    <div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:#EF4444">POWER GRID NODE · SYNTHETIC</div>
    <div style="font-weight:600;font-size:13px;margin:3px 0 2px">${n.name}</div>
    <div style="font-size:11px;color:${st.color};margin-bottom:8px">${st.label} · ${n.city}</div>
    <div style="height:8px;border-radius:4px;background:#18212F;position:relative;overflow:hidden;margin-bottom:6px"><div style="width:${Math.min(100, n.loading * 100)}%;height:100%;background:${st.color}"></div>
    <span style="position:absolute;top:0;bottom:0;left:${Math.min(99, n.loading_90d * 100)}%;width:2px;background:#E8EEF7"></span></div>
    ${row("EV hosting capacity", fmtMw(n.capacity_kw))}${row("Charging need at peak", `${fmtMw(n.peak_need_kw)} · ${pct(n.loading)}`)}
    ${row("Need in 90 days", `${fmtMw(n.need_90d_kw)} · ${pct(n.loading_90d)}`)}${row("Headroom", fmtMw(n.headroom_kw))}
    ${row("Stations fed", n.stations.length)}${row("Installed charger power", fmtMw(n.installed_kw))}
    <div style="margin-top:6px;font-size:10px;color:#64748B">Invented node and capacity for the demo, not EVN data. Peak need = installed kW × utilization × 1.25 (capped).</div></div>`;
}

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

function stationPopup(c: Charger, available: number, action?: { action: string; detail: string }, grid?: GridView | null): string {
  const status = CHARGER_STATUS[c.status];
  const g = grid?.stations[c.station_id];
  const node = g && grid?.nodes.find((n) => n.node_id === g.node_id);
  const gridRows = g && node
    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #263347">${row("Grid node", node.name)}${row("Station peak need", `${Math.round(g.peak_need_kw)} kW of ${g.installed_kw} kW`)}${row("Node loading", `<span style="color:${GRID_STATUS[node.status].color}">${Math.round(node.loading * 100)}%</span>`)}</div>`
    : "";
  return `<div style="min-width:216px">
    <div style="font-weight:600;font-size:13px">${c.name}</div>
    <div style="margin:2px 0 8px;display:flex;align-items:center;gap:6px;font-size:11px;color:${status.color}"><span style="width:7px;height:7px;border-radius:2px;background:${status.color}"></span>${status.label} · ${c.power_kw} kW</div>
    ${row("Chargers", c.ports)}${row("Available", available)}${row("Current utilization", `${Math.round(c.utilization * 100)}%`)}
    ${row("Average daily sessions", c.avg_daily_sessions)}${row("Peak", c.peak_window)}${row("Forecast 90 days", `+${Math.round(c.forecast_90d_pct)}%`)}${gridRows}
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
  const [showPilot, setShowPilot] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const grid = useApi<GridView>(showGrid ? "/api/chargers/grid" : null);
  const gridRef = useRef<GridView | null>(null);
  gridRef.current = showGrid ? grid.data : null;
  const demoOpen = useDemo((s) => s.open); // the docked demo panel narrows the map

  const chargers = useApi<Charger[]>("/api/chargers");
  const pilot = useMemo(() => (chargers.data ? pickPilot(chargers.data) : []), [chargers.data]);
  const occupancy = useMemo(() => (chargers.data ? occupancy24h(chargers.data) : null), [chargers.data]);
  const pilotIds = useMemo(() => new Set(showPilot ? pilot.map((c) => c.station_id) : []), [pilot, showPilot]);
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
      if (pilotIds.has(c.station_id)) return; // drawn by the pilot layer instead
      const action = optimized ? plan.data?.station_actions[c.station_id] : undefined;
      const expand = action?.action === "EXPAND";
      const marker = L.marker([c.latitude, c.longitude], { icon: chargerIcon(c.status, { expand, highlight: expand, size: expand ? 22 : 18 }), zIndexOffset: expand ? 400 : 0 });
      marker.bindTooltip(c.name, { direction: "top", offset: [0, -10] });
      marker.bindPopup(() => {
        const live = useLive.getState().chargerAvailability[idx] ?? c.available;
        const a = optimized ? planRef.current?.station_actions[c.station_id] : undefined;
        return stationPopup(c, live, a, gridRef.current);
      });
      marker.addTo(group);
    });
    group.addTo(map);
    return () => void group.remove();
  }, [map, chargers.data, optimized, plan.data, pilotIds]);

  // power grid: feeder lines from each synthetic node to the stations it feeds, then the node with its level meter
  useEffect(() => {
    if (!map || !showGrid || !grid.data || !chargers.data) return;
    const group = L.layerGroup();
    const byId = new Map(chargers.data.map((c) => [c.station_id, c]));
    for (const n of grid.data.nodes) {
      const color = GRID_STATUS[n.status].color;
      for (const id of n.stations) {
        const c = byId.get(id);
        if (c) L.polyline([[n.latitude, n.longitude], [c.latitude, c.longitude]], { pane: "routes", color, weight: 1.2, opacity: 0.55, interactive: false }).addTo(group);
      }
      L.marker([n.latitude, n.longitude], { icon: gridNodeIcon(n.loading, n.status), zIndexOffset: 1000 })
        .bindTooltip(`${n.name} · ${fmtMw(n.peak_need_kw)} need / ${fmtMw(n.capacity_kw)} capacity`, { direction: "top", offset: [0, -14] })
        .bindPopup(gridPopup(n))
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, showGrid, grid.data, chargers.data]);

  // proposed hybrid VinFast + Tesla pilot stations
  useEffect(() => {
    if (!map || !showPilot) return;
    const group = L.layerGroup();
    pilot.forEach((c, i) => {
      L.marker([c.latitude, c.longitude], { icon: pilotIcon(i + 1, focus === c.name), zIndexOffset: 900 })
        .bindTooltip(`Hybrid pilot #${i + 1} · ${c.name}`, { direction: "top", offset: [0, -14] })
        .bindPopup(pilotPopup(c, i + 1))
        .addTo(group);
    });
    group.addTo(map);
    return () => void group.remove();
  }, [map, pilot, showPilot, focus]);

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
        <Link to="/energy/open-charging" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-3 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink">
          <PlugZap size={13} /> VinFast / Tesla / Other EV charging
        </Link>
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
              <button
                onClick={() => setShowGrid((v) => !v)}
                aria-pressed={showGrid}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-2xs font-semibold transition-colors",
                  showGrid ? "bg-crit text-white shadow-[0_0_14px_#EF444488]" : "border border-crit/60 bg-crit/10 text-crit hover:bg-crit/20",
                )}
              >
                <Zap size={11} fill={showGrid ? "currentColor" : "none"} /> Power grid
              </button>
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
              {showGrid && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-2">
                  <span className="text-crit">▣ grid node (synthetic) · bar = charging need ÷ capacity</span>
                  {Object.values(GRID_STATUS).map((s) => (
                    <span key={s.label} className="inline-flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: s.color }} />{s.label}</span>
                  ))}
                </div>
              )}
              <button onClick={() => setShowPilot((v) => !v)} className={clsx("mt-1.5 flex items-center gap-1.5 rounded px-1 py-0.5 text-2xs transition-colors hover:bg-raised", showPilot ? "text-ink" : "text-ink-3")} aria-pressed={showPilot}>
                <span className="flex gap-px rounded bg-ink p-px" style={{ opacity: showPilot ? 1 : 0.4 }}>
                  <img src="/brands/vinfast.png" alt="" width={12} height={12} className="rounded-l-sm" />
                  <img src="/brands/tesla.png" alt="" width={12} height={12} className="rounded-r-sm" />
                </span>
                Hybrid VinFast + Tesla pilot (proposed, top {PILOT_STATIONS}) · {showPilot ? "on" : "off"}
              </button>
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
          {showGrid && grid.data && (
            <Panel
              title={<span className="flex items-center gap-2"><Zap size={13} className="text-crit" /> Power Grid vs Charging Need</span>}
              kicker="Synthetic grid nodes · peak need ÷ EV hosting capacity · tick = 90 days"
              bodyClassName="p-2 space-y-1 overflow-y-auto xl:max-h-[360px]"
            >
              {grid.data.nodes.map((n) => {
                const st = GRID_STATUS[n.status];
                return (
                  <button
                    key={n.node_id}
                    onClick={() => focusOn({ name: n.name, lat: n.latitude, lon: n.longitude })}
                    className={clsx("block w-full rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-raised", focus === n.name ? "border-crit/60 bg-raised" : "border-line")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">{n.name}</span>
                      <span className="num text-2xs" style={{ color: st.color }}>{Math.round(n.loading * 100)}%</span>
                    </div>
                    <div className="mt-1">
                      <Meter value={Math.min(n.peak_need_kw, n.capacity_kw)} max={n.capacity_kw} marker={Math.min(n.need_90d_kw, n.capacity_kw)} tone={n.status === "ok" ? "good" : n.status === "watch" ? "warn" : n.status === "constrained" ? "serious" : "crit"} height={6} />
                    </div>
                    <div className="mt-1 flex justify-between text-3xs text-ink-3">
                      <span>{n.city} · {n.stations.length} stations</span>
                      <span className="num">{fmtMw(n.peak_need_kw)} / {fmtMw(n.capacity_kw)} · 90d {Math.round(n.loading_90d * 100)}%</span>
                    </div>
                  </button>
                );
              })}
              <p className="px-1 pt-1 text-3xs leading-relaxed text-ink-3">{grid.data.note}</p>
            </Panel>
          )}
          {showPilot && pilot.length > 0 && (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <span className="flex gap-px rounded bg-ink p-px">
                    <img src="/brands/vinfast.png" alt="VinFast" width={16} height={16} className="rounded-l-sm" />
                    <img src="/brands/tesla.png" alt="Tesla" width={16} height={16} className="rounded-r-sm" />
                  </span>
                  Hybrid VinFast + Tesla Pilot
                </span>
              }
              kicker={`Proposed · ${PILOT_STATIONS} most-used stations · simulation`}
              action={<Link to="/energy/open-charging" className="text-2xs text-accent hover:underline">Business case →</Link>}
              bodyClassName="p-2 space-y-1 overflow-y-auto xl:max-h-[300px]"
            >
              {pilot.map((c, i) => (
                <button
                  key={c.station_id}
                  onClick={() => focusOn({ name: c.name, lat: c.latitude, lon: c.longitude })}
                  className={clsx("flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-raised", focus === c.name ? "border-accent/60 bg-raised" : "border-line")}
                >
                  <span className="num w-5 text-2xs text-accent">#{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{c.name}</span>
                    <span className="block text-3xs text-ink-3">{c.city} · {c.avg_daily_sessions} sessions/day · {Math.round(c.utilization * 100)}% util.</span>
                  </span>
                  <span className="num text-3xs text-ink-2">{pilotTeslaPorts(c)}/{c.ports} Tesla</span>
                </button>
              ))}
              <p className="px-1 pt-1 text-3xs leading-relaxed text-ink-3">
                VinFast keeps priority on every port; Tesla gets priority 2 on the pilot ports. Brand marks identify vehicle groups only: not affiliated with or endorsed by VinFast, Tesla or V-Green, and no such pilot is announced.
              </p>
            </Panel>
          )}
          <Panel className="order-first" title="VinFast Charger Network" kicker={optimized ? "AI recommendation" : "Current network · synthetic"}>
            <div className="flex items-end justify-between">
              <div>
                <div className="label">VinFast-only charger stations</div>
                <div className="num mt-0.5 text-2xl font-medium leading-none">
                  {s?.current_stations ?? "—"} <span className="text-xs text-ink-3">VinFast-only stations · {s ? fmtInt(s.current_ports) : "—"} ports</span>
                </div>
              </div>
              {s && <Badge tone={s.demand_multiplier > 1.05 ? "warn" : s.demand_multiplier < 0.95 ? "idle" : "good"}>Demand ×{s.demand_multiplier.toFixed(2)}</Badge>}
            </div>
            {occupancy && (
              <div className="mt-3 rounded-md border border-line bg-raised px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="label">Occupancy rate · 24 h</span>
                  <span className="num text-2xs text-ink-3">peak {occupancy.peakHour}:00 · {Math.round(occupancy.peak * 100)}%</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="num text-2xl font-medium leading-none">{Math.round(occupancy.avg * 100)}%</span>
                  <span className="text-3xs text-ink-3">24 h average · ports in use</span>
                </div>
                <div className="mt-2 flex h-12 items-end gap-px" role="img" aria-label="Occupancy by hour">
                  {occupancy.hours.map((o, h) => (
                    <div
                      key={h}
                      title={`${String(h).padStart(2, "0")}:00 · ${Math.round(o * 100)}%`}
                      className="flex-1 rounded-t-sm"
                      style={{ height: `${Math.max(4, o * 100)}%`, background: o >= 0.9 ? C.crit : o >= 0.75 ? C.warn : C.good, opacity: h === occupancy.peakHour ? 1 : 0.75 }}
                    />
                  ))}
                </div>
                <div className="mt-0.5 flex justify-between font-mono text-3xs text-ink-3"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
                <p className="mt-1 text-3xs text-ink-3">Estimated from each station's utilization and peak window (typical daily charging curve), weighted by ports.</p>
              </div>
            )}
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
