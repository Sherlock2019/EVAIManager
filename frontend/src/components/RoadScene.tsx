import clsx from "clsx";
import { useId, useMemo, type ReactNode } from "react";
import { C, confidenceTone, toneColor } from "../lib/format";
import type { Detection, Frame } from "../lib/types";

const W = 800;
const H = 450;
const HORIZON = 189;
const VX = W / 2;

/** Small deterministic PRNG so a frame always renders the same scene. */
function prng(seed: string) {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKY: Record<string, [string, string]> = {
  day: ["#5E7FA3", "#B4C6D6"],
  dawn: ["#37445E", "#C99A7C"],
  dusk: ["#2A2C47", "#B56A4C"],
  night: ["#04060B", "#0D1422"],
};
const GROUND: Record<string, string> = { day: "#56604F", dawn: "#3E4540", dusk: "#35363A", night: "#0A0E14" };
const ROAD: Record<string, string> = { day: "#3A3F47", dawn: "#30343B", dusk: "#2A2D34", night: "#12161D" };
const CAR_COLORS = ["#8D97A6", "#566273", "#A54040", "#31557F", "#D5DAE0", "#2B2F36", "#6D7F5E"];

function Glyph({ d, x, y, w, h, rand }: { d: Detection; x: number; y: number; w: number; h: number; rand: () => number }): ReactNode {
  const tail = "#E5484D";
  switch (d.cls) {
    case "car": {
      const body = CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)];
      return (
        <g>
          <rect x={x + w * 0.12} y={y} width={w * 0.76} height={h * 0.5} rx={w * 0.08} fill="#1C232D" />
          <rect x={x + w * 0.17} y={y + h * 0.06} width={w * 0.66} height={h * 0.3} rx={w * 0.05} fill="#3C4A5C" />
          <rect x={x} y={y + h * 0.36} width={w} height={h * 0.5} rx={w * 0.07} fill={body} />
          <rect x={x + w * 0.04} y={y + h * 0.46} width={w * 0.18} height={h * 0.12} rx={2} fill={tail} />
          <rect x={x + w * 0.78} y={y + h * 0.46} width={w * 0.18} height={h * 0.12} rx={2} fill={tail} />
          <rect x={x + w * 0.36} y={y + h * 0.6} width={w * 0.28} height={h * 0.12} rx={1.5} fill="#E9EDF2" opacity={0.85} />
          <rect x={x + w * 0.06} y={y + h * 0.84} width={w * 0.2} height={h * 0.16} rx={2} fill="#0B0E13" />
          <rect x={x + w * 0.74} y={y + h * 0.84} width={w * 0.2} height={h * 0.16} rx={2} fill="#0B0E13" />
        </g>
      );
    }
    case "truck":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h * 0.86} rx={3} fill="#BFC6CF" />
          <rect x={x + w * 0.06} y={y + h * 0.05} width={w * 0.88} height={h * 0.7} fill="none" stroke="#8B95A3" strokeWidth={1.5} />
          <line x1={x + w / 2} y1={y + h * 0.05} x2={x + w / 2} y2={y + h * 0.75} stroke="#8B95A3" strokeWidth={1.5} />
          <rect x={x} y={y + h * 0.8} width={w} height={h * 0.08} fill="#2B313A" />
          <rect x={x + w * 0.04} y={y + h * 0.8} width={w * 0.14} height={h * 0.06} fill={tail} />
          <rect x={x + w * 0.82} y={y + h * 0.8} width={w * 0.14} height={h * 0.06} fill={tail} />
          <rect x={x + w * 0.08} y={y + h * 0.88} width={w * 0.2} height={h * 0.12} rx={2} fill="#0B0E13" />
          <rect x={x + w * 0.72} y={y + h * 0.88} width={w * 0.2} height={h * 0.12} rx={2} fill="#0B0E13" />
        </g>
      );
    case "bus":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h * 0.9} rx={w * 0.06} fill="#C9973F" />
          <rect x={x + w * 0.07} y={y + h * 0.08} width={w * 0.86} height={h * 0.36} rx={3} fill="#263242" />
          <rect x={x + w * 0.05} y={y + h * 0.68} width={w * 0.16} height={h * 0.08} fill={tail} />
          <rect x={x + w * 0.79} y={y + h * 0.68} width={w * 0.16} height={h * 0.08} fill={tail} />
          <rect x={x + w * 0.08} y={y + h * 0.88} width={w * 0.2} height={h * 0.12} rx={2} fill="#0B0E13" />
          <rect x={x + w * 0.72} y={y + h * 0.88} width={w * 0.2} height={h * 0.12} rx={2} fill="#0B0E13" />
        </g>
      );
    case "motorcycle":
    case "bicycle": {
      const moto = d.cls === "motorcycle";
      const jacket = ["#3F6FA8", "#B8483E", "#4C8A5B", "#C2A23A", "#6B7280"][Math.floor(rand() * 5)];
      return (
        <g>
          <ellipse cx={x + w / 2} cy={y + h * 0.84} rx={w * (moto ? 0.2 : 0.1)} ry={h * 0.16} fill="#0B0E13" />
          {moto && <rect x={x + w * 0.2} y={y + h * 0.5} width={w * 0.6} height={h * 0.26} rx={w * 0.12} fill="#252B34" />}
          {moto && <rect x={x + w * 0.42} y={y + h * 0.62} width={w * 0.16} height={h * 0.07} fill={tail} />}
          <rect x={x + w * 0.22} y={y + h * 0.2} width={w * 0.56} height={h * 0.42} rx={w * 0.2} fill={jacket} />
          <circle cx={x + w / 2} cy={y + h * 0.12} r={Math.min(w * 0.26, h * 0.12)} fill={moto ? "#D9DEE5" : "#C7A17F"} />
        </g>
      );
    }
    case "pedestrian": {
      const coat = ["#48658F", "#8C4A45", "#5E6B58", "#A08C5B", "#4B4F58"][Math.floor(rand() * 5)];
      return (
        <g>
          <circle cx={x + w / 2} cy={y + h * 0.1} r={Math.min(w * 0.3, h * 0.1)} fill="#C7A17F" />
          <rect x={x + w * 0.18} y={y + h * 0.2} width={w * 0.64} height={h * 0.42} rx={w * 0.2} fill={coat} />
          <rect x={x + w * 0.22} y={y + h * 0.6} width={w * 0.22} height={h * 0.4} rx={w * 0.08} fill="#20252D" />
          <rect x={x + w * 0.56} y={y + h * 0.6} width={w * 0.22} height={h * 0.4} rx={w * 0.08} fill="#20252D" />
        </g>
      );
    }
    case "traffic_light": {
      const lit = Math.floor(rand() * 3);
      return (
        <g>
          <line x1={x + w / 2} y1={y + h} x2={x + w / 2} y2={HORIZON + 26} stroke="#2B313A" strokeWidth={3} />
          <rect x={x} y={y} width={w} height={h} rx={3} fill="#151A21" stroke="#2B313A" />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={x + w / 2} cy={y + h * (0.2 + i * 0.3)} r={w * 0.26} fill={i === lit ? ["#EF4444", "#FAB219", "#22C55E"][i] : "#2B313A"} />
          ))}
        </g>
      );
    }
    default: // traffic_sign
      return (
        <g>
          <line x1={x + w / 2} y1={y + h} x2={x + w / 2} y2={HORIZON + 40} stroke="#6B7280" strokeWidth={2.5} />
          <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill="#EEF1F5" stroke="#D03B3B" strokeWidth={4} />
        </g>
      );
  }
}

