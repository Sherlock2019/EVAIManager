import clsx from "clsx";
import type L from "leaflet";
import { useEffect, useRef, type ReactNode } from "react";
import { useLive } from "../lib/live";
import { createMap, VehicleLayer } from "../lib/map";

/** Leaflet map container. Hands the map instance to the parent once it exists. */
export function MapView({
  center,
  zoom,
  onMap,
  className,
  children,
}: {
  center: [number, number];
  zoom: number;
  onMap: (map: L.Map | null) => void;
  className?: string;
  children?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = createMap(el.current, center, zoom);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el.current);
    onMap(map);
    return () => {
      observer.disconnect();
      onMap(null);
      map.remove();
    };
    // the map is created once; later view changes go through the instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={clsx("relative isolate overflow-hidden", className)}>
      <div ref={el} className="absolute inset-0" />
      {children}
    </div>
  );
}

/** Overlay card pinned to a map corner (sits above Leaflet's own panes). */
export function MapOverlay({ position, children, className }: { position: "tl" | "tr" | "bl" | "br"; children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "absolute z-[500] rounded-md border border-line-strong bg-abyss/85 backdrop-blur",
        position === "tl" && "left-3 top-3",
        position === "tr" && "right-3 top-3",
        position === "bl" && "bottom-3 left-3",
        position === "br" && "bottom-3 right-14",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Draws the live fleet on a map and keeps it in sync with the simulation. */
export function useFleetLayer(map: L.Map | null, opts: { onSelect?: (id: string) => void; clusterBelowZoom?: number; routedOnly?: boolean } = {}) {
  const fleet = useLive((s) => s.fleet);
  const tick = useLive((s) => s.tick);
  const layer = useRef<VehicleLayer | null>(null);
  const onSelect = useRef(opts.onSelect);
  onSelect.current = opts.onSelect;

  useEffect(() => {
    if (!map) return;
    const l = new VehicleLayer(map, { clusterBelowZoom: opts.clusterBelowZoom, routedOnly: opts.routedOnly, onSelect: (id) => onSelect.current?.(id) });
    layer.current = l;
    return () => {
      l.destroy();
      layer.current = null;
    };
  }, [map, opts.clusterBelowZoom, opts.routedOnly]);

  useEffect(() => {
    if (layer.current && fleet) layer.current.setData(fleet);
  }, [map, fleet]);

  useEffect(() => {
    layer.current?.applyTick(useLive.getState().lastPositions);
  }, [tick]);

  return layer;
}
