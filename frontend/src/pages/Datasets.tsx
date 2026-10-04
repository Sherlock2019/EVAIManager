import clsx from "clsx";
import { GitBranch, UserCheck } from "lucide-react";
import { useState } from "react";
import { Badge, ErrorNote, Loading, MockTag, PageHeader, Panel } from "../components/ui";
import { useApi } from "../lib/api";
import { C, fmtCompact, fmtInt, titleCase, type Tone } from "../lib/format";
import type { DatasetVersion } from "../lib/types";

const STATUS_TONE: Record<string, Tone> = { Production: "good", Archived: "idle", Current: "accent", Building: "warn" };

/** Share bars for one version, with the previous version as a tick for comparison. */
function Distribution({ title, now, prev }: { title: string; now: Record<string, number>; prev?: Record<string, number> }) {
  const max = Math.max(...Object.values(now), ...(prev ? Object.values(prev) : [0]));
  return (
    <div>
      <div className="label mb-2">{title}</div>
      <div className="space-y-1.5">
        {Object.entries(now).map(([k, v]) => {
          const before = prev?.[k];
          const delta = before !== undefined ? v - before : 0;
          return (
            <div key={k} className="flex items-center gap-2">
              <span className="w-[104px] shrink-0 truncate text-2xs text-ink-2">{titleCase(k)}</span>
              <div className="relative h-2 flex-1 rounded-sm bg-line">
                <div className="h-full rounded-sm" style={{ width: `${(v / max) * 100}%`, background: C.s1 }} />
                {before !== undefined && <span className="absolute -top-0.5 h-3 w-0.5 bg-ink-2" style={{ left: `${(before / max) * 100}%` }} title={`previous version: ${before}%`} />}
              </div>
              <span className="num w-8 text-right text-2xs">{v}%</span>
              <span className={clsx("num w-8 text-right text-3xs", delta > 0 ? "text-good" : delta < 0 ? "text-ink-3" : "text-transparent")}>
                {delta > 0 ? "+" : ""}
                {delta}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Datasets() {
  const datasets = useApi<DatasetVersion[]>("/api/datasets");
  const [picked, setPicked] = useState("ADAS-v24");
  const list = datasets.data ?? [];
  const index = Math.max(0, list.findIndex((d) => d.version === picked));
  const current = list[index];
  const prev = index > 0 ? list[index - 1] : undefined;

  return (
    <div>
      <PageHeader
        kicker="ADAS · Dataset versioning"
        title="Training Datasets"
        description="Every dataset version records where its frames came from. Human corrections and mined edge cases shift the next version toward the scenarios the model finds hard."
      >
        <MockTag />
      </PageHeader>
      {datasets.error && <ErrorNote message={datasets.error} />}
      {datasets.loading && <Loading />}

      <div className="relative grid gap-3 md:grid-cols-4">
        {list.map((d, i) => (
          <button
            key={d.version}
            onClick={() => setPicked(d.version)}
            className={clsx("panel relative p-4 text-left transition-colors", d.version === current?.version ? "border-accent/60 bg-raised" : "hover:border-line-strong")}
          >
            <div className="flex items-center justify-between">
              <span className="num text-sm font-medium">{d.version}</span>
              <Badge tone={STATUS_TONE[d.status] ?? "idle"}>{d.status}</Badge>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="num text-2xl font-medium leading-none">{d.status === "Building" ? fmtCompact(d.frames_added) : fmtCompact(d.frames_total)}</span>
              <span className="text-2xs text-ink-3">{d.status === "Building" ? "new frames" : "frames"}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-2xs text-ink-3">
              <GitBranch size={11} /> {d.model} · {d.created}
            </div>
            {i < list.length - 1 && <span className="absolute -right-3 top-1/2 hidden h-px w-3 bg-line-strong md:block" />}
          </button>
        ))}
      </div>

      {current && (
        <div className="mt-3 grid gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
          <Panel title={current.version} kicker="Version summary">
            <div className="space-y-3">
              {[
                { l: "Total frames", v: fmtInt(current.frames_total) },
                { l: "Frames added", v: `+${fmtInt(current.frames_added)}` },
                { l: "Human corrections", v: fmtInt(current.human_corrections), icon: true },
                { l: "Edge cases added", v: fmtInt(current.edge_cases_added) },
              ].map((x) => (
                <div key={x.l} className="flex items-baseline justify-between border-b border-line pb-2.5 last:border-0 last:pb-0">
                  <span className="flex items-center gap-1.5 text-xs text-ink-2">
                    {x.icon && <UserCheck size={12} className="text-accent" />}
                    {x.l}
                  </span>
                  <span className="num text-base font-medium">{x.v}</span>
                </div>
              ))}
            </div>
            {current.status === "Building" && (
              <p className="mt-4 rounded-md border border-warn/30 bg-warn/5 p-2.5 text-2xs leading-relaxed text-ink-2">
                This version is still building. Each frame reviewed in the Human Review queue is added here, live.
              </p>
            )}
          </Panel>
          <Panel title="Composition" kicker={prev ? `Share of frames · tick marks ${prev.version}` : "Share of frames"}>
            <div className="grid gap-6 lg:grid-cols-3">
              <Distribution title="Class distribution" now={current.class_distribution} prev={prev?.class_distribution} />
              <Distribution title="Weather distribution" now={current.weather_distribution} prev={prev?.weather_distribution} />
              <Distribution title="City distribution" now={current.city_distribution} prev={prev?.city_distribution} />
            </div>
            <p className="mt-4 border-t border-line pt-3 text-2xs text-ink-3">
              From v21 to v24 the share of motorcycles, pedestrians, rain and fog grows on purpose: that is where edge-case mining found the model weakest.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
