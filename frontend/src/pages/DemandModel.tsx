import clsx from "clsx";
import { ArrowRight, CloudRain, Sun } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, ErrorNote, Kpi, Legend, Loading, Meter, MockTag, PageHeader, Panel, Stat, Tabs, axisProps, gridProps } from "../components/ui";
import { useApi } from "../lib/api";
import { C, fmtInt } from "../lib/format";
import type { DemandModelCard, DemandPrediction } from "../lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Consecutive rainy hours of the test week as [first label, last label] spans. */
function rainSpans(labels: string[], rain: number[]): [string, string][] {
  const spans: [string, string][] = [];
  rain.forEach((wet, i) => {
    if (!wet) return;
    if (i > 0 && rain[i - 1]) spans[spans.length - 1][1] = labels[i];
    else spans.push([labels[i], labels[i]]);
  });
  return spans;
}

export default function DemandModel() {
  const card = useApi<DemandModelCard>("/api/rides/model");
  const [zone, setZone] = useState(0);
  const [day, setDay] = useState(4);
  const [hour, setHour] = useState(17);
  const [rain, setRain] = useState<"dry" | "rain">("dry");
  const what = useApi<DemandPrediction>(`/api/rides/model/predict?zone=${zone}&hour=${hour}&day_of_week=${day}&rain=${rain === "rain"}`);

  const c = card.data;
  const m = c?.metrics;
  const series = useMemo(
    () => c?.test_week.labels.map((label, i) => ({ label, Actual: c.test_week.actual[zone][i], "AI model": c.test_week.predicted[zone][i], "Same hour last week": c.test_week.baseline[zone][i] })) ?? [],
    [c, zone],
  );
  const spans = useMemo(() => (c ? rainSpans(c.test_week.labels, c.test_week.rain) : []), [c]);
  const topShare = c?.importance[0]?.share_pct ?? 1;
  const p = what.data;

  return (
    <div>
      <PageHeader
        kicker="Energy · AI model"
        title="Demand Forecast Model"
        description="A gradient-boosted model trained on hourly ride history learns how passenger demand depends on time, place, weather and recent demand. It is scored on a week it never saw, against the usual naive forecast."
      >
        <MockTag>Real trained model · synthetic history</MockTag>
      </PageHeader>
      {card.error && <ErrorNote message={card.error} />}
      {card.loading && <Loading label="Training the model…" />}

      {c && m && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Average error" value={m.model.mae} unit="pickups / zone-hour" sub={`naive forecast: ${m.baseline.mae}`} tone="accent" />
            <Kpi label="Better than naive" value={m.mae_improvement_pct} unit="%" sub={`baseline: ${m.baseline_name.toLowerCase()}`} tone="good" />
            <Kpi label="Error as share of demand" value={m.model.wape_pct} unit="%" sub={`naive forecast: ${m.baseline.wape_pct}%`} />
            <Kpi label="Error in rainy hours" value={m.rain_hours ? m.rain_hours.model.mae : "—"} unit="pickups" sub={m.rain_hours ? `naive forecast: ${m.rain_hours.baseline.mae}` : "no rain in the test week"} tone="info" />
          </div>

          <Panel title="How the model is used" kicker="From vehicle signals to decisions" className="mb-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-ink-2">
              {c.pipeline.map((step, i) => (
                <span key={step} className="flex items-center gap-2">
                  <span className={clsx("rounded-md border px-2.5 py-1.5", step.includes("model") ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-raised")}>{step}</span>
                  {i < c.pipeline.length - 1 && <ArrowRight size={12} className="text-ink-3" />}
                </span>
              ))}
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-ink-3">
              {c.note} The <Link to="/energy/demand" className="text-accent hover:underline">Ride Demand 24h</Link> map still draws its typical-day picture from the zone rules; this model adds the day-specific forecast (day of week, rain, recent demand) shown here.
            </p>
          </Panel>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_372px]">
            <Panel
              title="Predicted vs actual, held-out week"
              kicker={`${c.zones[zone]} · pickups per hour`}
              action={
                <select value={zone} onChange={(e) => setZone(Number(e.target.value))} aria-label="Zone" className="h-7 rounded-md border border-line-strong bg-raised px-2 text-2xs text-ink">
                  {c.zones.map((z, i) => (
                    <option key={z} value={i}>{z}</option>
                  ))}
                </select>
              }
            >
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval={23} tickFormatter={(v: string) => v.slice(0, 3)} />
                    <YAxis {...axisProps} width={44} />
                    <Tooltip content={<ChartTooltip format={(v) => fmtInt(v)} />} />
                    {spans.map(([a, b]) => (
                      <ReferenceArea key={a} x1={a} x2={b} fill={C.info} fillOpacity={0.14} strokeOpacity={0} />
                    ))}
                    <Line type="monotone" dataKey="Same hour last week" stroke={C.prev} strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Actual" stroke={C.ink} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="AI model" stroke={C.s2} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2">
                <Legend
                  items={[
                    { label: "Actual pickups", color: C.ink, shape: "line" },
                    { label: "AI model forecast", color: C.s2, shape: "line" },
                    { label: "Naive: same hour last week", color: C.prev, shape: "line" },
                    { label: "Rain", color: C.info, shape: "square" },
                  ]}
                />
              </div>
            </Panel>

            <Panel title="Ask the model" kicker="What-if forecast">
              <div className="space-y-2.5">
                <label className="block">
                  <span className="label">Zone</span>
                  <select value={zone} onChange={(e) => setZone(Number(e.target.value))} className="mt-1 h-8 w-full rounded-md border border-line-strong bg-raised px-2 text-xs text-ink">
                    {c.zones.map((z, i) => (
                      <option key={z} value={i}>{z}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <span className="label">Day</span>
                  <div className="mt-1">
                    <Tabs value={String(day)} onChange={(v) => setDay(Number(v))} options={DAYS.map((d, i) => ({ value: String(i), label: d }))} />
                  </div>
                </div>
                <label className="block">
                  <div className="flex items-baseline justify-between">
                    <span className="label">Hour</span>
                    <span className="num text-xs text-ink">{hh(hour)}</span>
                  </div>
                  <input type="range" min={0} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="mt-1.5 w-full" style={{ ["--fill" as string]: `${(hour / 23) * 100}%` }} />
                </label>
                <div>
                  <span className="label">Weather</span>
                  <div className="mt-1">
                    <Tabs value={rain} onChange={setRain} options={[{ value: "dry", label: <span className="flex items-center gap-1"><Sun size={11} /> Dry</span> }, { value: "rain", label: <span className="flex items-center gap-1"><CloudRain size={11} /> Rain</span> }]} />
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2.5">
                <div className="label text-accent">Forecast</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="num text-[28px] font-medium leading-none text-ink">{p ? Math.round(p.predicted_pickups) : "—"}</span>
                  <span className="text-2xs text-ink-3">pickups in the hour</span>
                </div>
                {p && (
                  <div className="mt-2 border-t border-accent/20 pt-1.5">
                    <Stat label="EVs needed in the zone" value={p.evs_needed} />
                    <Stat label="Typical for this day and hour" value={Math.round(p.typical_pickups)} />
                    <Stat label="Effect of rain" value={`${p.rain_effect_pct > 0 ? "+" : ""}${p.rain_effect_pct}%`} tone="info" />
                  </div>
                )}
              </div>
              <p className="mt-2 text-3xs leading-relaxed text-ink-3">The training history only has rain between 13:00 and 23:00, so rain forecasts outside those hours are extrapolation.</p>
            </Panel>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel title="What the model relies on" kicker="Error added when a feature is scrambled" bodyClassName="p-0">
              <table className="table-grid w-full text-xs">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Comes from</th>
                    <th className="min-w-[180px]">Share of importance</th>
                  </tr>
                </thead>
                <tbody>
                  {c.importance.map((f) => (
                    <tr key={f.feature}>
                      <td className="font-medium">{f.label}</td>
                      <td className="text-ink-3">{f.source}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex-1"><Meter value={f.share_pct} max={topShare} tone="accent" /></div>
                          <span className="num w-12 text-right">{f.share_pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="Model card" kicker={c.name}>
              <dl className="space-y-2.5 text-xs">
                {[
                  ["Algorithm", c.algorithm],
                  ["Predicts", c.target],
                  ["Trained on", `${c.trained_on} (${fmtInt(c.training_rows)} rows)`],
                  ["Tested on", `${fmtInt(c.test_rows)} rows, ${c.test_period}`],
                  ["Fit (R²)", `${m.model.r2} for the model, ${m.baseline.r2} for the naive forecast`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="label">{k}</dt>
                    <dd className="mt-0.5 leading-relaxed text-ink-2">{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
