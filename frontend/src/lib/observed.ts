// Observed (real) charging-station locations from OpenStreetMap / Open Charge Map.
// Locations and source tags only: no live status, price, utilization or revenue.
import L from "leaflet";

export interface ObservedStation {
  id: string;
  source: "OSM" | "OCM";
  provenance: "observed";
  name: string;
  operator: string | null;
  brand: "vinfast" | "other" | "unknown";
  vehicle: "car" | "e-scooter" | "unknown";
  latitude: number;
  longitude: number;
  region: string;
  capacity: number | null;
  sockets: Record<string, string | number>;
  max_power_kw: number | null;
  address: string | null;
  opening_hours: string | null;
  last_checked: string | null;
  url: string;
}

export interface ObservedView {
  note: string;
  attribution: string;
  fetched_at: string | null;
  origin: string;
  errors: Record<string, string>;
  counts: { total: number; osm: number; ocm_added: number; vinfast: number; other: number; unknown: number; car: number; e_scooter: number; excluded_power_infrastructure: number };
  stations: ObservedStation[];
}

export const OBSERVED_BRAND_LABEL = { vinfast: "VinFast / V-Green", other: "Other operator", unknown: "Operator not tagged" } as const;

/** White ring = observed real station; inside, the VinFast mark or a plain dot for other / untagged operators. */
export function observedIcon(s: ObservedStation): L.DivIcon {
  const inner =
    s.brand === "vinfast"
      ? `<img src="/brands/vinfast.png" alt="" style="display:block;width:12px;height:12px;max-width:none"/>`
      : `<div style="width:12px;height:12px;background:${s.brand === "other" ? "#199E70" : "#6B7A90"}"></div>`;
  return L.divIcon({
    className: "map-divicon",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<div style="width:12px;height:12px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 1px #05080D,0 0 0 3px #FFFFFF,0 0 6px #FFFFFFAA">${inner}</div>`,
  });
}

const r = (label: string, value: string | number) =>
  `<div style="display:flex;justify-content:space-between;gap:18px;padding:2px 0"><span style="color:#64748B">${label}</span><span style="font-family:'JetBrains Mono',monospace;color:#E8EEF7;text-align:right">${value}</span></div>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function observedPopup(s: ObservedStation, attribution: string): string {
  const sockets = Object.entries(s.sockets).map(([k, v]) => `${esc(k)} × ${esc(String(v))}`).join(", ");
  return `<div style="min-width:230px;max-width:280px">
    <div style="font:500 9px 'JetBrains Mono',monospace;letter-spacing:.14em;color:#E8EEF7">REAL STATION · OBSERVED (${s.source})</div>
    <div style="font-weight:600;font-size:13px;margin:3px 0 8px">${esc(s.name)}</div>
    ${r("Operator", esc(s.operator ?? "not tagged"))}${r("Brand", OBSERVED_BRAND_LABEL[s.brand])}${r("Vehicles", s.vehicle)}
    ${s.capacity ? r("Charge points", s.capacity) : ""}${s.max_power_kw ? r("Max power", `${s.max_power_kw} kW`) : ""}${sockets ? r("Sockets", sockets) : ""}
    ${s.opening_hours ? r("Hours", esc(s.opening_hours)) : ""}${s.address ? r("Address", esc(s.address)) : ""}${s.last_checked ? r("Last checked", esc(s.last_checked)) : ""}
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid #263347;font-size:10px;color:#A3B2C7">Location from open data. <b>No live status, price or usage</b> in this source; usage and revenue elsewhere in the app are simulated.</div>
    <a href="${s.url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:11px;color:#3BC9F5">View on ${s.source === "OSM" ? "OpenStreetMap" : "Open Charge Map"} ↗</a>
    <div style="margin-top:4px;font-size:9px;color:#64748B">${esc(attribution)}</div></div>`;
}
