import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { Badge, Button, ErrorNote, Panel, Slider, Tabs } from "../../components/ui";
import { post } from "../../lib/api";
import { C } from "../../lib/format";
import { fmtVnd, fmtWait, type Evaluation, type PilotRow, useOc } from "../../lib/openCharging";
import { Check, ProvenanceTags } from "./shared";

const VERDICT_TONE = { Expand: "good", Modify: "warn", Stop: "crit" } as const;

export default function Pilot({ ev }: { ev: Evaluation }) {
  const assumptions = useOc((s) => s.assumptions)!;
  const existing = ev.sites.filter((s) => s.site_type !== "proposed");
  const [ids, setIds] = useState<string[]>(["OC-HCM-01", "OC-AIR-HAN", "OC-HCM-02"]);
  const [weeks, setWeeks] = useState(12);
  const [scenario, setScenario] = useState<"B" | "C">("C");
  const [minSuccess, setMinSuccess] = useState(80);
  const [rows, setRows] = useState<PilotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    post<{ sites: PilotRow[] }>("/api/open-charging/pilot", { site_ids: ids, weeks, scenario, min_success_rate: minSuccess / 100, assumptions })
      .then((r) => (setRows(r.sites), setError(null)))
      .catch((e: Error) => setError(e.message));

  const total = rows && {
    cost: rows.reduce((a, r) => a + r.investor_cost, 0),
    ret: rows.reduce((a, r) => a + r.investor_return_in_pilot, 0),
    inc: rows.reduce((a, r) => a + r.incremental_contribution, 0),
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceTags items={["SIMULATED PILOT", "SYNTHETIC SITES", "PARTNER ASSUMPTIONS"]} />
        <span className="text-2xs text-ink-3">Pilot uses spare capacity at existing sites only: no new ports. Pricing, priority and compatibility come from the other tabs.</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel title="Pilot set-up" kicker="Workflow D">
          <div className="label mb-1">Pilot sites (existing, synthetic)</div>
          <div className="space-y-1">
            {existing.map((s) => (
              <Check key={s.site_id} label={<span>{s.name} <span className="text-ink-3">· {s.region}</span></span>} checked={ids.includes(s.site_id)} onChange={(v) => setIds((xs) => (v ? [...xs, s.site_id] : xs.filter((x) => x !== s.site_id)))} />
            ))}
          </div>
          <div className="mt-3 space-y-3">
            <Slider label="Pilot period" unit=" weeks" min={2} max={52} value={weeks} onChange={setWeeks} />
            <div>
              <div className="label mb-1">Partner groups admitted</div>
              <Tabs value={scenario} onChange={setScenario} options={[{ value: "B", label: "B · Tesla" }, { value: "C", label: "C · Tesla + others" }]} />
            </div>
            <Slider label="Minimum third-party session success" unit="%" min={50} max={100} value={minSuccess} onChange={setMinSuccess} />
            <Button variant="primary" onClick={run} disabled={ids.length === 0}><FlaskConical size={13} /> Run pilot simulation</Button>
          </div>
        </Panel>

        <div className="space-y-3">
          {error && <ErrorNote message={error} />}
          {!rows && <Panel><p className="py-8 text-center text-xs text-ink-3">Pick sites and press Run pilot simulation.</p></Panel>}
          {rows && total && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Panel><div className="label">Investor cost (capex + pilot running)</div><div className="num mt-1 text-xl">{fmtVnd(total.cost)}</div></Panel>
                <Panel><div className="label">Incremental contribution in pilot</div><div className="num mt-1 text-xl">{fmtVnd(total.inc)}</div></Panel>
                <Panel><div className="label">Return in pilot after running cost</div><div className="num mt-1 text-xl" style={{ color: total.ret >= 0 ? C.good : C.crit }}>{fmtVnd(total.ret)}</div><div className="text-3xs text-ink-3">capex is recovered after the pilot, not within it</div></Panel>
              </div>
              <Panel title="Pilot results" kicker={`${weeks} weeks · scenario ${scenario}`} bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="table-grid w-full text-2xs">
                    <thead><tr><th>Site</th><th>Verdict</th><th>3rd-party success</th><th>VinFast wait base → pilot</th><th>Utilization</th><th>Sessions T / O</th><th>Incr. contribution</th><th>Investor cost</th><th>Why</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.site_id}>
                          <td className="font-medium">{r.name}</td>
                          <td><Badge tone={VERDICT_TONE[r.verdict]}>{r.verdict}</Badge></td>
                          <td className="num">{Math.round(r.third_party_success_rate * 100)}%</td>
                          <td className="num">{fmtWait(r.vinfast_wait_baseline.avg)} → {fmtWait(r.vinfast_wait_pilot.avg)}</td>
                          <td className="num">{Math.round(r.utilization_baseline * 100)}% → {Math.round(r.utilization_pilot * 100)}%</td>
                          <td className="num">{Math.round(r.sessions.tesla)} / {Math.round(r.sessions.other)}</td>
                          <td className="num">{fmtVnd(r.incremental_contribution)}</td>
                          <td className="num">{fmtVnd(r.investor_cost)}</td>
                          <td className="text-ink-2">{r.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <p className="text-3xs text-ink-3">Expand = VinFast wait within target, sessions succeed, contribution covers running cost · Modify = adjust tariffs, caps or compatibility · Stop = VinFast experience at risk.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
