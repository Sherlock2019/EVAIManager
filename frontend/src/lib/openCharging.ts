// Vietnam Open Charging & Investment Intelligence: types, shared state and formatting.
// Every figure on these pages is synthetic, simulated or illustrative (see the page banner).
import { useEffect, useState } from "react";
import { create } from "zustand";
import { post } from "./api";
import { C, type Tone } from "./format";

export type Group = "vinfast" | "tesla" | "other";
export type ByGroup<T = number> = Record<Group, T>;
export type ScenarioKey = "A" | "B" | "C";
export const GROUPS: Group[] = ["vinfast", "tesla", "other"];
export const GROUP_LABEL: ByGroup<string> = { vinfast: "VinFast", tesla: "Tesla", other: "Other EV brands" };
export const GROUP_COLOR: ByGroup<string> = { vinfast: C.s1, tesla: C.s2, other: C.s3 };
export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  A: "A · VinFast-only baseline",
  B: "B · Hybrid VinFast + Tesla",
  C: "C · Hybrid VinFast + Tesla + others",
};
export const ACTION_TONE: Record<string, Tone> = {
  "Open selected spare capacity": "good",
  "Upgrade capacity": "info",
  "Develop new hybrid site": "accent",
  "Keep VinFast-only": "idle",
  "Investigate further": "warn",
};
export const DISCLAIMER =
  "Independent simulation. No Tesla, VinFast, or V-Green partnership is announced or implied. Data and prices shown in demo mode are illustrative.";

export interface Assumptions {
  tariff_vinfast: number;
  tariff_tesla: number;
  tariff_other: number;
  vinfast_discount_pct: number;
  vinfast_free_share_pct: number;
  sponsor_reimbursement_vnd_per_kwh: number;
  third_party_session_fee_vnd: number;
  vat_pct: number;
  demand_scale_pct: number;
  kwh_vinfast: number;
  kwh_tesla: number;
  kwh_other: number;
  annual_growth_pct: number;
  assume_unverified_compatible: boolean;
  third_party_peak_cap_pct: number;
  target_vinfast_avg_wait_min: number;
  target_vinfast_p90_wait_min: number;
  energy_cost_vnd_per_kwh: number;
  demand_charge_vnd_per_kw_month: number;
  payment_fee_pct: number;
  maintenance_vnd_per_port_year: number;
  hybrid_platform_opex_vnd_year: number;
  site_owner_share_pct: number;
  capex_scale_pct: number;
  operating_model: "direct" | "roaming" | "joint";
  msp_margin_pct: number;
  partner_capex_share_pct: number;
  partner_cashflow_share_pct: number;
  horizon_years: number;
  discount_rate_pct: number;
  tax_pct: number;
  residual_value_pct: number;
  hybrid_mode: "B" | "C";
}

export interface Wait {
  avg: number | null;
  p90: number | null;
}

export interface Money {
  sessions: ByGroup;
  kwh: ByGroup;
  paid_kwh: ByGroup;
  free_kwh: number;
  driver_revenue: ByGroup;
  discount_value: number;
  sponsor_reimbursement: number;
  msp_margin: number;
  operator_revenue: number;
  vat_collected: number;
  energy_cost: number;
  payment_fees: number;
  site_owner_share: number;
  contribution: number;
  maintenance: number;
  platform_opex: number;
  demand_charges: number;
  operating_profit: number;
}

export interface MonthRow {
  month: number;
  driver_revenue: ByGroup;
  operator_revenue: number;
  contribution: number;
}

export interface ScenarioBlock {
  scenario: ScenarioKey;
  label: string;
  ports: number;
  year1: Money;
  monthly: MonthRow[];
  utilization: number;
  waits: ByGroup<Wait>;
  peak_cap_binding: boolean;
  excluded: Partial<ByGroup<string>>;
  turned_away_per_day: ByGroup;
}

export interface Metrics {
  cash_flows: number[];
  cumulative: number[];
  simple_roi_pct: number | null;
  roi_note: string | null;
  payback_years: number | null;
  payback_note: string | null;
  npv: number;
  irr_pct: number | null;
  irr_note: string | null;
}

export interface Option extends Metrics {
  option: "open_spare" | "add_ports" | "new_site";
  label: string;
  scenario: string;
  ports: number;
  capex: { items: Record<string, number>; total: number; grid_is_estimate: boolean };
  baseline_profit: number[];
  hybrid_profit: number[];
  annual_incremental_cf_y1: number;
  vinfast_wait: Wait;
  utilization: number;
  parties?: { operator: Metrics & { capex: number }; partner_investor: Metrics & { capex: number } };
}

