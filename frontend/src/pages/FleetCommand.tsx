import type L from "leaflet";
import { ArrowRight, History, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MapOverlay, MapView, useFleetLayer } from "../components/MapView";
import { TripReplay } from "../components/TripReplay";
import { Badge, Button, Legend, Loading, Meter, PageHeader, Panel, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { VEHICLE_STATUS, fmtInt, riskTone, toneColor } from "../lib/format";
import { useLive } from "../lib/live";
import { CITY_VIEWS } from "../lib/map";
import type { Prediction, VehicleDetail } from "../lib/types";

function TelemetryPanel({ vehicleId, onReplay, onClose }: { vehicleId: string; onReplay: () => void; onClose: () => void }) {
  const detail = useApi<VehicleDetail>(`/api/vehicles/${vehicleId}`);
  const tick = useLive((s) => s.tick);
  const { reload } = detail;
  useEffect(() => {
    if (tick % 2 === 0) reload();
  }, [tick, reload]);

  if (!detail.data || detail.data.vehicle.vehicle_id !== vehicleId) return <Loading label="Loading telemetry…" />;
  const { vehicle: v, prediction: p, estimated_range_km, motor_efficiency_pct } = detail.data;
  const status = VEHICLE_STATUS.find((s) => s.key === v.status) ?? VEHICLE_STATUS[0];
  const tone = riskTone[p.maintenance_risk];
  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <div className="num text-base font-medium">{v.vehicle_id}</div>
          <div className="text-2xs text-ink-3">
            {v.model} · {v.year} · {v.zone}, {v.city}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-2xs" style={{ color: status.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} />
            {status.label}
          </span>
          <button onClick={onClose} className="rounded p-0.5 text-ink-3 hover:bg-raised hover:text-ink" aria-label="Clear selection">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-line bg-raised p-3">
        <div className="flex items-baseline justify-between">
          <span className="label">Battery SOC</span>
          <span className="num text-sm">
            {v.battery_soc.toFixed(0)}% <span className="text-2xs text-ink-3">· {estimated_range_km} km range</span>
          </span>
        </div>
        <div className="mt-1.5">
          <Meter value={v.battery_soc} max={100} tone={v.battery_soc < 20 ? "crit" : v.battery_soc < 35 ? "warn" : "good"} height={6} />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4">
        <Stat label="Speed" value={`${v.speed_kmh.toFixed(0)} km/h`} />
        <Stat label="State of health" value={`${v.battery_soh.toFixed(0)}%`} />
        <Stat label="Battery temp" value={`${v.battery_temperature.toFixed(1)}°C`} tone={v.battery_temperature > 42 ? "crit" : undefined} />
        <Stat label="Motor temp" value={`${v.motor_temperature.toFixed(0)}°C`} tone={v.motor_temperature > 90 ? "crit" : undefined} />
        <Stat label="Motor efficiency" value={`${motor_efficiency_pct}%`} />
        <Stat label="Odometer" value={`${fmtInt(v.odometer_km)} km`} />
        <Stat label="Tires FL / FR" value={`${v.tire_pressure_fl.toFixed(1)} / ${v.tire_pressure_fr.toFixed(1)}`} />
        <Stat label="Tires RL / RR" value={`${v.tire_pressure_rl.toFixed(1)} / ${v.tire_pressure_rr.toFixed(1)}`} tone={Math.min(v.tire_pressure_rl, v.tire_pressure_rr) < 2.15 ? "warn" : undefined} />
      </div>

      <div className="mt-3 rounded-md border px-3 py-2.5" style={{ borderColor: `${toneColor[tone]}55`, background: `${toneColor[tone]}0D` }}>
        <div className="flex items-center justify-between">
          <span className="label">AI vehicle health</span>
          <Badge tone={tone}>{p.maintenance_risk} · {p.maintenance_probability.toFixed(0)}%</Badge>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="num text-xl font-medium">{p.health_score}</span>
          <span className="text-2xs text-ink-3">/ 100 health score</span>
        </div>
        {p.maintenance_risk !== "LOW" ? (
          <p className="mt-1 text-2xs text-ink-2">
            Predicted issue: <span className="text-ink">{p.predicted_component}</span> · service within {p.predicted_days_to_service} days
          </p>
        ) : (
          <p className="mt-1 text-2xs text-ink-2">No component trending toward service.</p>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onReplay} className="flex-1">
          <History size={12} /> Replay Trip
        </Button>
        <Link to={`/fleet/health?vehicle=${v.vehicle_id}`} className="flex-1">
          <Button size="sm" variant="primary" className="w-full">
            Health profile <ArrowRight size={12} />
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default function FleetCommand() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("vehicle");
  const summary = useLive((s) => s.summary);
  const fleet = useLive((s) => s.fleet);
  const attention = useApi<Prediction[]>("/api/maintenance/predictions?min_risk=HIGH&limit=7");
  const [map, setMap] = useState<L.Map | null>(null);
  const [replay, setReplay] = useState(false);
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);

  const select = (id: string | null) => {
    setReplay(false);
    setParams(id ? { vehicle: id } : {}, { replace: true });
  };
  const layer = useFleetLayer(map, { onSelect: select, clusterBelowZoom: 11 });

  useEffect(() => {
    layer.current?.select(selected, true);
  }, [selected, layer, fleet, map]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = query.replace(/\D/g, "");
    const id = digits ? `VF-EV-${digits.padStart(4, "0")}` : "";
    if (fleet?.ids.includes(id)) {
      setNotFound(false);
      select(id);
    } else setNotFound(true);
  };

  return (
    <div>
      <PageHeader kicker="Fleet · Operations" title="Fleet Command Center" description="Every simulated EV, live. Clusters at national scale, individual vehicles at city scale. Click a vehicle to open its telemetry and replay its trip.">
        <form onSubmit={search} className="flex items-center gap-1.5">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setNotFound(false); }}
              placeholder="Find vehicle, e.g. 0821"
              className="h-8 w-48 rounded-md border border-line-strong bg-raised pl-7 pr-2 font-mono text-xs text-ink placeholder:text-ink-3"
            />
          </div>
          <Button type="submit">Locate</Button>
          {notFound && <span className="text-2xs text-crit">Not in fleet</span>}
        </form>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        {VEHICLE_STATUS.map((s) => (
          <div key={s.key} className="panel flex items-center justify-between px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-xs text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="num text-base font-medium">{summary ? fmtInt(summary.status_counts[s.key]) : "—"}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_372px]">
        <section className="panel overflow-hidden">
          <MapView center={CITY_VIEWS["Ho Chi Minh City"].center} zoom={11.5} onMap={setMap} className="h-[640px]">
            <MapOverlay position="tl" className="p-1">
              <div className="flex gap-0.5">
                {Object.keys(CITY_VIEWS).map((name) => (
                  <button key={name} onClick={() => map?.flyTo(CITY_VIEWS[name].center, CITY_VIEWS[name].zoom, { duration: 0.8 })} className="rounded px-2 py-1 text-2xs text-ink-2 hover:bg-raised hover:text-ink">
                    {name === "Ho Chi Minh City" ? "HCMC" : name}
                  </button>
                ))}
              </div>
            </MapOverlay>
            <MapOverlay position="bl" className="px-3 py-2">
              <Legend items={VEHICLE_STATUS.map((v) => ({ label: v.label, color: v.color }))} />
            </MapOverlay>
          </MapView>
        </section>

        <div className="flex flex-col gap-3">
          {selected ? (
            <>
              <Panel title="Vehicle Telemetry" kicker="Live">
                <TelemetryPanel vehicleId={selected} onReplay={() => setReplay(true)} onClose={() => select(null)} />
              </Panel>
              {replay && (
                <Panel title="Route Replay" kicker="Previous trip">
                  <TripReplay map={map} vehicleId={selected} autoPlay />
                </Panel>
              )}
            </>
          ) : (
            <Panel title="Needs Attention" kicker="Highest maintenance risk" bodyClassName="p-0">
              <p className="border-b border-line px-4 py-2.5 text-2xs text-ink-3">Select a vehicle on the map, or start with one the maintenance AI has flagged.</p>
              <ul className="divide-y divide-line">
                {attention.data?.map((p) => (
                  <li key={p.vehicle_id}>
                    <button onClick={() => select(p.vehicle_id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-raised">
                      <span className="h-6 w-0.5 rounded" style={{ background: toneColor[riskTone[p.maintenance_risk]] }} />
                      <span className="min-w-0 flex-1">
                        <span className="num block text-xs">{p.vehicle_id}</span>
                        <span className="block truncate text-2xs text-ink-3">
                          {p.model} · {p.predicted_component}
                        </span>
                      </span>
                      <span className="num text-xs" style={{ color: toneColor[riskTone[p.maintenance_risk]] }}>
                        {p.maintenance_probability.toFixed(0)}%
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
