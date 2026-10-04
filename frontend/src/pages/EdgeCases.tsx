import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { RoadScene } from "../components/RoadScene";
import { Badge, ErrorNote, Legend, Loading, Meter, MockTag, PageHeader, Panel, axisProps } from "../components/ui";
import { useApi } from "../lib/api";
import { C, fmtInt, riskTone, toneColor } from "../lib/format";
import type { EdgeCase, EdgeCaseReport, Frame } from "../lib/types";

function SampleFrame({ id }: { id: string }) {
  const frame = useApi<Frame>(`/api/adas/frames/${id}`);
  if (!frame.data) return <div className="aspect-video animate-pulse rounded-md bg-raised" />;
  return (
    <Link to={`/adas/review?frame=${id}`} className="group block">
      <RoadScene frame={frame.data} hud={false} className="transition-shadow group-hover:shadow-[0_0_0_1px_#3BC9F5]" />
      <div className="num mt-1 flex justify-between text-3xs text-ink-3">
        <span>{id}</span>
        <span>{Math.round(frame.data.model_confidence * 100)}%</span>
      </div>
    </Link>
  );
}

function BubbleTooltip({ active, payload }: { active?: boolean; payload?: { payload: EdgeCase }[] }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <div className="rounded-md border border-line-strong bg-raised px-2.5 py-2 text-2xs shadow-xl">
      <div className="font-medium text-ink">{c.scenario}</div>
      <div className="num mt-1 text-ink-2">{c.events} events · avg confidence {(c.average_confidence * 100).toFixed(0)}% · est. error {(c.error_rate * 100).toFixed(0)}%</div>
    </div>
  );
}

export default function EdgeCases() {
  const report = useApi<EdgeCaseReport>("/api/adas/edge-cases");
  const [picked, setPicked] = useState<string | null>(null);
  const cases = report.data?.cases ?? [];
  const current = cases.find((c) => c.key === picked) ?? cases[0];

  return (
    <div>
      <PageHeader
        kicker="ADAS · Production monitoring"
        title="AI Edge Case Miner"
        description="Find the scenarios where the model is most likely to fail, so the next training cycle is spent on the data that matters most."
      >
        <MockTag>Error rates simulated from confidence</MockTag>
      </PageHeader>
      {report.error && <ErrorNote message={report.error} />}

      {report.data && (
        <div className="panel mb-3 flex flex-wrap items-center gap-3 border-accent/40 bg-accent/5 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="label text-accent">AI recommendation</div>
            <p className="mt-0.5 text-sm font-medium">“{report.data.recommendation}”</p>
          </div>
          <Link to="/adas/datasets" className="text-2xs text-accent hover:underline">
            Planned for ADAS-v24 →
          </Link>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Scenarios Ranked by Risk" kicker="Events × estimated error rate" bodyClassName="p-0">
          {report.loading ? (
            <Loading />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-grid w-full text-xs">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Events</th>
                    <th>Average confidence</th>
                    <th>Error rate</th>
                    <th>Priority</th>
                    <th>Frames requested</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.key} className="cursor-pointer" onClick={() => setPicked(c.key)} style={current?.key === c.key ? { background: "#0F1621", boxShadow: "inset 2px 0 0 #3BC9F5" } : undefined}>
                      <td>
                        <div className="font-medium">{c.scenario}</div>
                        <div className="text-3xs text-ink-3">
                          mostly {c.top_city === "Ho Chi Minh City" ? "HCMC" : c.top_city} ({c.top_city_events}) · {c.pending_review} pending
                        </div>
                      </td>
                      <td className="num">{fmtInt(c.events)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="num w-8">{(c.average_confidence * 100).toFixed(0)}%</span>
                          <div className="w-16">
                            <Meter value={c.average_confidence} tone={c.average_confidence >= 0.9 ? "good" : c.average_confidence >= 0.7 ? "warn" : "crit"} marker={0.7} />
                          </div>
                        </div>
                      </td>
                      <td className="num">{(c.error_rate * 100).toFixed(0)}%</td>
                      <td>
                        <Badge tone={riskTone[c.priority]}>{c.priority}</Badge>
                      </td>
                      <td className="num text-ink-2">{c.frames_requested ? `+${fmtInt(c.frames_requested)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Confidence vs. Volume" kicker="Bubble size = events · lower-left is worst">
          <div className="mb-2">
            <Legend items={(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((p) => ({ label: `${p[0]}${p.slice(1).toLowerCase()} priority`, color: toneColor[riskTone[p]] }))} />
          </div>
          <div className="h-[440px]">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: -8 }}>
                <CartesianGrid stroke="#18212F" />
                <XAxis type="number" dataKey="average_confidence" domain={[0.55, 0.9]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axisProps} label={{ value: "average confidence", position: "insideBottom", offset: -10, fill: C.ink3, fontSize: 10 }} />
                <YAxis type="number" dataKey="error_rate" domain={[0, 0.26]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...axisProps} label={{ value: "est. error rate", angle: -90, position: "insideLeft", offset: 18, fill: C.ink3, fontSize: 10 }} />
                <ZAxis type="number" dataKey="events" range={[80, 900]} />
                <Tooltip content={<BubbleTooltip />} cursor={{ stroke: "#263347" }} />
                <Scatter
                  data={cases}
                  isAnimationActive={false}
                  onClick={(d: { key?: string }) => d.key && setPicked(d.key)}
                  shape={(props: { cx?: number; cy?: number; size?: number; payload?: EdgeCase }) => {
                    const { cx = 0, cy = 0, size = 100, payload } = props;
                    const color = toneColor[riskTone[payload?.priority ?? "LOW"]];
                    const r = Math.sqrt(size / Math.PI);
                    const active = payload?.key === current?.key;
                    return (
                      <g style={{ cursor: "pointer" }}>
                        <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.28} stroke={color} strokeWidth={active ? 2.5 : 1.2} />
                        {/* selective direct labels: the worst case and the selection; the rest via tooltip */}
                        {(payload?.priority === "CRITICAL" || active) && (
                          <text x={cx} y={cy - r - 5} textAnchor="middle" fontSize={10} fill={C.ink2}>
                            {payload?.scenario}
                          </text>
                        )}
                      </g>
                    );
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {current && (
        <Panel title={`Weakest Frames — ${current.scenario}`} kicker="Click a frame to review it" className="mt-3" action={<Badge tone={riskTone[current.priority]}>{current.priority}</Badge>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            {current.sample_frames.map((id) => (
              <SampleFrame key={id} id={id} />
            ))}
          </div>
          {report.data && report.data.recommendations.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="label mb-2">Training data requests generated</div>
              <ul className="grid gap-1.5 md:grid-cols-2">
                {report.data.recommendations.map((r) => (
                  <li key={r.scenario} className="flex items-center gap-2 text-xs text-ink-2">
                    <Badge tone={riskTone[r.priority as "HIGH" | "CRITICAL"]}>{r.priority}</Badge>
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
