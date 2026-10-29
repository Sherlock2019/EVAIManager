import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, ChartTooltip, Legend, Panel, Tabs, axisProps, gridProps } from "../../components/ui";
import { C } from "../../lib/format";
import { GROUPS, GROUP_COLOR, GROUP_LABEL, SCENARIO_LABEL, fmtVnd, fmtWait, type Evaluation, type Group, type Money, type ScenarioKey, type Site, useOc } from "../../lib/openCharging";
import { ProvenanceTags, REGIONS, Select, type Region } from "./shared";

const KEYS: ScenarioKey[] = ["A", "B", "C"];
const PERIODS = { y1: { label: "Year 1", months: [1, 12] }, h1: { label: "H1", months: [1, 6] }, h2: { label: "H2", months: [7, 12] }, q4: { label: "Q4", months: [10, 12] } } as const;
type Period = keyof typeof PERIODS;

function sumMoney(sites: Site[], k: ScenarioKey): Money & { stations: number; ports: number } {
  const z = () => ({ vinfast: 0, tesla: 0, other: 0 });
  const acc = { stations: 0, ports: 0, sessions: z(), kwh: z(), paid_kwh: z(), driver_revenue: z(), free_kwh: 0, discount_value: 0, sponsor_reimbursement: 0, msp_margin: 0, operator_revenue: 0, vat_collected: 0, energy_cost: 0, payment_fees: 0, site_owner_share: 0, contribution: 0, maintenance: 0, platform_opex: 0, demand_charges: 0, operating_profit: 0 };
  for (const s of sites) {
    const y = s.scenarios[k].year1;
    acc.stations += 1;
    acc.ports += s.scenarios[k].ports;
    for (const key of Object.keys(y) as (keyof Money)[]) {
      const v = y[key];
      if (typeof v === "number") (acc[key] as number) += v;
      else for (const g of GROUPS) (acc[key] as Record<Group, number>)[g] += v[g];
    }
  }
  return acc;
}

const ROWS: { label: string; get: (m: Money) => number; cost?: boolean }[] = [
  ...GROUPS.map((g) => ({ label: `Driver revenue · ${GROUP_LABEL[g]}`, get: (m: Money) => m.driver_revenue[g] })),
  { label: "Sponsor reimbursement (only if configured)", get: (m) => m.sponsor_reimbursement },
  { label: "Mobility-provider margin (roaming, not operator revenue)", get: (m) => -m.msp_margin, cost: true },
  { label: "Total operator charging revenue", get: (m) => m.operator_revenue },
  { label: "Electricity cost", get: (m) => -m.energy_cost, cost: true },
  { label: "Payment processing fees", get: (m) => -m.payment_fees, cost: true },
  { label: "Site-owner / franchise share", get: (m) => -m.site_owner_share, cost: true },
  { label: "Contribution margin", get: (m) => m.contribution },
  { label: "Maintenance", get: (m) => -m.maintenance, cost: true },
  { label: "Hybrid platform opex", get: (m) => -m.platform_opex, cost: true },
  { label: "Demand charges", get: (m) => -m.demand_charges, cost: true },
  { label: "Operating profit", get: (m) => m.operating_profit },
  { label: "Memo: free / discounted value given (not revenue)", get: (m) => m.discount_value },
  { label: "Memo: VAT collected (pass-through)", get: (m) => m.vat_collected },
];

