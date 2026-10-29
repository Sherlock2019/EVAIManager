// Proposed hybrid VinFast + Tesla pilot on the existing (synthetic) charging network.
// The busiest stations open a share of their ports to Tesla; VinFast keeps priority. Simulation only.
import type { Charger } from "./types";

export const PILOT_STATIONS = 10;
const PILOT_TESLA_SHARE = 0.25;   // share of a station's ports opened to Tesla in the pilot
const PILOT_MIN_TESLA_PORTS = 2;

export const pilotTeslaPorts = (c: Charger) => Math.min(c.ports, Math.max(PILOT_MIN_TESLA_PORTS, Math.round(c.ports * PILOT_TESLA_SHARE)));

/** The most-used stations, by average daily sessions then utilization. */
export function pickPilot(chargers: Charger[]): Charger[] {
  return [...chargers].sort((a, b) => b.avg_daily_sessions - a.avg_daily_sessions || b.utilization - a.utilization).slice(0, PILOT_STATIONS);
}

export const popupRow = (label: string, value: string | number) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;padding:2px 0"><span style="color:#64748B">${label}</span><span style="font-family:'JetBrains Mono',monospace;color:#E8EEF7">${value}</span></div>`;

export function pilotPopup(c: Charger, rank: number): string {
  const tesla = pilotTeslaPorts(c);
  return `<div style="min-width:236px">
    <div style="display:flex;align-items:center;gap:6px"><img src="/brands/vinfast.png" width="18" height="18" style="border-radius:4px"/><img src="/brands/tesla.png" width="18" height="18" style="border-radius:4px"/>
    <span style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:#3BC9F5">HYBRID PILOT #${rank} · PROPOSED</span></div>
    <div style="font-weight:600;font-size:13px;margin:6px 0 8px">${c.name}</div>
    ${popupRow("Average daily sessions", c.avg_daily_sessions)}${popupRow("Current utilization", `${Math.round(c.utilization * 100)}%`)}${popupRow("Ports", `${c.ports} · ${c.power_kw} kW`)}
    ${popupRow("VinFast", `all ${c.ports} ports · priority 1`)}${popupRow("Tesla pilot ports", `${tesla} of ${c.ports} · priority 2`)}${popupRow("Peak", c.peak_window)}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid #263347;font-size:11px;color:#A3B2C7">Picked as one of the ${PILOT_STATIONS} most-used stations. VinFast drivers keep priority; watch VinFast wait at peak before widening access.</div>
    <div style="margin-top:6px;font-size:10px;color:#64748B">Simulation only. Not affiliated with or endorsed by VinFast, Tesla or V-Green; no pilot is planned or announced. Tesla compatibility unverified.</div>
    <a href="/energy/open-charging?tab=queue" style="display:inline-block;margin-top:6px;font-size:11px;color:#3BC9F5">Simulate the priority queue →</a></div>`;
}
