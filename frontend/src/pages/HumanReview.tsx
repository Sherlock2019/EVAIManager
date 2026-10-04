import clsx from "clsx";
import { ArrowRight, Check, CheckCircle2, PencilLine, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RoadScene, classLabel } from "../components/RoadScene";
import { Badge, Button, ErrorNote, Field, Loading, PageHeader, Panel, Slider } from "../components/ui";
import { post, useApi } from "../lib/api";
import { useDemo } from "../lib/demo";
import { confidenceTone, fmtInt, titleCase, toneColor } from "../lib/format";
import { useLive } from "../lib/live";
import type { Detection, Frame, FramePage, ReviewResponse } from "../lib/types";

const CLASSES = ["car", "truck", "bus", "motorcycle", "bicycle", "pedestrian", "traffic_light", "traffic_sign"];
type Mode = "idle" | "correct" | "add";
type Box = [number, number, number, number];
const NEW_ID = -1;

const clampBox = ([x, y, w, h]: Box): Box => {
  const cw = Math.min(0.9, Math.max(0.015, w));
  const ch = Math.min(0.9, Math.max(0.02, h));
  return [Math.min(1 - cw, Math.max(0, x)), Math.min(1 - ch, Math.max(0, y)), cw, ch];
};

/** Sliders that stand in for dragging the box handles. */
function BoxEditor({ box, onChange }: { box: Box; onChange: (b: Box) => void }) {
  const set = (i: number, v: number) => {
    const next = [...box] as Box;
    next[i] = v / 100;
    onChange(clampBox(next));
  };
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
      {["Left", "Top", "Width", "Height"].map((label, i) => (
        <Slider key={label} label={label} unit="%" min={i < 2 ? 0 : 2} max={i < 2 ? 95 : 60} step={0.5} value={Math.round(box[i] * 200) / 2} onChange={(v) => set(i, v)} />
      ))}
    </div>
  );
}

