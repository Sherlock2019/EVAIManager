import clsx from "clsx";
import {
  Activity,
  BatteryCharging,
  Bot,
  BrainCircuit,
  Car,
  Crosshair,
  Database,
  Gauge,
  LayoutDashboard,
  LineChart,
  Network,
  Play,
  Radar,
  Route,
  ScanEye,
  SlidersHorizontal,
  Tags,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { runDemo, useDemo } from "../lib/demo";
import { fmtInt } from "../lib/format";
import { useLive } from "../lib/live";
import { DemoRunner } from "./DemoRunner";
import { PageGuide } from "./Guide";
import { Dot } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: "review" | "maintenance";
  end?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Intelligence",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/adas", label: "ADAS Intelligence", icon: ScanEye, end: true },
      { to: "/copilot", label: "AI Recommendations", icon: Bot },
    ],
  },
  {
    group: "ADAS",
    items: [
      { to: "/adas/labeling", label: "Labeling Pipeline", icon: Tags },
      { to: "/adas/review", label: "Human Review", icon: Crosshair, badge: "review" },
      { to: "/adas/edge-cases", label: "Edge Cases", icon: Radar },
      { to: "/adas/datasets", label: "Training Datasets", icon: Database },
      { to: "/adas/metrics", label: "Model Metrics", icon: LineChart },
    ],
  },
  {
    group: "Fleet",
    items: [
      { to: "/fleet", label: "Fleet Command", icon: Car, end: true },
      { to: "/fleet/health", label: "Vehicle Health", icon: Gauge },
      { to: "/fleet/maintenance", label: "Maintenance", icon: Wrench, badge: "maintenance" },
    ],
  },
  {
    group: "Energy",
    items: [
      { to: "/energy/charging", label: "Charging Network", icon: BatteryCharging },
      { to: "/energy/routes", label: "Route Intelligence", icon: Route },
      { to: "/energy/demand", label: "Ride Demand 24h", icon: Users },
      { to: "/energy/model", label: "Demand Forecast Model", icon: BrainCircuit },
    ],
  },
  {
    group: "System",
    items: [
      { to: "/system/architecture", label: "Architecture", icon: Network },
      { to: "/system/simulation", label: "Simulation Controls", icon: SlidersHorizontal },
    ],
  },
];

export const LOOP = ["Drive", "Observe", "Learn", "Predict", "Optimize", "Improve"];

function Sidebar() {
  const summary = useLive((s) => s.summary);
  const badge = (kind?: NavItem["badge"]) =>
    kind === "review" ? summary?.review_queue : kind === "maintenance" ? summary?.predicted_maintenance_cases : undefined;

  return (
    <nav className="flex w-[212px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((section) => (
          <div key={section.group} className="mb-4">
            <div className="label px-2 pb-1.5">{section.group}</div>
            {section.items.map((item) => {
              const count = badge(item.badge);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      "group relative mb-px flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors",
                      isActive ? "bg-raised text-ink shadow-[inset_0_0_0_1px_#18212F]" : "text-ink-2 hover:bg-raised/60 hover:text-ink",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute -left-2.5 top-1.5 h-4 w-0.5 rounded-r bg-accent" />}
                      <item.icon size={14} className={isActive ? "text-accent" : "text-ink-3 group-hover:text-ink-2"} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {count !== undefined && <span className="num rounded bg-abyss px-1 text-3xs text-ink-2">{fmtInt(count)}</span>}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-line px-4 py-3">
        <div className="label mb-1">Demo lab</div>
        <p className="text-3xs leading-relaxed text-ink-3">Independent technology demonstration on synthetic data. Not an official VinFast product.</p>
      </div>
    </nav>
  );
}

function HeaderStat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "crit" | "warn" }) {
  return (
    <div className="hidden border-l border-line px-3.5 lg:block">
      <div className="label">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={clsx("num text-sm font-medium", tone === "crit" ? "text-crit" : tone === "good" ? "text-good" : "text-ink")}>{value}</span>
        {sub && <span className="num text-3xs text-ink-3">{sub}</span>}
      </div>
    </div>
  );
}

function Header() {
  const summary = useLive((s) => s.summary);
  const connected = useLive((s) => s.connected);
  const running = summary?.live.running ?? false;
  const demoRunning = useDemo((s) => s.running);
  const navigate = useNavigate();

  return (
    <header className="flex h-[52px] shrink-0 items-center border-b border-line bg-panel pl-4 pr-3">
      <div className="flex w-[196px] shrink-0 items-center gap-2.5">
        {/* neutral lab mark (telemetry trace) — deliberately not a brand logo */}
        <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
          <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="#0F1621" stroke="#263347" />
          <path d="M6 18h5l3-8 4 13 3-9 2 4h3" fill="none" stroke="#3BC9F5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="leading-none">
          <div className="text-[13px] font-bold tracking-[0.32em] text-ink">VINFAST</div>
          <div className="mt-1 font-mono text-[8.5px] tracking-[0.2em] text-ink-3">AI MOBILITY INTELLIGENCE</div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-l border-line pl-4">
        <Dot tone={connected && running ? "good" : connected ? "warn" : "crit"} pulse={connected && running} />
        <span className="text-xs text-ink-2">{connected ? (running ? "Live Simulation" : "Simulation Paused") : "Connecting…"}</span>
      </div>

      {/* the loop tagline needs room; on narrower screens it lives on the Overview hero only */}
      <div className="mx-4 hidden min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden min-[1880px]:flex" aria-label="Drive, Observe, Learn, Predict, Optimize, Improve">
        {LOOP.map((word, i) => (
          <span key={word} className="flex items-center gap-1.5">
            <span className="font-mono text-2xs uppercase tracking-[0.16em] text-ink-2">{word}</span>
            {i < LOOP.length - 1 && <span className="text-accent/70">→</span>}
          </span>
        ))}
      </div>
      <div className="flex-1 min-[1880px]:hidden" />

      <HeaderStat label="Current Fleet" value={summary ? fmtInt(summary.active_vehicles) : "—"} sub="EVs online" />
      <HeaderStat label="Healthy Vehicles" value={summary ? `${summary.healthy_pct}%` : "—"} tone="good" />
      <HeaderStat label="ADAS Model" value={summary ? "Vision v6" : "—"} sub={summary ? `mAP ${summary.adas_model.map.toFixed(2)}` : undefined} />
      <HeaderStat label="Charging Network" value={summary ? summary.charging_stations : "—"} sub={summary ? `${summary.network_load_pct}% load` : undefined} />
      <HeaderStat label="Alerts" value={summary ? summary.alerts : "—"} tone={summary && summary.alerts > 0 ? "crit" : undefined} />

      <button
        onClick={() => (demoRunning ? useDemo.getState().setOpen(true) : void runDemo(navigate))}
        className="ml-3 inline-flex h-8 items-center gap-2 rounded-md bg-accent px-3.5 text-xs font-semibold tracking-wide text-abyss transition-colors hover:bg-[#6bd8f8]"
      >
        {demoRunning ? <Activity size={13} className="animate-pulse-dot" /> : <Play size={13} fill="currentColor" />}
        {demoRunning ? "DEMO RUNNING" : "RUN AI DEMO"}
      </button>
    </header>
  );
}

export function AppShell() {
  const demoOpen = useDemo((s) => s.open);
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className={clsx("min-w-0 flex-1 overflow-y-auto transition-[padding] duration-300", demoOpen && "xl:pr-[392px]")}>
          <div className="mx-auto max-w-[1720px] p-4">
            <PageGuide />
            <Outlet />
          </div>
        </main>
      </div>
      <DemoRunner />
    </div>
  );
}


