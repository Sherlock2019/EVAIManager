import { C } from "../lib/format";
import type { Prediction, Vehicle } from "../lib/types";

const tireColor = (bar: number) => (bar < 2.1 ? C.crit : bar < 2.25 ? C.warn : "#4A5A72");

/** Simplified top-view EV with battery pack, motor and tires driven by live telemetry. Front is to the right. */
export function CarTopView({ v, p }: { v: Vehicle; p: Prediction }) {
  const key = p.component_key;
  const hot = v.battery_temperature > 42;
  const packColor = hot ? C.crit : v.battery_soh < 86 ? C.warn : C.good;
  const cells = 20;
  const lit = Math.round((v.battery_soc / 100) * cells);
  const motorHot = v.motor_temperature > 90;
  const wheels = [
    { id: "fl", x: 352, y: 26, bar: v.tire_pressure_fl },
    { id: "fr", x: 352, y: 198, bar: v.tire_pressure_fr },
    { id: "rl", x: 96, y: 26, bar: v.tire_pressure_rl },
    { id: "rr", x: 96, y: 198, bar: v.tire_pressure_rr },
  ];
  const lowWheel = wheels.reduce((a, b) => (b.bar < a.bar ? b : a));

  return (
    <svg viewBox="0 0 520 240" className="h-full w-full" role="img" aria-label={`Top view of ${v.vehicle_id}`}>
      <defs>
        <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A2433" />
          <stop offset="0.5" stopColor="#101824" />
          <stop offset="1" stopColor="#1A2433" />
        </linearGradient>
        <radialGradient id="beamR" cx="0" cy="0.5" r="1">
          <stop offset="0" stopColor="#CFE9FF" stopOpacity="0.35" />
          <stop offset="1" stopColor="#CFE9FF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* headlight beams */}
      <path d="M474,82 L520,56 L520,112 Z" fill="url(#beamR)" />
      <path d="M474,158 L520,128 L520,184 Z" fill="url(#beamR)" />

      {/* wheels */}
      {wheels.map((w) => (
        <g key={w.id}>
          <rect x={w.x} y={w.y} width={62} height={16} rx={5} fill="#0A0E14" stroke={tireColor(w.bar)} strokeWidth={w.bar < 2.25 ? 2 : 1.2} />
          {key === "tires" && w.id === lowWheel.id && (
            <rect x={w.x - 5} y={w.y - 5} width={72} height={26} rx={8} fill="none" stroke={C.crit} strokeWidth={1.5} className="animate-pulse-dot" />
          )}
        </g>
      ))}

      {/* body */}
      <path d="M74,40 H392 C446,40 482,74 482,120 C482,166 446,200 392,200 H74 C52,200 38,184 38,166 V74 C38,56 52,40 74,40 Z" fill="url(#carBody)" stroke="#33445C" strokeWidth={1.5} />
      {/* glass */}
      <path d="M338,62 C366,70 380,92 380,120 C380,148 366,170 338,178 L322,160 C330,150 334,136 334,120 C334,104 330,90 322,80 Z" fill="#1E3348" stroke="#2F4A66" />
      <path d="M150,66 L170,82 C166,94 164,106 164,120 C164,134 166,146 170,158 L150,174 C138,160 132,142 132,120 C132,98 138,80 150,66 Z" fill="#1A2B3D" stroke="#2F4A66" />
      <path d="M178,60 H316 L306,78 H186 Z" fill="#162435" stroke="#2A3F58" />
      <path d="M178,180 H316 L306,162 H186 Z" fill="#162435" stroke="#2A3F58" />
      {/* mirrors + lights */}
      <rect x={318} y={30} width={14} height={9} rx={3} fill="#1A2433" stroke="#33445C" />
      <rect x={318} y={201} width={14} height={9} rx={3} fill="#1A2433" stroke="#33445C" />
      <path d="M462,74 q12,10 14,22" stroke="#CFE9FF" strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M462,166 q12,-10 14,-22" stroke="#CFE9FF" strokeWidth={3} fill="none" strokeLinecap="round" />
      <rect x={38} y={70} width={4} height={24} rx={2} fill={C.crit} opacity={0.85} />
      <rect x={38} y={146} width={4} height={24} rx={2} fill={C.crit} opacity={0.85} />

      {/* battery pack (skateboard) */}
      <g>
        <rect x={182} y={86} width={128} height={68} rx={5} fill="#070B11" stroke={packColor} strokeWidth={1.4} />
        {Array.from({ length: cells }, (_, i) => {
          const col = i % 10;
          const rowIdx = Math.floor(i / 10);
          return <rect key={i} x={188 + col * 11.8} y={92 + rowIdx * 29} width={9.4} height={25} rx={1.5} fill={i < lit ? packColor : "#18212F"} opacity={i < lit ? 0.9 : 1} />;
        })}
        {(key === "thermal" || key === "battery") && <rect x={176} y={80} width={140} height={80} rx={8} fill="none" stroke={C.crit} strokeWidth={1.5} className="animate-pulse-dot" />}
      </g>

      {/* drive motor (front axle) */}
      <g>
        <line x1={414} y1={46} x2={414} y2={194} stroke="#2A3A50" strokeWidth={3} />
        <circle cx={414} cy={120} r={15} fill="#070B11" stroke={motorHot ? C.crit : "#4A5A72"} strokeWidth={1.6} />
        <circle cx={414} cy={120} r={6} fill={motorHot ? C.crit : C.accent} opacity={0.9} />
        {key === "motor" && <circle cx={414} cy={120} r={22} fill="none" stroke={C.crit} strokeWidth={1.5} className="animate-pulse-dot" />}
      </g>
      {/* rear axle + brakes */}
      <line x1={127} y1={46} x2={127} y2={194} stroke="#2A3A50" strokeWidth={3} />
      {key === "brakes" &&
        [50, 190].map((y) => <circle key={y} cx={127} cy={y} r={9} fill="none" stroke={C.crit} strokeWidth={1.5} className="animate-pulse-dot" />)}
      {/* charge port */}
      <rect x={88} y={198} width={12} height={5} rx={1.5} fill={v.status === "charging" ? C.info : "#33445C"} />
      {key === "charging" && <rect x={82} y={193} width={24} height={15} rx={5} fill="none" stroke={C.crit} strokeWidth={1.5} className="animate-pulse-dot" />}

      {/* energy flow battery → motor */}
      <line x1={310} y1={120} x2={399} y2={120} stroke={C.accent} strokeWidth={1.6} className={v.moving ? "flow-line" : undefined} opacity={0.8} />

      <text x={246} y={226} textAnchor="middle" fontSize={9} fontFamily="JetBrains Mono, monospace" fill="#64748B" letterSpacing="2">
        {v.model.toUpperCase()} · FRONT →
      </text>
    </svg>
  );
}
