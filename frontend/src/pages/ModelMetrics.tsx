import { ArrowRight, UserCheck } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, ErrorNote, Legend, Loading, MockTag, PageHeader, Panel, Tabs, axisProps, gridProps } from "../components/ui";
import { useApi } from "../lib/api";
import { C, titleCase } from "../lib/format";
import type { ModelMetrics as Metrics } from "../lib/types";

type Dim = "object_class" | "weather" | "lighting" | "city" | "vehicle_type";
const DIMS: { value: Dim; label: string }[] = [
  { value: "object_class", label: "Object class" },
  { value: "weather", label: "Weather" },
  { value: "lighting", label: "Day / night" },
  { value: "city", label: "City" },
  { value: "vehicle_type", label: "Vehicle type" },
];
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

export default function ModelMetrics() {
  const metrics = useApi<Metrics>("/api/adas/model-metrics");
  const [dim, setDim] = useState<Dim>("object_class");
  const m = metrics.data;
  if (metrics.error) return <ErrorNote message={metrics.error} />;
  if (!m) return <Loading className="h-[60vh]" />;

  const [v5, v6] = m.models;
  const headline: { label: string; key: keyof typeof v6; lower?: boolean; raw?: boolean }[] = [
    { label: "Precision", key: "precision" },
    { label: "Recall", key: "recall" },
    { label: "mAP", key: "map", raw: true },
    { label: "False positive rate", key: "false_positive_rate", lower: true },
    { label: "False negative rate", key: "false_negative_rate", lower: true },
  ];
  const breakdown = m.breakdowns[dim].map((r) => ({ ...r, slice: titleCase(r.slice) }));
  const c = m.candidate;

  return (
    <div>
      <PageHeader kicker="ADAS · Model performance" title="ADAS Model Dashboard" description="ADAS Vision v6 against v5, sliced the way failures actually happen: by object class, weather, light, city and vehicle type.">
        <MockTag>Mock demo data · simulated metrics</MockTag>
      </PageHeader>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        {headline.map((h) => {
          const now = v6[h.key] as number;
          const before = v5[h.key] as number;
          const better = h.lower ? now < before : now > before;
          return (
            <div key={h.label} className="panel px-3.5 py-3">
              <div className="label">{h.label}</div>
              <div className="num mt-1.5 text-[22px] font-medium leading-none">{h.raw ? now.toFixed(2) : pct(now)}</div>
              <div className="num mt-1.5 flex items-center gap-1 text-2xs text-ink-3">
                v5 {h.raw ? before.toFixed(2) : pct(before)}
                <span className={better ? "text-good" : "text-crit"}>
                  {now > before ? "▲" : "▼"} {h.raw ? Math.abs(now - before).toFixed(2) : `${(Math.abs(now - before) * 100).toFixed(1)} pts`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Recall by Slice"
          kicker="ADAS Vision v5 vs v6"
          action={<Tabs value={dim} onChange={setDim} options={DIMS} />}
        >
          <div className="mb-2">
            <Legend items={[{ label: "ADAS Vision v5", color: C.prev, shape: "square" }, { label: "ADAS Vision v6", color: C.s1, shape: "square" }]} />
          </div>
          <div style={{ height: Math.max(220, breakdown.length * 42) }}>
            <ResponsiveContainer>
              <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 16 }} barGap={2} barCategoryGap={9}>
                <CartesianGrid stroke="#18212F" horizontal={false} />
                <XAxis type="number" domain={[0.5, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axisProps} />
                <YAxis type="category" dataKey="slice" width={112} {...axisProps} tick={{ ...axisProps.tick, fill: C.ink2 }} />
                <Tooltip content={<ChartTooltip format={(v) => pct(v)} />} cursor={{ fill: "#18212F" }} />
                <Bar dataKey="v5" name="ADAS Vision v5" fill={C.prev} radius={[0, 3, 3, 0]} barSize={9} isAnimationActive={false} />
                <Bar dataKey="v6" name="ADAS Vision v6" fill={C.s1} radius={[0, 3, 3, 0]} barSize={9} isAnimationActive={false} label={{ position: "right", fill: C.ink2, fontSize: 10, fontFamily: "JetBrains Mono", formatter: (v: number) => pct(v, 0) }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Why Human Feedback Matters" kicker="Before vs after corrections" action={<MockTag>Mock</MockTag>}>
            <div className="space-y-4">
              {m.feedback_impact.map((f) => (
                <div key={f.metric}>
                  <div className="text-xs font-medium">{f.metric}</div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div>
                      <div className="label">Before feedback</div>
                      <div className="num text-xl text-ink-2">{f.before}%</div>
                    </div>
                    <ArrowRight size={16} className="text-accent" />
                    <div>
                      <div className="label text-accent">After feedback</div>
                      <div className="num text-xl font-medium text-ink">{f.after}%</div>
                    </div>
                    <span className="num ml-auto rounded bg-good/10 px-1.5 py-0.5 text-2xs text-good">+{(f.after - f.before).toFixed(1)} pts</span>
                  </div>
                  {/* dumbbell on a shared 70-95% scale */}
                  <div className="relative mt-2 h-1 rounded-full bg-line">
                    <div className="absolute top-0 h-1 rounded-full bg-accent/60" style={{ left: `${((f.before - 70) / 25) * 100}%`, width: `${((f.after - f.before) / 25) * 100}%` }} />
                    <span className="absolute -top-[3px] h-2.5 w-2.5 rounded-full border-2 border-panel bg-ink-3" style={{ left: `calc(${((f.before - 70) / 25) * 100}% - 5px)` }} />
                    <span className="absolute -top-[3px] h-2.5 w-2.5 rounded-full border-2 border-panel bg-accent" style={{ left: `calc(${((f.after - 70) / 25) * 100}% - 5px)` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Next Candidate" kicker={c.name}>
            <div className="flex items-center gap-2 text-2xs text-ink-2">
              <UserCheck size={12} className="text-accent" />
              <span>
                <span className="num text-ink">{c.session_corrections}</span> human corrections captured this session · {c.trained_on}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { l: "Motorcycle recall", now: c.motorcycle_recall, base: c.baseline.motorcycle_recall, f: (v: number) => pct(v, 2) },
                { l: "Pedestrian recall", now: c.pedestrian_recall, base: c.baseline.pedestrian_recall, f: (v: number) => pct(v, 2) },
                { l: "mAP", now: c.map, base: c.baseline.map, f: (v: number) => v.toFixed(4) },
              ].map((x) => (
                <div key={x.l} className="rounded-md border border-line bg-raised px-2.5 py-2">
                  <div className="label">{x.l}</div>
                  <div className="num mt-1 text-sm">{x.f(x.now)}</div>
                  <div className={`num text-3xs ${x.now > x.base ? "text-good" : "text-ink-3"}`}>{x.now > x.base ? `▲ from ${x.f(x.base)}` : "no change yet"}</div>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-2xs leading-relaxed text-ink-3">Review a frame in the Human Review queue and this simulated candidate moves. The uplift per correction is a mock constant.</p>
          </Panel>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Panel title="Model Comparison" kicker="ADAS Vision v5 → v6" bodyClassName="p-0">
          <table className="table-grid w-full text-xs">
            <thead>
              <tr>
                <th>Metric</th>
                <th>v5</th>
                <th>v6</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {m.comparison.map((r) => {
                const better = r.lower_is_better ? r.v6 < r.v5 : r.v6 > r.v5;
                return (
                  <tr key={r.metric}>
                    <td className="font-medium">{r.metric}</td>
                    <td className="num text-ink-3">{r.v5.toFixed(r.metric === "mAP" ? 2 : 3)}</td>
                    <td className="num">{r.v6.toFixed(r.metric === "mAP" ? 2 : 3)}</td>
                    <td className={`num ${better ? "text-good" : "text-crit"}`}>
                      {r.v6 > r.v5 ? "+" : "−"}
                      {Math.abs(r.v6 - r.v5).toFixed(3)} {r.lower_is_better && <span className="text-3xs text-ink-3">lower is better</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title="mAP by Model Version" kicker="Each version trained on a richer dataset">
          <div className="h-[226px]">
            <ResponsiveContainer>
              <LineChart data={m.history} margin={{ top: 18, right: 24, bottom: 0, left: -14 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="version" {...axisProps} padding={{ left: 24, right: 24 }} />
                <YAxis domain={[0.6, 0.9]} {...axisProps} tickFormatter={(v: number) => v.toFixed(2)} />
                <Tooltip content={<ChartTooltip format={(v) => v.toFixed(2)} />} cursor={{ stroke: "#263347" }} />
                <Line type="monotone" dataKey="map" name="mAP" stroke={C.s1} strokeWidth={2} dot={{ r: 4, fill: C.s1, stroke: C.panel, strokeWidth: 2 }} isAnimationActive={false} label={{ position: "top", fill: C.ink2, fontSize: 10, fontFamily: "JetBrains Mono", formatter: (v: number) => v.toFixed(2) }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <p className="mt-3 text-3xs text-ink-3">{m.note}</p>
    </div>
  );
}
