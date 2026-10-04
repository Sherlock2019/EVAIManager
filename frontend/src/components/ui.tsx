import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { toneColor, type Tone } from "../lib/format";

/* ---------- Panel ---------- */
export function Panel({
  title,
  kicker,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  kicker?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("panel flex min-w-0 flex-col", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {kicker && <div className="label mb-0.5">{kicker}</div>}
            <h2 className="truncate text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={clsx("min-h-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ kicker, title, description, children }: { kicker: string; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="label text-accent">{kicker}</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* ---------- Status dot / badge ---------- */
export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span
      className={clsx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", pulse && "animate-pulse-dot", className)}
      style={{ background: toneColor[tone], boxShadow: `0 0 0 3px ${toneColor[tone]}22` }}
    />
  );
}

export function Badge({ tone = "idle", children, solid, className }: { tone?: Tone; children: ReactNode; solid?: boolean; className?: string }) {
  const color = toneColor[tone];
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-3xs font-medium uppercase tracking-wider", className)}
      style={solid ? { background: color, color: "#05080D" } : { background: `${color}1A`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      {children}
    </span>
  );
}

export function MockTag({ children = "Mock demo data" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-line-strong px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wider text-ink-3">
      {children}
    </span>
  );
}

/* ---------- Button ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" | "good"; size?: "sm" | "md" };

export function Button({ variant = "outline", size = "md", className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-2xs" : "h-8 px-3 text-xs",
        variant === "primary" && "bg-accent text-abyss hover:bg-[#6bd8f8]",
        variant === "outline" && "border border-line-strong bg-raised text-ink-2 hover:border-ink-3 hover:text-ink",
        variant === "ghost" && "text-ink-2 hover:bg-raised hover:text-ink",
        variant === "danger" && "border border-crit/50 bg-crit/10 text-crit hover:bg-crit/20",
        variant === "good" && "border border-good/50 bg-good/10 text-good hover:bg-good/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------- KPI tile ---------- */
export function Kpi({
  label,
  value,
  unit,
  sub,
  tone,
  icon,
  spark,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  spark?: number[];
}) {
  return (
    <div className="panel relative overflow-hidden px-3.5 py-3">
      {tone && <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: toneColor[tone] }} />}
      <div className="flex items-center justify-between gap-2">
        <span className="label truncate">{label}</span>
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="num text-[22px] font-medium leading-none text-ink">{value}</span>
          {unit && <span className="num text-xs text-ink-3">{unit}</span>}
        </div>
        {spark && <Sparkline data={spark} color={tone ? toneColor[tone] : "#3BC9F5"} width={64} height={22} />}
      </div>
      {sub && <div className="mt-1.5 truncate text-2xs text-ink-3">{sub}</div>}
    </div>
  );
}

/* ---------- Sparkline ---------- */
export function Sparkline({ data, color = "#3BC9F5", width = 80, height = 24, fill = true }: { data: number[]; color?: string; width?: number; height?: number; fill?: boolean }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((d, i) => [(i / (data.length - 1)) * (width - 2) + 1, height - 2 - ((d - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      {fill && <path d={`${line} L${width - 1},${height} L1,${height} Z`} fill={color} opacity={0.12} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2} fill={color} />
    </svg>
  );
}

/* ---------- Meter (horizontal bar) ---------- */
export function Meter({ value, max = 1, tone = "accent", height = 4, marker }: { value: number; max?: number; tone?: Tone; height?: number; marker?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-line" style={{ height }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: toneColor[tone] }} />
      {marker !== undefined && <span className="absolute inset-y-0 w-px bg-ink-2" style={{ left: `${(marker / max) * 100}%` }} />}
    </div>
  );
}

/* ---------- Ring gauge ---------- */
export function Ring({ value, size = 96, stroke = 7, tone = "accent", label, sub }: { value: number; size?: number; stroke?: number; tone?: Tone; label: ReactNode; sub?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = 0.75; // 270° instrument sweep
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[135deg]">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#18212F" strokeWidth={stroke} strokeDasharray={`${c * arc} ${c}`} strokeLinecap="round" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={toneColor[tone]}
          strokeWidth={stroke}
          strokeDasharray={`${c * arc * Math.max(0, Math.min(1, value))} ${c}`}
          strokeLinecap="round"
          className="transition-[stroke-dasharray] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-xl font-medium leading-none text-ink">{label}</span>
        {sub && <span className="label mt-1">{sub}</span>}
      </div>
    </div>
  );
}

/* ---------- Tabs ---------- */
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-abyss p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded px-2.5 py-1 text-2xs font-medium transition-colors",
            value === o.value ? "bg-raised text-ink shadow-[inset_0_0_0_1px_#263347]" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Key/value row ---------- */
export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-2xs text-ink-3">{label}</span>
      <span className="num text-xs text-ink" style={tone ? { color: toneColor[tone] } : undefined}>
        {value}
      </span>
    </div>
  );
}

/* ---------- Stacked field (label above value) ---------- */
export function Field({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="num mt-0.5 truncate text-xs text-ink" style={tone ? { color: toneColor[tone] } : undefined}>
        {value}
      </div>
    </div>
  );
}

/* ---------- Loading / error ---------- */
export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex h-full min-h-[120px] items-center justify-center gap-2 text-2xs text-ink-3", className)}>
      <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
      <span className="label">{label}</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit">
      Could not load data: {message}. Is the backend running on :8000?
    </div>
  );
}

/* ---------- Slider ---------- */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  baseline,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
  baseline?: number;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-2xs text-ink-2">{label}</span>
        <span className="num text-xs text-ink">
          {unit === "+%" ? `+${value}%` : `${value}${unit}`}
          {baseline !== undefined && value !== baseline && <span className="ml-1.5 text-3xs text-ink-3">base {baseline}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ ["--fill" as string]: `${fill}%` }}
      />
    </label>
  );
}

/* ---------- Chart tooltip shared by all Recharts charts ---------- */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
  format?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-strong bg-raised px-2.5 py-2 shadow-xl">
      {label !== undefined && <div className="label mb-1">{label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-2xs">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="num ml-auto pl-3 text-ink">{typeof p.value === "number" && format ? format(p.value, String(p.name)) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export const axisProps = {
  tick: { fill: "#64748B", fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
  axisLine: { stroke: "#263347" },
  tickLine: false as const,
};
export const gridProps = { stroke: "#18212F", strokeDasharray: "0", vertical: false as const };

/* ---------- Legend ---------- */
export function Legend({ items }: { items: { label: string; color: string; shape?: "dot" | "square" | "line" | "diamond" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-2xs text-ink-2">
          <span
            className={clsx(
              "inline-block",
              i.shape === "line" ? "h-0.5 w-3.5" : "h-2 w-2",
              (i.shape ?? "dot") === "dot" && "rounded-full",
              i.shape === "square" && "rounded-sm",
              i.shape === "diamond" && "rotate-45 rounded-[1px]",
            )}
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}
