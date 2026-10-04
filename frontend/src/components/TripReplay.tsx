import clsx from "clsx";
import L from "leaflet";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApi } from "../lib/api";
import { C } from "../lib/format";
import type { Trip } from "../lib/types";
import { Button, Loading, Meter } from "./ui";

const TICK_MS = 80;
const DURATION_MS = 16000;
const EVENT_COLOR: Record<string, string> = { start: C.good, traffic: C.warn, charging: C.info, depart: C.info, arrive: C.accent };

const carIcon = L.divIcon({
  className: "map-divicon",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div style="width:22px;height:22px;border-radius:50%;background:${C.accent};box-shadow:0 0 0 3px #05080D,0 0 0 5px ${C.accent}66,0 0 22px ${C.accent};display:flex;align-items:center;justify-content:center"><div style="width:7px;height:7px;border-radius:50%;background:#05080D"></div></div>`,
});

/** Replays a vehicle's trip on the given map while SOC, speed, energy and location update. */
export function TripReplay({ map, vehicleId, autoPlay = false }: { map: L.Map | null; vehicleId: string; autoPlay?: boolean }) {
  const trip = useApi<Trip>(`/api/vehicles/${vehicleId}/route`);
  const [pos, setPos] = useState(0); // fractional index into samples
  const [playing, setPlaying] = useState(false);
  const marker = useRef<L.Marker | null>(null);
  const travelled = useRef<L.Polyline | null>(null);
  const data = trip.data?.vehicle_id === vehicleId ? trip.data : null;

  // static geometry: route line, event pins, moving marker
  useEffect(() => {
    if (!map || !data) return;
    const group = L.layerGroup();
    const line = L.polyline(data.coords, { pane: "routes", color: C.ink3, weight: 3, opacity: 0.7, dashArray: "3 6" }).addTo(group);
    travelled.current = L.polyline([], { pane: "routes", color: C.accent, weight: 4, opacity: 0.95 }).addTo(group);
    for (const e of data.timeline) {
      const [lat, lon] = data.coords[e.index];
      L.circleMarker([lat, lon], { radius: 5, color: "#05080D", weight: 2, fillColor: EVENT_COLOR[e.type] ?? C.ink2, fillOpacity: 1 })
        .bindTooltip(`${e.time} ${e.label}`, { direction: "top", offset: [0, -4] })
        .addTo(group);
    }
    marker.current = L.marker(data.coords[0], { icon: carIcon, zIndexOffset: 1000, interactive: false }).addTo(group);
    group.addTo(map);
    map.flyToBounds(line.getBounds().pad(0.25), { duration: 0.7 });
    setPos(0);
    setPlaying(autoPlay);
    return () => {
      group.remove();
      marker.current = null;
      travelled.current = null;
    };
  }, [map, data, autoPlay]);

  // playback clock
  useEffect(() => {
    if (!playing || !data) return;
    const last = data.samples.length - 1;
    const step = last / (DURATION_MS / TICK_MS);
    const timer = window.setInterval(() => {
      setPos((p) => {
        const next = Math.min(last, p + step);
        if (next >= last) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, data]);

  // move the marker along the samples
  const i = Math.floor(pos);
  const a = data?.samples[i];
  const b = data?.samples[Math.min(i + 1, (data?.samples.length ?? 1) - 1)];
  useEffect(() => {
    if (!data || !a || !b) return;
    const t = pos - i;
    const lat = a.lat + (b.lat - a.lat) * t;
    const lon = a.lon + (b.lon - a.lon) * t;
    marker.current?.setLatLng([lat, lon]);
    travelled.current?.setLatLngs([...data.samples.slice(0, i + 1).map((s) => [s.lat, s.lon] as [number, number]), [lat, lon]]);
  }, [pos, data, a, b, i]);

  if (trip.loading || !data || !a) return <Loading label="Loading trip…" />;
  const last = data.samples.length - 1;
  const finished = pos >= last;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="label">Trip replay · {data.vehicle_id}</div>
          <div className="truncate text-xs font-medium">{data.name}</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (finished) setPos(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? <Pause size={11} /> : <Play size={11} />} {playing ? "Pause" : finished ? "Replay" : pos > 0 ? "Resume" : "Replay Trip"}
          </Button>
          <Button size="sm" onClick={() => { setPlaying(false); setPos(0); }} aria-label="Restart trip">
            <RotateCcw size={11} />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          { l: "Time", v: a.time },
          { l: "Battery SOC", v: `${a.soc.toFixed(0)}%` },
          { l: "Speed", v: `${a.speed_kmh.toFixed(0)} km/h` },
          { l: "Energy use", v: `${a.energy_kwh.toFixed(1)} kWh` },
        ].map((x) => (
          <div key={x.l} className="rounded-md border border-line bg-raised px-2 py-1.5">
            <div className="label">{x.l}</div>
            <div className="num mt-0.5 text-xs text-ink">{x.v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <Meter value={pos} max={last} />
        <div className="num mt-1 flex justify-between text-3xs text-ink-3">
          <span>{a.distance_km.toFixed(1)} km</span>
          <span>
            {a.lat.toFixed(4)}, {a.lon.toFixed(4)} · {a.state}
          </span>
          <span>{data.summary.distance_today_km} km</span>
        </div>
      </div>

      <ol className="mt-3 space-y-0">
        {data.timeline.map((e, k) => {
          const reached = pos > 0 && e.time <= a.time;
          return (
            <li key={k} className="relative flex gap-2.5 pb-2 last:pb-0">
              {k < data.timeline.length - 1 && <span className={clsx("absolute left-[4px] top-3 h-full w-px", reached ? "bg-accent/60" : "bg-line-strong")} />}
              <span className="relative mt-1 h-[9px] w-[9px] shrink-0 rounded-full border-2" style={{ borderColor: reached ? EVENT_COLOR[e.type] : "#263347", background: reached ? EVENT_COLOR[e.type] : "#0A0F17" }} />
              <span className={clsx("num w-9 shrink-0 text-2xs", reached ? "text-ink" : "text-ink-3")}>{e.time}</span>
              <span className="min-w-0">
                <span className={clsx("text-2xs font-medium", reached ? "text-ink" : "text-ink-3")}>{e.label}</span>
                <span className="ml-1.5 text-2xs text-ink-3">{e.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-3">
        {[
          { l: "Distance today", v: `${data.summary.distance_today_km} km` },
          { l: "Energy consumed", v: `${data.summary.energy_consumed_kwh} kWh` },
          { l: "Charging stops", v: data.summary.charging_stops },
          { l: "Avg efficiency", v: `${data.summary.average_efficiency_wh_km} Wh/km` },
        ].map((x) => (
          <div key={x.l}>
            <div className="label">{x.l}</div>
            <div className="num mt-0.5 text-xs text-ink">{x.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
