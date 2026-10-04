import { create } from "zustand";
import { post } from "./api";
import { reloadFleet, useLive } from "./live";
import type { DemoStep } from "./types";

export const DEMO_TITLES = [
  "New vehicle telemetry arrives",
  "EV develops battery temperature anomaly",
  "Maintenance AI detects the anomaly",
  "Service recommendation generated",
  "Vehicle route feeds the charging-demand model",
  "Charger demand prediction changes",
  "AI proposes charging capacity expansion",
  "ADAS low-confidence frame detected",
  "Human corrects the motorcycle label",
  "Frame enters the next training dataset",
  "Updated model metrics appear",
];
const STEP_MS = 3200;

interface DemoState {
  open: boolean;
  running: boolean;
  follow: boolean;
  current: number; // step currently executing (1-based), 0 = idle
  steps: DemoStep[];
  error: string | null;
  setOpen: (open: boolean) => void;
  setFollow: (follow: boolean) => void;
}

export const useDemo = create<DemoState>((set) => ({
  open: false,
  running: false,
  follow: true,
  current: 0,
  steps: [],
  error: null,
  setOpen: (open) => set({ open }),
  setFollow: (follow) => set({ follow }),
}));

let runToken = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run the guided demo: each step is a real backend state change, revealed in sequence. */
export async function runDemo(navigate: (to: string) => void) {
  const token = ++runToken;
  useDemo.setState({ open: true, running: true, current: 0, steps: [], error: null });
  try {
    for (let n = 1; n <= DEMO_TITLES.length; n++) {
      if (token !== runToken) return;
      useDemo.setState({ current: n });
      const step = await post<DemoStep>(`/api/demo/step/${n}`);
      if (token !== runToken) return;
      useDemo.setState((s) => ({ steps: [...s.steps, step] }));
      useLive.getState().refresh();
      if (n <= 3) reloadFleet();
      if (useDemo.getState().follow) navigate(step.link);
      await sleep(STEP_MS);
    }
  } catch (e) {
    useDemo.setState({ error: (e as Error).message });
  } finally {
    if (token === runToken) useDemo.setState({ running: false, current: 0 });
  }
}

export function stopDemo() {
  runToken++;
  useDemo.setState({ running: false, current: 0 });
}