export interface ScoreRow {
  factor: string;
  label: string;
  weight: number;
  value: number | null;
  contribution: number | null;
  missing: boolean;
}

export interface Site {
  site_id: string;
  name: string;
  city: string;
  region: string;
  setting: string;
  lat: number;
  lon: number;
  site_type: "vinfast_only" | "proposed";
  dc_ports: number;
  ac_ports: number;
  port_kw: number;
  grid: "confirmed" | "estimated" | "unknown";
  grid_spare_kw: number | null;
  accessibility: number | null;
  corridor: number;
  add_ports: number;
  compatibility: ByGroup<string>;
  simulated_demand: ByGroup;
  baseline_utilization: number | null;
  baseline_vinfast_wait: Wait | null;
  scenarios: Record<ScenarioKey, ScenarioBlock>;
  options: Record<string, Option>;
  score: { score: number; completeness: number; missing: string[]; breakdown: ScoreRow[] };
  recommendation: { action: string; category: string; category_label: string; option: string | null; reasons: string[]; risks: string[]; next_step: string; narrative: string };
  sensitivity: { driver: string; npv_low: number; npv_high: number; swing: number }[];
  provenance: Record<string, string>;
  labels: string[];
}

export interface PortfolioBlock {
  stations: number;
  ports: number;
  sessions: ByGroup;
  kwh: ByGroup;
  paid_kwh: ByGroup;
  driver_revenue: ByGroup;
  operator_revenue: number;
  contribution: number;
  operating_profit: number;
  monthly: MonthRow[];
  incremental_revenue?: number;
  incremental_contribution?: number;
}

export interface Evaluation {
  disclaimer: string;
  note: string;
  accounting_basis: string;
  sites: Site[];
  portfolio: Record<ScenarioKey, PortfolioBlock>;
}

export interface Meta {
  disclaimer: string;
  assumptions: Assumptions;
  weights: Record<string, number>;
  factor_labels: Record<string, string>;
  queue_policy: QueuePolicy;
  demo_bids: Bid[];
  formulas: Record<string, string>;
}

/* ---------- queue ---------- */
export interface QueuePolicy {
  priority: Record<string, number>;
  anti_starvation_min: number | null;
  reserved_vinfast_ports: number;
  reserve_release_idle_min: number;
  third_party_max_ports: number | null;
  allow_unverified: boolean;
  target_avg_wait_vinfast_min: number;
  target_p90_wait_vinfast_min: number;
}

export interface QueueRow {
  vehicle_id: string;
  group: Group;
  model: string;
  position: number;
  priority: number;
  effective_priority: number;
  promoted: boolean;
  arrive_min: number;
  kwh: number;
  est_start_min: number | null;
  reason: string;
  blocked: string | null;
  compatible_ports: string[];
}

export interface PortState {
  port_id: string;
  status: "free" | "charging" | "offline" | "reserved_idle";
  reserved: boolean;
  vehicle_id: string | null;
  group: Group | null;
  end_min: number | null;
  pending_outage: boolean;
}

export interface Snapshot {
  t: number;
  clock: string;
  queue: QueueRow[];
  ports: PortState[];
  queue_counts: ByGroup;
  events: string[];
}

export interface GroupStats {
  arrived: number;
  served: number;
  absent: number;
  cancelled: number;
  waiting_at_end: number;
  avg_wait: number | null;
  p90_wait: number | null;
  max_wait: number | null;
}

export interface QueueResult {
  note: string;
  start_clock: string;
  step_min: number;
  horizon_min: number;
  ports: { port_id: string; power_kw: number; compat: Record<string, string>; reserved: boolean; offline_from: number | null; offline_to: number | null }[];
  snapshots: Snapshot[];
  log: { t: number; clock: string; type: string; text: string }[];
  stats: ByGroup<GroupStats>;
  alerts: { t: number; clock: string; kind: string; text: string }[];
  wait_method: string;
}

/* ---------- pricing ---------- */
export interface Quote {
  group: Group;
  kwh: number;
  price_per_kwh: number;
  lines: { label: string; amount: number }[];
  total_incl_vat: number;
  vat_included: number;
  total_excl_vat: number;
  vat_pct: number;
  sponsor_pays_excl_vat: number;
  payer: string;
  valid_minutes: number;
  note: string;
}

