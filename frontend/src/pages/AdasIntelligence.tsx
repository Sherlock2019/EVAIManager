import clsx from "clsx";
import { ArrowDown, ArrowRight, Pause, Play, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RoadScene, classLabel } from "../components/RoadScene";
import { Badge, Button, Field, Loading, Meter, MockTag, PageHeader, Panel, Stat } from "../components/ui";
import { useApi } from "../lib/api";
import { confidenceTone, fmtInt, titleCase, toneColor, type Tone } from "../lib/format";
import type { FramePage, PipelineStats } from "../lib/types";

const ROUTING: { key: "auto_accept" | "sample_review" | "human_review"; label: string; rule: string; tone: Tone }[] = [
  { key: "auto_accept", label: "Auto accept", rule: "confidence ≥ 0.90", tone: "good" },
  { key: "sample_review", label: "Sample review", rule: "0.70 – 0.89", tone: "warn" },
  { key: "human_review", label: "Mandatory human review", rule: "< 0.70", tone: "crit" },
];
const routeOf = (c: number) => (c >= 0.9 ? ROUTING[0] : c >= 0.7 ? ROUTING[1] : ROUTING[2]);

function Node({ children, accent, sub }: { children: string; accent?: boolean; sub?: string }) {
  return (
    <div className={clsx("rounded-md border px-3 py-1.5 text-center", accent ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-raised text-ink")}>
      <div className="whitespace-nowrap text-xs font-medium">{children}</div>
      {sub && <div className="label mt-0.5">{sub}</div>}
    </div>
  );
}
const Down = () => <ArrowDown size={13} className="mx-auto my-1 text-ink-3" />;

/** The human-in-the-loop workflow from sensor to next training dataset. */
function Workflow() {
  return (
    <div className="mx-auto max-w-[520px]">
      <Node sub="sensors">Camera / LiDAR</Node>
      <Down />
      <div className="grid grid-cols-2 items-center gap-2">
        <Node>Data Ingestion</Node>
        <Node>Validation</Node>
      </div>
      <Down />
      <Node accent>Auto Labeling</Node>
      <Down />
      <Node>Confidence Score</Node>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {[
          { band: "HIGH", action: "Accept", tone: "good" as Tone },
          { band: "MEDIUM", action: "Sample Review", tone: "warn" as Tone },
          { band: "LOW", action: "Human Review", tone: "crit" as Tone },
        ].map((b) => (
          <div key={b.band} className="text-center">
            <Down />
            <div className="rounded-md border px-2 py-1.5" style={{ borderColor: `${toneColor[b.tone]}55`, background: `${toneColor[b.tone]}10` }}>
              <div className="label" style={{ color: toneColor[b.tone] }}>{b.band}</div>
              <div className="mt-0.5 text-xs font-medium">{b.action}</div>
            </div>
            {b.band === "LOW" && (
              <>
                <Down />
                <Node accent>Correction</Node>
              </>
            )}
          </div>
        ))}
      </div>
      <Down />
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
        {["Dataset Version", "Model Training", "Evaluation", "Deployment", "Production Monitoring", "Edge Case Mining"].map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <Node>{s}</Node>
            <ArrowRight size={12} className="text-ink-3" />
          </span>
        ))}
        <Node accent sub="↻ loop">Next Training Dataset</Node>
      </div>
    </div>
  );
}

