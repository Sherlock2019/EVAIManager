import { create } from "zustand";
import type { AdasEvent, FleetMap, Summary, TickMessage } from "./types";

interface LiveState {
  connected: boolean;
  transport: "websocket" | "polling" | "offline";
  summary: Summary | null;
  /** Whole-fleet map rows. Mutated in place on every tick; watch `tick` to react. */
  fleet: FleetMap | null;
  tick: number;
  lastPositions: number[][];
  chargerAvailability: Record<number, number>;
  events: AdasEvent[];
  /** Bumped whenever server state is mutated so `useApi` hooks refetch. */
  refreshKey: number;
  refresh: () => void;
}

export const useLive = create<LiveState>((set) => ({
  connected: false,
  transport: "offline",
  summary: null,
  fleet: null,
  tick: 0,
  lastPositions: [],
  chargerAvailability: {},
  events: [],
  refreshKey: 0,
  refresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));

function applyTick(msg: TickMessage) {
  const state = useLive.getState();
  const fleet = state.fleet;
  const positions = msg.positions ?? [];
  if (fleet) {
    for (const [i, lat, lon, soc, status, speed] of positions) {
      const row = fleet.rows[i];
      if (row) {
        row[0] = lat;
        row[1] = lon;
        row[2] = soc;
        row[3] = status;
        row[4] = speed;
      }
    }
  }
  const availability = { ...state.chargerAvailability };
  for (const [idx, available] of msg.chargers ?? []) availability[idx] = available;
  useLive.setState({
    tick: state.tick + 1,
    lastPositions: positions,
    chargerAvailability: availability,
    events: msg.adas_events?.length ? [...msg.adas_events, ...state.events].slice(0, 40) : state.events,
    summary: msg.summary ?? state.summary,
  });
}

async function loadFleet() {
  try {
    const [fleet, summary, events] = await Promise.all([
      fetch("/api/vehicles/map").then((r) => r.json() as Promise<FleetMap>),
      fetch("/api/dashboard/summary").then((r) => r.json() as Promise<Summary>),
      fetch("/api/dashboard/adas-events").then((r) => r.json() as Promise<AdasEvent[]>),
    ]);
    useLive.setState({ fleet, summary, events });
  } catch {
    /* backend not up yet; the connection loop retries */
  }
}

let started = false;
let lastPolledSeq = -1;

/** Connect to the live simulation: WebSocket first, HTTP polling as a fallback. */
export function startLive() {
  if (started) return;
  started = true;
  void loadFleet();

  let socket: WebSocket | null = null;
  const connect = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws/live`);
    socket.onopen = () => {
      useLive.setState({ connected: true, transport: "websocket" });
      if (!useLive.getState().fleet) void loadFleet();
    };
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as TickMessage;
      if (msg.type === "tick") applyTick(msg);
      else if (msg.summary) useLive.setState({ summary: msg.summary });
    };
    socket.onclose = () => {
      useLive.setState({ connected: false, transport: "polling" });
      setTimeout(connect, 4000);
    };
    socket.onerror = () => socket?.close();
  };
  connect();

  setInterval(async () => {
    if (useLive.getState().transport === "websocket") return;
    try {
      const msg = (await fetch("/api/live/tick").then((r) => r.json())) as TickMessage;
      if (!useLive.getState().fleet) await loadFleet();
      if (msg.seq !== undefined && msg.seq !== lastPolledSeq) {
        lastPolledSeq = msg.seq;
        applyTick(msg);
      }
      useLive.setState({ connected: true });
    } catch {
      useLive.setState({ connected: false, transport: "offline" });
    }
  }, 3000);
}

/** Re-pull the whole fleet (after a world reset or an injected fault). */
export function reloadFleet() {
  void loadFleet();
}