export interface Bid {
  bid_id: string;
  group: Group;
  max_price_vnd_per_kwh: number;
  kwh: number;
  submitted_min: number;
  expires_min: number | null;
  cancelled: boolean;
}

export interface BidResultRow extends Bid {
  priority: number;
  base_tariff: number;
  accepted: boolean;
  reason: string;
  rank?: number;
  charged_incl_vat: number;
  charged_excl_vat: number;
  impact: string;
}

export interface BidResult {
  bids: BidResultRow[];
  accepted: number;
  slots: number;
  revenue_incl_vat: number;
  revenue_excl_vat: number;
  walk_in_capacity_note: string;
  rules: string;
  note: string;
}

/* ---------- pilot ---------- */
export interface PilotRow {
  site_id: string;
  name: string;
  ports: number;
  sessions: ByGroup;
  third_party_success_rate: number;
  vinfast_wait_baseline: Wait;
  vinfast_wait_pilot: Wait;
  utilization_baseline: number;
  utilization_pilot: number;
  incremental_contribution: number;
  incremental_operating_profit: number;
  investor_cost: number;
  capex: number;
  pilot_run_cost: number;
  investor_return_in_pilot: number;
  verdict: "Expand" | "Modify" | "Stop";
  why: string;
}

/* ---------- shared state ---------- */
export type OcTab = "investment" | "queue" | "pricing" | "revenue" | "roi" | "pilot";

interface OcState {
  defaults: { assumptions: Assumptions; weights: Record<string, number> } | null;
  assumptions: Assumptions | null;
  weights: Record<string, number>;
  siteId: string;
  demoNonce: number;
  init: (a: Assumptions, w: Record<string, number>) => void;
  set: (patch: Partial<Assumptions>) => void;
  setWeight: (k: string, v: number) => void;
  load: (a: Assumptions, w: Record<string, number>) => void;
  selectSite: (id: string) => void;
  loadDemo: () => void;
}

export const DEMO_SITE = "OC-AIR-LTH";

export const useOc = create<OcState>((set, get) => ({
  defaults: null,
  assumptions: null,
  weights: {},
  siteId: DEMO_SITE,
  demoNonce: 0,
  init: (a, w) => {
    if (!get().assumptions) set({ defaults: { assumptions: a, weights: w }, assumptions: a, weights: w });
  },
  set: (patch) => set((s) => ({ assumptions: s.assumptions ? { ...s.assumptions, ...patch } : s.assumptions })),
  setWeight: (k, v) => set((s) => ({ weights: { ...s.weights, [k]: v } })),
  load: (a, w) => set({ assumptions: a, weights: w }),
  selectSite: (id) => set({ siteId: id }),
  loadDemo: () => {
    const d = get().defaults;
    if (d) set({ assumptions: d.assumptions, weights: d.weights, siteId: DEMO_SITE, demoNonce: get().demoNonce + 1 });
  },
}));

/** Re-run the evaluation whenever assumptions or weights change (debounced). */
export function useEvaluation() {
  const assumptions = useOc((s) => s.assumptions);
  const weights = useOc((s) => s.weights);
  const [data, setData] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!assumptions) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setBusy(true);
      post<Evaluation>("/api/open-charging/evaluate", { assumptions, weights })
        .then((d) => !cancelled && (setData(d), setError(null)))
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setBusy(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assumptions, weights]);
  return { data, error, busy };
}

/* ---------- formatting ---------- */
/** VND, compact: 1.25B, 640M, 12K. */
export function fmtVnd(n: number | null | undefined, unit = true): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : a >= 1e4 ? `${(n / 1e3).toFixed(0)}K` : Math.round(n).toLocaleString("en-US");
  return unit ? `${s} ₫` : s;
}

export const fmtPrice = (n: number) => `${Math.round(n).toLocaleString("en-US")} ₫/kWh`;
export const fmtWait = (w: number | null | undefined) => (w === null || w === undefined ? "unbounded" : `${w.toFixed(1)} min`);
export const fmtYears = (y: number | null | undefined, note?: string | null) => (y === null || y === undefined ? note ?? "—" : `${y.toFixed(1)} yr`);
export const fmtRoi = (r: number | null | undefined) => (r === null || r === undefined ? "n/a" : `${r.toFixed(0)}%`);
export const clock = (t: number, start = "08:00") => {
  const [h, m] = start.split(":").map(Number);
  const total = h * 60 + m + Math.round(t);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