export default function AdasIntelligence() {
  const stats = useApi<PipelineStats>("/api/adas/pipeline");
  // a varied slice of the frame sample to cycle through
  const frames = useApi<FramePage>("/api/adas/frames?limit=60&offset=4200");
  const [index, setIndex] = useState(42);
  const [playing, setPlaying] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  const items = frames.data?.items ?? [];
  useEffect(() => {
    if (!playing || !items.length) return;
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
      setSelected(null);
    }, 3500);
    return () => window.clearInterval(t);
  }, [playing, items.length]);

  const frame = items[index % Math.max(1, items.length)];
  const total = stats.data?.total_frames ?? 0;

  return (
    <div>
      <PageHeader
        kicker="POC 1 · ADAS data & human-in-the-loop"
        title="ADAS Intelligence"
        description="ADAS needs enormous amounts of accurately labeled data. Manual labeling is slow, expensive and hard to scale; AI-only labeling lets wrong labels silently enter training sets. The answer is both, joined by confidence."
      >
        <MockTag>Simulated perception · not a production ADAS model</MockTag>
      </PageHeader>

      <div className="mb-3 grid gap-3 md:grid-cols-4">
        {[
          { t: "AI Auto-Label", d: "Every frame is labeled by the model first." },
          { t: "Confidence Scoring", d: "Difficult scenes score lower: night, rain, fog, occlusion." },
          { t: "Human Review", d: "Only uncertain labels reach a person." },
          { t: "Feedback Loop", d: "Corrections become the next training dataset." },
        ].map((x, i) => (
          <div key={x.t} className="panel relative px-4 py-3">
            <span className="num absolute right-3 top-2.5 text-2xs text-ink-3">0{i + 1}</span>
            <div className="text-xs font-semibold uppercase tracking-wider text-accent">{x.t}</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">{x.d}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Frame Visualizer"
          kicker="Synthetic camera frame · simulated detections"
          action={
            <>
              <Button size="sm" onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause size={11} /> : <Play size={11} />} {playing ? "Pause" : "Auto-play"}
              </Button>
              <Button size="sm" onClick={() => { setIndex((i) => (i + 1) % Math.max(1, items.length)); setSelected(null); }}>
                <SkipForward size={11} /> Next frame
              </Button>
            </>
          }
        >
          {frame ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
              <RoadScene frame={frame} selectedId={selected} onSelect={setSelected} />
              <div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <Field label="Frame" value={frame.frame_id} />
                  <Field label="Vehicle" value={frame.vehicle_id} />
                  <Field label="Speed" value={`${frame.speed_kmh.toFixed(0)} km/h`} />
                  <Field label="Time" value={frame.timestamp.slice(11, 16)} />
                  <Field label="Weather" value={titleCase(frame.weather)} />
                  <Field label="Lighting" value={titleCase(frame.lighting)} />
                  <div className="col-span-2">
                    <Field label="GPS" value={`${frame.latitude.toFixed(4)}, ${frame.longitude.toFixed(4)}`} />
                  </div>
                </div>
                <div className="mt-3 rounded-md border border-line bg-raised p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="label">Model confidence</span>
                    <span className="num text-sm" style={{ color: toneColor[confidenceTone(frame.model_confidence)] }}>
                      {Math.round(frame.model_confidence * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={frame.model_confidence} tone={confidenceTone(frame.model_confidence)} marker={0.7} />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="label">Routing</span>
                    <Badge tone={routeOf(frame.model_confidence).tone}>{routeOf(frame.model_confidence).label}</Badge>
                  </div>
                </div>
                <div className="label mb-1 mt-3">Detected objects · {frame.objects_detected}</div>
                <ul className="space-y-0.5">
                  {frame.objects.map((o) => (
                    <li key={o.id}>
                      <button onClick={() => setSelected(o.id)} className={clsx("flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-2xs hover:bg-raised", selected === o.id && "bg-raised")}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-sm" style={{ background: toneColor[confidenceTone(o.confidence)] }} />
                          {classLabel(o.cls)}
                        </span>
                        <span className="num">{Math.round(o.confidence * 100)}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <Loading label="Loading frames…" />
          )}
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Confidence Routing" kicker={`${fmtInt(total)} frames in sample`}>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-sm">
              {ROUTING.map((r) => (
                <span key={r.key} style={{ width: `${total ? ((stats.data?.routing[r.key] ?? 0) / total) * 100 : 33}%`, background: toneColor[r.tone] }} />
              ))}
            </div>
            <div className="mt-3 space-y-2.5">
              {ROUTING.map((r) => {
                const n = stats.data?.routing[r.key] ?? 0;
                return (
                  <div key={r.key} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-sm" style={{ background: toneColor[r.tone] }} />
                      <div>
                        <div className="text-xs">{r.label}</div>
                        <div className="num text-3xs text-ink-3">{r.rule}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-sm">{fmtInt(n)}</div>
                      <div className="num text-3xs text-ink-3">{total ? ((n / total) * 100).toFixed(1) : "—"}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 border-t border-line pt-2.5">
              <Stat label="Labels in sample" value={fmtInt(stats.data?.total_labels ?? 0)} />
              <Stat label="Frames in review queue" value={fmtInt(stats.data?.review_queue ?? 0)} tone="warn" />
            </div>
            <Link to="/adas/review">
              <Button variant="primary" className="mt-2 w-full">
                Open Human Review Queue <ArrowRight size={12} />
              </Button>
            </Link>
          </Panel>
        </div>
      </div>

      <Panel title="Human-in-the-Loop Workflow" kicker="From sensor to next training dataset" className="mt-3">
        <Workflow />
      </Panel>
    </div>
  );
}
