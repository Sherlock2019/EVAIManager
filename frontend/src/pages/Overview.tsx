import clsx from "clsx";
import L from "leaflet";
import { ArrowRight, BatteryCharging, Car, Crosshair, Database, MapPin, ScanEye, ShieldCheck, Sparkles, Wrench, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LOOP } from "../components/AppShell";
import { MapOverlay, MapView, useFleetLayer } from "../components/MapView";
import { Badge, Button, Kpi, Legend, MockTag, Panel } from "../components/ui";
import { useApi } from "../lib/api";
import { C, CHARGER_STATUS, VEHICLE_STATUS, fmtCompact, fmtInt, toneColor, type Tone } from "../lib/format";
import { useLive } from "../lib/live";
import { CITY_VIEWS, HeatLayer, chargerIcon, eventIcon, siteIcon } from "../lib/map";
import type { Charger, Insight, Plan, RouteInfo } from "../lib/types";

const INSIGHT_TONE: Record<Insight["tone"], Tone> = { critical: "crit", warning: "warn", serious: "serious", info: "accent", muted: "idle" };
const LIFECYCLE = ["Vehicle", "Sensors + Telemetry", "Data Platform", "AI", "Human Validation", "Decision", "Action", "New Data", "Continuous Improvement"];
const VALUE_CARDS = [
  { title: "ADAS Data", icon: ScanEye, to: "/adas", points: ["Reduce manual labeling work", "Prioritize difficult samples", "Improve dataset quality"] },
  { title: "Vehicle Operations", icon: Wrench, to: "/fleet/maintenance", points: ["Predict failures earlier", "Improve fleet availability", "Optimize maintenance scheduling"] },
  { title: "Charging Network", icon: BatteryCharging, to: "/energy/charging", points: ["Understand real charging demand", "Identify infrastructure gaps", "Avoid unnecessary capacity"] },
  { title: "Continuous AI", icon: Sparkles, to: "/system/architecture", points: ["Every vehicle generates learning data", "Every correction improves models", "Every journey improves network planning"] },
];
type LayerKey = "vehicles" | "chargers" | "routes" | "events" | "heat" | "sites";
const LAYERS: { key: LayerKey; label: string }[] = [
  { key: "vehicles", label: "Vehicles" },
  { key: "chargers", label: "Chargers" },
  { key: "routes", label: "Routes" },
  { key: "events", label: "ADAS events" },
  { key: "heat", label: "Demand heat" },
  { key: "sites", label: "AI sites" },
];