export default function HumanReview() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get("frame");
  const queue = useApi<FramePage>("/api/adas/review-queue?limit=40");
  const pinned = useApi<Frame>(wanted ? `/api/adas/frames/${wanted}` : null);
  const refresh = useLive((s) => s.refresh);
  const demoOpen = useDemo((s) => s.open);

  const [currentId, setCurrentId] = useState<string | null>(wanted);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [draftCls, setDraftCls] = useState("motorcycle");
  const [draftConf, setDraftConf] = useState(100);
  const [draftBox, setDraftBox] = useState<Box>([0.4, 0.5, 0.1, 0.15]);
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wanted) setCurrentId(wanted);
  }, [wanted]);

  const items = queue.data?.items ?? [];
  const frame: Frame | null = useMemo(() => {
    if (result && result.frame.frame_id === currentId) return result.frame;
    if (pinned.data && pinned.data.frame_id === currentId) return pinned.data;
    return items.find((f) => f.frame_id === currentId) ?? items[0] ?? null;
  }, [result, pinned.data, items, currentId]);

  // default selection: the weakest label, which is why the frame is here
  useEffect(() => {
    if (!frame) return;
    setMode("idle");
    setError(null);
    const weakest = [...frame.objects].sort((a, b) => a.confidence - b.confidence)[0];
    setSelected(weakest?.id ?? null);
  }, [frame?.frame_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedObj = frame?.objects.find((o) => o.id === selected) ?? null;
  const reviewed = frame ? frame.label_status !== "pending_review" : false;

  const open = (id: string) => {
    setResult(null);
    setCurrentId(id);
    setParams({}, { replace: true });
  };
  const next = () => {
    const remaining = items.filter((f) => f.frame_id !== frame?.frame_id);
    if (remaining[0]) open(remaining[0].frame_id);
  };
  const startCorrect = () => {
    if (!selectedObj) return;
    setDraftCls(selectedObj.cls);
    setDraftConf(100);
    setDraftBox(selectedObj.bbox);
    setMode("correct");
  };
  const startAdd = () => {
    setDraftCls("pedestrian");
    setDraftBox([0.46, 0.5, 0.05, 0.13]);
    setMode("add");
  };
  const submit = async (body: unknown) => {
    if (!frame) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<ReviewResponse>(`/api/adas/review/${frame.frame_id}`, body);
      setCurrentId(frame.frame_id);
      setResult(res);
      setMode("idle");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // unsaved edits drawn on the frame
  const overrides: Record<number, Partial<Detection>> | undefined = mode === "correct" && selectedObj ? { [selectedObj.id]: { cls: draftCls, bbox: draftBox } } : undefined;
  const sceneFrame: Frame | null =
    frame && mode === "add"
      ? { ...frame, objects: [...frame.objects, { id: NEW_ID, cls: draftCls, confidence: 1, bbox: draftBox, occluded: false, small: false, factors: [], source: "human" }] }
      : frame;

  return (
    <div>
      <PageHeader
        kicker="ADAS · Human-in-the-loop"
        title="Human Review Queue"
        description="Only labels the model is unsure about reach a reviewer. Every decision here is written back to the next training dataset."
      >
        <div className="text-right">
          <div className="label">Frames awaiting review</div>
          <div className="num text-xl font-medium text-warn">{queue.data ? fmtInt(queue.data.total) : "—"}</div>
        </div>
      </PageHeader>
      {queue.error && <ErrorNote message={queue.error} />}

      {/* with the guided-demo panel docked on the right, the queue column gives its width to the frame */}
      <div className={clsx("grid gap-3", demoOpen ? "xl:grid-cols-[minmax(0,1fr)_330px]" : "xl:grid-cols-[210px_minmax(0,1fr)_330px]")}>
        {/* queue */}
        <Panel title="Queue" kicker="Lowest confidence first" bodyClassName="p-0" className={clsx("max-xl:order-3", demoOpen && "xl:hidden")}>
          <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
            {items.map((f) => (
              <li key={f.frame_id}>
                <button onClick={() => open(f.frame_id)} className={clsx("flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-raised", frame?.frame_id === f.frame_id && "bg-raised shadow-[inset_2px_0_0_#3BC9F5]")}>
                  <span className="min-w-0 flex-1">
                    <span className="num block text-2xs">{f.frame_id}</span>
                    <span className="block truncate text-3xs text-ink-3">{titleCase(f.scenario_category)}</span>
                  </span>
                  <span className="num text-xs" style={{ color: toneColor[confidenceTone(f.model_confidence)] }}>
                    {Math.round(f.model_confidence * 100)}%
                  </span>
                </button>
              </li>
            ))}
            {queue.loading && <Loading />}
          </ul>
        </Panel>

        {/* viewer */}
        <Panel
          title={frame ? `Camera Frame · ${frame.frame_id}` : "Camera Frame"}
          kicker={frame ? `${frame.vehicle_id} · ${frame.city}` : undefined}
          action={frame && <Badge tone={reviewed ? "accent" : "crit"}>{reviewed ? titleCase(frame.label_status) : "Needs human review"}</Badge>}
        >
          {sceneFrame && frame ? (
            <>
              <RoadScene frame={sceneFrame} selectedId={mode === "add" ? NEW_ID : selected} onSelect={mode === "idle" ? setSelected : undefined} overrides={overrides} />
              <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-x-6 gap-y-2.5">
                <Field label="Scenario" value={titleCase(frame.scenario_category)} />
                <Field label="Weather" value={titleCase(frame.weather)} />
                <Field label="Lighting" value={titleCase(frame.lighting)} />
                <Field label="Road" value={titleCase(frame.road_type)} />
                <Field label="Speed" value={`${frame.speed_kmh.toFixed(0)} km/h`} />
                <Field label="Captured" value={frame.timestamp.slice(11, 16)} />
              </div>
              {selectedObj && selectedObj.factors.length > 0 && mode === "idle" && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
                  <span className="label">Why confidence is low</span>
                  {selectedObj.factors.map((f) => (
                    <span key={f} className="rounded border border-line px-1.5 py-0.5 text-3xs text-ink-2">{titleCase(f)}</span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Loading label={queue.loading ? "Loading queue…" : "Queue is empty"} />
          )}
        </Panel>

        {/* reviewer console */}
        <div className="flex flex-col gap-3">
          <Panel title="AI Detections" kicker="Select a label">
            <ul className="space-y-1">
              {frame?.objects.map((o) => {
                const human = o.source !== "ai";
                return (
                  <li key={o.id}>
                    <button
                      onClick={() => mode === "idle" && setSelected(o.id)}
                      className={clsx("flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left transition-colors", selected === o.id ? "border-accent/60 bg-raised" : "border-line hover:bg-raised")}
                    >
                      <span>
                        <span className="block text-xs font-medium">{titleCase(o.cls)}</span>
                        {o.original_cls && (
                          <span className="block text-3xs text-ink-3">
                            was {titleCase(o.original_cls)} · AI {Math.round((o.original_confidence ?? 0) * 100)}%
                          </span>
                        )}
                      </span>
                      {human ? (
                        <Badge tone="accent"><Check size={9} /> Human</Badge>
                      ) : (
                        <span className="num text-xs" style={{ color: toneColor[confidenceTone(o.confidence)] }}>AI: {Math.round(o.confidence * 100)}%</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {result && result.frame.frame_id === frame?.frame_id ? (
            <div className="panel animate-slide-in border-accent/50 p-4">
              <div className="flex items-center gap-2 text-accent">
                <CheckCircle2 size={16} />
                <span className="font-mono text-xs font-bold tracking-[0.14em]">{result.headline}</span>
              </div>
              <p className="mt-2 text-sm text-ink">“{result.message}”</p>
              {result.dataset_version && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-line bg-raised px-2.5 py-1.5">
                    <div className="label">{result.dataset.version} new frames</div>
                    <div className="num text-sm">{fmtInt(result.dataset.frames_added)}</div>
                  </div>
                  <div className="rounded-md border border-line bg-raised px-2.5 py-1.5">
                    <div className="label">Human corrections</div>
                    <div className="num text-sm">{fmtInt(result.dataset.human_corrections)}</div>
                  </div>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <Button variant="primary" className="flex-1" onClick={next}>
                  Next frame <ArrowRight size={12} />
                </Button>
                <Link to="/adas/datasets">
                  <Button>View dataset</Button>
                </Link>
              </div>
            </div>
          ) : reviewed ? (
            <div className="panel p-4 text-xs text-ink-2">
              This frame has already been reviewed ({titleCase(frame?.label_status ?? "")}).
              <Button className="mt-3 w-full" onClick={next}>Next frame in queue <ArrowRight size={12} /></Button>
            </div>
          ) : (
            <Panel title="Reviewer Actions" kicker={mode === "idle" ? "Decide" : mode === "correct" ? "Correct label" : "Add missed object"}>
              {error && <p className="mb-2 text-2xs text-crit">{error}</p>}
              {mode === "idle" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="good" disabled={busy || !frame} onClick={() => void submit({ action: "accept" })}>
                      <Check size={13} /> ACCEPT
                    </Button>
                    <Button variant="primary" disabled={busy || !selectedObj} onClick={startCorrect}>
                      <PencilLine size={13} /> CORRECT
                    </Button>
                    <Button variant="danger" disabled={busy || !frame} onClick={() => void submit({ action: "reject" })}>
                      <X size={13} /> REJECT
                    </Button>
                    <Button disabled={busy || !frame} onClick={startAdd}>
                      <Plus size={13} /> ADD OBJECT
                    </Button>
                  </div>
                  <p className="mt-3 text-2xs leading-relaxed text-ink-3">
                    Accept confirms all labels. Correct edits the selected label{selectedObj ? ` (${classLabel(selectedObj.cls)})` : ""}. Reject removes the frame from training. Add object labels something the model missed.
                  </p>
                </>
              )}
              {mode !== "idle" && (
                <div className="space-y-3.5">
                  <label className="block">
                    <span className="mb-1.5 block text-2xs text-ink-2">Object class</span>
                    <select value={draftCls} onChange={(e) => setDraftCls(e.target.value)} className="h-8 w-full rounded-md border border-line-strong bg-raised px-2 text-xs text-ink">
                      {CLASSES.map((c) => (
                        <option key={c} value={c}>{titleCase(c)}</option>
                      ))}
                    </select>
                  </label>
                  {mode === "correct" && <Slider label="Corrected confidence" unit="%" min={50} max={100} value={draftConf} onChange={setDraftConf} />}
                  <div>
                    <div className="mb-2 text-2xs text-ink-2">Bounding box adjustment</div>
                    <BoxEditor box={draftBox} onChange={setDraftBox} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      className="flex-1"
                      disabled={busy}
                      onClick={() =>
                        void submit(
                          mode === "correct"
                            ? { action: "correct", corrections: [{ object_id: selectedObj!.id, cls: draftCls, confidence: draftConf / 100, bbox: draftBox }] }
                            : { action: "add_object", new_object: { cls: draftCls, bbox: draftBox } },
                        )
                      }
                    >
                      <Check size={13} /> {busy ? "Saving…" : mode === "correct" ? "Save correction" : "Add object"}
                    </Button>
                    <Button onClick={() => setMode("idle")} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
