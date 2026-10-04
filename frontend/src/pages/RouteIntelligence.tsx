import clsx from "clsx";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MapOverlay, MapView, useFleetLayer } from "../components/MapView";
import { TripReplay } from "../components/TripReplay";
import { ErrorNote, Kpi, Legend, Loading, MockTag, PageHeader, Panel, Tabs } from "../components/ui";
import { useApi } from "../lib/api";
import { useDemo } from "../lib/demo";
import { C, VEHICLE_STATUS, fmtInt, titleCase } from "../lib/format";
import { CITY_VIEWS, HeatLayer } from "../lib/map";
import type { RouteInfo } from "../lib/types";

type Heat = "none" | "travel_density" | "charging_demand" | "charger_capacity";
const HEAT_RAMP: Record<Exclude<Heat, "none">, [string, string]> = {
  travel_density: ["#12325E", "#9EC5F4"],
  charging_demand: ["#7A2E10", "#FFB98A"],
  charger_capacity: ["#0B4A36", "#7FE0BC"],
};

export default function RouteIntelligence() {
  const [params, setParams] = useSearchParams();
  const vehicleId = params.get("vehicle");
  const routes = useApi<RouteInfo[]>("/api/routes");
  const heatData = useApi<Record<string, number[][]>>("/api/routes/heatmap");
  const [map, setMap] = useState<L.Map | null>(null);
  const [heat, setHeat] = useState<Heat>("travel_density");
  const [routeId, setRouteId] = useState<string | null>(null);
  const demoOpen = useDemo((s) => s.open); // the docked demo panel narrows the map

  const selectVehicle = (id: string | null) => setParams(id ? { vehicle: id } : {}, { replace: true });
  // only vehicles driving a named route, so the route geometry stays readable
  const layer = useFleetLayer(map, { onSelect: selectVehicle, clusterBelowZoom: 8, routedOnly: true });
  useEffect(() => {
    layer.current?.select(vehicleId);
  }, [vehicleId, layer, map]);

  const sorted = useMemo(() => [...(routes.data ?? [])].sort((a, b) => b.trips_per_day - a.trips_per_day), [routes.data]);
  const active = sorted.find((r) => r.route_id === routeId) ?? null;

  // route polylines, weighted by daily trips
  useEffect(() => {
    if (!map || !routes.data) return;
    const group = L.layerGroup();
    const max = Math.max(...routes.data.map((r) => r.trips_per_day));
    for (const r of routes.data) {
      const on = r.route_id === routeId;
      L.polyline(r.coords, {
        pane: "routes",
        color: on ? "#FFFFFF" : C.accent,
        weight: on ? 5 : 1.5 + (3.5 * r.trips_per_day) / max,
        opacity: vehicleId ? 0.12 : on ? 0.95 : routeId ? 0.2 : 0.5,
        dashArray: r.kind === "corridor" ? "2 7" : undefined,
      })
        .bindTooltip(`${r.name} · ${fmtInt(r.trips_per_day)} trips/day`, { sticky: true })
        .on("click", () => setRouteId(r.route_id))
        .addTo(group);
    }
    group.addTo(map);
    return () => void group.remove();
  }, [map, routes.data, routeId, vehicleId]);

  useEffect(() => {
    if (!map || !heatData.data || heat === "none") return;
    const [low, high] = HEAT_RAMP[heat];
    const hl = new HeatLayer(map, low, high, heat === "charger_capacity" ? 20 : 28);
    hl.setPoints(heatData.data[heat]);
    return () => hl.destroy();
  }, [map, heatData.data, heat]);

  const pickRoute = (r: RouteInfo) => {
    setRouteId(r.route_id);
    selectVehicle(null);
    map?.flyToBounds(L.latLngBounds(r.coords).pad(0.25), { duration: 0.7 });
  };

  const urban = sorted.filter((r) => r.kind === "urban");
  const totalTrips = sorted.reduce((a, r) => a + r.trips_per_day, 0);

  return (
    <div>
      <PageHeader
        kicker="Energy · Mobility intelligence"
        title="Route Intelligence"
        description="GPS and route history become travel demand; travel demand plus charging behaviour becomes a demand forecast. Pick a route, then a vehicle, and replay its trip."
      >
        <MockTag>Synthetic routes · not snapped to roads</MockTag>
      </PageHeader>
      {routes.error && <ErrorNote message={routes.error} />}

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Tracked routes" value={sorted.length || "—"} sub={`${urban.length} urban · ${sorted.length - urban.length} inter-city`} />
        <Kpi label="Observed trips / day" value={fmtInt(totalTrips)} sub="across all routes" />
        <Kpi label="Busiest corridor" value={sorted[0] ? fmtInt(sorted[0].trips_per_day) : "—"} sub={sorted[0]?.name} tone="accent" />
        <Kpi label="Vehicles on routes" value={sorted.reduce((a, r) => a + r.vehicles.length, 0) || "—"} sub="shown live on this map" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_372px]">
        <section className="panel overflow-hidden">
          <MapView center={CITY_VIEWS["Ho Chi Minh City"].center} zoom={11.5} onMap={setMap} className="h-[640px]">
            <MapOverlay position="tl" className="flex items-center gap-2 p-1.5">
              <span className="label pl-1.5">Heatmap</span>
              <Tabs
                value={heat}
                onChange={setHeat}
                options={[
                  { value: "none", label: "Off" },
                  { value: "travel_density", label: "Travel density" },
                  { value: "charging_demand", label: "Charging demand" },
                  { value: "charger_capacity", label: "Charger capacity" },
                ]}
              />
            </MapOverlay>
            <MapOverlay position="tr" className={clsx("p-1", demoOpen && "hidden")}>
              <div className="flex gap-0.5">
                {["Ho Chi Minh City", "Hanoi", "Da Nang", "Vietnam"].map((name) => (
                  <button key={name} onClick={() => map?.flyTo(CITY_VIEWS[name].center, name === "Ho Chi Minh City" ? 11.5 : CITY_VIEWS[name].zoom, { duration: 0.8 })} className="rounded px-2 py-1 text-2xs text-ink-2 hover:bg-raised hover:text-ink">
                    {name === "Ho Chi Minh City" ? "HCMC" : name}
                  </button>
                ))}
              </div>
            </MapOverlay>
            <MapOverlay position="bl" className="px-3 py-2">
              <Legend items={[{ label: "Route · width = trips/day", color: C.accent, shape: "line" }, ...VEHICLE_STATUS.slice(0, 4).map((v) => ({ label: v.label, color: v.color }))]} />
              {heat !== "none" && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="label">{titleCase(heat)}</span>
                  <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(to right, ${HEAT_RAMP[heat][0]}55, ${HEAT_RAMP[heat][1]})` }} />
                  <span className="text-3xs text-ink-3">low → high</span>
                </div>
              )}
            </MapOverlay>
          </MapView>
        </section>

        <div className="flex flex-col gap-3">
          {vehicleId ? (
            <Panel title="Vehicle Trip" kicker="Click Replay Trip to animate">
              <TripReplay map={map} vehicleId={vehicleId} />
              <button onClick={() => selectVehicle(null)} className="mt-3 text-2xs text-accent hover:underline">
                ← Back to routes
              </button>
            </Panel>
          ) : (
            <Panel title="EV Routes" kicker="Ranked by daily trips" bodyClassName="p-0">
              {routes.loading && <Loading />}
              <ul className="max-h-[588px] divide-y divide-line overflow-y-auto">
                {sorted.map((r) => {
                  const on = r.route_id === active?.route_id;
                  return (
                    <li key={r.route_id}>
                      <button onClick={() => pickRoute(r)} className={clsx("block w-full px-4 py-2 text-left hover:bg-raised", on && "bg-raised shadow-[inset_2px_0_0_#3BC9F5]")}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">{r.name}</span>
                          <span className="num shrink-0 text-xs">{fmtInt(r.trips_per_day)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-3xs text-ink-3">
                          <span>{r.city} · {r.distance_km} km</span>
                          <span>trips/day</span>
                        </div>
                      </button>
                      {on && (
                        <div className="flex flex-wrap items-center gap-1.5 bg-raised px-4 pb-2.5">
                          <span className="label mr-1">Vehicles</span>
                          {r.vehicles.map((id) => (
                            <button key={id} onClick={() => selectVehicle(id)} className="num rounded border border-line-strong px-1.5 py-0.5 text-3xs text-ink-2 hover:border-accent hover:text-accent">
                              {id}
                            </button>
                          ))}
                          {!r.vehicles.length && <span className="text-3xs text-ink-3">none on this route right now</span>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Workflow" kicker="Journeys to network planning" className="mt-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-ink-2">
          {["GPS / route history", "Travel demand", "Charging behaviour", "Geospatial analytics", "Demand forecast", "Charger site optimization"].map((s, i, a) => (
            <span key={s} className="flex items-center gap-2">
              <span className={clsx("rounded-md border px-2.5 py-1.5", i === a.length - 1 ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-raised")}>{s}</span>
              {i < a.length - 1 && <span className="text-ink-3">→</span>}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
