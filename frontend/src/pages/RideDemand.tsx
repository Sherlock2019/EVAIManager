import clsx from "clsx";
import L from "leaflet";
import { BatteryCharging, Car, Clock, Navigation, Pause, Play, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MapOverlay, MapView } from "../components/MapView";
import { Badge, ChartTooltip, ErrorNote, Kpi, Legend, Loading, MockTag, PageHeader, Panel, Tabs, axisProps, gridProps } from "../components/ui";
import { useApi } from "../lib/api";
import { useDemo } from "../lib/demo";
import { C, fmtInt, type Tone } from "../lib/format";
import { HeatLayer, chargerIcon, siteIcon } from "../lib/map";
import type { RideForecast, RideHour, RideStation } from "../lib/types";

type Day = "weekday" | "weekend";
type Layer = "passengers" | "evs" | "gap";
type Audience = "drivers" | "operator";

const PASSENGER = C.s2;
const EV = C.s1;
const HEAT_RAMP: Record<Exclude<Layer, "gap">, [string, string]> = {
  passengers: ["#7A2E10", "#FFB98A"],
  evs: ["#12325E", "#9EC5F4"],
};
const STATUS: Record<string, { tone: Tone; color: string; label: string }> = {
  SHORTAGE: { tone: "crit", color: C.crit, label: "Too few EVs" },
  BALANCED: { tone: "good", color: C.good, label: "Balanced" },
  SURPLUS: { tone: "info", color: C.info, label: "Idle EVs" },
};
const VERDICT: Record<RideStation["verdict"], { status: string; tone: Tone }> = {
  UNDERSIZED: { status: "overloaded", tone: "crit" },
  "RIGHT-SIZED": { status: "normal", tone: "good" },
  OVERSIZED: { status: "low", tone: "idle" },
};

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const row = (label: string, value: string | number) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;padding:2px 0"><span style="color:#64748B">${label}</span><span style="font-family:'JetBrains Mono',monospace;color:#E8EEF7">${value}</span></div>`;

/** Bowed line a → b; opposite directions bow to opposite sides, so two-way flows stay apart. */
function arc(a: [number, number], b: [number, number], bow = 0.18): [number, number][] {
  const mid: [number, number] = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * bow, (a[1] + b[1]) / 2 + (b[0] - a[0]) * bow];
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * mid[0] + t ** 2 * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * mid[1] + t ** 2 * b[1]];
  });
}

/** The zone's fixed scatter, drawn further and brighter the busier the hour is. */
function heatPoints(f: RideForecast, h: RideHour, layer: Exclude<Layer, "gap">): number[][] {
  const max = layer === "passengers" ? f.summary.max_zone_pickups : f.summary.max_zone_evs;
  const points: number[][] = [];
  f.zones.forEach((z, i) => {
    const share = (layer === "passengers" ? h.zones[i].pickups : h.zones[i].evs) / max;
    const cloud = layer === "passengers" ? z.cloud : z.ev_cloud;
    const n = Math.ceil(cloud.length * Math.sqrt(share));
    for (let k = 0; k < n; k++) points.push([cloud[k][0], cloud[k][1], 0.5 + 1.5 * share]);
  });
  return points;
}

function zonePill(name: string, pickups: number, evs: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "map-divicon",
    iconSize: [0, 0],
    html: `<div style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;padding:3px 7px;border-radius:6px;background:rgba(5,8,13,0.86);border:1px solid ${color};box-shadow:0 0 14px ${color}55;text-align:center;line-height:1.25">
      <div style="font-size:10px;color:#A3B2C7">${name}</div>
      <div style="font:500 11px 'JetBrains Mono',monospace"><span style="color:#FFB98A">${pickups}</span><span style="color:#64748B"> · </span><span style="color:#9EC5F4">${evs}</span></div></div>`,
  });
}

function moveLabel(evs: number): L.DivIcon {
  return L.divIcon({
    className: "map-divicon",
    iconSize: [0, 0],
    html: `<div style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;padding:1px 6px;border-radius:9px;background:${C.accent};color:#05080D;font:700 10px 'JetBrains Mono',monospace;box-shadow:0 0 0 2px #05080D">${evs} EVs</div>`,
  });
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} className={clsx("rounded px-2 py-1 text-2xs transition-colors", on ? "bg-raised text-ink shadow-[inset_0_0_0_1px_#263347]" : "text-ink-3 hover:text-ink-2")}>
      {children}
    </button>
  );
}

