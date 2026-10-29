import { FolderOpen, Play, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, ErrorNote, Loading, PageHeader, Tabs } from "../components/ui";
import { api, post, useApi } from "../lib/api";
import { type Assumptions, type Meta, type OcTab, useEvaluation, useOc } from "../lib/openCharging";
import Investment from "./open-charging/Investment";
import Pilot from "./open-charging/Pilot";
import Pricing from "./open-charging/Pricing";
import Queue from "./open-charging/Queue";
import Revenue from "./open-charging/Revenue";
import Roi from "./open-charging/Roi";
import { Banner } from "./open-charging/shared";

const TABS: { value: OcTab; label: string }[] = [
  { value: "investment", label: "Investment Opportunities" },
  { value: "queue", label: "Priority Queue" },
  { value: "pricing", label: "Pricing & Bids" },
  { value: "revenue", label: "Revenue Dashboard" },
  { value: "roi", label: "ROI & Comparison" },
  { value: "pilot", label: "Pilot Simulator" },
];

interface Saved {
  scenario_id: string;
  name: string;
  created_at: string;
  assumptions: Assumptions;
  weights: Record<string, number>;
}

export default function OpenCharging() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "investment") as OcTab;
  const goto = (t: OcTab) => setParams({ tab: t });

  const meta = useApi<Meta>("/api/open-charging/meta");
  const init = useOc((s) => s.init);
  const loadDemo = useOc((s) => s.loadDemo);
  const load = useOc((s) => s.load);
  const assumptions = useOc((s) => s.assumptions);
  const weights = useOc((s) => s.weights);
  const ev = useEvaluation();
  const [saved, setSaved] = useState<Saved[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (meta.data) init(meta.data.assumptions, meta.data.weights);
  }, [meta.data, init]);
  useEffect(() => {
    api<Saved[]>("/api/open-charging/scenarios").then(setSaved).catch(() => setSaved([]));
  }, []);

  const save = () => {
    const name = window.prompt("Name this assumption set", `Scenario ${saved.length + 1}`);
    if (!name || !assumptions) return;
    post<Saved>("/api/open-charging/scenarios", { name, assumptions, weights })
      .then((s) => {
        setSaved((xs) => [...xs, s]);
        setNote(`Saved "${s.name}" (${s.scenario_id})`);
      })
      .catch((e: Error) => setNote(`Save failed: ${e.message}`));
  };

  const runDemo = () => {
    loadDemo();
    setNote("Demo scenario loaded: seeded synthetic sites, default illustrative prices and policy. Long Thanh International Airport selected.");
    goto("investment");
  };

  return (
    <div>
      <PageHeader
        kicker="Energy · Charging · Proposal"
        title="Vietnam Open Charging & Investment Intelligence"
        description="Find the best locations, protect VinFast drivers, and evaluate the business case for shared EV charging with Tesla and other EV brands."
      >
        <Link to="/energy/charging" className="text-2xs text-ink-3 underline-offset-2 hover:text-ink hover:underline">← Charging Network</Link>
        {saved.length > 0 && (
          <label className="inline-flex items-center gap-1.5 text-2xs text-ink-2">
            <FolderOpen size={12} />
            <select
              defaultValue=""
              onChange={(e) => {
                const s = saved.find((x) => x.scenario_id === e.target.value);
                if (s) (load(s.assumptions, s.weights), setNote(`Loaded "${s.name}"`));
              }}
              className="h-7 rounded border border-line-strong bg-abyss px-1 text-2xs"
            >
              <option value="" disabled>Saved scenarios</option>
              {saved.map((s) => <option key={s.scenario_id} value={s.scenario_id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <Button onClick={save} disabled={!assumptions}><Save size={13} /> Save scenario</Button>
        <Button variant="primary" onClick={runDemo} disabled={!meta.data}><Play size={13} fill="currentColor" /> Load Demo Scenario</Button>
      </PageHeader>

      <Banner />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="max-w-full overflow-x-auto"><Tabs value={tab} onChange={goto} options={TABS} /></div>
        {(note || ev.busy) && <span className="text-2xs text-ink-3">{ev.busy ? "Recalculating…" : note}</span>}
      </div>

      {(meta.error || ev.error) && <ErrorNote message={meta.error ?? ev.error ?? ""} />}
      {!meta.data || !ev.data ? (
        <Loading label="Building synthetic scenario…" />
      ) : (
        <>
          {tab === "investment" && <Investment ev={ev.data} goto={goto} />}
          {tab === "queue" && <Queue defaults={meta.data.queue_policy} />}
          {tab === "pricing" && <Pricing demoBids={meta.data.demo_bids} />}
          {tab === "revenue" && <Revenue ev={ev.data} />}
          {tab === "roi" && <Roi ev={ev.data} formulas={meta.data.formulas} />}
          {tab === "pilot" && <Pilot ev={ev.data} />}
        </>
      )}
    </div>
  );
}