function Environment({ frame, rand, uid }: { frame: Frame; rand: () => number; uid: string }) {
  const { lighting, road_type: road } = frame;
  const night = lighting === "night";
  const built = road === "urban" || road === "residential" || road === "intersection";
  const wall = night ? "#141C28" : lighting === "day" ? "#77818F" : "#4A4F5C";
  const buildings: ReactNode[] = [];
  if (built) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const w = 62;
        const h = (road === "residential" ? 70 : 150) - i * 16 + rand() * 34;
        const x = side < 0 ? i * (w + 3) - 8 : W - (i + 1) * (w + 3) + 8;
        if (side < 0 ? x + w > VX - 60 : x < VX + 60) continue;
        buildings.push(<rect key={`${side}${i}`} x={x} y={HORIZON - h} width={w} height={h + 8} fill={wall} opacity={0.75 + rand() * 0.25} />);
        for (let r = 0; r < Math.floor(h / 22); r++)
          for (let c = 0; c < 3; c++)
            if (rand() < (night ? 0.4 : 0.75))
              buildings.push(<rect key={`${side}${i}w${r}${c}`} x={x + 8 + c * 17} y={HORIZON - h + 9 + r * 20} width={10} height={9} fill={night ? "#E9C46A" : "#2E3743"} opacity={night ? 0.8 : 0.55} />);
      }
    }
  }
  return (
    <g>
      <rect width={W} height={HORIZON + 2} fill={`url(#sky${uid})`} />
      {!night && lighting !== "day" && <circle cx={VX + 150} cy={HORIZON - 14} r={26} fill="#F2C28B" opacity={0.55} />}
      {road === "highway" && <path d={`M0,${HORIZON} C120,${HORIZON - 46} 260,${HORIZON - 20} 400,${HORIZON - 30} S640,${HORIZON - 58} 800,${HORIZON - 12} V${HORIZON} Z`} fill={night ? "#080C12" : "#4F5F58"} />}
      {buildings}
      <rect y={HORIZON} width={W} height={H - HORIZON} fill={GROUND[lighting]} />
      {built && (
        <>
          <polygon points={`${VX - 22},${HORIZON} ${VX - 15},${HORIZON} -90,${H} -260,${H}`} fill={night ? "#161B23" : "#7A828D"} />
          <polygon points={`${VX + 15},${HORIZON} ${VX + 22},${HORIZON} ${W + 260},${H} ${W + 90},${H}`} fill={night ? "#161B23" : "#7A828D"} />
        </>
      )}
      <polygon points={`${VX - 15},${HORIZON} ${VX + 15},${HORIZON} ${W + 90},${H} -90,${H}`} fill={ROAD[lighting]} />
      {road === "intersection" && (
        <g opacity={0.55}>
          {Array.from({ length: 13 }, (_, i) => (
            <rect key={i} x={118 + i * 44} y={296} width={24} height={30} fill="#E8EEF7" />
          ))}
        </g>
      )}
      {[-1, 1].map((s) => (
        <line key={s} x1={VX + s * 5} y1={HORIZON} x2={VX + s * 163} y2={H} stroke="#E8EEF7" strokeWidth={3} strokeDasharray="16 22" opacity={0.6} />
      ))}
      {[-1, 1].map((s) => (
        <line key={s} x1={VX + s * 15} y1={HORIZON} x2={VX + s * 490} y2={H} stroke={road === "highway" ? "#E9C46A" : "#E8EEF7"} strokeWidth={3} opacity={0.5} />
      ))}
      {road === "tunnel" && (
        <g>
          <rect y={HORIZON - 150} width={W} height={150} fill={lighting === "night" ? "#0C1119" : "#6E7682"} />
          <path d={`M${VX - 190},${HORIZON} A190,150 0 0 1 ${VX + 190},${HORIZON} Z`} fill="#06080C" />
          <path d={`M${VX - 190},${HORIZON} A190,150 0 0 1 ${VX + 190},${HORIZON}`} fill="none" stroke="#A9B2BE" strokeWidth={7} />
          {[-110, -40, 40, 110].map((dx) => (
            <rect key={dx} x={VX + dx - 9} y={HORIZON - 96 + Math.abs(dx) * 0.42} width={18} height={5} fill="#F2D38B" opacity={0.9} />
          ))}
        </g>
      )}
    </g>
  );
}

