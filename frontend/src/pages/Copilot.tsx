import clsx from "clsx";
import { ArrowRight, Bot, SendHorizontal, User } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, MockTag, PageHeader, Panel } from "../components/ui";
import { post, useApi } from "../lib/api";
import { fmtUsd, riskTone, toneColor } from "../lib/format";
import type { CopilotAnswer, EdgeCaseReport, Plan, Prediction } from "../lib/types";

interface Message {
  role: "user" | "ai";
  text: string;
  answer?: CopilotAnswer;
}

const GREETING: Message = {
  role: "ai",
  text: "I answer questions from the same simulated fleet, charging and ADAS data that drives the dashboards. I am a deterministic rules engine, not a language model.",
};

export default function Copilot() {
  const suggestions = useApi<string[]>("/api/copilot/suggestions");
  const maintenance = useApi<Prediction[]>("/api/maintenance/predictions?min_risk=HIGH&limit=4");
  const plan = useApi<Plan>("/api/chargers/recommendations");
  const edge = useApi<EdgeCaseReport>("/api/adas/edge-cases");
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // open with one worked example so the page shows what the copilot does
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const question = "Where should VinFast add charging capacity?";
    post<CopilotAnswer>("/api/copilot/ask", { question })
      .then((answer) => setMessages((m) => (m.length === 1 ? [...m, { role: "user", text: question }, { role: "ai", text: answer.answer, answer }] : m)))
      .catch(() => undefined);
  }, []);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const [answer] = await Promise.all([post<CopilotAnswer>("/api/copilot/ask", { question: q }), new Promise((r) => setTimeout(r, 450))]);
      setMessages((m) => [...m, { role: "ai", text: answer.answer, answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "ai", text: `I could not reach the backend (${(e as Error).message}).` }]);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };
  const followUps = [...messages].reverse().find((m) => m.answer)?.answer?.suggestions ?? suggestions.data ?? [];

  return (
    <div>
      <PageHeader kicker="Intelligence · Decision support" title="AI Recommendations" description="Every recommendation the three AI systems are making right now, plus a copilot that explains them in plain language.">
        <MockTag>Deterministic copilot · no external LLM</MockTag>
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel title="AI Copilot" kicker="Ask the platform" bodyClassName="flex flex-col p-0" className="h-[680px]">
          <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div key={i} className={clsx("flex animate-slide-in gap-2.5", m.role === "user" && "flex-row-reverse")}>
                <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", m.role === "ai" ? "bg-accent/15 text-accent" : "bg-raised text-ink-2")}>
                  {m.role === "ai" ? <Bot size={13} /> : <User size={13} />}
                </span>
                <div className={clsx("max-w-[640px] rounded-lg border px-3.5 py-2.5", m.role === "ai" ? "border-line bg-raised" : "border-accent/30 bg-accent/10")}>
                  <div className="label mb-1">{m.role === "ai" ? "AI" : "You"}</div>
                  <p className="whitespace-pre-line text-xs leading-relaxed text-ink">{m.text}</p>
                  {m.answer && m.answer.items.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {m.answer.items.map((item) => (
                        <div key={item.title} className="rounded-md border border-line bg-panel px-2.5 py-1.5">
                          <div className="num text-sm font-medium">{item.value}</div>
                          <div className="max-w-[150px] truncate text-3xs text-ink-2">{item.title}</div>
                          <div className="max-w-[150px] truncate text-3xs text-ink-3">{item.caption}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.answer?.link && (
                    <Link to={m.answer.link} className="mt-2.5 inline-flex items-center gap-1 text-2xs text-accent hover:underline">
                      Open the supporting dashboard <ArrowRight size={10} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
                  <Bot size={13} />
                </span>
                <div className="label animate-pulse-dot rounded-lg border border-line bg-raised px-3.5 py-3">Analysing dashboard data…</div>
              </div>
            )}
          </div>
          <div className="border-t border-line p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {followUps.slice(0, 5).map((s) => (
                <button key={s} onClick={() => void ask(s)} disabled={busy} className="rounded-full border border-line-strong px-2.5 py-1 text-2xs text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40">
                  {s}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about vehicles, chargers or ADAS scenarios…"
                className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-3 text-xs text-ink placeholder:text-ink-3"
              />
              <Button type="submit" variant="primary" className="h-9" disabled={busy || !input.trim()}>
                <SendHorizontal size={13} /> Ask
              </Button>
            </form>
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Vehicle Operations" kicker="Predictive maintenance" action={<Link to="/fleet/maintenance" className="text-2xs text-accent hover:underline">All cases →</Link>} bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {maintenance.data?.map((p) => (
                <li key={p.vehicle_id}>
                  <Link to={`/fleet/health?vehicle=${p.vehicle_id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-raised">
                    <span className="h-7 w-0.5 rounded" style={{ background: toneColor[riskTone[p.maintenance_risk]] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs">
                        <span className="num">{p.vehicle_id}</span> · {p.recommended_action}
                      </span>
                      <span className="block truncate text-2xs text-ink-3">{p.predicted_component} · within {p.predicted_days_to_service} days</span>
                    </span>
                    <Badge tone={riskTone[p.maintenance_risk]}>{p.maintenance_probability.toFixed(0)}%</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Charging Network" kicker="Planning engine" action={<Link to="/energy/charging?optimize=1" className="text-2xs text-accent hover:underline">Optimize →</Link>} bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {plan.data?.sites.filter((s) => s.recommended).slice(0, 2).map((s) => (
                <li key={s.name} className="flex items-center gap-3 px-4 py-2">
                  <Badge tone="info">ADD</Badge>
                  <span className="min-w-0 flex-1 truncate text-xs">{s.name}</span>
                  <span className="num text-xs">{s.score}/100</span>
                </li>
              ))}
              {plan.data?.expansions.slice(0, 1).map((s) => (
                <li key={s.name} className="flex items-center gap-3 px-4 py-2">
                  <Badge tone="warn">EXPAND</Badge>
                  <span className="min-w-0 flex-1 truncate text-xs">{s.name}</span>
                  <span className="num text-xs">+{s.add_ports} ports</span>
                </li>
              ))}
              {plan.data?.planned_sites.filter((p) => p.action === "DO NOT EXPAND").slice(0, 1).map((p) => (
                <li key={p.name} className="flex items-center gap-3 px-4 py-2">
                  <Badge tone="idle">DO NOT EXPAND</Badge>
                  <span className="min-w-0 flex-1 truncate text-xs">{p.name}</span>
                  <span className="num text-xs">{fmtUsd(p.avoided_investment_usd)}*</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-1.5 text-3xs text-ink-3">*illustrative mock estimate</p>
          </Panel>

          <Panel title="ADAS Training Data" kicker="Edge case miner" action={<Link to="/adas/edge-cases" className="text-2xs text-accent hover:underline">Scenarios →</Link>} bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {edge.data?.recommendations.slice(0, 3).map((r) => (
                <li key={r.scenario} className="flex items-start gap-3 px-4 py-2">
                  <Badge tone={riskTone[r.priority as "HIGH" | "CRITICAL"]}>{r.priority}</Badge>
                  <span className="text-xs text-ink-2">{r.text}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
