import clsx from "clsx";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, ChartTooltip, Legend, Panel, Stat, Tabs, axisProps, gridProps } from "../../components/ui";
import { C, titleCase } from "../../lib/format";
import { ACTION_TONE, fmtRoi, fmtVnd, fmtWait, fmtYears, type Evaluation, type Option, useOc } from "../../lib/openCharging";
import { NumField, ProvenanceTags, Select, SiteSelect } from "./shared";

const OPT_COLOR = [C.s1, C.s2, C.s3];

export default function Roi({ ev, formulas }: { ev: Evaluation; formulas: Record<string, string> }) {
  const a = useOc((s) => s.assumptions)!;
  const set = useOc((s) => s.set);
  const siteId = useOc((s) => s.siteId);
  const select = useOc((s) => s.selectSite);
  const site = ev.sites.find((s) => s.site_id === siteId) ?? ev.sites[0];
  const options = Object.values(site.options);
  const rec = site.recommendation.option;

  const timeline = Array.from({ length: a.horizon_years + 1 }, (_, y) => {
    const row: Record<string, number> = { year: y };
    options.forEach((o) => (row[o.option] = (y === 0 ? -o.capex.total : o.cumulative[y - 1] - o.capex.total) / 1e6));
    return row;
  });
  const tornado = site.sensitivity.map((d) => {
    const base = site.options[rec ?? options[0].option].npv;
    return { driver: d.driver, low: (Math.min(d.npv_low, d.npv_high) - base) / 1e6, high: (Math.max(d.npv_low, d.npv_high) - base) / 1e6 };
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SiteSelect sites={ev.sites} />
        <span className="label">Hybrid scenario</span>
        <Tabs value={a.hybrid_mode} onChange={(v) => set({ hybrid_mode: v })} options={[{ value: "B", label: "B · + Tesla" }, { value: "C", label: "C · + Tesla + others" }]} />
        <ProvenanceTags items={["ESTIMATED FINANCIAL RESULTS", "NOT AN INVESTMENT GUARANTEE"]} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className={clsx("grid gap-3", options.length > 1 ? "md:grid-cols-2" : "")}>
            {options.map((o, i) => <OptionCard key={o.option} o={o} color={OPT_COLOR[i]} recommended={o.option === rec} horizon={a.horizon_years} />)}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Cumulative incremental cash flow" kicker="M VND · year 0 = capex · payback where the line crosses 0">
              <div className="h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeline}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="year" {...axisProps} />
                    <YAxis {...axisProps} width={52} />
                    <ReferenceLine y={0} stroke={C.ink3} />
                    <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(0)}M ₫`} />} />
                    {options.map((o, i) => <Line key={o.option} dataKey={o.option} name={o.label} stroke={OPT_COLOR[i]} strokeWidth={2} dot={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1"><Legend items={options.map((o, i) => ({ label: o.label, color: OPT_COLOR[i], shape: "line" as const }))} /></div>
            </Panel>
            <Panel title="Sensitivity (±20 %)" kicker="Change in NPV of the suggested option · M VND">
              <div className="h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tornado} layout="vertical" stackOffset="sign">
                    <CartesianGrid {...gridProps} horizontal={false} vertical />
                    <XAxis type="number" {...axisProps} />
                    <YAxis type="category" dataKey="driver" {...axisProps} width={130} />
                    <ReferenceLine x={0} stroke={C.ink3} />
                    <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(0)}M ₫`} />} cursor={{ fill: "#ffffff08" }} />
                    <Bar dataKey="low" name="Unfavourable" fill={C.s2} stackId="t" />
                    <Bar dataKey="high" name="Favourable" fill={C.s3} stackId="t" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        </div>

        <Panel title="Assumptions" kicker="Edits apply to every site and dashboard">
          <div className="grid grid-cols-2 gap-2.5">
            <NumField label="Capex scale" k="capex_scale_pct" unit="%" step={5} />
            <NumField label="Energy cost" k="energy_cost_vnd_per_kwh" unit="₫/kWh" step={100} />
            <NumField label="Demand / utilization" k="demand_scale_pct" unit="%" step={5} />
            <NumField label="Annual growth" k="annual_growth_pct" unit="%" min={-20} />
            <NumField label="Tesla tariff" k="tariff_tesla" unit="₫/kWh" step={100} />
            <NumField label="Other tariff" k="tariff_other" unit="₫/kWh" step={100} />
            <NumField label="Maintenance / port" k="maintenance_vnd_per_port_year" unit="₫/yr" step={1_000_000} />
            <NumField label="Platform opex" k="hybrid_platform_opex_vnd_year" unit="₫/yr" step={10_000_000} />
            <NumField label="Demand charge" k="demand_charge_vnd_per_kw_month" unit="₫/kW·mo" step={1000} />
            <NumField label="Site-owner share" k="site_owner_share_pct" unit="%" />
            <NumField label="Horizon" k="horizon_years" unit="years" min={1} max={15} />
            <NumField label="Discount rate" k="discount_rate_pct" unit="%" />
            <NumField label="Income tax" k="tax_pct" unit="%, 0 = pre-tax" />
            <NumField label="Residual value" k="residual_value_pct" unit="% of capex" />
            <NumField label="3rd-party peak cap" k="third_party_peak_cap_pct" unit="% of ports" />
            <NumField label="VinFast avg wait target" k="target_vinfast_avg_wait_min" unit="min" />
          </div>
          <div className="mt-3 space-y-2">
            <Select label="Commercial model" value={a.operating_model} onChange={(v) => set({ operating_model: v })} options={[{ value: "direct", label: "Direct payment" }, { value: "roaming", label: "Roaming" }, { value: "joint", label: "Joint investment" }]} />
            {a.operating_model === "roaming" && <NumField label="Mobility-provider margin on 3rd-party revenue" k="msp_margin_pct" unit="%" />}
            {a.operating_model === "joint" && (
              <div className="grid grid-cols-2 gap-2.5">
                <NumField label="Partner share of capex" k="partner_capex_share_pct" unit="%" />
                <NumField label="Partner share of cash flow" k="partner_cashflow_share_pct" unit="%" />
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Stakeholders ev={ev} />

      <Panel title="Portfolio comparison" kicker="Each site's suggestion with the option behind it · click to inspect" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="table-grid w-full text-2xs">
            <thead><tr><th>Site</th><th>Suggestion</th><th>Option</th><th>Incremental capex</th><th>Yr-1 incremental CF</th><th>Simple ROI</th><th>Payback</th><th>NPV</th><th>IRR</th><th>VinFast peak wait</th></tr></thead>
            <tbody>
              {ev.sites.map((s) => {
                const o = s.options[s.recommendation.option ?? Object.keys(s.options)[0]];
                return (
                  <tr key={s.site_id} className={clsx("cursor-pointer", s.site_id === site.site_id && "bg-raised")} onClick={() => select(s.site_id)}>
                    <td>{s.name}</td>
                    <td><Badge tone={ACTION_TONE[s.recommendation.action]}>{s.recommendation.action}</Badge></td>
                    <td className="text-ink-2">{s.recommendation.option ? o.label : "— (shown: best option)"}</td>
                    <td className="num">{fmtVnd(o.capex.total)}</td>
                    <td className="num">{fmtVnd(o.annual_incremental_cf_y1)}</td>
                    <td className="num">{fmtRoi(o.simple_roi_pct)}</td>
                    <td className="num">{fmtYears(o.payback_years, "no payback")}</td>
                    <td className="num" style={{ color: o.npv >= 0 ? C.good : C.crit }}>{fmtVnd(o.npv)}</td>
                    <td className="num">{o.irr_pct === null ? "n/a" : `${o.irr_pct}%`}</td>
                    <td className="num">{fmtWait(o.vinfast_wait.avg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Definitions" kicker="Deterministic calculations, not AI predictions">
        <dl className="grid gap-x-6 gap-y-1.5 text-2xs md:grid-cols-2">
          {Object.entries(formulas).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="w-40 shrink-0 text-ink-3">{titleCase(k)}</dt><dd className="font-mono text-ink-2">{v}</dd></div>
          ))}
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-ink-3">Zero capex / no payback</dt><dd className="text-ink-2">ROI shown as not applicable when capex is zero; "No payback within modeled horizon" when cumulative cash flow never covers capex.</dd></div>
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-ink-3">IRR</dt><dd className="text-ink-2">Only shown when cash flows change sign exactly once; otherwise the reason is given instead of a number.</dd></div>
        </dl>
      </Panel>
    </div>
  );
}

/** Who bears the costs and who receives the benefits, year 1, for the selected site under the chosen hybrid scenario. */
function Stakeholders({ ev }: { ev: Evaluation }) {
  const a = useOc((s) => s.assumptions)!;
  const siteId = useOc((s) => s.siteId);
  const site = ev.sites.find((s) => s.site_id === siteId) ?? ev.sites[0];
  const A = site.scenarios.A;
  const H = site.scenarios[a.hybrid_mode];
  const o = site.options[site.recommendation.option ?? Object.keys(site.options)[0]];
  const vat = 1 + a.vat_pct / 100;
  const rows = [
    { who: "Charging operator", costs: `Capex ${fmtVnd(o.parties?.operator.capex ?? o.capex.total)}, energy, platform and maintenance`, gets: `Operating profit ${fmtVnd(A.year1.operating_profit)} → ${fmtVnd(H.year1.operating_profit)} / yr` },
    { who: "VinFast drivers", costs: `Peak wait ${fmtWait(A.waits.vinfast.avg)} → ${fmtWait(H.waits.vinfast.avg)} (target ${a.target_vinfast_avg_wait_min} min)`, gets: `Priority P1 kept; lowest tariff ${Math.round(a.tariff_vinfast).toLocaleString("en-US")} ₫/kWh` },
    { who: "Tesla drivers", costs: `Pay ${Math.round(a.tariff_tesla).toLocaleString("en-US")} ₫/kWh incl. VAT; priority P2`, gets: `Access to ${H.ports} ports (compatibility ${site.compatibility.tesla}); est. wait ${fmtWait(H.waits.tesla.avg)}` },
    ...(a.hybrid_mode === "C" ? [{ who: "Other-brand drivers", costs: `Pay ${Math.round(a.tariff_other).toLocaleString("en-US")} ₫/kWh incl. VAT; priority P3`, gets: `Access (compatibility ${site.compatibility.other}); est. wait ${fmtWait(H.waits.other.avg)}` }] : []),
    { who: "Tesla (company)", costs: "Nothing modelled", gets: "No charging revenue by default; benefit is driver access only" },
    { who: "Site owner", costs: "Parking space", gets: a.site_owner_share_pct > 0 ? `${a.site_owner_share_pct}% share = ${fmtVnd(H.year1.site_owner_share)} / yr` : "Zero share configured" },
    { who: "Sponsor / manufacturer", costs: H.year1.sponsor_reimbursement > 0 ? `Reimburses ${fmtVnd(H.year1.sponsor_reimbursement)} / yr` : "None: no reimbursement configured", gets: "Free-charging benefit for eligible VinFast drivers" },
    ...(a.operating_model === "roaming" ? [{ who: "Mobility service provider", costs: "Billing and customer service for roaming drivers", gets: `Margin ${fmtVnd(H.year1.msp_margin)} / yr (not operator revenue)` }] : []),
    ...(o.parties ? [{ who: "Partner investor", costs: `Capex ${fmtVnd(o.parties.partner_investor.capex)}`, gets: `${a.partner_cashflow_share_pct}% of incremental cash flow · NPV ${fmtVnd(o.parties.partner_investor.npv)}` }] : []),
    { who: "Tax authority", costs: "—", gets: `VAT collected ${fmtVnd(H.year1.vat_collected)} / yr (pass-through, ${((vat - 1) * 100).toFixed(0)}%)` },
  ];
  return (
    <Panel title={`Stakeholders · ${site.name}`} kicker={`Year 1 · A vs ${a.hybrid_mode} · under the configured commercial model (${a.operating_model})`} bodyClassName="p-0">
      <table className="table-grid w-full text-2xs">
        <thead><tr><th>Party</th><th>Bears</th><th>Receives</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.who}><td className="font-medium">{r.who}</td><td className="text-ink-2">{r.costs}</td><td className="text-ink-2">{r.gets}</td></tr>)}</tbody>
      </table>
    </Panel>
  );
}

function OptionCard({ o, color, recommended, horizon }: { o: Option; color: string; recommended: boolean; horizon: number }) {
  return (
    <Panel
      title={<><span style={{ color }}>● </span>{o.label}</>}
      kicker={`${o.ports} DC ports · scenario ${o.scenario} vs VinFast-only${o.option === "new_site" ? " (baseline: no site)" : ""}`}
      action={recommended ? <Badge tone="good" solid>suggested</Badge> : undefined}
      className={recommended ? "ring-1 ring-good/50" : undefined}
    >
      <div className="grid grid-cols-2 gap-x-4">
        <Stat label="Incremental capex" value={`${fmtVnd(o.capex.total)}${o.capex.grid_is_estimate ? "*" : ""}`} />
        <Stat label="Year-1 incremental cash flow" value={fmtVnd(o.annual_incremental_cf_y1)} />
        <Stat label={`Simple ROI (${horizon} yr)`} value={o.simple_roi_pct === null ? "n/a" : fmtRoi(o.simple_roi_pct)} tone={o.simple_roi_pct !== null && o.simple_roi_pct < 0 ? "crit" : undefined} />
        <Stat label="Payback" value={fmtYears(o.payback_years, o.payback_note)} />
        <Stat label="NPV" value={fmtVnd(o.npv)} tone={o.npv >= 0 ? "good" : "crit"} />
        <Stat label="IRR" value={o.irr_pct === null ? o.irr_note ?? "n/a" : `${o.irr_pct}%`} />
        <Stat label="VinFast peak wait avg / p90" value={`${fmtWait(o.vinfast_wait.avg)} / ${fmtWait(o.vinfast_wait.p90)}`} />
        <Stat label="Utilization" value={`${Math.round(o.utilization * 100)}%`} />
      </div>
      {o.roi_note && <p className="mt-1 text-3xs text-ink-3">{o.roi_note}</p>}
      <div className="mt-2 border-t border-line pt-2">
        <div className="label mb-1">Capex breakdown</div>
        {Object.entries(o.capex.items).filter(([, v]) => v > 0).map(([k, v]) => <Stat key={k} label={titleCase(k)} value={fmtVnd(v)} />)}
        {o.capex.grid_is_estimate && <p className="text-3xs text-warn">*grid cost is an estimate (grid status not confirmed)</p>}
      </div>
      <div className="mt-2 border-t border-line pt-2">
        <div className="label mb-1">Annual incremental cash flow</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-3xs text-ink-2">
          {o.cash_flows.map((cf, i) => <span key={i}>Y{i + 1} {fmtVnd(cf, false)}</span>)}
        </div>
      </div>
      {o.parties && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="label mb-1">Joint investment split</div>
          {(["operator", "partner_investor"] as const).map((p) => (
            <Stat key={p} label={titleCase(p)} value={`capex ${fmtVnd(o.parties![p].capex)} · ROI ${fmtRoi(o.parties![p].simple_roi_pct)} · NPV ${fmtVnd(o.parties![p].npv)}`} />
          ))}
        </div>
      )}
    </Panel>
  );
}