export default function Overview() {
  const summary = useLive((s) => s.summary);
  const events = useLive((s) => s.events);
  const insights = useApi<Insight[]>("/api/dashboard/insights");
  const chargers = useApi<Charger[]>("/api/chargers");
  const routes = useApi<RouteInfo[]>("/api/routes");
  const plan = useApi<Plan>("/api/chargers/recommendations");
  const heat = useApi<Record<string, number[][]>>("/api/routes/heatmap");
  const navigate = useNavigate();

  const [map, setMap] = useState<L.Map | null>(null);
  const [view, setView] = useState("Vietnam");
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ vehicles: true, chargers: true, routes: true, events: true, heat: false, sites: true });
  const [zoom, setZoom] = useState(6);

  useFleetLayer(layers.vehicles ? map : null, { onSelect: (id) => navigate(`/fleet/health?vehicle=${id}`), clusterBelowZoom: 11 });

  useEffect(() => {
    if (!map) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on("zoomend", onZoom);
    return () => void map.off("zoomend", onZoom);
  }, [map]);

  // charging stations (only once the map is zoomed to city scale, to keep the national view legible)
  useEffect(() => {
    if (!map || !chargers.data || !layers.chargers) return;
    const group = L.layerGroup();
    const cityScale = zoom >= 9.5;
    for (const c of chargers.data) {
      if (!cityScale && c.status !== "overloaded") continue;
      L.marker([c.latitude, c.longitude], { icon: chargerIcon(c.status, { size: cityScale ? 16 : 12 }), keyboard: false })
        .bindTooltip(`${c.name} · ${Math.round(c.utilization * 100)}% · ${CHARGER_STATUS[c.status].label}`, { direction: "top", offset: [0, -8] })
        .on("click", () => navigate("/energy/charging"))
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, chargers.data, layers.chargers, zoom, navigate]);

  // route polylines
  useEffect(() => {
    if (!map || !routes.data || !layers.routes) return;
    const group = L.layerGroup();
    const maxTrips = Math.max(...routes.data.map((r) => r.trips_per_day));
    for (const r of routes.data) {
      const corridor = r.kind === "corridor";
      if (!corridor && zoom < 9.5) continue;
      L.polyline(r.coords, { pane: "routes", color: C.accent, weight: corridor ? 2 : 1.5 + (2.5 * r.trips_per_day) / maxTrips, opacity: corridor ? 0.55 : 0.4, dashArray: corridor ? "2 7" : undefined })
        .bindTooltip(`${r.name} · ${fmtInt(r.trips_per_day)} trips/day`, { sticky: true })
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, routes.data, layers.routes, zoom]);

  // proposed sites
  useEffect(() => {
    if (!map || !plan.data || !layers.sites) return;
    const group = L.layerGroup();
    for (const s of plan.data.sites.filter((x) => x.recommended)) {
      L.marker([s.latitude, s.longitude], { icon: siteIcon(s.score, true, zoom < 9.5), zIndexOffset: 500 })
        .bindTooltip(`ADD — ${s.name} · AI score ${s.score}`, { direction: "top", offset: [0, -14] })
        .on("click", () => navigate("/energy/charging"))
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, plan.data, layers.sites, navigate, zoom]);

  // live ADAS events
  useEffect(() => {
    if (!map || !layers.events) return;
    const group = L.layerGroup();
    for (const e of events.slice(0, 14)) {
      const color = e.routing === "human_review" ? C.crit : e.routing === "sample_review" ? C.warn : C.good;
      L.marker([e.lat, e.lon], { icon: eventIcon(color), keyboard: false, zIndexOffset: 300 })
        .bindTooltip(`${e.scenario} · ${e.cls} ${Math.round(e.confidence * 100)}%`, { direction: "top", offset: [0, -6] })
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, events, layers.events]);

  // demand heat
  useEffect(() => {
    if (!map || !heat.data || !layers.heat) return;
    const layer = new HeatLayer(map, "#7A2E10", "#FFB98A");
    layer.setPoints(heat.data.charging_demand);
    return () => layer.destroy();
  }, [map, heat.data, layers.heat]);

  const flyTo = (name: string) => {
    setView(name);
    const v = CITY_VIEWS[name];
    map?.flyTo(v.center, v.zoom, { duration: 0.9 });
  };

  const s = summary;
  const kpis = useMemo(
    () =>
      s
        ? [
            { label: "Active Vehicles", value: fmtInt(s.active_vehicles), sub: `${fmtInt(s.fleet_total)} in fleet`, icon: <Car size={13} />, tone: "accent" as Tone },
            { label: "Vehicles Healthy", value: s.healthy_pct, unit: "%", sub: `${s.risk_counts.MEDIUM + s.risk_counts.HIGH + s.risk_counts.CRITICAL} flagged by AI`, icon: <ShieldCheck size={13} />, tone: "good" as Tone },
            { label: "ADAS Frames Today", value: fmtCompact(s.adas_frames_today), sub: "fleet-scale counter", icon: <ScanEye size={13} /> },
            { label: "Auto-Labeled", value: s.auto_labeled_pct, unit: "%", sub: "labels accepted by AI", icon: <Zap size={13} /> },
            { label: "Human Review Queue", value: fmtInt(s.review_queue), sub: "frames awaiting review", icon: <Crosshair size={13} />, tone: "warn" as Tone },
            { label: "Charging Stations", value: s.charging_stations, sub: `${fmtInt(s.charging_ports)} ports · ${s.overloaded_stations} overloaded`, icon: <BatteryCharging size={13} /> },
            { label: "Predicted Maintenance", value: s.predicted_maintenance_cases, sub: `${s.risk_counts.CRITICAL} critical cases`, icon: <Wrench size={13} />, tone: "crit" as Tone },
            { label: "Recommended New Sites", value: s.recommended_new_sites, sub: "AI charger planning", icon: <MapPin size={13} />, tone: "info" as Tone },
          ]
        : [],
    [s],
  );

  return (
    <div className="space-y-3">
      {/* hero strip */}
      <div className="panel hairline-grid flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5">
        <div>
          <div className="label text-accent">Executive overview</div>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">One fleet. Three feedback loops.</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {LOOP.map((word, i) => (
            <span key={word} className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-ink">{word}</span>
              {i < LOOP.length - 1 && <ArrowRight size={13} className="text-accent" />}
            </span>
          ))}
        </div>
        <MockTag>Synthetic data · not an official VinFast product</MockTag>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 min-[1900px]:grid-cols-8">
        {kpis.length ? kpis.map((k) => <Kpi key={k.label} {...k} />) : Array.from({ length: 8 }, (_, i) => <div key={i} className="panel h-[84px] animate-pulse" />)}
      </div>

      {/* map + insights */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel overflow-hidden">
          <MapView center={CITY_VIEWS.Vietnam.center} zoom={CITY_VIEWS.Vietnam.zoom} onMap={setMap} className="h-[600px]">
            <MapOverlay position="tl" className="p-1">
              <div className="flex flex-wrap gap-0.5">
                {Object.keys(CITY_VIEWS).map((name) => (
                  <button
                    key={name}
                    onClick={() => flyTo(name)}
                    className={clsx("rounded px-2 py-1 text-2xs font-medium transition-colors", view === name ? "bg-accent text-abyss" : "text-ink-2 hover:bg-raised hover:text-ink")}
                  >
                    {name === "Ho Chi Minh City" ? "HCMC" : name}
                  </button>
                ))}
              </div>
            </MapOverlay>
            <MapOverlay position="tr" className="w-[150px] p-2.5">
              <div className="label mb-1.5">Layers</div>
              {LAYERS.map((l) => (
                <label key={l.key} className="flex cursor-pointer items-center gap-2 py-0.5 text-2xs text-ink-2 hover:text-ink">
                  <input type="checkbox" checked={layers[l.key]} onChange={(e) => setLayers((p) => ({ ...p, [l.key]: e.target.checked }))} className="accent-[#3BC9F5]" />
                  {l.label}
                </label>
              ))}
            </MapOverlay>
            <MapOverlay position="bl" className="max-w-[min(560px,calc(100%-90px))] px-3 py-2">
              <div className="flex flex-col gap-1.5">
                <Legend items={VEHICLE_STATUS.map((v) => ({ label: v.label, color: v.color }))} />
                <Legend
                  items={[
                    ...["normal", "high", "overloaded", "low"].map((k) => ({ label: CHARGER_STATUS[k].label, color: CHARGER_STATUS[k].color, shape: "square" as const })),
                    { label: "Recommended site", color: C.info, shape: "diamond" as const },
                  ]}
                />
              </div>
            </MapOverlay>
            <MapOverlay position="br" className="px-3 py-2">
              <div className="label">Live fleet</div>
              <div className="num mt-0.5 text-sm text-ink">
                {s ? fmtInt(s.active_vehicles) : "—"} <span className="text-2xs text-ink-3">EVs · {s ? s.status_counts.charging : "—"} charging</span>
              </div>
            </MapOverlay>
          </MapView>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-2xs text-ink-3">
              {zoom < 9.5 ? "National view: fleet clusters, inter-city corridors and overloaded stations. Pick a city to see every vehicle, route and charger." : "City view: every vehicle is drawn individually. Click one to open its health profile."}
            </p>
            <Link to="/energy/charging?optimize=1">
              <Button variant="primary" size="sm">
                <Sparkles size={12} /> AI Optimize Network
              </Button>
            </Link>
          </div>
        </section>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="AI Insights" kicker="Generated from live data" bodyClassName="p-0" className="flex-1">
            <ul className="divide-y divide-line">
              {(insights.data ?? []).map((i) => (
                <li key={i.category}>
                  <Link to={i.link} className="group block px-4 py-2.5 transition-colors hover:bg-raised">
                    <div className="flex items-center justify-between">
                      <Badge tone={INSIGHT_TONE[i.tone]}>{i.category}</Badge>
                      <ArrowRight size={12} className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-2 group-hover:text-ink">{i.text}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Live ADAS Events" kicker="Confidence routing" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {events.slice(0, 5).map((e) => (
                <li key={e.id} className="flex items-center gap-2.5 px-4 py-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: toneColor[e.routing === "human_review" ? "crit" : e.routing === "sample_review" ? "warn" : "good"] }} />
                  <span className="min-w-0 flex-1 truncate text-2xs text-ink-2">{e.scenario}</span>
                  <span className="num text-2xs text-ink">{Math.round(e.confidence * 100)}%</span>
                  <span className="num w-[52px] text-right text-3xs text-ink-3">{e.ts}</span>
                </li>
              ))}
              {!events.length && <li className="label px-4 py-3">Waiting for simulation…</li>}
            </ul>
          </Panel>
        </div>
      </div>

      {/* lifecycle */}
      <Panel title="How data becomes a continuously improving system" kicker="Platform lifecycle">
        <div className="flex flex-wrap items-stretch gap-y-2">
          {LIFECYCLE.map((step, i) => (
            <div key={step} className="flex items-center">
              <div className={clsx("rounded-md border px-3 py-2", i === 4 ? "border-accent/50 bg-accent/10" : "border-line bg-raised")}>
                <div className="num text-3xs text-ink-3">{String(i + 1).padStart(2, "0")}</div>
                <div className={clsx("mt-0.5 whitespace-nowrap text-xs font-medium", i === 4 ? "text-accent" : "text-ink")}>{step}</div>
              </div>
              {i < LIFECYCLE.length - 1 ? <ArrowRight size={14} className="mx-1.5 shrink-0 text-ink-3" /> : <span className="ml-2 font-mono text-2xs text-accent">↻ loop</span>}
            </div>
          ))}
        </div>
      </Panel>

      {/* business value */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {VALUE_CARDS.map((card) => (
          <Link key={card.title} to={card.to} className="panel group block p-4 transition-colors hover:border-line-strong">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <card.icon size={15} />
                </span>
                <h3 className="text-xs font-semibold uppercase tracking-wider">{card.title}</h3>
              </div>
              <ArrowRight size={13} className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
            </div>
            <ul className="mt-3 space-y-1.5">
              {card.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-xs text-ink-2">
                  <span className="mt-[7px] h-px w-2.5 shrink-0 bg-accent" />
                  {p}
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </div>
      <p className="flex items-center gap-1.5 pb-2 text-3xs text-ink-3">
        <Database size={10} /> All figures are generated from seeded synthetic data and simulated models.
      </p>
    </div>
  );
}
