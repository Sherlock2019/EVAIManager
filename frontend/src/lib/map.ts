import L from "leaflet";
import { C, CHARGER_STATUS, VEHICLE_STATUS } from "./format";
import type { FleetMap } from "./types";

export const VIETNAM: L.LatLngBoundsExpression = [
  [8.6, 102.6],
  [23.2, 110.4],
];
export const CITY_VIEWS: Record<string, { center: [number, number]; zoom: number }> = {
  Vietnam: { center: [16.1, 106.9], zoom: 6 },
  Hanoi: { center: [21.0285, 105.8342], zoom: 12 },
  "Hai Phong": { center: [20.85, 106.67], zoom: 12 },
  "Da Nang": { center: [16.05, 108.19], zoom: 12 },
  "Nha Trang": { center: [12.255, 109.175], zoom: 12 },
  "Ho Chi Minh City": { center: [10.795, 106.705], zoom: 12 },
};

/**
 * Basemap. Default: the standard OpenStreetMap raster tiles, recoloured to a
 * dark style with a CSS filter (see index.css) — no API key needed.
 * To use a natively dark, keyed provider instead, set VITE_MAP_TILE_URL
 * (and optionally VITE_MAP_ATTRIBUTION); the filter is then switched off.
 */
const CUSTOM_TILES = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
const TILES = CUSTOM_TILES
  ? { url: CUSTOM_TILES, attribution: (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) ?? "", filtered: false }
  : {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      filtered: true,
    };

export function createMap(el: HTMLElement, center: [number, number], zoom: number): L.Map {
  const map = L.map(el, { center, zoom, zoomControl: false, preferCanvas: true, minZoom: 5, maxZoom: 17, zoomSnap: 0.5, worldCopyJump: false });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  el.classList.toggle("tiles-osm", TILES.filtered);
  L.tileLayer(TILES.url, { maxZoom: 19, attribution: `${TILES.attribution} · synthetic fleet data` }).addTo(map);
  // dedicated panes keep z-order stable: heat < routes < markers
  map.createPane("heat").style.zIndex = "350";
  map.getPane("heat")!.style.pointerEvents = "none";
  map.createPane("routes").style.zIndex = "380";
  return map;
}

/* ------------------------------------------------------------------ */
/* Vehicle layer: canvas dots when zoomed in, grid clusters when out   */
/* ------------------------------------------------------------------ */

interface VehicleLayerOptions {
  onSelect?: (vehicleId: string) => void;
  clusterBelowZoom?: number;
  animateMs?: number;
  /** Only draw vehicles that are driving a named route (row[6] === 1). */
  routedOnly?: boolean;
}

export class VehicleLayer {
  private fleet: FleetMap | null = null;
  private markers: L.CircleMarker[] = [];
  private dots = L.layerGroup();
  private corridor = L.layerGroup();
  private clusters = L.layerGroup();
  private renderer: L.Canvas;
  private selected = -1;
  private ring: L.CircleMarker | null = null;
  private anim: { from: Float64Array; to: Float64Array; idx: number[]; start: number } | null = null;
  private timer: number | null = null;
  private ticksSinceCluster = 0;
  private readonly clusterBelow: number;
  private readonly animateMs: number;

  constructor(private map: L.Map, private opts: VehicleLayerOptions = {}) {
    this.clusterBelow = opts.clusterBelowZoom ?? 11;
    this.animateMs = opts.animateMs ?? 2800;
    this.renderer = L.canvas({ padding: 0.3 });
    this.corridor.addTo(map);
    map.on("zoomend", this.onZoom);
  }

  private get clustered() {
    return this.map.getZoom() < this.clusterBelow;
  }

  private radius() {
    const z = this.map.getZoom();
    return z >= 14 ? 6 : z >= 12.5 ? 4.5 : z >= this.clusterBelow ? 3.5 : 3;
  }