export default function RideDemand() {
  const [day, setDay] = useState<Day>("weekday");
  const [hour, setHour] = useState(18);
  const [playing, setPlaying] = useState(false);
  const [layer, setLayer] = useState<Layer>("passengers");
  const [show, setShow] = useState({ flows: true, moves: true, chargers: true });
  const [audience, setAudience] = useState<Audience>("drivers");
  const [map, setMap] = useState<L.Map | null>(null);
  const demoOpen = useDemo((s) => s.open); // the docked demo panel narrows the map

  const forecast = useApi<RideForecast>(`/api/rides/forecast?day=${day}`);
  const f = forecast.data;
  const now = f?.hours[hour];
  const hourRef = useRef(hour);
  hourRef.current = hour;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setHour((h) => (h + 1) % 24), 1200);
    return () => window.clearInterval(t);
  }, [playing]);

  // flows and moves need SVG so their dashes can animate; everything else stays on canvas
  const svg = useMemo(() => (map ? L.svg({ pane: "routes" }) : null), [map]);
  const heat = useRef<HeatLayer | null>(null);
  useEffect(() => {
    if (!map || layer === "gap") return;
    const hl = new HeatLayer(map, ...HEAT_RAMP[layer], 34, 0.9);
    heat.current = hl;
    return () => {
      hl.destroy();
      heat.current = null;
    };
  }, [map, layer]);
  useEffect(() => {
    if (f && now && layer !== "gap") heat.current?.setPoints(heatPoints(f, now, layer));
  }, [f, now, layer, map]);

  // everything that changes with the hour: zone labels, gap rings, passenger flows, EV moves
  useEffect(() => {
    if (!map || !svg || !f || !now) return;
    const group = L.layerGroup();
    const at = (i: number): [number, number] => [f.zones[i].lat, f.zones[i].lon];
    f.zones.forEach((z, i) => {
      const zh = now.zones[i];
      const status = STATUS[zh.status];
      if (layer === "gap") {
        L.circleMarker(at(i), { radius: 16 + 34 * Math.min(1, Math.abs(1 - zh.ratio)), color: status.color, weight: 1.5, fillColor: status.color, fillOpacity: 0.16, interactive: false }).addTo(group);
      }
      L.marker(at(i), { icon: zonePill(z.name, zh.pickups, zh.evs, zh.status === "BALANCED" ? "#263347" : status.color), zIndexOffset: 300 })
        .bindTooltip(`${z.name} · ${z.kind}<br/>${zh.pickups} pickups/h · ${zh.dropoffs} drop-offs/h · ${zh.evs} EVs<br/>${status.label} · est. wait ${zh.wait_min} min`, { direction: "top", offset: [0, -16] })
        .addTo(group);
    });
    if (show.flows) {
      const max = Math.max(1, ...now.flows.map((x) => x.rides));
      for (const flow of now.flows) {
        L.polyline(arc(at(flow.from), at(flow.to)), { renderer: svg, className: "ride-flow", color: "#FFB98A", weight: 2 + (4.5 * flow.rides) / max, opacity: 0.5 + (0.45 * flow.rides) / max })
          .bindTooltip(`${f.zones[flow.from].name} → ${f.zones[flow.to].name} · ${flow.rides} rides/h`, { sticky: true })
          .addTo(group);
      }
    }
    if (show.moves) {
      for (const m of now.moves) {
        const path = arc(at(m.from), at(m.to), -0.12);
        L.polyline(path, { renderer: svg, className: "ride-move", color: C.accent, weight: 2.5, opacity: 0.95 })
          .bindTooltip(`Move ${m.evs} EVs: ${f.zones[m.from].name} → ${f.zones[m.to].name} · leave by ${m.depart_by}`, { sticky: true })
          .addTo(group);
        L.marker(path[12], { icon: moveLabel(m.evs), interactive: false, zIndexOffset: 500 }).addTo(group);
      }
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, svg, f, now, layer, show.flows, show.moves]);

  // charging stations and proposed sites do not change with the hour
  useEffect(() => {
    if (!map || !f || !show.chargers) return;
    const group = L.layerGroup();
    for (const s of f.stations) {
      const expand = s.verdict === "UNDERSIZED";
      L.marker([s.latitude, s.longitude], { icon: chargerIcon(VERDICT[s.verdict].status, { expand, size: expand ? 20 : 15 }), zIndexOffset: expand ? 200 : 0 })
        .bindTooltip(`${s.name} · ${s.verdict}`, { direction: "top", offset: [0, -10] })
        .bindPopup(
          () => `<div style="min-width:216px"><div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:${C[VERDICT[s.verdict].tone]}">${s.verdict}${s.change_ports ? ` · ${s.change_ports > 0 ? "+" : ""}${s.change_ports} PORTS` : ""}</div>
          <div style="font-weight:600;font-size:13px;margin:3px 0 8px">${s.name}</div>
          ${row("Installed ports", s.ports)}${row("Right size", s.required_ports)}${row(`Busy at ${hh(hourRef.current)}`, `${Math.min(s.ports, Math.round(s.hourly_busy_ports[hourRef.current]))} / ${s.ports}`)}
          ${row("Busiest hour", hh(s.peak_hour))}${row("Demand at peak", `${s.peak_busy_ports} ports`)}${s.queue_at_peak ? row("EVs queuing at peak", s.queue_at_peak) : ""}</div>`,
        )
        .addTo(group);
    }
    for (const p of f.proposed_sites) {
      L.marker([p.latitude, p.longitude], { icon: siteIcon(p.ports, true), zIndexOffset: 400 })
        .bindTooltip(`${p.name} · proposed ${p.ports} ports`, { direction: "top", offset: [0, -14] })
        .bindPopup(
          `<div style="min-width:216px"><div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:${C.info}">PROPOSED NEW STATION</div>
          <div style="font-weight:600;font-size:13px;margin:3px 0 8px">${p.name}</div>
          ${row("Recommended size", `${p.ports} ports`)}${row("Zone shortfall", `${p.zone_shortfall_ports} ports`)}${row("Charging peak", hh(p.peak_hour))}
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid #263347;font-size:11px;color:#A3B2C7">${p.reason}</div></div>`,
        )
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, f, show.chargers]);

  const flyTo = (lat: number, lon: number, zoom = 13) => map?.flyTo([lat, lon], zoom, { duration: 0.7 });
  const flyToZone = (i: number) => f && flyTo(f.zones[i].lat, f.zones[i].lon);
  const jump = (h: number) => {
    setPlaying(false);
    setHour(h);
  };

  const s = f?.summary;
  const ranked = useMemo(() => (f && now ? now.zones.map((z, i) => ({ ...z, i, name: f.zones[i].name, kind: f.zones[i].kind })).sort((a, b) => a.ratio - b.ratio) : []), [f, now]);
  const curve = useMemo(() => f?.hours.map((h) => ({ label: h.label, Passengers: h.passengers, "EV capacity": h.capacity })) ?? [], [f]);
  const sizing = useMemo(() => {
    if (!f) return [];
    return [
      ...f.proposed_sites.map((p) => ({ key: p.name, kind: "ADD", tone: "info" as Tone, name: p.name, lat: p.latitude, lon: p.longitude, lines: [`New station · ${p.ports} ports`, p.reason] })),
      ...f.stations.filter((x) => x.verdict === "UNDERSIZED").slice(0, 6).map((x) => ({
        key: x.station_id, kind: `+${x.change_ports}`, tone: "crit" as Tone, name: x.name, lat: x.latitude, lon: x.longitude,
        lines: [`${x.ports} ports installed · right size ${x.required_ports}`, `Peak ${hh(x.peak_hour)} · ${x.queue_at_peak} EVs queuing`],
      })),
      ...f.stations.filter((x) => x.verdict === "OVERSIZED").map((x) => ({
        key: x.station_id, kind: `${x.change_ports}`, tone: "idle" as Tone, name: x.name, lat: x.latitude, lon: x.longitude,
        lines: [`${x.ports} ports installed · right size ${x.required_ports}`, `Only ${x.peak_busy_ports} ports busy at its ${hh(x.peak_hour)} peak`],
      })),
    ];
  }, [f]);

  return (
    <div>
      <PageHeader
        kicker="Energy · Ride demand intelligence"
        title="Passenger Demand & EV Positioning"
        description="In-vehicle IoT signals show where passengers get in and out. The forecast turns them into a 24-hour map of riders, EVs and charging load: drivers see where to be and when, the network team sees which stations are the wrong size."
      >
        <MockTag>Synthetic IoT signals · {f?.city ?? "Ho Chi Minh City"}</MockTag>
        <Tabs value={day} onChange={setDay} options={[{ value: "weekday", label: "Weekday" }, { value: "weekend", label: "Weekend" }]} />
      </PageHeader>
      {forecast.error && <ErrorNote message={forecast.error} />}

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Rides forecast / day" value={s ? fmtInt(s.daily_rides) : "—"} sub={s && `busiest pickups: ${s.busiest_pickup_zone}`} icon={<Users size={13} />} spark={f?.hours.map((h) => h.passengers)} />
        <Kpi label="Peak hour" value={s ? hh(s.peak_hour) : "—"} sub={s && `${fmtInt(s.peak_passengers)} passengers / h`} icon={<Clock size={13} />} tone="accent" />
        <Kpi label="EVs in the city" value={s ? fmtInt(s.evs) : "—"} sub={s && `${fmtInt(s.peak_evs_on_duty)} on duty at peak`} icon={<Car size={13} />} />
        <Kpi label="Requests not served" value={s ? fmtInt(s.unserved_rides) : "—"} sub={s && `${s.served_pct}% served · worst ${s.worst_gap.zone} ${hh(s.worst_gap.hour)}`} icon={<Navigation size={13} />} tone="warn" />
        <Kpi label="Stations wrong-sized" value={s ? s.undersized_stations + s.oversized_stations : "—"} unit={s && `of ${s.stations}`} sub={s && `${s.undersized_stations} too small · ${s.oversized_stations} too big`} icon={<BatteryCharging size={13} />} tone="serious" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_372px]">
        <section className="panel flex flex-col overflow-hidden">
          <MapView center={[10.805, 106.7]} zoom={12} onMap={setMap} className="min-h-[600px] flex-1">
            <MapOverlay position="tl" className="p-1.5">
              <Tabs value={layer} onChange={setLayer} options={[{ value: "passengers", label: "Passengers" }, { value: "evs", label: "EV supply" }, { value: "gap", label: "Supply gap" }]} />
              <div className="mt-1 flex gap-0.5">
                <Toggle on={show.flows} onClick={() => setShow((p) => ({ ...p, flows: !p.flows }))}>Trip flows</Toggle>
                <Toggle on={show.moves} onClick={() => setShow((p) => ({ ...p, moves: !p.moves }))}>EV moves</Toggle>
                <Toggle on={show.chargers} onClick={() => setShow((p) => ({ ...p, chargers: !p.chargers }))}>Chargers</Toggle>
              </div>
            </MapOverlay>
            <MapOverlay position="tr" className={clsx("px-3.5 py-2 text-right", demoOpen && "hidden")}>
              <div className="num text-[28px] font-medium leading-none text-ink">{hh(hour)}</div>
              <div className="label mt-1">{day} forecast</div>
              {now && (
                <div className="num mt-1.5 text-2xs leading-relaxed">
                  <div style={{ color: "#FFB98A" }}>{fmtInt(now.passengers)} passengers / h</div>
                  <div style={{ color: "#9EC5F4" }}>{fmtInt(now.evs_on_duty)} EVs on duty</div>
                </div>
              )}
            </MapOverlay>
            <MapOverlay position="bl" className="max-w-[540px] px-3 py-2">
              <Legend
                items={[
                  { label: "Pickups / h", color: "#FFB98A" },
                  { label: "EVs in zone", color: "#9EC5F4" },
                  { label: "Passenger trips", color: "#FFB98A", shape: "line" },
                  { label: "Move EVs here", color: C.accent, shape: "line" },
                ]}
              />
              {show.chargers && (
                <div className="mt-1.5">
                  <Legend
                    items={[
                      { label: "Too small (+)", color: C.crit, shape: "square" },
                      { label: "Right size", color: C.good, shape: "square" },
                      { label: "Too big", color: C.idle, shape: "square" },
                      { label: "Proposed station · number = ports", color: C.info, shape: "diamond" },
                    ]}
                  />
                </div>
              )}
              {layer === "gap" && (
                <div className="mt-1.5">
                  <Legend items={Object.values(STATUS).map((x) => ({ label: x.label, color: x.color }))} />
                </div>
              )}
            </MapOverlay>
            {forecast.loading && <Loading className="absolute inset-0 z-[600] bg-abyss/60" label="Forecasting 24 hours…" />}
          </MapView>

          <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
            <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play 24 hours"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-abyss transition-colors hover:bg-[#6bd8f8]">
              {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="h-[72px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={curve} margin={{ top: 4, right: 16, bottom: 0, left: 16 }} onClick={(e) => typeof e?.activeTooltipIndex === "number" && jump(e.activeTooltipIndex)} style={{ cursor: "pointer" }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval={2} height={16} />
                    <YAxis hide />
                    <Tooltip content={<ChartTooltip format={(v) => `${fmtInt(v)} / h`} />} />
                    <Area type="monotone" dataKey="Passengers" stroke={PASSENGER} fill={PASSENGER} fillOpacity={0.22} strokeWidth={1.5} isAnimationActive={false} />
                    <Line type="monotone" dataKey="EV capacity" stroke={EV} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <ReferenceLine x={hh(hour)} stroke={C.accent} strokeWidth={1.5} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <input type="range" min={0} max={23} value={hour} onChange={(e) => jump(Number(e.target.value))} aria-label="Hour of day" className="mt-1 w-full" style={{ ["--fill" as string]: `${(hour / 23) * 100}%` }} />
            </div>
            <div className="hidden w-[150px] shrink-0 text-2xs text-ink-3 lg:block">
              <Legend items={[{ label: "Passengers / h", color: PASSENGER, shape: "square" }, { label: "Rides the EVs can serve", color: EV, shape: "line" }]} />
              <div className="mt-1.5">Press play or drag to move through the day.</div>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-3">
          <div>
            <Tabs value={audience} onChange={setAudience} options={[{ value: "drivers", label: "For drivers" }, { value: "operator", label: "For the charging network" }]} />
          </div>
          {audience === "drivers" ? (
            <>
              <Panel title={`Where to be by ${hh(hour + 1)}`} kicker="Reposition idle EVs before demand arrives" bodyClassName="p-2 space-y-1.5">
                {now?.moves.map((m) => (
                  <button key={`${m.from}-${m.to}`} onClick={() => flyToZone(m.to)} className="block w-full rounded-md border border-line px-3 py-2 text-left transition-colors hover:bg-raised">
                    <div className="flex items-center gap-2">
                      <Badge tone="accent">{m.evs} EVs</Badge>
                      <span className="truncate text-xs font-medium">{f?.zones[m.from].name} → {f?.zones[m.to].name}</span>
                    </div>
                    <div className="mt-1 text-2xs text-ink-2">Leave by <span className="num text-ink">{m.depart_by}</span> · {m.distance_km} km · {m.eta_min} min · +{m.extra_rides} rides/h</div>
                    <div className="mt-0.5 text-2xs text-ink-3">{m.reason}</div>
                  </button>
                ))}
                {now && !now.moves.length && (
                  <p className="px-2 py-3 text-xs text-ink-2">
                    No repositioning needed for {hh(hour + 1)}. <span className="num text-ink">{now.idle_evs}</span> EVs are idle now, a good hour to charge.
                  </p>
                )}
              </Panel>
              <Panel title={`Zone balance at ${hh(hour)}`} kicker="Shortest EV supply first" bodyClassName="p-0">
                <ul className="max-h-[380px] divide-y divide-line overflow-y-auto">
                  {ranked.map((z) => (
                    <li key={z.name}>
                      <button onClick={() => flyToZone(z.i)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-raised">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{z.name}</div>
                          <div className="num text-3xs text-ink-3">
                            <span style={{ color: "#FFB98A" }}>{z.pickups} pickups</span> · <span style={{ color: "#9EC5F4" }}>{z.evs} EVs</span> · wait {z.wait_min} min
                          </div>
                        </div>
                        <Badge tone={STATUS[z.status].tone}>{STATUS[z.status].label}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          ) : (
            <>
              <Panel title="Right-size the network" kicker="Each station against its busiest hour">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { n: s?.undersized_stations, l: `too small · +${s?.ports_to_add ?? 0} ports`, c: C.crit },
                    { n: s?.right_sized_stations, l: "right size", c: C.good },
                    { n: s?.oversized_stations, l: `too big · −${s?.ports_to_remove ?? 0} ports`, c: C.ink2 },
                  ].map((x) => (
                    <div key={x.l} className="rounded-md border border-line bg-raised px-2.5 py-2">
                      <div className="num text-lg font-medium leading-none" style={{ color: x.c }}>{x.n ?? "—"}</div>
                      <div className="mt-1 text-3xs leading-tight text-ink-3">{x.l}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2.5 text-2xs leading-relaxed text-ink-3">
                  Sized so the busiest hour of today's forecast sits at 90% of ports. Charging Network sizes for 90-day growth instead, so its numbers differ.
                </p>
              </Panel>
              <Panel title="Station actions" kicker="Click to locate on map" bodyClassName="p-2 space-y-1.5 overflow-y-auto max-h-[420px]">
                {sizing.map((a) => (
                  <button key={a.key} onClick={() => flyTo(a.lat, a.lon, 13.5)} className="block w-full rounded-md border border-line px-3 py-2 text-left transition-colors hover:bg-raised">
                    <div className="flex items-center gap-2">
                      <Badge tone={a.tone}>{a.kind}</Badge>
                      <span className="truncate text-xs font-medium">{a.name}</span>
                    </div>
                    {a.lines.map((l) => (
                      <div key={l} className="mt-1 text-2xs text-ink-2">{l}</div>
                    ))}
                  </button>
                ))}
              </Panel>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Passengers by zone and hour" kicker="24-hour forecast · click a cell to jump there" action={<Legend items={[{ label: "More pickups", color: PASSENGER, shape: "square" }, { label: "Too few EVs", color: C.crit }]} />}>
          {f && s && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[620px] gap-px" style={{ gridTemplateColumns: "104px repeat(24, minmax(0, 1fr))" }}>
                <span />
                {f.hours.map((h) => (
                  <span key={h.hour} className={clsx("num pb-1 text-center text-3xs", h.hour === hour ? "text-accent" : "text-ink-3")}>{h.hour % 3 === 0 || h.hour === hour ? String(h.hour).padStart(2, "0") : ""}</span>
                ))}
                {f.zones.map((z, i) => (
                  <div key={z.name} className="contents">
                    <button onClick={() => flyToZone(i)} className="truncate pr-2 text-left text-2xs text-ink-2 hover:text-ink">{z.name}</button>
                    {f.hours.map((h) => {
                      const zh = h.zones[i];
                      return (
                        <button
                          key={h.hour}
                          title={`${z.name} ${h.label} · ${zh.pickups} pickups · ${zh.evs} EVs · ${STATUS[zh.status].label}`}
                          onClick={() => { jump(h.hour); flyToZone(i); }}
                          className={clsx("relative h-[18px] rounded-[2px]", h.hour === hour && "outline outline-1 outline-accent")}
                          style={{ background: `rgba(217,89,38,${0.06 + 0.94 * (zh.pickups / s.max_zone_pickups)})` }}
                        >
                          {zh.status === "SHORTAGE" && <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-crit shadow-[0_0_0_1px_#05080D]" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Driver shift plan" kicker="Best zone to wait in, hour by hour" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {f?.shifts.map((b) => {
              const on = hour >= b.start && hour < b.end;
              return (
                <li key={b.start}>
                  <button onClick={() => { jump(b.start); flyToZone(b.zone); }} className={clsx("block w-full px-4 py-2 text-left hover:bg-raised", on && "bg-raised shadow-[inset_2px_0_0_#3BC9F5]")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-2xs text-ink-2">{b.label}</span>
                      <span className="num text-2xs text-ink-3">{b.requests_per_ev} requests / EV</span>
                    </div>
                    <div className="mt-0.5 text-xs font-medium">{b.zone_name} <span className="font-normal text-ink-3">· {b.kind}</span></div>
                    <div className="mt-0.5 text-3xs text-ink-3">{b.pickups} pickups/h · {b.evs} EVs nearby · most riders go to {b.top_destination}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Where passengers travel from and to" kicker="Busiest trips of the day" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table-grid w-full text-xs">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Rides / day</th>
                  <th>Busiest hour</th>
                  <th>Distance</th>
                </tr>
              </thead>
              <tbody>
                {f?.corridors.map((c) => (
                  <tr key={`${c.from}-${c.to}`} className="cursor-pointer" onClick={() => { jump(c.peak_hour); map?.flyToBounds(L.latLngBounds([[f.zones[c.from].lat, f.zones[c.from].lon], [f.zones[c.to].lat, f.zones[c.to].lon]]).pad(0.6), { duration: 0.7 }); }}>
                    <td className="font-medium">{f.zones[c.from].name}</td>
                    <td className="font-medium">{f.zones[c.to].name}</td>
                    <td className="num">{fmtInt(c.rides)}</td>
                    <td className="num">{hh(c.peak_hour)}</td>
                    <td className="num text-ink-3">{c.distance_km} km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="IoT signals behind the forecast" kicker="Simulated in this demo" action={<MockTag />}>
          <ul className="space-y-2">
            {f?.signals.map((x) => (
              <li key={x.source}>
                <div className="text-xs font-medium">{x.source}</div>
                <div className="text-2xs text-ink-3">{x.use}</div>
              </li>
            ))}
          </ul>
          {f && <p className="mt-3 border-t border-line pt-2.5 text-2xs text-ink-3">{f.note}</p>}
        </Panel>
      </div>
    </div>
  );
}
