import { Gavel, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, ErrorNote, Panel, Stat } from "../../components/ui";
import { post } from "../../lib/api";
import { GROUPS, GROUP_LABEL, fmtPrice, fmtVnd, type Bid, type BidResult, type Group, type Quote, useOc } from "../../lib/openCharging";
import { Check, GroupBadge, NumField, ProvenanceTags, Select } from "./shared";

const cell = "h-6 w-full rounded border border-line-strong bg-abyss px-1 font-mono text-2xs";

export default function Pricing({ demoBids }: { demoBids: Bid[] }) {
  const assumptions = useOc((s) => s.assumptions)!;
  const demoNonce = useOc((s) => s.demoNonce);
  const [group, setGroup] = useState<Group>("tesla");
  const [kwh, setKwh] = useState(40);
  const [freeEligible, setFreeEligible] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [bids, setBids] = useState<Bid[]>(demoBids);
  const [slots, setSlots] = useState(2);
  const [cap, setCap] = useState(7000);
  const [slotStart, setSlotStart] = useState(60);
  const [result, setResult] = useState<BidResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBids(demoBids);
    setSlots(2);
    setCap(7000);
    setSlotStart(60);
  }, [demoNonce, demoBids]);

  useEffect(() => {
    setAccepted(false);
    post<Quote>("/api/open-charging/quote", { group, kwh, vinfast_free_eligible: freeEligible, assumptions }).then(setQuote).catch((e: Error) => setError(e.message));
  }, [group, kwh, freeEligible, assumptions]);

  useEffect(() => {
    post<BidResult>("/api/open-charging/bids/simulate", { bids, eligible_slots: slots, price_cap_vnd_per_kwh: cap, slot_start_min: slotStart, assumptions })
      .then((r) => (setResult(r), setError(null)))
      .catch((e: Error) => setError(e.message));
  }, [bids, slots, cap, slotStart, assumptions]);

  const editBid = (i: number, p: Partial<Bid>) => setBids((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const addBid = () => setBids((bs) => [...bs, { bid_id: `B${bs.length + 1}`, group: "tesla", max_price_vnd_per_kwh: 5000, kwh: 40, submitted_min: 10, expires_min: null, cancelled: false }]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceTags items={["ILLUSTRATIVE PRICING", "SIMULATION ONLY · NO PAYMENTS"]} />
        <span className="text-2xs text-ink-3">These are not current tariffs of any operator. Changes here flow into the revenue and ROI dashboards.</span>
      </div>
      {error && <ErrorNote message={error} />}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel title="Price scenario" kicker="Default hierarchy: VinFast lowest · Tesla middle · other brands highest (VAT-inclusive, as displayed)">
          <div className="grid gap-3 md:grid-cols-3">
            <NumField label="VinFast tariff" k="tariff_vinfast" unit="₫/kWh" step={100} hint="Enter V-Green's published tariff here by hand to replace the illustrative value" />
            <NumField label="Tesla tariff" k="tariff_tesla" unit="₫/kWh" step={100} />
            <NumField label="Other brands tariff" k="tariff_other" unit="₫/kWh" step={100} />
            <NumField label="VinFast discount" k="vinfast_discount_pct" unit="%" max={100} />
            <NumField label="VinFast free charging (3 years)" k="vinfast_free_share_pct" unit="% of kWh" max={100} hint="VinFast EVs charge free for their first 3 years: share of VinFast kWh from vehicles still in that period" />
            <NumField label="Sponsor reimbursement" k="sponsor_reimbursement_vnd_per_kwh" unit="₫/kWh, 0 = none" step={100} hint="Only counted if a reimbursement agreement is modelled" />
            <NumField label="Third-party session fee" k="third_party_session_fee_vnd" unit="₫" step={1000} />
            <NumField label="VAT" k="vat_pct" unit="%" max={30} />
            <NumField label="Payment processing" k="payment_fee_pct" unit="%" step={0.1} />
          </div>
          {assumptions.tariff_vinfast > assumptions.tariff_tesla || assumptions.tariff_tesla > assumptions.tariff_other ? (
            <p className="mt-2 text-2xs text-warn">Note: prices no longer follow the default VinFast &lt; Tesla &lt; other hierarchy.</p>
          ) : null}
          <p className="mt-2 text-3xs text-ink-3">
            Free charging is never counted as driver revenue. A sponsor or manufacturer pays only when a reimbursement rate is set; otherwise nobody pays and the operator absorbs the energy cost.
          </p>
        </Panel>

        <Panel title="Driver quote (demo mode)" kicker="Transparent fixed price, shown before the driver accepts">
          <div className="flex flex-wrap items-end gap-3">
            <Select value={group} onChange={setGroup} options={GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
            <label className="text-2xs text-ink-2">kWh <input type="number" min={1} max={200} value={kwh} onChange={(e) => setKwh(Number(e.target.value) || 1)} className="ml-1 h-7 w-16 rounded border border-line-strong bg-abyss px-1 font-mono text-xs" /></label>
            {group === "vinfast" && <Check label="Eligible for free charging" checked={freeEligible} onChange={setFreeEligible} />}
          </div>
          {quote && (
            <div className="mt-3 rounded-md border border-line bg-raised p-3">
              {quote.lines.map((l) => <Stat key={l.label} label={l.label} value={fmtVnd(l.amount)} />)}
              <div className="my-1 border-t border-line" />
              <Stat label="Estimated total (VAT incl.)" value={fmtVnd(quote.total_incl_vat)} tone="accent" />
              <Stat label={`of which VAT ${quote.vat_pct}%`} value={fmtVnd(quote.vat_included)} />
              <Stat label="Total excl. VAT" value={fmtVnd(quote.total_excl_vat)} />
              <Stat label="Who pays" value={quote.payer} />
              {quote.sponsor_pays_excl_vat > 0 && <Stat label="Sponsor pays (excl. VAT)" value={fmtVnd(quote.sponsor_pays_excl_vat)} />}
              <Stat label="Price valid for" value={`${quote.valid_minutes} min`} />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="good" onClick={() => setAccepted(true)}>Accept quote (simulated)</Button>
                {accepted && <span className="text-2xs text-good">Accepted in simulation. No payment was made.</span>}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Optional price-bidding simulator (pay-as-bid)"
        kicker="Bids buy a guaranteed future slot on eligible unreserved capacity. A fixed price stays available."
        action={<Button size="sm" onClick={addBid}><Plus size={11} /> Add bid</Button>}
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-end gap-4 border-b border-line px-4 py-2.5 text-2xs">
          <label className="text-ink-2">Eligible slots <input type="number" min={0} max={50} value={slots} onChange={(e) => setSlots(Number(e.target.value))} className="ml-1 h-7 w-14 rounded border border-line-strong bg-abyss px-1 font-mono" /></label>
          <label className="text-ink-2">Slot starts at minute <input type="number" min={0} value={slotStart} onChange={(e) => setSlotStart(Number(e.target.value))} className="ml-1 h-7 w-16 rounded border border-line-strong bg-abyss px-1 font-mono" /></label>
          <label className="text-ink-2">Operator price cap <input type="number" step={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="ml-1 h-7 w-20 rounded border border-line-strong bg-abyss px-1 font-mono" /> ₫/kWh</label>
          {result && <span className="ml-auto text-ink-2"><Gavel size={11} className="mr-1 inline" />{result.accepted}/{result.slots} accepted · {fmtVnd(result.revenue_excl_vat)} excl. VAT · {result.walk_in_capacity_note}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="table-grid w-full text-2xs">
            <thead><tr><th>Bid</th><th>Group</th><th>Max price ₫/kWh</th><th>kWh</th><th>Submitted (min)</th><th>Expires (min)</th><th>Cancelled</th><th>Base tariff</th><th>Result</th><th>Charged (VAT incl.)</th><th>Wait impact</th><th /></tr></thead>
            <tbody>
              {bids.map((b, i) => {
                const r = result?.bids.find((x) => x.bid_id === b.bid_id);
                return (
                  <tr key={b.bid_id}>
                    <td className="num">{b.bid_id}</td>
                    <td>
                      <select value={b.group} onChange={(e) => editBid(i, { group: e.target.value as Group })} className={cell}>
                        {GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                      </select>
                    </td>
                    <td><input type="number" step={100} value={b.max_price_vnd_per_kwh} onChange={(e) => editBid(i, { max_price_vnd_per_kwh: Number(e.target.value) || 1 })} className={cell} /></td>
                    <td><input type="number" value={b.kwh} onChange={(e) => editBid(i, { kwh: Number(e.target.value) || 1 })} className={cell} /></td>
                    <td><input type="number" value={b.submitted_min} onChange={(e) => editBid(i, { submitted_min: Number(e.target.value) })} className={cell} /></td>
                    <td><input type="number" value={b.expires_min ?? ""} placeholder="none" onChange={(e) => editBid(i, { expires_min: e.target.value === "" ? null : Number(e.target.value) })} className={cell} /></td>
                    <td><input type="checkbox" checked={b.cancelled} onChange={(e) => editBid(i, { cancelled: e.target.checked })} /></td>
                    <td className="num">{r ? fmtPrice(r.base_tariff) : "—"}</td>
                    <td>{r && <div className="flex items-start gap-1.5"><Badge tone={r.accepted ? "good" : "idle"}>{r.accepted ? "accepted" : "rejected"}</Badge><span className="text-ink-2">{r.reason}</span></div>}</td>
                    <td className="num">{r?.accepted ? fmtVnd(r.charged_incl_vat) : "—"}</td>
                    <td className="text-ink-3">{r?.impact}</td>
                    <td><button onClick={() => setBids((bs) => bs.filter((_, j) => j !== i))} className="text-ink-3 hover:text-crit" aria-label={`Remove ${b.bid_id}`}><Trash2 size={12} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-1 border-t border-line px-4 py-2 text-3xs text-ink-3">
          <div>{result?.rules} Tie-breaker: earliest submission, then bid id. A bid below the published fixed price or above the operator cap is rejected. No capacity → nothing accepted, nothing charged.</div>
          <div>Bid outcomes are not added to the revenue dashboard: it reflects completed simulated sessions only. {result?.note}</div>
          <div className="flex flex-wrap gap-2">{GROUPS.map((g) => <GroupBadge key={g} group={g}>{GROUP_LABEL[g]} · P{g === "vinfast" ? 1 : g === "tesla" ? 2 : 3}</GroupBadge>)}</div>
        </div>
      </Panel>
    </div>
  );
}