function Weather({ frame, rand, uid }: { frame: Frame; rand: () => number; uid: string }) {
  const { weather, lighting } = frame;
  const drops = weather === "heavy_rain" ? 240 : weather === "rain" ? 100 : 0;
  return (
    <g pointerEvents="none">
      {lighting === "night" && (
        <>
          <rect width={W} height={H} fill="#02040A" opacity={0.5} />
          <polygon points={`${VX - 60},${H} ${VX + 60},${H} ${VX + 250},${HORIZON + 30} ${VX - 250},${HORIZON + 30}`} fill={`url(#beam${uid})`} />
        </>
      )}
      {(lighting === "dusk" || lighting === "dawn") && <rect width={W} height={H} fill="#1A1220" opacity={0.28} />}
      {weather === "fog" && <rect width={W} height={H} fill={`url(#fog${uid})`} />}
      {drops > 0 && (
        <>
          <rect width={W} height={H} fill="#5D6A7A" opacity={weather === "heavy_rain" ? 0.3 : 0.14} />
          {Array.from({ length: drops }, (_, i) => {
            const x = rand() * (W + 80) - 40;
            const y = rand() * H;
            const len = weather === "heavy_rain" ? 24 : 15;
            return <line key={i} x1={x} y1={y} x2={x - len * 0.32} y2={y + len} stroke="#DCE6F2" strokeWidth={1} opacity={0.16 + rand() * 0.26} />;
          })}
        </>
      )}
    </g>
  );
}

export const classLabel = (cls: string) => cls.replace("_", " ").toUpperCase();

