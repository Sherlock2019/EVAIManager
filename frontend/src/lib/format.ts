import type { Risk } from "./types";

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtPct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const fmtUsd = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`);

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return fmtInt(n);
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Status palette — reserved for state, never used as a chart series colour. */
export const C = {
  accent: "#3BC9F5",
  good: "#22C55E",
  warn: "#FAB219",
  serious: "#EC835A",
  crit: "#EF4444",
  info: "#3987E5",
  idle: "#6B7A90",
  ink: "#E8EEF7",
  ink2: "#A3B2C7",
  ink3: "#64748B",
  line: "#18212F",
  panel: "#0A0F17",
  // chart series (categorical, fixed order)
  s1: "#3987E5",
  s2: "#D95926",
  s3: "#199E70",
  s4: "#C98500",
  prev: "#55657D", // de-emphasised "previous version" series
} as const;

export type Tone = "good" | "warn" | "serious" | "crit" | "info" | "idle" | "accent";

export const riskTone: Record<Risk, Tone> = { LOW: "good", MEDIUM: "warn", HIGH: "serious", CRITICAL: "crit" };

/** index = backend status code */
export const VEHICLE_STATUS = [
  { key: "healthy", label: "Healthy", color: C.good },
  { key: "charging", label: "Charging", color: C.info },
  { key: "warning", label: "Maintenance warning", color: C.warn },
  { key: "critical", label: "Critical", color: C.crit },
  { key: "offline", label: "Offline", color: C.idle },
] as const;

export const CHARGER_STATUS: Record<string, { label: string; color: string }> = {
  normal: { label: "Normal capacity", color: C.good },
  high: { label: "High usage", color: C.warn },
  overloaded: { label: "Overloaded", color: C.crit },
  low: { label: "Low utilization", color: C.idle },
  recommended: { label: "Recommended new site", color: C.info },
};

export function confidenceTone(c: number): Tone {
  if (c >= 0.9) return "good";
  if (c >= 0.7) return "warn";
  return "crit";
}

export const toneColor: Record<Tone, string> = {
  good: C.good,
  warn: C.warn,
  serious: C.serious,
  crit: C.crit,
  info: C.info,
  idle: C.idle,
  accent: C.accent,
};
