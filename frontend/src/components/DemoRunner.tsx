import clsx from "clsx";
import { ArrowRight, Check, Play, Square, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DEMO_TITLES, runDemo, stopDemo, useDemo } from "../lib/demo";
import type { Tone } from "../lib/format";
import { Badge, Button } from "./ui";

const SYSTEM_TONE: Record<string, Tone> = { FLEET: "good", CHARGING: "info", ADAS: "accent" };
const SYSTEM_OF_STEP = ["FLEET", "FLEET", "FLEET", "FLEET", "CHARGING", "CHARGING", "CHARGING", "ADAS", "ADAS", "ADAS", "ADAS"];

/** Side drawer that narrates the 11-step guided demo while the dashboards update behind it. */
export function DemoRunner() {
  const { open, running, current, steps, follow, error, setOpen, setFollow } = useDemo();
  const navigate = useNavigate();
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [steps.length, current]);

  if (!open) return null;
  const done = steps.length === DEMO_TITLES.length && !running;

  return (
    <aside className="fixed bottom-3 right-3 top-[60px] z-[1200] flex w-[380px] max-w-[calc(100vw-24px)] flex-col rounded-lg border border-line-strong bg-panel/95 shadow-2xl backdrop-blur">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="label text-accent">Guided demo</div>
            <h2 className="mt-0.5 text-sm font-semibold">One fleet, three feedback loops</h2>
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-ink-3 hover:bg-raised hover:text-ink" aria-label="Close demo panel">
            <X size={16} />
          </button>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden>
          {DEMO_TITLES.map((_, i) => (
            <span
              key={i}
              className={clsx("h-1 flex-1 rounded-full transition-colors duration-500", i < steps.length ? "bg-accent" : i + 1 === current ? "animate-pulse-dot bg-accent/60" : "bg-line")}
            />
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="num text-2xs text-ink-3">
            {steps.length}/{DEMO_TITLES.length} steps{done ? " · complete" : running ? " · running" : ""}
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-2xs text-ink-2">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[#3BC9F5]" />
            Follow along on dashboards
          </label>
        </div>
      </header>

      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {DEMO_TITLES.map((title, i) => {
          const n = i + 1;
          const step = steps[i];
          const active = n === current && !step;
          const system = SYSTEM_OF_STEP[i];
          return (
            <li
              key={n}
              ref={active || (step && n === steps.length) ? activeRef : undefined}
              className={clsx("rounded-md border px-3 py-2.5 transition-colors", step ? "animate-slide-in border-line-strong bg-raised" : active ? "border-accent/50 bg-accent/5" : "border-transparent opacity-45")}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={clsx(
                    "num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-3xs font-bold",
                    step ? "bg-accent text-abyss" : active ? "border border-accent text-accent" : "border border-line-strong text-ink-3",
                  )}
                >
                  {step ? <Check size={11} strokeWidth={3} /> : n}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink">{title}</span>
                    <Badge tone={SYSTEM_TONE[system]}>{system}</Badge>
                  </div>
                  {active && <div className="label mt-1 animate-pulse-dot text-accent">Processing…</div>}
                  {step && (
                    <>
                      <p className="mt-1 text-2xs leading-relaxed text-ink-2">{step.detail}</p>
                      {step.metrics.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {step.metrics.map((m) => (
                            <div key={m.label} className="flex items-center justify-between gap-2 rounded bg-abyss px-2 py-1">
                              <span className="label">{m.label}</span>
                              <span className="num flex items-center gap-1.5 text-2xs">
                                {m.before !== null && (
                                  <>
                                    <span className="text-ink-3">{m.before}</span>
                                    <ArrowRight size={10} className="text-ink-3" />
                                  </>
                                )}
                                <span className="font-medium text-ink">{m.after}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <button onClick={() => navigate(step.link)} className="mt-2 inline-flex items-center gap-1 text-2xs text-accent hover:underline">
                        Open on dashboard <ArrowRight size={10} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="border-t border-line px-4 py-3">
        {error && <p className="mb-2 text-2xs text-crit">Demo stopped: {error}</p>}
        {done && (
          <p className="mb-2.5 text-2xs leading-relaxed text-ink-2">
            Data created intelligence, intelligence created decisions, a human validated the important one, and the action became new training data.
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-3xs text-ink-3">Synthetic data · simulated models</span>
          {running ? (
            <Button variant="danger" size="sm" onClick={stopDemo}>
              <Square size={11} /> Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => void runDemo(navigate)}>
              <Play size={11} /> {steps.length ? "Run again" : "Start"}
            </Button>
          )}
        </div>
      </footer>
    </aside>
  );
}
