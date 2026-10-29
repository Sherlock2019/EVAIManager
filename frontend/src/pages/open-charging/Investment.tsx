import clsx from "clsx";
import L from "leaflet";
import { ArrowRightLeft, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MapOverlay, MapView } from "../../components/MapView";
import { Badge, Button, Legend, Meter, Panel, Stat, Tabs } from "../../components/ui";
import { useApi } from "../../lib/api";
import { C, CHARGER_STATUS, toneColor } from "../../lib/format";
import { CITY_VIEWS, chargerIcon, pilotIcon } from "../../lib/map";
import { ACTION_TONE, GROUPS, GROUP_COLOR, GROUP_LABEL, fmtRoi, fmtVnd, fmtWait, fmtYears, type Assumptions, type ByGroup, type Evaluation, type Group, type OcTab, type Site, useOc } from "../../lib/openCharging";
import { pickPilot, pilotPopup, pilotTeslaPorts, popupRow } from "../../lib/pilot";
import type { Charger } from "../../lib/types";
import { CompatBadge, GroupBadge, ProvenanceTags, REGIONS, type Region } from "./shared";

type Brand = "all" | Group;
type Layer = "both" | "network" | "analysis";

// Who could charge where under the proposed plan (simulation): VinFast everywhere; Tesla on the
// hybrid pilot stations and on analysis sites suggested for opening; other brands only on the latter.
const OPENED = new Set(["Open selected spare capacity", "Upgrade capacity", "Develop new hybrid site"]);

function siteAccess(s: Site): ByGroup<boolean> {
  const open = OPENED.has(s.recommendation.action);
  return { vinfast: true, tesla: open && s.compatibility.tesla !== "incompatible", other: open && s.compatibility.other !== "incompatible" };
}

function stationAccess(c: Charger, pilotIds: Set<string>): ByGroup<boolean> {
  return { vinfast: true, tesla: pilotIds.has(c.station_id), other: false };
}

function stationRegion(c: Charger): Region {
  if (/airport/i.test(c.name)) return "Airports";
  if (c.city === "Ho Chi Minh City") return "HCMC";
  if (c.city === "Hanoi") return "Hanoi";
  return "Corridor";
}

const accessLine = (a: ByGroup<boolean>) =>
  GROUPS.map((g) => `<span style="color:${a[g] ? GROUP_COLOR[g] : "#475569"}">${a[g] ? "✓" : "✕"} ${GROUP_LABEL[g]}</span>`).join(" &nbsp;");

function networkPopup(c: Charger): string {
  const st = CHARGER_STATUS[c.status];
  return `<div style="min-width:220px">
    <div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:#64748B">CHARGING NETWORK STATION · SYNTHETIC</div>
    <div style="font-weight:600;font-size:13px;margin-top:3px">${c.name}</div>
    <div style="margin:2px 0 8px;font-size:11px;color:${st.color}">${st.label} · ${c.city}</div>
    ${popupRow("Ports", `${c.ports} · ${c.power_kw} kW`)}${popupRow("Available now", c.available)}${popupRow("Utilization", `${Math.round(c.utilization * 100)}%`)}
    ${popupRow("Average daily sessions", c.avg_daily_sessions)}${popupRow("Peak", c.peak_window)}${popupRow("Forecast 90 days", `+${Math.round(c.forecast_90d_pct)}%`)}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #263347;font-size:11px">${accessLine({ vinfast: true, tesla: false, other: false })}</div>
    <div style="margin-top:6px;font-size:11px;color:#A3B2C7"><b>${c.action ?? "—"}</b> — ${c.recommendation ?? ""}</div></div>`;
}

// Network-station revenue estimate (illustrative). Matches the site engine: 18 operating hours,
// 85 % practical utilization ceiling, delivered power = 80 % of nameplate.
const OPERATING_HOURS = 18;
const MAX_PRACTICAL_UTIL = 0.85;
const POWER_DERATE = 0.8;
const TESLA_SESSIONS_PER_PILOT_PORT = 3;   // assumed Tesla demand per opened port per day, before the capacity cap

interface GroupTotals { stations: number; ports: number; portUsage: number; revVinfast: number; revTesla: number; revOther: number; teslaSessions: number }

function networkDay(c: Charger, a: Assumptions, tesla: boolean) {
  const vat = 1 + a.vat_pct / 100;
  const vf = (c.avg_daily_sessions * a.kwh_vinfast * (1 - a.vinfast_free_share_pct / 100) * a.tariff_vinfast * (1 - a.vinfast_discount_pct / 100)) / vat;
  const sessionH = a.kwh_tesla / (c.power_kw * POWER_DERATE);
  const spare = (Math.max(0, MAX_PRACTICAL_UTIL - c.utilization) * c.ports * OPERATING_HOURS) / sessionH;
  const tSessions = tesla ? Math.min(pilotTeslaPorts(c) * TESLA_SESSIONS_PER_PILOT_PORT, spare) : 0;
  const ts = (tSessions * (a.kwh_tesla * a.tariff_tesla + a.third_party_session_fee_vnd)) / vat;
  return { vf, tesla: ts, tSessions, usage: Math.min(1, c.utilization + (tSessions * sessionH) / (c.ports * OPERATING_HOURS)) };
}

