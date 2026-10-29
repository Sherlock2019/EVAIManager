import clsx from "clsx";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, MockTag } from "../../components/ui";
import { DISCLAIMER, GROUP_COLOR, GROUP_LABEL, type Assumptions, type Group, type Site, useOc } from "../../lib/openCharging";

/** Persistent disclaimer shown on every tab. */
export function Banner() {
  return (
    <div role="note" className="mb-3 flex items-start gap-2.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
      <ShieldAlert size={14} className="mt-px shrink-0" />
      <span>
        <b>{DISCLAIMER}</b> Brand priority, pricing and bidding are proposals that would need partner agreement, contractual and legal review before any real deployment.
      </span>
    </div>
  );
}

export function ProvenanceTags({ items = ["SYNTHETIC SITE", "SIMULATED DEMAND", "ILLUSTRATIVE PRICING", "ESTIMATED FINANCIAL RESULTS"] }: { items?: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => (
        <MockTag key={t}>{t}</MockTag>
      ))}
    </div>
  );
}

export function GroupBadge({ group, children }: { group: Group; children?: ReactNode }) {
  const color = GROUP_COLOR[group];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-3xs font-medium uppercase tracking-wider"
      style={{ background: `${color}1F`, color, boxShadow: `inset 0 0 0 1px ${color}55` }}
    >
      {children ?? GROUP_LABEL[group]}
    </span>
  );
}

export function CompatBadge({ status }: { status: string }) {
  return <Badge tone={status === "confirmed" ? "good" : status === "unverified" ? "warn" : "crit"}>{status}</Badge>;
}

/** Number input bound to one assumption. */
export function NumField({ label, k, unit, step = 1, min = 0, max, hint }: { label: string; k: keyof Assumptions; unit?: string; step?: number; min?: number; max?: number; hint?: string }) {
  const value = useOc((s) => s.assumptions?.[k]);
  const set = useOc((s) => s.set);
  return (
    <label className="block min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-2xs text-ink-2" title={hint}>{label}</span>
        {unit && <span className="shrink-0 font-mono text-3xs text-ink-3">{unit}</span>}
      </div>
      <input
        type="number"
        className="h-7 w-full rounded border border-line-strong bg-abyss px-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        value={typeof value === "number" ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) set({ [k]: n } as Partial<Assumptions>);
        }}
      />
    </label>
  );
}

export function Check({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-2xs text-ink-2" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#3BC9F5]" />
      {label}
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string; className?: string }) {
  return (
    <label className={clsx("inline-flex items-center gap-2", className)}>
      {label && <span className="label">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-7 max-w-full rounded border border-line-strong bg-abyss px-2 text-xs text-ink focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SiteSelect({ sites, filter }: { sites: Site[]; filter?: (s: Site) => boolean }) {
  const siteId = useOc((s) => s.siteId);
  const select = useOc((s) => s.selectSite);
  const list = filter ? sites.filter(filter) : sites;
  return <Select label="Site" value={siteId} onChange={select} options={list.map((s) => ({ value: s.site_id, label: `${s.name} · ${s.region}` }))} />;
}

export const REGIONS = ["All", "HCMC", "Hanoi", "Corridor", "Airports"] as const;
export type Region = (typeof REGIONS)[number];
