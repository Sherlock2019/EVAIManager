import { ArrowRight, ChevronDown, ChevronUp, HelpCircle, Play } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { runDemo } from "../lib/demo";
import { C, fmtInt } from "../lib/format";
import { useLive } from "../lib/live";
import { APP_PURPOSE, MAIN_FEATURES, PAGE_GUIDE, PITCH, PROBLEMS } from "../lib/guide";
import { Button } from "./ui";

const HIDE_KEY = "guide-hidden";

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false; // storage blocked: just show the guide
  }
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-1">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-2 text-2xs leading-relaxed text-ink-2">
          <span className="num mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-3xs font-bold text-accent">{i + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function PitchCard({ n, color, label, lead, children }: { n: number; color: string; label: string; lead: string; children: ReactNode }) {
  return (
    <div className="relative border-b border-line px-5 py-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
      <div className="flex items-center gap-2">
        <span className="num flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-abyss" style={{ background: color }}>{n}</span>
        <span className="font-mono text-xs font-bold uppercase tracking-[0.14em]" style={{ color }}>{label}</span>
      </div>
      <p className="mt-2.5 text-[15px] font-semibold leading-snug tracking-tight text-ink">{lead}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Bullets({ items, color }: { items: string[]; color: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-xs leading-snug text-ink-2">
          <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Bar above every page: what it is for, the problem it solves, how to use it. */
export function PageGuide() {
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(readHidden);
  const guide = PAGE_GUIDE[pathname];
  if (!guide || pathname === "/") return null; // the Overview carries the full guide itself

  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      /* preference simply is not remembered */
    }
  };

  return (
    <aside className="mb-4 rounded-lg border border-accent/30 bg-accent/[0.04]">
      <button onClick={toggle} className="flex w-full items-center gap-2 px-4 py-2 text-left">
        <HelpCircle size={13} className="shrink-0 text-accent" />
        <span className="label text-accent">What this page is for · how to use it</span>
        {hidden && <span className="min-w-0 flex-1 truncate text-2xs text-ink-2">{guide.purpose}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-3xs text-ink-3">
          {hidden ? "Show" : "Hide"} {hidden ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>
      {!hidden && (
        <div className="grid gap-x-6 gap-y-3 border-t border-accent/20 px-4 py-3 md:grid-cols-3">
          <div>
            <div className="label mb-1">What it is for</div>
            <p className="text-xs leading-relaxed text-ink">{guide.purpose}</p>
          </div>
          <div>
            <div className="label mb-1">Problem it solves</div>
            <p className="text-xs leading-relaxed text-ink-2">{guide.problem}</p>
          </div>
          <div>
            <div className="label mb-1">How to use it</div>
            <Steps steps={guide.steps} />
          </div>
        </div>
      )}
    </aside>
  );
}

/** Overview section: what the app is for, the problems it solves, each main feature and how to use it. */
export function AppGuide() {
  const navigate = useNavigate();
  const s = useLive((state) => state.summary);
  // each goal's current state, taken from the live simulation
  const figures: Record<string, string> = s
    ? {
        cars: `${s.predicted_maintenance_cases} cars flagged · ${s.risk_counts.CRITICAL} critical`,
        chargers: `${s.overloaded_stations} of ${s.charging_stations} stations overloaded`,
        planning: `${s.recommended_new_sites} new sites recommended`,
        rides: "24-hour forecast · 14 zones",
        adas: `${s.auto_labeled_pct}% auto-labeled · ${fmtInt(s.review_queue)} to review`,
      }
    : {};
  return (
    <section className="panel overflow-hidden">
      {/* the four questions a first-time visitor asks, in order */}
      <div className="border-b border-line">
        <PitchCard n={1} color={C.accent} label={PITCH.what.label} lead={PITCH.what.lead}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {PITCH.what.goals.map((g) => (
              <Link key={g.id} to={g.to} className="group flex flex-col rounded-md border border-line bg-raised px-3 py-2.5 transition-colors hover:border-accent/50">
                <div className="flex items-start justify-between gap-2">
                  <span className="label text-accent">{g.name}</span>
                  <ArrowRight size={12} className="mt-0.5 shrink-0 text-ink-3 group-hover:text-accent" />
                </div>
                <p className="mt-1.5 text-[13px] font-semibold leading-snug text-ink">{g.goal}</p>
                <p className="mt-1 flex-1 text-2xs leading-relaxed text-ink-3">{g.how}</p>
                <div className="num mt-2 border-t border-line pt-1.5 text-2xs text-ink-2">
                  <span className="label mr-1.5">In this demo</span>
                  {figures[g.id] ?? "…"}
                </div>
              </Link>
            ))}
          </div>
        </PitchCard>
      </div>
      <div className="grid border-b border-line md:grid-cols-3">
        <PitchCard n={2} color={C.good} label={PITCH.benefits.label} lead={PITCH.benefits.lead}>
          <Bullets items={PITCH.benefits.points} color={C.good} />
        </PitchCard>
        <PitchCard n={3} color={C.warn} label={PITCH.who.label} lead={PITCH.who.lead}>
          <ul className="space-y-1.5">
            {PITCH.who.roles.map((r) => (
              <li key={r.role}>
                <Link to={r.to} className="group block text-xs leading-snug">
                  <span className="font-medium text-ink group-hover:text-accent">{r.role}</span>
                  <span className="text-ink-3"> get {r.gets}</span>
                </Link>
              </li>
            ))}
          </ul>
        </PitchCard>
        <PitchCard n={4} color={C.info} label={PITCH.how.label} lead={PITCH.how.lead}>
          <ol className="space-y-1.5">
            {PITCH.how.steps.map((s, i) => (
              <li key={s.name} className="flex gap-2 text-xs leading-snug">
                <span className="num mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-3xs font-bold text-abyss" style={{ background: C.info }}>{i + 1}</span>
                <span><span className="font-medium text-ink">{s.name}.</span> <span className="text-ink-3">{s.text}</span></span>
              </li>
            ))}
          </ol>
        </PitchCard>
      </div>

      <div className="grid gap-x-8 gap-y-4 border-b border-line px-5 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <div className="label text-accent">In one line</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">{APP_PURPOSE.headline}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{APP_PURPOSE.summary}</p>
          <Button variant="primary" className="mt-4" onClick={() => void runDemo(navigate)}>
            <Play size={12} fill="currentColor" /> Start with the 2-minute guided demo
          </Button>
        </div>
        <div>
          <div className="label mb-2">The problems it solves</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROBLEMS.map((p) => (
              <Link key={p.area} to={p.to} className="group rounded-md border border-line bg-raised px-3 py-2.5 transition-colors hover:border-accent/50">
                <div className="flex items-center justify-between">
                  <span className="label text-ink-2">{p.area}</span>
                  <ArrowRight size={12} className="text-ink-3 group-hover:text-accent" />
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-ink-3"><span className="text-crit">Problem.</span> {p.problem}</p>
                <p className="mt-1 text-2xs leading-relaxed text-ink"><span className="text-good">This app.</span> {p.solution}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="label text-accent">Main features · how to use each one</div>
          <span className="text-2xs text-ink-3">Every page repeats its own guide at the top.</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {MAIN_FEATURES.map((f) => (
            <div key={f.to} className="flex flex-col rounded-md border border-line bg-raised px-3 py-2.5">
              <div className="text-[13px] font-semibold text-ink">{f.title}</div>
              <p className="mt-1 text-2xs leading-relaxed text-ink-2">{f.purpose}</p>
              <div className="label mb-1 mt-2.5">How to use it</div>
              <div className="flex-1">
                <Steps steps={f.steps} />
              </div>
              <Link to={f.to} className="mt-2.5 inline-flex items-center gap-1 text-2xs font-medium text-accent hover:underline">
                Open {f.title} <ArrowRight size={11} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