function BrandComparison({ ev, chargers, pilotIds }: { ev: Evaluation; chargers: Charger[]; pilotIds: Set<string> }) {
  const a = useOc((s) => s.assumptions)!;
  const empty = (): GroupTotals => ({ stations: 0, ports: 0, portUsage: 0, revVinfast: 0, revTesla: 0, revOther: 0, teslaSessions: 0 });
  const vfOnly = empty();
  const hybrid = empty();
  for (const c of chargers) {
    const isPilot = pilotIds.has(c.station_id);
    const d = networkDay(c, a, isPilot);
    const g = isPilot ? hybrid : vfOnly;
    g.stations += 1;
    g.ports += c.ports;
    g.portUsage += c.ports * d.usage;
    g.revVinfast += d.vf;
    g.revTesla += d.tesla;
    g.teslaSessions += d.tSessions;
  }
  const all = empty();
  for (const s of ev.sites.filter((x) => siteAccess(x).other)) {
    const blk = s.scenarios.C;
    all.stations += 1;
    all.ports += blk.ports;
    all.portUsage += blk.ports * blk.utilization;
    all.revVinfast += blk.year1.driver_revenue.vinfast / 365;
    all.revTesla += blk.year1.driver_revenue.tesla / 365;
    all.revOther += blk.year1.driver_revenue.other / 365;
  }
  const cols = [
    { key: "vf", label: "VinFast-only", logos: ["vinfast"], g: vfOnly, src: "Charging network" },
    { key: "vt", label: "VinFast + Tesla", logos: ["vinfast", "tesla"], g: hybrid, src: "Hybrid pilot (proposed)" },
    { key: "all", label: "VinFast + Tesla + Other", logos: ["vinfast", "tesla", "other"], g: all, src: "Analysis sites to open" },
  ];
  const rev = (g: GroupTotals) => g.revVinfast + g.revTesla + g.revOther;
  const perPort = (g: GroupTotals) => (g.ports ? rev(g) / g.ports : 0);
  const usage = (g: GroupTotals) => (g.ports ? g.portUsage / g.ports : 0);
  const best = Math.max(...cols.map((c) => perPort(c.g)));
  const uplift = perPort(vfOnly) ? (perPort(hybrid) / perPort(vfOnly) - 1) * 100 : 0;

  const rows: { label: string; v: (g: GroupTotals) => string; hi?: (g: GroupTotals) => boolean }[] = [
    { label: "Stations", v: (g) => String(g.stations) },
    { label: "Charging ports", v: (g) => String(g.ports) },
    { label: "Average usage", v: (g) => `${Math.round(usage(g) * 100)}%` },
    { label: "Revenue / day", v: (g) => fmtVnd(rev(g)) },
    { label: "· from VinFast", v: (g) => fmtVnd(g.revVinfast) },
    { label: "· from Tesla", v: (g) => (g.revTesla ? fmtVnd(g.revTesla) : "—") },
    { label: "· from other brands", v: (g) => (g.revOther ? fmtVnd(g.revOther) : "—") },
    { label: "Revenue / day per station", v: (g) => fmtVnd(g.stations ? rev(g) / g.stations : 0) },
    { label: "Revenue / day per port", v: (g) => fmtVnd(perPort(g)), hi: (g) => perPort(g) === best },
  ];

  return (
    <Panel title="VinFast-only vs hybrid charging" kicker="Per day · VND excl. VAT · illustrative tariffs · estimate" bodyClassName="p-0">
      <table className="w-full text-2xs">
        <thead>
          <tr className="border-b border-line">
            <th className="px-3 py-2 text-left font-normal text-ink-3" />
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right align-bottom font-normal">
                <div className="flex justify-end gap-0.5">
                  {c.logos.map((l) =>
                    l === "other" ? <span key={l} className="h-3.5 w-3.5 rounded-sm" style={{ background: GROUP_COLOR.other }} title="Other EV brands" /> : <img key={l} src={`/brands/${l}.png`} alt={l} width={14} height={14} className="rounded-sm" />,
                  )}
                </div>
                <div className="mt-1 font-medium text-ink">{c.label}</div>
                <div className="text-3xs text-ink-3">{c.src}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line last:border-0">
              <td className={clsx("px-3 py-1", r.label.startsWith("·") ? "pl-5 text-ink-3" : "text-ink-2")}>{r.label}</td>
              {cols.map((c) => (
                <td key={c.key} className="num px-2 py-1 text-right" style={r.hi?.(c.g) ? { color: C.good, fontWeight: 600 } : undefined}>{r.v(c.g)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 border-t border-line px-3 py-2 text-3xs leading-relaxed text-ink-3">
        <div>
          Per port, the pilot stations earn <b className="text-ink">{uplift >= 0 ? "+" : ""}{uplift.toFixed(0)}%</b> vs VinFast-only, mostly because they are the busiest stations.
          Tesla itself adds <b className="text-ink">+{hybrid.revVinfast ? ((hybrid.revTesla / hybrid.revVinfast) * 100).toFixed(0) : 0}%</b> on top ({Math.round(hybrid.teslaSessions)} sessions/day), capped by spare capacity ({Math.round(MAX_PRACTICAL_UTIL * 100)}% ceiling); quieter stations have more room for Tesla.
        </div>
        <div>Network stations: sessions × kWh × tariff ÷ (1 + VAT); Tesla = min({TESLA_SESSIONS_PER_PILOT_PORT}/opened port, spare capacity). Analysis sites: scenario C, year-1 daily average. Synthetic data.</div>
      </div>
    </Panel>
  );
}

// Tesla opportunities at underused VinFast-only network stations. Cost figures mirror the site engine
// (backend open_charging.py): connector/authorization allowance per opened port + software + permits. Illustrative.
const OPPORTUNITY_CITIES = [
  { city: "Ho Chi Minh City", label: "HCMC" },
  { city: "Hanoi", label: "Hanoi" },
  { city: "Da Nang", label: "Da Nang" },
] as const;
const OPPORTUNITIES_PER_CITY = 10;
const OPEN_COST_PER_PORT_VND = 40_000_000;
const OPEN_FIXED_COST_VND = 250_000_000 + 80_000_000;

interface Opportunity { c: Charger; teslaPorts: number; spare: number; sessions: number; revDay: number; marginYear: number; capex: number; payback: number | null }

function opportunity(c: Charger, a: Assumptions): Opportunity {
  const vat = 1 + a.vat_pct / 100;
  const teslaPorts = pilotTeslaPorts(c);
  const sessionH = a.kwh_tesla / (c.power_kw * POWER_DERATE);
  const spare = Math.max(0, MAX_PRACTICAL_UTIL - c.utilization);
  const sessions = Math.min(teslaPorts * TESLA_SESSIONS_PER_PILOT_PORT, (spare * c.ports * OPERATING_HOURS) / sessionH);
  const revDay = (sessions * (a.kwh_tesla * a.tariff_tesla + a.third_party_session_fee_vnd)) / vat;
  const energyDay = sessions * a.kwh_tesla * a.energy_cost_vnd_per_kwh;
  const marginYear = (revDay * (1 - (a.payment_fee_pct / 100) * vat - a.site_owner_share_pct / 100) - energyDay) * 365 - a.hybrid_platform_opex_vnd_year;
  const capex = ((teslaPorts * OPEN_COST_PER_PORT_VND + OPEN_FIXED_COST_VND) * a.capex_scale_pct) / 100;
  return { c, teslaPorts, spare, sessions, revDay, marginYear, capex, payback: marginYear > 0 ? capex / marginYear : null };
}

function teslaOpportunityIcon(): L.DivIcon {
  return L.divIcon({
    className: "map-divicon",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="width:20px;height:20px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 2px #05080D,0 0 0 3.5px #E31937,0 0 10px #E3193799"><img src="/brands/tesla.png" width="20" height="20" alt=""/></div>`,
  });
}

function TeslaOpportunities({ chargers, pilotIds, onFocus }: { chargers: Charger[]; pilotIds: Set<string>; onFocus: (c: Charger) => void }) {
  const a = useOc((s) => s.assumptions)!;
  const [city, setCity] = useState<(typeof OPPORTUNITY_CITIES)[number]["city"]>("Ho Chi Minh City");
  const list = useMemo(() => underused(chargers, pilotIds, city).map((c) => opportunity(c, a)), [chargers, pilotIds, city, a]);
  const tot = list.reduce((s, o) => ({ rev: s.rev + o.revDay, capex: s.capex + o.capex, sessions: s.sessions + o.sessions }), { rev: 0, capex: 0, sessions: 0 });
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <img src="/brands/tesla.png" alt="" width={16} height={16} className="rounded-sm" />
          Tesla opportunities · {OPPORTUNITIES_PER_CITY} underused VinFast-only stations
        </span>
      }
      kicker="Lowest utilization per city · hybrid pilot stations excluded · open part of the spare capacity to Tesla"
      action={<Tabs value={city} onChange={setCity} options={OPPORTUNITY_CITIES.map((x) => ({ value: x.city, label: x.label }))} />}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="table-grid w-full text-2xs">
          <thead>
            <tr>
              <th>#</th><th>Station</th><th>Utilization</th><th>Spare</th><th>Ports · kW</th><th>Tesla ports</th><th>Tesla sessions/day</th><th>Tesla revenue/day</th><th>Cost to open</th><th>Payback</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o, i) => (
              <tr key={o.c.station_id} className="cursor-pointer" onClick={() => onFocus(o.c)}>
                <td className="num text-ink-3">{i + 1}</td>
                <td><div className="font-medium">{o.c.name}</div><div className="text-ink-3">{o.c.zone} · {o.c.avg_daily_sessions} VinFast sessions/day</div></td>
                <td><div className="flex items-center gap-2"><div className="w-12"><Meter value={o.c.utilization} tone="idle" /></div><span className="num">{Math.round(o.c.utilization * 100)}%</span></div></td>
                <td className="num" style={{ color: C.good }}>{Math.round(o.spare * 100)}%</td>
                <td className="num">{o.c.ports} · {o.c.power_kw}</td>
                <td className="num">{o.teslaPorts}</td>
                <td className="num">{o.sessions.toFixed(1)}</td>
                <td className="num">{fmtVnd(o.revDay)}</td>
                <td className="num">{fmtVnd(o.capex)}</td>
                <td className="num" style={{ color: o.payback !== null && o.payback <= 3 ? C.good : undefined }}>{fmtYears(o.payback, "none")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong font-medium">
              <td /><td className="px-3 py-1.5">Total, {list.length} stations</td><td colSpan={4} />
              <td className="num px-3">{tot.sessions.toFixed(0)}</td><td className="num px-3">{fmtVnd(tot.rev)}</td><td className="num px-3">{fmtVnd(tot.capex)}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-3xs leading-relaxed text-ink-3">
        Estimate on synthetic stations: {TESLA_SESSIONS_PER_PILOT_PORT} Tesla sessions per opened port per day, capped by spare capacity ({Math.round(MAX_PRACTICAL_UTIL * 100)}% ceiling); illustrative Tesla tariff and energy cost from Pricing & ROI.
        Payback = cost to open ÷ (Tesla contribution − hybrid platform opex) per year. VinFast keeps priority; Tesla compatibility unverified. Not an offer to, or plan of, Tesla or VinFast.
      </p>
    </Panel>
  );
}

function underused(chargers: Charger[], pilotIds: Set<string>, city: string): Charger[] {
  return chargers
    .filter((c) => c.city === city && !pilotIds.has(c.station_id))
    .sort((x, y) => x.utilization - y.utilization || x.avg_daily_sessions - y.avg_daily_sessions)
    .slice(0, OPPORTUNITIES_PER_CITY);
}

function AccessBadges({ a }: { a: ByGroup<boolean> }) {
  return (
    <span className="flex gap-1">
      {GROUPS.map((g) => (
        <span key={g} title={`${GROUP_LABEL[g]}: ${a[g] ? "can charge (proposed)" : "no access"}`} className="rounded px-1 font-mono text-3xs" style={a[g] ? { color: GROUP_COLOR[g], background: `${GROUP_COLOR[g]}1F` } : { color: "#475569" }}>
          {g === "vinfast" ? "VF" : g === "tesla" ? "TSLA" : "OTH"}
        </span>
      ))}
    </span>
  );
}

// SYNTHETIC corridors drawn for context only: rough polylines, not surveyed routes
const CORRIDORS: { name: string; path: [number, number][] }[] = [
  { name: "HCMC – Long Thanh – Dau Giay", path: [[10.79, 106.75], [10.79, 106.87], [10.77, 107.03], [10.95, 107.25]] },
  { name: "Hanoi – Hai Phong", path: [[21.0, 105.9], [20.94, 106.25], [20.86, 106.6], [20.82, 106.72]] },
  { name: "Da Nang – Hoi An", path: [[16.05, 108.2], [15.95, 108.28], [15.88, 108.33]] },
  { name: "Hanoi – Noi Bai", path: [[21.03, 105.83], [21.12, 105.81], [21.215, 105.806]] },
];

const VIEWS: Record<string, { center: [number, number]; zoom: number }> = {
  Vietnam: CITY_VIEWS.Vietnam,
  HCMC: { center: [10.8, 106.82], zoom: 10.5 },
  Hanoi: { center: [21.08, 105.86], zoom: 10.5 },
};

function siteMarker(s: Site, selected: boolean): L.DivIcon {
  const color = toneColor[ACTION_TONE[s.recommendation.action] ?? "idle"];
  const size = selected ? 30 : 24;
  const proposed = s.site_type === "proposed";
  const airport = s.setting === "airport";
  return L.divIcon({
    className: "map-divicon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;${proposed ? "transform:rotate(45deg);" : ""}border-radius:${airport ? "50%" : "5px"};background:${proposed ? "#0F1621" : color};border:2px ${proposed ? "dashed" : "solid"} ${color};box-shadow:0 0 0 2px #05080D${selected ? `,0 0 18px ${color}` : ""};display:flex;align-items:center;justify-content:center"><span style="${proposed ? "transform:rotate(-45deg);" : ""}color:${proposed ? color : "#05080D"};font:700 ${size > 26 ? 11 : 10}px 'JetBrains Mono',monospace">${Math.round(s.score.score)}</span></div>`,
  });
}

export default function Investment({ ev, goto }: { ev: Evaluation; goto: (t: OcTab) => void }) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [region, setRegion] = useState<Region>("All");
  const [kind, setKind] = useState<"all" | "vinfast_only" | "proposed">("all");
  const [brand, setBrand] = useState<Brand>("all");
  const [layer, setLayer] = useState<Layer>("both");
  const siteId = useOc((s) => s.siteId);
  const select = useOc((s) => s.selectSite);

  const chargers = useApi<Charger[]>("/api/chargers");
  const pilot = useMemo(() => (chargers.data ? pickPilot(chargers.data) : []), [chargers.data]);
  const pilotRank = useMemo(() => new Map(pilot.map((c, i) => [c.station_id, i + 1])), [pilot]);
  const pilotIds = useMemo(() => new Set(pilotRank.keys()), [pilotRank]);

  const inRegionSites = ev.sites.filter((s) => region === "All" || s.region === region);
  const inRegionStations = (chargers.data ?? []).filter((c) => region === "All" || stationRegion(c) === region);
  const sites = useMemo(
    () =>
      layer === "network"
        ? []
        : inRegionSites.filter((s) => (kind === "all" || s.site_type === kind) && (brand === "all" || siteAccess(s)[brand])).sort((a, b) => b.score.score - a.score.score),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ev.sites, region, kind, brand, layer],
  );
  const stations = useMemo(
    () =>
      layer === "analysis" || kind === "proposed"
        ? []
        : inRegionStations.filter((c) => brand === "all" || stationAccess(c, pilotIds)[brand]).sort((a, b) => b.avg_daily_sessions - a.avg_daily_sessions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chargers.data, region, kind, brand, layer, pilotIds],
  );
  const brandCount = (g: Brand) =>
    inRegionSites.filter((s) => g === "all" || siteAccess(s)[g]).length + inRegionStations.filter((c) => g === "all" || stationAccess(c, pilotIds)[g]).length;
  const site = ev.sites.find((s) => s.site_id === siteId) ?? ev.sites[0];

  const opportunityIds = useMemo(
    () => new Set(chargers.data ? OPPORTUNITY_CITIES.flatMap((x) => underused(chargers.data!, pilotIds, x.city).map((c) => c.station_id)) : []),
    [chargers.data, pilotIds],
  );

  // charging network stations (existing synthetic network); the hybrid pilot ones carry both brand marks,
  // underused stations proposed as Tesla opportunities carry a Tesla ring
  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    for (const c of stations) {
      const rank = pilotRank.get(c.station_id);
      const opp = opportunityIds.has(c.station_id);
      L.marker([c.latitude, c.longitude], { icon: rank ? pilotIcon(rank) : opp ? teslaOpportunityIcon() : chargerIcon(c.status, { size: 14 }), zIndexOffset: rank ? 700 : opp ? 600 : 0 })
        .bindTooltip(`${c.name}${rank ? ` · hybrid pilot #${rank}` : opp ? " · Tesla opportunity (underused)" : ""} · ${Math.round(c.utilization * 100)}% util. · ${c.avg_daily_sessions} sessions/day`, { direction: "top", offset: [0, -10] })
        .bindPopup(rank ? pilotPopup(c, rank) : networkPopup(c))
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, stations, pilotRank, opportunityIds]);

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    for (const c of CORRIDORS) {
      L.polyline(c.path, { color: C.accent, weight: 2, opacity: 0.45, dashArray: "6 6" }).bindTooltip(`Corridor (synthetic): ${c.name}`).addTo(group);
    }
    for (const s of sites) {
      const total = Object.values(s.simulated_demand).reduce((a, b) => a + b, 0);
      L.circle([s.lat, s.lon], { radius: 300 + total * 18, color: GROUP_COLOR.other, weight: 0, fillOpacity: 0.12, interactive: false }).addTo(group);
      L.marker([s.lat, s.lon], { icon: siteMarker(s, s.site_id === siteId), zIndexOffset: s.site_id === siteId ? 1000 : 800 })
        .bindTooltip(`${s.name} · ${s.recommendation.action} · score ${Math.round(s.score.score)}`, { direction: "top", offset: [0, -14] })
        .on("click", () => select(s.site_id))
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, sites, siteId, select]);

  useEffect(() => {
    if (!map) return;
    if (region === "HCMC" || region === "Hanoi") map.flyTo(VIEWS[region].center, VIEWS[region].zoom, { duration: 0.7 });
    else map.flyTo(VIEWS.Vietnam.center, 6, { duration: 0.7 });
  }, [map, region]);

  const focus = (s: Site) => {
    select(s.site_id);
    map?.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 11), { duration: 0.6 });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="label">Who can charge</span>
        <Tabs
          value={brand}
          onChange={setBrand}
          options={(["all", ...GROUPS] as Brand[]).map((g) => ({
            value: g,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {g === "vinfast" && <img src="/brands/vinfast.png" alt="" width={12} height={12} className="rounded-sm" />}
                {g === "tesla" && <img src="/brands/tesla.png" alt="" width={12} height={12} className="rounded-sm" />}
                {g === "other" && <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR.other }} />}
                {g === "all" ? "All brands" : GROUP_LABEL[g]} <span className="num text-ink-3">{brandCount(g)}</span>
              </span>
            ),
          }))}
        />
        <Tabs value={layer} onChange={setLayer} options={[{ value: "both", label: "Network + analysis sites" }, { value: "network", label: `Charging network (${chargers.data?.length ?? "…"})` }, { value: "analysis", label: `Analysis sites (${ev.sites.length})` }]} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={region} onChange={setRegion} options={REGIONS.map((r) => ({ value: r, label: r === "Airports" ? "✈ Airports" : r === "Corridor" ? "Corridor & other cities" : r }))} />
        <Tabs value={kind} onChange={setKind} options={[{ value: "all", label: "All sites" }, { value: "vinfast_only", label: "Existing VinFast-only" }, { value: "proposed", label: "New-build" }]} />
        <ProvenanceTags items={["SYNTHETIC SITES", "SIMULATED DEMAND", "PROPOSED ACCESS"]} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-3">
        <section className="panel overflow-hidden">
          <MapView center={CITY_VIEWS.Vietnam.center} zoom={6} onMap={setMap} className="h-[520px]">
            <MapOverlay position="bl" className="px-3 py-2">
              <Legend
                items={Object.entries(ACTION_TONE).map(([label, tone]) => ({ label, color: toneColor[tone], shape: "square" as const }))}
              />
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-2xs text-ink-3">
                <span>■ existing</span><span>◆ new-build</span><span>● airport</span><span>number = site score</span><span>halo = simulated demand</span><span>- - corridor</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3">
                <span className="flex items-center gap-1">
                  <span className="flex gap-px rounded bg-ink p-px"><img src="/brands/vinfast.png" alt="" width={11} height={11} /><img src="/brands/tesla.png" alt="" width={11} height={11} /></span>
                  hybrid pilot station
                </span>
                <span className="flex items-center gap-1">
                  <img src="/brands/tesla.png" alt="" width={11} height={11} className="rounded-full ring-1 ring-[#E31937]" />
                  Tesla opportunity (underused)
                </span>
                {["normal", "high", "overloaded", "low"].map((k) => (
                  <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: CHARGER_STATUS[k].color }} />{CHARGER_STATUS[k].label}</span>
                ))}
                <span>(small = network station)</span>
              </div>
            </MapOverlay>
          </MapView>
        </section>
          {chargers.data && (
            <TeslaOpportunities chargers={chargers.data} pilotIds={pilotIds} onFocus={(c) => map?.flyTo([c.latitude, c.longitude], 14, { duration: 0.6 })} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {chargers.data && <BrandComparison ev={ev} chargers={chargers.data} pilotIds={pilotIds} />}
          <SiteDetail site={site} goto={goto} />
        </div>
      </div>

      <Panel title="Ranked investment opportunities" kicker="Click a row for details · map pins and this list show the same data (list works without map tiles)" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="table-grid w-full text-xs">
            <thead>
              <tr>
                <th>#</th><th>Site</th><th>Type</th><th>Suggestion</th><th>Who can charge</th><th>Score</th><th>Data</th><th>Base util.</th><th>VinFast wait base → hybrid</th><th>Capex</th><th>NPV</th><th>Payback</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s, i) => {
                const opt = s.options[s.recommendation.option ?? Object.keys(s.options)[0]];
                return (
                  <tr key={s.site_id} onClick={() => focus(s)} className={clsx("cursor-pointer", s.site_id === siteId && "bg-raised")}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-2xs text-ink-3">{s.city} · {s.setting} · {s.dc_ports} DC × {s.port_kw} kW</div>
                    </td>
                    <td><Badge tone={s.site_type === "proposed" ? "info" : "idle"}>{s.site_type === "proposed" ? "proposed" : "VinFast-only"}</Badge></td>
                    <td><Badge tone={ACTION_TONE[s.recommendation.action]}>{s.recommendation.action}</Badge></td>
                    <td><AccessBadges a={siteAccess(s)} /></td>
                    <td className="num text-sm">{s.score.score.toFixed(0)}</td>
                    <td className="num" title={s.score.missing.length ? `Missing: ${s.score.missing.join(", ")}` : "All factors present"}>
                      <span style={{ color: s.score.completeness < 1 ? C.warn : C.ink2 }}>{Math.round(s.score.completeness * 100)}%</span>
                    </td>
                    <td className="num">{s.baseline_utilization === null ? "new" : `${Math.round(s.baseline_utilization * 100)}%`}</td>
                    <td className="num">{s.baseline_vinfast_wait ? fmtWait(s.baseline_vinfast_wait.avg) : "—"} → {fmtWait(opt.vinfast_wait.avg)}</td>
                    <td className="num">{fmtVnd(opt.capex.total)}</td>
                    <td className="num" style={{ color: opt.npv >= 0 ? C.good : C.crit }}>{fmtVnd(opt.npv)}</td>
                    <td className="num">{fmtYears(opt.payback_years, "none in horizon")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {stations.length > 0 && (
        <Panel
          title={`Charging network stations · ${stations.length} shown`}
          kicker="Same synthetic stations and data as the Charging Network page · sorted by daily sessions · click to locate"
          bodyClassName="p-0"
        >
          <div className="max-h-[420px] overflow-auto">
            <table className="table-grid w-full text-xs">
              <thead>
                <tr>
                  <th>Station</th><th>City</th><th>Status</th><th>Ports · kW</th><th>Available</th><th>Utilization</th><th>Sessions/day</th><th>Peak</th><th>90-day forecast</th><th>Who can charge</th><th>Network plan</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((c) => {
                  const rank = pilotRank.get(c.station_id);
                  const st = CHARGER_STATUS[c.status];
                  return (
                    <tr key={c.station_id} className="cursor-pointer" onClick={() => map?.flyTo([c.latitude, c.longitude], 13.5, { duration: 0.6 })}>
                      <td>
                        <div className="flex items-center gap-1.5 font-medium">
                          {rank && <span className="flex gap-px rounded bg-ink p-px"><img src="/brands/vinfast.png" alt="" width={11} height={11} /><img src="/brands/tesla.png" alt="" width={11} height={11} /></span>}
                          {c.name}
                        </div>
                        {rank && <div className="text-2xs text-accent">Hybrid pilot #{rank} · {pilotTeslaPorts(c)}/{c.ports} ports open to Tesla (proposed)</div>}
                      </td>
                      <td className="text-ink-2">{c.city}</td>
                      <td><span className="inline-flex items-center gap-1.5 text-2xs" style={{ color: st.color }}><span className="h-2 w-2 rounded-sm" style={{ background: st.color }} />{st.label}</span></td>
                      <td className="num">{c.ports} · {c.power_kw}</td>
                      <td className="num">{c.available}</td>
                      <td><div className="flex items-center gap-2"><div className="w-14"><Meter value={c.utilization} tone={c.utilization > 0.9 ? "crit" : c.utilization > 0.75 ? "warn" : "good"} /></div><span className="num">{Math.round(c.utilization * 100)}%</span></div></td>
                      <td className="num">{c.avg_daily_sessions}</td>
                      <td className="num text-ink-2">{c.peak_window}</td>
                      <td className="num">+{Math.round(c.forecast_90d_pct)}%</td>
                      <td><AccessBadges a={stationAccess(c, pilotIds)} /></td>
                      <td className="text-2xs text-ink-2">{c.action ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <WeightsPanel site={site} />
    </div>
  );
}

function SiteDetail({ site, goto }: { site: Site; goto: (t: OcTab) => void }) {
  const opt = site.options[site.recommendation.option ?? Object.keys(site.options)[0]];
  const c = site.scenarios.C;
  const growth = 1 + (useOc((s) => s.assumptions?.annual_growth_pct) ?? 0) / 100;
  return (
    <Panel
      title={site.name}
      kicker={`${site.site_id} · ${site.city} · ${site.site_type === "proposed" ? "Proposed new-build" : "Existing VinFast-only (synthetic)"}`}
      bodyClassName="space-y-3 overflow-y-auto xl:max-h-[470px]"
      action={<Button size="sm" variant="primary" onClick={() => goto("roi")}><ArrowRightLeft size={11} /> Compare Scenarios</Button>}
    >
      <div className="rounded-md border px-3 py-2" style={{ borderColor: `${toneColor[ACTION_TONE[site.recommendation.action]]}66` }}>
        <Badge tone={ACTION_TONE[site.recommendation.action]}>{site.recommendation.action}</Badge>
        <p className="mt-1.5 text-xs leading-relaxed text-ink">{site.recommendation.narrative}</p>
        <p className="mt-1 text-3xs text-ink-3">Deterministic rules on simulated data, not an AI prediction · {site.recommendation.category_label}</p>
      </div>
      <ProvenanceTags items={site.labels} />

      <div>
        <div className="label mb-1">Simulated demand (sessions/day) · current → year-5 forecast</div>
        {GROUPS.map((g) => (
          <div key={g} className="flex items-center gap-2 py-0.5">
            <span className="w-24 text-2xs" style={{ color: GROUP_COLOR[g] }}>{GROUP_LABEL[g]}</span>
            <div className="flex-1"><Meter value={site.simulated_demand[g]} max={120} tone="info" /></div>
            <span className="num w-24 text-right text-2xs">{site.simulated_demand[g].toFixed(0)} → {(site.simulated_demand[g] * Math.pow(growth, 4)).toFixed(0)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        <Stat label="Chargers" value={`${site.dc_ports} DC (${site.port_kw} kW) + ${site.ac_ports} AC`} />
        <Stat label="Grid capacity" value={site.grid === "unknown" ? "UNKNOWN" : `${site.grid}${site.grid_spare_kw !== null ? ` · ${site.grid_spare_kw} kW spare` : ""}`} tone={site.grid === "unknown" ? "warn" : undefined} />
        <Stat label="Utilization (VinFast-only)" value={site.baseline_utilization === null ? "new site" : `${Math.round(site.baseline_utilization * 100)}%`} />
        <Stat label="Utilization (hybrid C)" value={`${Math.round(c.utilization * 100)}%`} />
        <Stat label="Spare capacity" value={site.baseline_utilization === null ? "—" : `${Math.round((1 - site.baseline_utilization) * 100)}%`} />
        <Stat label="Peak 3rd-party cap" value={c.peak_cap_binding ? "binding" : "not binding"} />
      </div>

      <div>
        <div className="label mb-1">Compatibility (assumed for simulation; must be tested)</div>
        <div className="flex flex-wrap gap-2">
          {GROUPS.map((g) => (
            <span key={g} className="flex items-center gap-1"><GroupBadge group={g} /><CompatBadge status={site.compatibility[g]} /></span>
          ))}
        </div>
      </div>

      <div>
        <div className="label mb-1">Estimated peak-hour wait (avg / p90)</div>
        <table className="w-full text-2xs">
          <tbody>
            {(["A", "B", "C"] as const).map((k) => (
              <tr key={k} className="border-b border-line last:border-0">
                <td className="py-1 text-ink-3">{k}</td>
                {GROUPS.map((g) => {
                  const w = site.scenarios[k].waits[g];
                  const shown = k === "A" ? g === "vinfast" : k === "B" ? g !== "other" : true;
                  return <td key={g} className="num py-1" style={{ color: GROUP_COLOR[g] }}>{shown ? `${fmtWait(w.avg)} / ${fmtWait(w.p90)}` : "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-x-4">
        <Stat label={`Capex · ${opt.label}`} value={`${fmtVnd(opt.capex.total)}${opt.capex.grid_is_estimate ? "*" : ""}`} />
        <Stat label="Year-1 incremental cash flow" value={fmtVnd(opt.annual_incremental_cf_y1)} />
        <Stat label="Year-1 revenue (C)" value={fmtVnd(c.year1.operator_revenue)} />
        <Stat label="Year-1 contribution (C)" value={fmtVnd(c.year1.contribution)} />
        <Stat label="Simple ROI" value={fmtRoi(opt.simple_roi_pct)} />
        <Stat label="Payback" value={fmtYears(opt.payback_years, "none in horizon")} />
      </div>
      {opt.capex.grid_is_estimate && <p className="text-3xs text-warn">*grid connection cost is an estimate: no confirmed grid data</p>}

      <div>
        <div className="label mb-1">Why</div>
        <ul className="list-disc space-y-0.5 pl-4 text-2xs text-ink-2">{site.recommendation.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="label mb-1 mt-2">Risks</div>
        <ul className="list-disc space-y-0.5 pl-4 text-2xs text-ink-2">{site.recommendation.risks.map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="label mb-1 mt-2">Next validation step</div>
        <p className="text-2xs text-ink">{site.recommendation.next_step}</p>
        <div className="label mb-1 mt-2">Most sensitive assumptions (NPV swing, ±20 %)</div>
        <p className="text-2xs text-ink-2">{site.sensitivity.slice(0, 2).map((d) => `${d.driver} (${fmtVnd(d.swing)})`).join(" · ")}</p>
      </div>
    </Panel>
  );
}

function WeightsPanel({ site }: { site: Site }) {
  const weights = useOc((s) => s.weights);
  const setWeight = useOc((s) => s.setWeight);
  const defaults = useOc((s) => s.defaults);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel
        title="Scoring weights"
        kicker="Editable · score = Σ(weight × factor) ÷ Σ(weights with data) × 100"
        action={defaults && <Button size="sm" variant="ghost" onClick={() => Object.entries(defaults.weights).forEach(([k, v]) => setWeight(k, v))}><RotateCcw size={11} /> Reset</Button>}
      >
        <div className="grid gap-x-5 gap-y-2 md:grid-cols-2">
          {site.score.breakdown.map((b) => (
            <label key={b.factor} className="block">
              <div className="mb-0.5 flex justify-between text-2xs"><span className="text-ink-2">{b.label}</span><span className="num">{(weights[b.factor] ?? 0).toFixed(2)}</span></div>
              <input type="range" min={0} max={0.4} step={0.01} value={weights[b.factor] ?? 0} onChange={(e) => setWeight(b.factor, Number(e.target.value))} className="w-full" style={{ ["--fill" as string]: `${((weights[b.factor] ?? 0) / 0.4) * 100}%` }} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-3xs text-ink-3">Weights sum to {total.toFixed(2)}; the score normalises by the weights that have data, so it stays 0–100 and is reproducible.</p>
      </Panel>
      <Panel title={`Score breakdown · ${site.name}`} kicker={`Score ${site.score.score.toFixed(1)} · data completeness ${Math.round(site.score.completeness * 100)}%`} bodyClassName="p-0">
        <table className="table-grid w-full text-2xs">
          <thead><tr><th>Factor</th><th>Value 0–1</th><th>Weight</th><th>Points</th></tr></thead>
          <tbody>
            {site.score.breakdown.map((b) => (
              <tr key={b.factor}>
                <td>{b.label}</td>
                <td className="num">{b.missing ? <Badge tone="warn">missing</Badge> : b.value?.toFixed(2)}</td>
                <td className="num">{b.weight.toFixed(2)}</td>
                <td>
                  {b.missing ? <span className="text-ink-3">excluded, not zero-filled</span> : (
                    <div className="flex items-center gap-2"><div className="w-20"><Meter value={b.contribution ?? 0} max={25} tone="accent" /></div><span className="num">{b.contribution?.toFixed(1)}</span></div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