  setData(fleet: FleetMap) {
    this.fleet = fleet;
    this.dots.clearLayers();
    this.corridor.clearLayers();
    this.markers = fleet.rows.map((row, i) => {
      const m = L.circleMarker([row[0], row[1]], {
        renderer: this.renderer,
        radius: this.radius(),
        color: "#05080D",
        weight: 1,
        fillColor: VEHICLE_STATUS[row[3]].color,
        fillOpacity: 0.95,
        bubblingMouseEvents: false,
      });
      m.bindTooltip(() => `${fleet.ids[i]} · ${fleet.models[i]} · ${VEHICLE_STATUS[fleet.rows[i][3]].label}`, { direction: "top", offset: [0, -4] });
      m.on("click", () => this.opts.onSelect?.(fleet.ids[i]));
      if (!this.opts.routedOnly || row[6]) (row[5] ? this.corridor : this.dots).addLayer(m);
      return m;
    });
    this.onZoom();
  }

  private onZoom = () => {
    if (!this.fleet) return;
    const r = this.radius();
    for (const m of this.markers) m.setRadius(r);
    if (this.clustered) {
      this.map.removeLayer(this.dots);
      this.buildClusters();
      this.clusters.addTo(this.map);
    } else {
      this.map.removeLayer(this.clusters);
      this.dots.addTo(this.map);
    }
    this.updateRing();
  };

  private buildClusters() {
    const fleet = this.fleet!;
    const zoom = this.map.getZoom();
    const cell = 76;
    const bins = new Map<string, { n: number; lat: number; lon: number; alert: number }>();
    fleet.rows.forEach((row) => {
      if (row[5]) return; // corridor traffic is always drawn individually
      if (this.opts.routedOnly && !row[6]) return;
      const p = this.map.project([row[0], row[1]], zoom);
      const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
      const b = bins.get(key) ?? { n: 0, lat: 0, lon: 0, alert: 0 };
      b.n += 1;
      b.lat += row[0];
      b.lon += row[1];
      if (row[3] === 2 || row[3] === 3) b.alert += 1;
      bins.set(key, b);
    });
    this.clusters.clearLayers();
    bins.forEach((b) => {
      const size = Math.round(26 + Math.min(30, Math.sqrt(b.n) * 2.4));
      const alert = b.alert ? `<span style="position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:${C.crit};color:#fff;font:700 9px 'JetBrains Mono',monospace;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #05080D">${b.alert}</span>` : "";
      const icon = L.divIcon({
        className: "map-divicon",
        iconSize: [size, size],
        html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;background:rgba(34,197,94,0.16);box-shadow:inset 0 0 0 1.5px ${C.good},0 0 18px rgba(34,197,94,0.25);display:flex;align-items:center;justify-content:center;color:#E8EEF7;font:500 ${b.n > 99 ? 10 : 11}px 'JetBrains Mono',monospace">${b.n}${alert}</div>`,
      });
      const center: L.LatLngExpression = [b.lat / b.n, b.lon / b.n];
      L.marker(center, { icon, keyboard: false })
        .bindTooltip(`${b.n} vehicles${b.alert ? ` · ${b.alert} need attention` : ""}`, { direction: "top", offset: [0, -size / 2] })
        .on("click", () => this.map.flyTo(center, Math.min(13, zoom + 2.5), { duration: 0.6 }))
        .addTo(this.clusters);
    });
  }

  /** Apply a simulation delta: [index, lat, lon, soc, status, speed][] */
  applyTick(positions: number[][]) {
    if (!this.fleet || !this.markers.length) return;
    const bounds = this.map.getBounds().pad(0.2);
    const idx: number[] = [];
    const from: number[] = [];
    const to: number[] = [];
    for (const [i, lat, lon, , status] of positions) {
      const m = this.markers[i];
      if (!m) continue;
      const color = VEHICLE_STATUS[status].color;
      if (m.options.fillColor !== color) m.setStyle({ fillColor: color });
      const cur = m.getLatLng();
      if (cur.lat === lat && cur.lng === lon) continue;
      const visible = (this.fleet.rows[i][5] === 1 || !this.clustered) && (bounds.contains(cur) || bounds.contains([lat, lon]));
      if (!visible) {
        m.setLatLng([lat, lon]);
        continue;
      }
      idx.push(i);
      from.push(cur.lat, cur.lng);
      to.push(lat, lon);
    }
    this.anim = { idx, from: Float64Array.from(from), to: Float64Array.from(to), start: performance.now() };
    if (this.timer === null) this.timer = window.setInterval(this.step, 90);
    if (this.clustered && ++this.ticksSinceCluster >= 8) {
      this.ticksSinceCluster = 0;
      this.buildClusters();
    }
  }

