import { ArrowRight, ChevronDown, ChevronUp, HelpCircle, Play } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { runDemo } from "../lib/demo";
import { APP_PURPOSE, MAIN_FEATURES, PAGE_GUIDE, PROBLEMS } from "../lib/guide";
import { Badge, Button } from "./ui";

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
  return (
    <section className="panel overflow-hidden">
      <div className="grid gap-x-8 gap-y-4 border-b border-line px-5 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <div className="label text-accent">What this app is for</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">{APP_PURPOSE.headline}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{APP_PURPOSE.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Built for</span>
            {APP_PURPOSE.audience.map((a) => (
              <Badge key={a} tone="accent">{a}</Badge>
            ))}
          </div>
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