export default function Revenue({ ev }: { ev: Evaluation }) {
  const assumptions = useOc((s) => s.assumptions)!;
  const set = useOc((s) => s.set);
  const [region, setRegion] = useState<Region>("All");
  const [siteId, setSiteId] = useState("all");
  const [power, setPower] = useState("all");
  const [group, setGroup] = useState<"all" | Group>("all");
  const [scen, setScen] = useState<ScenarioKey>("C");
  const [period, setPeriod] = useState<Period>("y1");

  const sites = useMemo(
    () => ev.sites.filter((s) => (region === "All" || s.region === region) && (siteId === "all" || s.site_id === siteId) && (power === "all" || String(s.port_kw) === power)),
    [ev.sites, region, siteId, power],
  );
  const totals = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, sumMoney(sites, k)])) as Record<ScenarioKey, ReturnType<typeof sumMoney>>, [sites]);
  const groups = group === "all" ? GROUPS : [group];
  const [m0, m1] = PERIODS[period].months;

  const monthly = useMemo(() => {
    const rows = Array.from({ length: m1 - m0 + 1 }, (_, i) => ({ month: `M${m0 + i}`, vinfast: 0, tesla: 0, other: 0 }));
    for (const s of sites)
      for (const m of s.scenarios[scen].monthly)
        if (m.month >= m0 && m.month <= m1) for (const g of GROUPS) rows[m.month - m0][g] += m.driver_revenue[g] / 1e6;
    return rows;
  }, [sites, scen, m0, m1]);

  const periodRevenue = (k: ScenarioKey) =>
    sites.reduce((a, s) => a + s.scenarios[k].monthly.filter((m) => m.month >= m0 && m.month <= m1).reduce((b, m) => b + groups.reduce((c, g) => c + m.driver_revenue[g], 0), 0), 0);

  const bySite = useMemo(
    () =>
      sites
        .map((s) => ({ name: s.name.length > 22 ? `${s.name.slice(0, 21)}…` : s.name, A: s.scenarios.A.year1.contribution / 1e6, [scen]: s.scenarios[scen].year1.contribution / 1e6, inc: (s.scenarios[scen].year1.contribution - s.scenarios.A.year1.contribution) / 1e6 }))
        .sort((a, b) => b.inc - a.inc)
        .slice(0, 10),
    [sites, scen],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={region} onChange={(r) => { setRegion(r); setSiteId("all"); }} options={REGIONS.map((r) => ({ value: r, label: r }))} />
        <Select label="Station" value={siteId} onChange={setSiteId} options={[{ value: "all", label: "All stations (portfolio)" }, ...ev.sites.filter((s) => region === "All" || s.region === region).map((s) => ({ value: s.site_id, label: s.name }))]} />
        <Select label="Charger" value={power} onChange={setPower} options={[{ value: "all", label: "All DC" }, { value: "60", label: "60 kW sites" }, { value: "120", label: "120 kW sites" }]} />
        <Select label="Brand" value={group} onChange={setGroup} options={[{ value: "all", label: "All brands" }, ...GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] }))]} />
        <Select label="Period" value={period} onChange={setPeriod} options={Object.entries(PERIODS).map(([k, v]) => ({ value: k as Period, label: v.label }))} />
        <Select label="Operating model" value={assumptions.operating_model} onChange={(v) => set({ operating_model: v })} options={[{ value: "direct", label: "Direct payment to operator" }, { value: "roaming", label: "Roaming (mobility provider)" }, { value: "joint", label: "Joint investment" }]} />
        <Badge tone="warn">Data: simulated only · no actual data connected</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceTags items={["SIMULATED SESSIONS", "ILLUSTRATIVE PRICING", "ESTIMATED FINANCIAL RESULTS"]} />
        <span className="text-2xs text-ink-3">{ev.accounting_basis} Charging revenue belongs to the operator; Tesla earns no charging revenue; site-owner share is {assumptions.site_owner_share_pct}%.</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {KEYS.map((k) => {
          const t = totals[k];
          const inc = k === "A" ? null : t.operator_revenue - totals.A.operator_revenue;
          const incC = k === "A" ? null : t.contribution - totals.A.contribution;
          const waits = sites.map((s) => s.scenarios[k].waits.vinfast.avg).filter((w): w is number => w !== null);
          return (
            <Panel key={k} title={SCENARIO_LABEL[k]} kicker={`${t.stations} stations · ${t.ports} DC ports`} className={k === scen ? "ring-1 ring-accent/50" : undefined}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Kv l="Sessions (yr 1)" v={Math.round(groups.reduce((a, g) => a + t.sessions[g], 0)).toLocaleString("en-US")} />
                <Kv l="kWh delivered" v={`${(groups.reduce((a, g) => a + t.kwh[g], 0) / 1e6).toFixed(2)} GWh`} />
                <Kv l={`Driver revenue · ${PERIODS[period].label}`} v={fmtVnd(periodRevenue(k))} />
                <Kv l="Operator revenue (yr 1)" v={fmtVnd(t.operator_revenue)} />
                <Kv l="Contribution margin" v={fmtVnd(t.contribution)} />
                <Kv l="Operating profit" v={fmtVnd(t.operating_profit)} tone={t.operating_profit >= 0 ? C.good : C.crit} />
                <Kv l="Free / discounted kWh" v={`${(t.free_kwh / 1e3).toFixed(0)} MWh`} />
                <Kv l="Avg VinFast peak wait (sites)" v={waits.length ? fmtWait(waits.reduce((a, b) => a + b, 0) / waits.length) : "unbounded"} />
                {inc !== null && <Kv l="Incremental revenue vs A" v={fmtVnd(inc)} tone={C.good} />}
                {incC !== null && <Kv l="Incremental contribution vs A" v={fmtVnd(incC)} tone={incC >= 0 ? C.good : C.crit} />}
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Monthly driver revenue by vehicle group" kicker={`Scenario ${scen} · M VND excl. VAT · third-party demand ramps up over 6 months`} action={<Tabs value={scen} onChange={setScen} options={KEYS.map((k) => ({ value: k, label: k }))} />}>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} width={44} />
                <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(0)}M ₫`} />} cursor={{ fill: "#ffffff08" }} />
                {groups.map((g) => <Bar key={g} dataKey={g} name={GROUP_LABEL[g]} stackId="r" fill={GROUP_COLOR[g]} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2"><Legend items={groups.map((g) => ({ label: GROUP_LABEL[g], color: GROUP_COLOR[g], shape: "square" as const }))} /></div>
        </Panel>
        <Panel title="Baseline vs hybrid contribution · top sites by increment" kicker={`Year 1 · M VND · A vs ${scen}`}>
          <div className="h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySite} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} />
                <YAxis type="category" dataKey="name" {...axisProps} width={150} />
                <Tooltip content={<ChartTooltip format={(v) => `${v.toFixed(0)}M ₫`} />} cursor={{ fill: "#ffffff08" }} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="A" name="A · VinFast-only" fill={C.prev} />
                <Bar dataKey={scen} name={`${scen} · hybrid`} fill={C.s1} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Revenue and cost breakdown" kicker="Year 1 · VND excl. VAT · operator view" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table-grid w-full text-2xs">
              <thead><tr><th>Line</th>{KEYS.map((k) => <th key={k} className="text-right">{k}</th>)}<th className="text-right">C − A</th></tr></thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className={/Total|Contribution|Operating/.test(r.label) ? "font-medium" : undefined}>
                    <td className={r.cost ? "text-ink-3" : undefined}>{r.label}</td>
                    {KEYS.map((k) => <td key={k} className="num text-right">{fmtVnd(r.get(totals[k]), false)}</td>)}
                    <td className="num text-right">{fmtVnd(r.get(totals.C) - r.get(totals.A), false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Station comparison" kicker={`Scenario ${scen} · utilization and peak waits`} bodyClassName="p-0">
          <div className="max-h-[440px] overflow-auto">
            <table className="table-grid w-full text-2xs">
              <thead><tr><th>Station</th><th>Util. A → {scen}</th>{GROUPS.map((g) => <th key={g}>{GROUP_LABEL[g].split(" ")[0]} wait</th>)}</tr></thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.site_id}>
                    <td>{s.name}</td>
                    <td className="num">{Math.round(s.scenarios.A.utilization * 100)}% → {Math.round(s.scenarios[scen].utilization * 100)}%</td>
                    {GROUPS.map((g) => {
                      const on = scen === "C" || (scen === "B" && g !== "other") || g === "vinfast";
                      return <td key={g} className="num" style={{ color: GROUP_COLOR[g] }}>{on ? fmtWait(s.scenarios[scen].waits[g].avg) : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Kv({ l, v, tone }: { l: string; v: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="label truncate">{l}</div>
      <div className="num mt-0.5 text-sm" style={tone ? { color: tone } : undefined}>{v}</div>
    </div>
  );
}