  private step = () => {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.start) / this.animateMs);
    for (let k = 0; k < a.idx.length; k++) {
      const lat = a.from[2 * k] + (a.to[2 * k] - a.from[2 * k]) * t;
      const lon = a.from[2 * k + 1] + (a.to[2 * k + 1] - a.from[2 * k + 1]) * t;
      this.markers[a.idx[k]].setLatLng([lat, lon]);
    }
    this.updateRing();
    if (t >= 1) this.anim = null;
  };

  select(vehicleId: string | null, pan = false) {
    this.selected = vehicleId && this.fleet ? this.fleet.ids.indexOf(vehicleId) : -1;
    this.updateRing();
    if (pan && this.selected >= 0) {
      const row = this.fleet!.rows[this.selected];
      this.map.flyTo([row[0], row[1]], Math.max(this.map.getZoom(), 13.5), { duration: 0.7 });
    }
  }

  private updateRing() {
    if (this.selected < 0 || !this.markers[this.selected]) {
      this.ring?.remove();
      this.ring = null;
      return;
    }
    const ll = this.markers[this.selected].getLatLng();
    if (!this.ring) {
      this.ring = L.circleMarker(ll, { radius: 11, color: C.accent, weight: 2, fill: false, interactive: false, renderer: this.renderer }).addTo(this.map);
    } else {
      this.ring.setLatLng(ll);
    }
  }

  destroy() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.map.off("zoomend", this.onZoom);
    this.dots.remove();
    this.corridor.remove();
    this.clusters.remove();
    this.ring?.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Heat layer: single-hue density rendered to a canvas                 */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class HeatLayer {
  private canvas: HTMLCanvasElement;
  private points: number[][] = [];
  private palette: Uint8ClampedArray;

  /** `low` → `high` is a one-hue ramp: intensity is carried by lightness and opacity. */
  constructor(private map: L.Map, low: string, high: string, private baseRadius = 26, private maxAlpha = 0.78) {
    this.canvas = L.DomUtil.create("canvas", "heat-canvas leaflet-zoom-hide") as HTMLCanvasElement;
    map.getPane("heat")!.appendChild(this.canvas);
    const [r1, g1, b1] = hexToRgb(low);
    const [r2, g2, b2] = hexToRgb(high);
    this.palette = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      this.palette[i * 3] = r1 + (r2 - r1) * t;
      this.palette[i * 3 + 1] = g1 + (g2 - g1) * t;
      this.palette[i * 3 + 2] = b1 + (b2 - b1) * t;
    }
    map.on("moveend zoomend resize", this.draw);
  }

  setPoints(points: number[][]) {
    this.points = points;
    this.draw();
  }

  private draw = () => {
    const size = this.map.getSize();
    if (!size.x || !size.y) return; // container not laid out (yet, or any more)
    const dpr = 1; // density maps are soft; device pixels would only cost time
    this.canvas.width = size.x * dpr;
    this.canvas.height = size.y * dpr;
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !this.points.length) return;
    ctx.clearRect(0, 0, size.x, size.y);
    const radius = Math.max(7, Math.min(70, this.baseRadius * Math.pow(2, this.map.getZoom() - 12)));
    for (const [lat, lon, w] of this.points) {
      const p = this.map.latLngToContainerPoint([lat, lon]);
      if (p.x < -radius || p.y < -radius || p.x > size.x + radius || p.y > size.y + radius) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      g.addColorStop(0, `rgba(0,0,0,${0.22 * w})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    }
    const img = ctx.getImageData(0, 0, size.x, size.y);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (!a) continue;
      d[i] = this.palette[a * 3];
      d[i + 1] = this.palette[a * 3 + 1];
      d[i + 2] = this.palette[a * 3 + 2];
      d[i + 3] = Math.min(255, a * 1.6) * this.maxAlpha;
    }
    ctx.putImageData(img, 0, 0);
  };

  destroy() {
    this.map.off("moveend zoomend resize", this.draw);
    this.canvas.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Charger / site icons                                                */
/* ------------------------------------------------------------------ */

const BOLT = '<path d="M9.2 1.5 3.5 9h3.6l-.9 5.5L12 7H8.3z" fill="#05080D"/>';

/** Station pin. Colour encodes the utilisation state; shape distinguishes proposals. */
export function chargerIcon(status: string, opts: { size?: number; expand?: boolean; highlight?: boolean } = {}): L.DivIcon {
  const size = opts.size ?? 18;
  const color = CHARGER_STATUS[status]?.color ?? C.idle;
  const ring = opts.highlight ? `box-shadow:0 0 0 2px #05080D,0 0 0 4px ${color},0 0 16px ${color}` : `box-shadow:0 0 0 2px #05080D`;
  const plus = opts.expand
    ? `<span style="position:absolute;top:-6px;right:-7px;width:13px;height:13px;border-radius:50%;background:#E8EEF7;color:#05080D;font:700 11px/13px 'JetBrains Mono',monospace;text-align:center;box-shadow:0 0 0 1.5px #05080D">+</span>`
    : "";
  return L.divIcon({
    className: "map-divicon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:5px;background:${color};${ring};display:flex;align-items:center;justify-content:center"><svg width="${size - 5}" height="${size - 5}" viewBox="0 0 16 16">${BOLT}</svg>${plus}</div>`,
  });
}

/** Proposed new site: blue diamond with its AI score. */
export function siteIcon(score: number, recommended: boolean, compact = false): L.DivIcon {
  const color = recommended ? C.info : "#3A4A63";
  if (compact) {
    // national-scale view: a plain marker, so the score is not mistaken for a cluster count
    return L.divIcon({
      className: "map-divicon",
      iconSize: [13, 13],
      iconAnchor: [6.5, 6.5],
      html: `<div style="width:13px;height:13px;transform:rotate(45deg);border-radius:3px;background:${color};border:1.5px solid #9EC5F4;box-shadow:0 0 0 2px #05080D,0 0 14px ${color}"></div>`,
    });
  }
  const size = recommended ? 30 : 22;
  return L.divIcon({
    className: "map-divicon",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;transform:rotate(45deg);border-radius:5px;background:${recommended ? color : "#0F1621"};border:1.5px ${recommended ? "solid" : "dashed"} ${recommended ? "#9EC5F4" : color};box-shadow:0 0 0 2px #05080D${recommended ? `,0 0 20px ${color}` : ""};display:flex;align-items:center;justify-content:center"><span style="transform:rotate(-45deg);color:${recommended ? "#fff" : "#A3B2C7"};font:700 ${recommended ? 11 : 9}px 'JetBrains Mono',monospace">${score}</span></div>`,
  });
}

/** Planned site the optimizer advises against. */
export function plannedIcon(unnecessary: boolean): L.DivIcon {
  const color = unnecessary ? C.idle : C.good;
  return L.divIcon({
    className: "map-divicon",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="width:24px;height:24px;border-radius:50%;background:#0F1621;border:1.5px dashed ${color};box-shadow:0 0 0 2px #05080D;display:flex;align-items:center;justify-content:center;color:${color};font:700 12px 'JetBrains Mono',monospace">${unnecessary ? "✕" : "✓"}</div>`,
  });
}

export function eventIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "map-divicon",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="width:14px;height:14px;border-radius:50%;border:1.5px solid ${color};background:${color}33;box-shadow:0 0 12px ${color}"></div>`,
  });
}