export function RoadScene({
  frame,
  selectedId,
  onSelect,
  showBoxes = true,
  overrides,
  className,
  hud = true,
}: {
  frame: Frame;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  showBoxes?: boolean;
  /** Unsaved reviewer edits, drawn instead of the stored detection. */
  overrides?: Record<number, Partial<Detection>>;
  className?: string;
  hud?: boolean;
}) {
  const objects = useMemo(
    () => frame.objects.map((o) => ({ ...o, ...(overrides?.[o.id] ?? {}) })).sort((a, b) => a.bbox[1] + a.bbox[3] - (b.bbox[1] + b.bbox[3])),
    [frame.objects, overrides],
  );
  const uid = useId().replace(/:/g, "");
  const envRand = prng(frame.frame_id);
  const weatherRand = prng(frame.frame_id + "w");
  const [skyTop, skyBottom] = SKY[frame.lighting] ?? SKY.day;

  return (
    <div className={clsx("relative aspect-video w-full overflow-hidden rounded-md border border-line bg-black", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Synthetic camera frame ${frame.frame_id}`}>
        <defs>
          <linearGradient id={`sky${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={skyTop} />
            <stop offset="1" stopColor={skyBottom} />
          </linearGradient>
          <linearGradient id={`fog${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#C9D2DC" stopOpacity="0.55" />
            <stop offset="0.42" stopColor="#C9D2DC" stopOpacity="0.78" />
            <stop offset="1" stopColor="#C9D2DC" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id={`beam${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#F5F0DC" stopOpacity="0.3" />
            <stop offset="1" stopColor="#F5F0DC" stopOpacity="0" />
          </linearGradient>
        </defs>
        <Environment frame={frame} rand={envRand} uid={uid} />
        {objects.map((o) => {
          const [bx, by, bw, bh] = o.bbox;
          const rand = prng(`${frame.frame_id}:${o.id}`);
          return (
            <g key={o.id} opacity={o.occluded ? 0.72 : 1}>
              <Glyph d={o} x={bx * W} y={by * H} w={bw * W} h={bh * H} rand={rand} />
            </g>
          );
        })}
        <Weather frame={frame} rand={weatherRand} uid={uid} />
        {showBoxes &&
          objects.map((o) => {
            const [bx, by, bw, bh] = o.bbox;
            const x = bx * W;
            const y = by * H;
            const w = bw * W;
            const h = bh * H;
            const human = o.source !== "ai";
            const color = human ? C.accent : toneColor[confidenceTone(o.confidence)];
            const selected = o.id === selectedId;
            const text = human ? `${classLabel(o.cls)} ✓ HUMAN` : `${classLabel(o.cls)} ${Math.round(o.confidence * 100)}%`;
            const tw = text.length * 6.7 + 10;
            const labelY = y < 18 ? y + h + 2 : y - 16;
            const labelX = Math.min(Math.max(0, x - 1), W - tw);
            return (
              <g key={o.id} onClick={() => onSelect?.(o.id)} style={{ cursor: onSelect ? "pointer" : "default" }}>
                <rect x={x} y={y} width={w} height={h} fill={selected ? `${color}22` : "transparent"} stroke={color} strokeWidth={selected ? 3 : 1.8} strokeDasharray={o.occluded && !human ? "6 4" : undefined} />
                {selected &&
                  [
                    [x, y],
                    [x + w, y],
                    [x, y + h],
                    [x + w, y + h],
                  ].map(([cx, cy], i) => <rect key={i} x={cx - 4} y={cy - 4} width={8} height={8} fill="#05080D" stroke={color} strokeWidth={2} />)}
                <rect x={labelX} y={labelY} width={tw} height={15} rx={2} fill={color} />
                <text x={labelX + 5} y={labelY + 11} fontSize={10.5} fontWeight={700} fontFamily="JetBrains Mono, monospace" fill="#05080D">
                  {text}
                </text>
              </g>
            );
          })}
      </svg>
      {hud && (
        <>
          <div className="pointer-events-none absolute left-2.5 top-2 font-mono text-3xs uppercase tracking-wider text-white/80 [text-shadow:0_1px_2px_#000]">
            Front cam · {frame.frame_id}
            {frame.lidar_available && " · LiDAR"}
          </div>
          <div className="pointer-events-none absolute right-2.5 top-2 flex items-center gap-1.5 font-mono text-3xs uppercase tracking-wider text-white/80 [text-shadow:0_1px_2px_#000]">
            <span className="h-1.5 w-1.5 rounded-full bg-crit" /> Synthetic scene
          </div>
          <div className="pointer-events-none absolute bottom-2 left-2.5 font-mono text-3xs text-white/80 [text-shadow:0_1px_2px_#000]">
            {frame.speed_kmh.toFixed(0)} km/h · {frame.latitude.toFixed(4)}, {frame.longitude.toFixed(4)}
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2.5 font-mono text-3xs uppercase text-white/80 [text-shadow:0_1px_2px_#000]">
            {frame.weather.replace("_", " ")} · {frame.lighting} · {frame.road_type}
          </div>
        </>
      )}
    </div>
  );
}
