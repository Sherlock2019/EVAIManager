import clsx from "clsx";
import L from "leaflet";
import { ArrowRightLeft, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MapOverlay, MapView } from "../../components/MapView";
import { Badge, Button, Legend, Meter, Panel, Stat, Tabs } from "../../components/ui";
import { C, toneColor } from "../../lib/format";
import { CITY_VIEWS } from "../../lib/map";
import { ACTION_TONE, GROUPS, GROUP_COLOR, GROUP_LABEL, fmtRoi, fmtVnd, fmtWait, fmtYears, type Evaluation, type OcTab, type Site, useOc } from "../../lib/openCharging";
import { CompatBadge, GroupBadge, ProvenanceTags, REGIONS, type Region } from "./shared";

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
  const siteId = useOc((s) => s.siteId);
  const select = useOc((s) => s.selectSite);

  const sites = useMemo(
    () => ev.sites.filter((s) => (region === "All" || s.region === region) && (kind === "all" || s.site_type === kind)).sort((a, b) => b.score.score - a.score.score),
    [ev.sites, region, kind],
  );
  const site = ev.sites.find((s) => s.site_id === siteId) ?? ev.sites[0];

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    for (const c of CORRIDORS) {
      L.polyline(c.path, { color: C.accent, weight: 2, opacity: 0.45, dashArray: "6 6" }).bindTooltip(`Corridor (synthetic): ${c.name}`).addTo(group);
    }
    for (const s of sites) {
      const total = Object.values(s.simulated_demand).reduce((a, b) => a + b, 0);
      L.circle([s.lat, s.lon], { radius: 300 + total * 18, color: GROUP_COLOR.other, weight: 0, fillOpacity: 0.12, interactive: false }).addTo(group);
      L.marker([s.lat, s.lon], { icon: siteMarker(s, s.site_id === siteId), zIndexOffset: s.site_id === siteId ? 800 : 0 })
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
        <Tabs value={region} onChange={setRegion} options={REGIONS.map((r) => ({ value: r, label: r === "Airports" ? "✈ Airports" : r }))} />
        <Tabs value={kind} onChange={setKind} options={[{ value: "all", label: "All sites" }, { value: "vinfast_only", label: "Existing VinFast-only" }, { value: "proposed", label: "New-build" }]} />
        <ProvenanceTags items={["SYNTHETIC SITES", "SIMULATED DEMAND"]} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="panel overflow-hidden">
          <MapView center={CITY_VIEWS.Vietnam.center} zoom={6} onMap={setMap} className="h-[520px]">
            <MapOverlay position="bl" className="px-3 py-2">
              <Legend
                items={Object.entries(ACTION_TONE).map(([label, tone]) => ({ label, color: toneColor[tone], shape: "square" as const }))}
              />
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-2xs text-ink-3">
                <span>■ existing</span><span>◆ new-build</span><span>● airport</span><span>number = site score</span><span>halo = simulated demand</span><span>- - corridor</span>
              </div>
            </MapOverlay>
          </MapView>
        </section>
        <SiteDetail site={site} goto={goto} />
      </div>

      <Panel title="Ranked investment opportunities" kicker="Click a row for details · map pins and this list show the same data (list works without map tiles)" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="table-grid w-full text-xs">
            <thead>
              <tr>
                <th>#</th><th>Site</th><th>Type</th><th>Suggestion</th><th>Score</th><th>Data</th><th>Base util.</th><th>VinFast wait base → hybrid</th><th>Capex</th><th>NPV</th><th>Payback</th>
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
