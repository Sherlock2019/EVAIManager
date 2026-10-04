import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RoadScene } from "../components/RoadScene";
import { Badge, ChartTooltip, ErrorNote, Kpi, Loading, MockTag, PageHeader, Panel, Tabs, axisProps, gridProps } from "../components/ui";
import { useApi } from "../lib/api";
import { C, confidenceTone, fmtInt, titleCase, toneColor, type Tone } from "../lib/format";
import type { Frame, FramePage, PipelineStats } from "../lib/types";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  auto_accepted: { label: "Auto accepted", tone: "good" },
  sample_passed: { label: "Sample band · passed", tone: "warn" },
  pending_review: { label: "Pending review", tone: "crit" },
  human_accepted: { label: "Human accepted", tone: "accent" },
  human_corrected: { label: "Human corrected", tone: "accent" },
  human_rejected: { label: "Rejected", tone: "idle" },
};
type Dim = "weather" | "lighting" | "road_type" | "class";
const binColor = (lo: number) => (lo >= 0.9 ? C.good : lo >= 0.7 ? C.warn : C.crit);

export default function LabelingPipeline() {
  const stats = useApi<PipelineStats>("/api/adas/pipeline");
  const [status, setStatus] = useState("all");
  const [dim, setDim] = useState<Dim>("weather");
  const frames = useApi<FramePage>(`/api/adas/frames?limit=14${status === "all" ? "" : `&status=${status}`}`);
  const [picked, setPicked] = useState<Frame | null>(null);

  const s = stats.data;
  const preview = picked ?? frames.data?.items[0] ?? null;
  const breakdown = !s
    ? []
    : dim === "class"
      ? s.confidence_by_class.map((r) => ({ key: titleCase(r.key), value: r.avg_confidence }))
      : [...s.confidence_by[dim]].sort((a, b) => a.avg_confidence - b.avg_confidence).map((r) => ({ key: titleCase(r.key), value: r.avg_confidence }));

  return (
    <div>
      <PageHeader
        kicker="ADAS · Auto-label engine"
        title="Labeling Pipeline"
        description="The engine labels every frame, scores its own confidence and routes each frame by that score. Confidence falls in the conditions that make perception hard."
      >
        <MockTag>Simulated confidence logic</MockTag>
      </PageHeader>
      {stats.error && <ErrorNote message={stats.error} />}

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Frames in sample" value={s ? fmtInt(s.total_frames) : "—"} sub={s ? `${fmtInt(s.total_labels)} object labels` : undefined} />
        <Kpi label="Auto accept" value={s ? fmtInt(s.routing.auto_accept) : "—"} sub="confidence ≥ 0.90" tone="good" />
        <Kpi label="Sample review" value={s ? fmtInt(s.routing.sample_review) : "—"} sub="0.70 – 0.89 · QC sampled" tone="warn" />
        <Kpi label="Mandatory human review" value={s ? fmtInt(s.routing.human_review) : "—"} sub="confidence < 0.70" tone="crit" />
        <Kpi label="Review queue" value={s ? fmtInt(s.review_queue) : "—"} sub="mandatory + QC sample" tone="accent" />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Frame Confidence Distribution" kicker="Weakest label per frame decides the route">
          {s ? (
            <>
              <div className="h-[230px]">
                <ResponsiveContainer>
                  <BarChart data={s.histogram} margin={{ top: 16, right: 8, bottom: 0, left: -14 }} barCategoryGap={2}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="bin" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip content={<ChartTooltip format={(v) => `${fmtInt(v)} frames`} />} cursor={{ fill: "#18212F" }} />
                    <ReferenceLine x="0.70" stroke={C.ink3} strokeDasharray="4 4" label={{ value: "0.70 human review", position: "top", fill: C.ink2, fontSize: 9, fontFamily: "JetBrains Mono" }} />
                    <ReferenceLine x="0.90" stroke={C.ink3} strokeDasharray="4 4" label={{ value: "0.90 auto accept", position: "top", fill: C.ink2, fontSize: 9, fontFamily: "JetBrains Mono" }} />
                    <Bar dataKey="count" name="Frames" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {s.histogram.map((b) => (
                        <Cell key={b.bin} fill={binColor(b.lo)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-ink-2">
                {[
                  { l: "Mandatory human review", c: C.crit },
                  { l: "Sample review", c: C.warn },
                  { l: "Auto accept", c: C.good },
                ].map((x) => (
                  <span key={x.l} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: x.c }} />
                    {x.l}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <Loading />
          )}
        </Panel>

        <Panel
          title="Average Confidence by Condition"
          kicker="Where the model struggles"
          action={
            <Tabs
              value={dim}
              onChange={setDim}
              options={[
                { value: "weather", label: "Weather" },
                { value: "lighting", label: "Lighting" },
                { value: "road_type", label: "Road" },
                { value: "class", label: "Object class" },
              ]}
            />
          }
        >
          {s ? (
            <div className="h-[230px]">
              <ResponsiveContainer>
                <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 12 }} barCategoryGap={6}>
                  <CartesianGrid stroke="#18212F" horizontal={false} />
                  <XAxis type="number" domain={[0.5, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axisProps} />
                  <YAxis type="category" dataKey="key" width={96} {...axisProps} tick={{ ...axisProps.tick, fill: C.ink2 }} />
                  <Tooltip content={<ChartTooltip format={(v) => `${(v * 100).toFixed(1)}%`} />} cursor={{ fill: "#18212F" }} />
                  <Bar dataKey="value" name="Avg confidence" fill={C.s1} radius={[0, 3, 3, 0]} barSize={14} isAnimationActive={false} label={{ position: "right", fill: C.ink2, fontSize: 10, fontFamily: "JetBrains Mono", formatter: (v: number) => `${Math.round(v * 100)}%` }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Loading />
          )}
          {s && (
            <div className="mt-2 border-t border-line pt-2.5">
              <div className="label mb-1.5">Confidence penalties applied by the engine</div>
              <div className="flex flex-wrap gap-1">
                {Object.values(s.penalties)
                  .flatMap((group) => Object.entries(group))
                  .filter(([, v]) => v > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <span key={k} className="rounded border border-line px-1.5 py-0.5 text-3xs text-ink-2">
                      {titleCase(k)} <span className="num text-crit">−{(v * 100).toFixed(0)}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel
          title="Frames"
          kicker={`${fmtInt(frames.data?.total ?? 0)} matching`}
          bodyClassName="p-0"
          action={
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPicked(null); }} className="h-7 rounded-md border border-line-strong bg-raised px-2 text-2xs text-ink">
              <option value="all">All label statuses</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="table-grid w-full text-xs">
              <thead>
                <tr>
                  <th>Frame</th>
                  <th>Vehicle</th>
                  <th>Conditions</th>
                  <th>Objects</th>
                  <th>Confidence</th>
                  <th>Label status</th>
                  <th>Dataset</th>
                </tr>
              </thead>
              <tbody>
                {frames.data?.items.map((f) => (
                  <tr key={f.frame_id} className="cursor-pointer" onClick={() => setPicked(f)} style={preview?.frame_id === f.frame_id ? { background: "#0F1621" } : undefined}>
                    <td className="num">{f.frame_id}</td>
                    <td className="num text-ink-2">{f.vehicle_id.slice(-4)}</td>
                    <td className="text-ink-2">{titleCase(f.weather)} · {f.lighting} · {titleCase(f.road_type)}</td>
                    <td className="num">{f.objects_detected}</td>
                    <td className="num" style={{ color: toneColor[confidenceTone(f.model_confidence)] }}>{(f.model_confidence * 100).toFixed(0)}%</td>
                    <td><Badge tone={STATUS[f.label_status]?.tone ?? "idle"}>{STATUS[f.label_status]?.label ?? f.label_status}</Badge></td>
                    <td className="num text-ink-3">{f.dataset_version ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {frames.loading && <Loading />}
        </Panel>
        <Panel title="Frame Preview" kicker={preview?.frame_id ?? "—"}>
          {preview ? (
            <>
              <RoadScene frame={preview} />
              <div className="mt-2.5 flex items-center justify-between text-2xs text-ink-2">
                <span>{titleCase(preview.scenario_category)}</span>
                {preview.label_status === "pending_review" && (
                  <Link to={`/adas/review?frame=${preview.frame_id}`} className="text-accent hover:underline">
                    Review this frame →
                  </Link>
                )}
              </div>
            </>
          ) : (
            <Loading />
          )}
        </Panel>
      </div>
    </div>
  );
}
