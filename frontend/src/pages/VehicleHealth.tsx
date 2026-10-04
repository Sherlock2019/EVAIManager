import clsx from "clsx";
import { CalendarCheck, CheckCircle2, MapPin, Minus, TrendingDown, Wrench } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CarTopView } from "../components/CarTopView";
import { Badge, Button, ChartTooltip, ErrorNote, Loading, Meter, PageHeader, Panel, Ring, Sparkline, axisProps, gridProps } from "../components/ui";
import { post, useApi } from "../lib/api";
import { useDemo } from "../lib/demo";
import { C, VEHICLE_STATUS, fmtInt, riskTone, toneColor, type Tone } from "../lib/format";
import { useLive } from "../lib/live";
import type { Booking, TelemetryPoint, VehicleDetail } from "../lib/types";

const QUICK = ["VF-EV-0821", "VF-EV-0442", "VF-EV-1077", "VF-EV-0612", "VF-EV-0218"];
const COMPONENT_LABEL: Record<string, string> = { thermal: "Battery cooling", battery: "Battery pack", tires: "Tires", motor: "Drive motor", brakes: "Brakes", charging: "Charging" };

function Readout({ label, value, unit, tone, sub }: { label: string; value: ReactNode; unit?: string; tone?: Tone; sub?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="num text-lg font-medium leading-none" style={tone ? { color: toneColor[tone] } : undefined}>
          {value}
        </span>
        {unit && <span className="num text-2xs text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-3xs text-ink-3">{sub}</div>}
    </div>
  );
}

function Group({ title, children, align = "left" }: { title: string; children: ReactNode; align?: "left" | "right" }) {
  return (
    <div className={clsx("rounded-md border border-line bg-raised/60 p-3", align === "right" && "xl:text-right")}>
      <div className="label mb-2 text-accent">{title}</div>
      {children}
    </div>
  );
}

function MiniChart({ data, dataKey, label, unit, limit, limitLabel, domain }: { data: TelemetryPoint[]; dataKey: keyof TelemetryPoint; label: string; unit: string; limit?: number; limitLabel?: string; domain?: [number | string, number | string] }) {
  const last = data[data.length - 1]?.[dataKey] as number | undefined;
  return (
    <div className="rounded-md border border-line bg-raised/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="num text-xs">
          {last}
          {unit}
        </span>
      </div>
      <div className="mt-1 h-[112px]">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" {...axisProps} interval={11} />
            <YAxis {...axisProps} domain={domain ?? ["auto", "auto"]} width={46} />
            <Tooltip content={<ChartTooltip format={(v) => `${v}${unit}`} />} cursor={{ stroke: "#263347" }} />
            {limit !== undefined && <ReferenceLine y={limit} stroke={C.crit} strokeDasharray="4 4" label={{ value: limitLabel, position: "insideTopLeft", fill: C.crit, fontSize: 9, fontFamily: "JetBrains Mono" }} />}
            <Line type="monotone" dataKey={dataKey} name={label} stroke={C.s1} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function VehicleHealth() {
  const [params, setParams] = useSearchParams();
  const vehicleId = params.get("vehicle") ?? "VF-EV-0821";
  const detail = useApi<VehicleDetail>(`/api/vehicles/${vehicleId}`);
  const telemetry = useApi<{ points: TelemetryPoint[]; low_wheel: string }>(`/api/vehicles/${vehicleId}/telemetry`);
  const tick = useLive((s) => s.tick);
  const refresh = useLive((s) => s.refresh);
  const demoOpen = useDemo((s) => s.open);
  const [query, setQuery] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);

  const { reload } = detail;
  useEffect(() => {
    if (tick % 2 === 0) reload();
  }, [tick, reload]);
  useEffect(() => setBooking(null), [vehicleId]);

  const go = (e: FormEvent) => {
    e.preventDefault();
    const digits = query.replace(/\D/g, "");
    if (digits) setParams({ vehicle: `VF-EV-${digits.padStart(4, "0")}` });
  };
  const schedule = async () => {
    setBusy(true);
    try {
      setBooking(await post<Booking>(`/api/maintenance/schedule/${vehicleId}`));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const selector = (
    <>
      <div className="hidden items-center gap-1 lg:flex">
        {QUICK.map((id) => (
          <button key={id} onClick={() => setParams({ vehicle: id })} className={clsx("num rounded px-2 py-1 text-2xs transition-colors", id === vehicleId ? "bg-accent text-abyss" : "border border-line text-ink-2 hover:border-line-strong hover:text-ink")}>
            {id.slice(-4)}
          </button>
        ))}
      </div>
      <form onSubmit={go} className="flex gap-1.5">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Vehicle no." className="h-8 w-28 rounded-md border border-line-strong bg-raised px-2 font-mono text-xs text-ink placeholder:text-ink-3" />
        <Button type="submit">Open</Button>
      </form>
    </>
  );

  if (detail.error)
    return (
      <div>
        <PageHeader kicker="Fleet · Vehicle digital twin" title="Vehicle Health">{selector}</PageHeader>
        <ErrorNote message={detail.error} />
      </div>
    );
  if (!detail.data || detail.data.vehicle.vehicle_id !== vehicleId) return <Loading label="Loading vehicle…" className="h-[60vh]" />;

  const { vehicle: v, prediction: p, estimated_range_km, motor_efficiency_pct, digital_twin } = detail.data;
  const tone = riskTone[p.maintenance_risk];
  const status = VEHICLE_STATUS.find((s) => s.key === v.status) ?? VEHICLE_STATUS[0];
  const booked = detail.data.booking ?? (booking?.vehicle_id === vehicleId ? booking : null);
  const tires = [
    { k: "FL", bar: v.tire_pressure_fl },
    { k: "FR", bar: v.tire_pressure_fr },
    { k: "RL", bar: v.tire_pressure_rl },
    { k: "RR", bar: v.tire_pressure_rr },
  ];
  const points = telemetry.data?.points ?? [];

  return (
    <div>
      <PageHeader kicker="Fleet · Vehicle digital twin" title={`${v.vehicle_id} · ${v.model}`} description={`${v.year} · ${v.zone}, ${v.city} · last service ${v.last_service}`}>
        {selector}
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3">
        {/* car dashboard */}
        <section className="panel hairline-grid p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs" style={{ color: status.color }}>
              <span className={clsx("h-2 w-2 rounded-full", v.moving && "animate-pulse-dot")} style={{ background: status.color }} />
              {status.label} · {v.speed_kmh.toFixed(0)} km/h
            </span>
            <Link to={`/fleet?vehicle=${v.vehicle_id}`} className="inline-flex items-center gap-1 text-2xs text-accent hover:underline">
              <MapPin size={11} /> Locate on fleet map
            </Link>
          </div>
          {/* wide: readouts flank the car. With the demo panel docked there is no room, so the car goes on top. */}
          <div className={clsx("grid items-center gap-4", !demoOpen && "xl:grid-cols-[200px_minmax(0,1fr)_200px]")}>
            <div className={clsx("grid grid-cols-2 gap-3", demoOpen ? "order-2" : "xl:grid-cols-1")}>
              <Group title="Battery">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <Readout label="SOC" value={v.battery_soc.toFixed(0)} unit="%" tone={v.battery_soc < 20 ? "crit" : undefined} />
                  <Readout label="SOH" value={v.battery_soh.toFixed(0)} unit="%" tone={v.battery_soh < 86 ? "warn" : undefined} />
                  <Readout label="Temperature" value={v.battery_temperature.toFixed(0)} unit="°C" tone={v.battery_temperature > 42 ? "crit" : undefined} />
                  <Readout label="Est. range" value={estimated_range_km} unit="km" />
                </div>
              </Group>
              <Group title="Motor">
                <div className="grid grid-cols-2 gap-x-3">
                  <Readout label="Temperature" value={v.motor_temperature.toFixed(0)} unit="°C" tone={v.motor_temperature > 90 ? "crit" : undefined} />
                  <Readout label="Efficiency" value={motor_efficiency_pct} unit="%" />
                </div>
              </Group>
            </div>
            <div className={clsx("mx-auto aspect-[520/240] w-full max-w-[620px]", demoOpen && "order-1 max-w-[460px]")}>
              <CarTopView v={v} p={p} />
            </div>
            <div className={clsx("grid grid-cols-2 gap-3", demoOpen ? "order-3" : "xl:grid-cols-1")}>
              <Group title="Tires · bar">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  {tires.map((t) => (
                    <Readout key={t.k} label={t.k} value={t.bar.toFixed(1)} tone={t.bar < 2.1 ? "crit" : t.bar < 2.25 ? "warn" : undefined} />
                  ))}
                </div>
              </Group>
              <Group title="Odometer">
                <Readout label="Total distance" value={fmtInt(v.odometer_km)} unit="km" sub={`${v.daily_km.toFixed(0)} km/day · ${fmtInt(v.charging_cycles)} charge cycles`} />
              </Group>
            </div>
          </div>
          {v.fault_codes.length > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <span className="label">Active fault codes</span>
              {v.fault_codes.map((code) => (
                <Badge key={code} tone="crit">{code}</Badge>
              ))}
            </div>
          )}
        </section>

        <Panel title="Telemetry — last 24 hours" kicker="30-minute samples · synthetic" className="flex-1">
          {points.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              <MiniChart data={points} dataKey="battery_temperature" label="Battery temperature" unit="°C" limit={45} limitLabel="thermal limit 45°C" domain={[24, 56]} />
              <MiniChart data={points} dataKey="motor_temperature" label="Motor temperature" unit="°C" limit={95} limitLabel="limit 95°C" domain={[40, 112]} />
              <MiniChart data={points} dataKey="battery_soc" label="Battery SOC" unit="%" domain={[0, 100]} />
              <MiniChart data={points} dataKey="tire_pressure_low" label={`Tire pressure · ${telemetry.data?.low_wheel.toUpperCase()}`} unit=" bar" limit={2.1} limitLabel="min 2.1 bar" domain={[1.8, 2.6]} />
            </div>
          ) : (
            <Loading />
          )}
        </Panel>
        </div>

        {/* AI health */}
        <Panel title="AI Vehicle Health" kicker="Predictive maintenance engine">
          <div className="flex items-center gap-4">
            <Ring value={p.health_score / 100} tone={tone} label={p.health_score} sub="/ 100" size={104} />
            <div className="min-w-0">
              <div className="label">Health score</div>
              <Badge tone={tone} className="mt-1">{p.maintenance_risk} risk</Badge>
              <div className="num mt-2 text-xs text-ink-2">{p.maintenance_probability.toFixed(0)}% maintenance probability</div>
            </div>
          </div>
          {p.maintenance_risk === "LOW" ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-good/30 bg-good/5 p-3 text-xs text-ink-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" />
              No component is trending toward service. The vehicle stays on its routine interval (next: {v.next_service}).
            </div>
          ) : (
            <div className="mt-4 rounded-md border p-3" style={{ borderColor: `${toneColor[tone]}55`, background: `${toneColor[tone]}0D` }}>
              <div className="label">Predicted issue</div>
              <div className="mt-1 text-sm font-medium">{p.predicted_component} degradation</div>
              <div className="mt-2.5 grid grid-cols-2 gap-3">
                <Readout label="Confidence" value={Math.round((p.confidence ?? 0) * 100)} unit="%" />
                <Readout label="Predicted service need" value={p.predicted_days_to_service ?? "—"} unit="days" />
              </div>
              <ul className="mt-3 space-y-1 border-t border-line pt-2.5">
                {p.reason_codes.map((r) => (
                  <li key={r} className="flex gap-1.5 text-2xs text-ink-2">
                    <span style={{ color: toneColor[tone] }}>+</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {booked ? (
            <div className="mt-3 animate-slide-in rounded-md border border-good/40 bg-good/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-good">
                <CalendarCheck size={13} /> Maintenance scheduled
              </div>
              <p className="mt-1 text-2xs text-ink-2">
                {booked.component} · {booked.service_center} · <span className="num text-ink">{booked.scheduled_for}</span>
              </p>
            </div>
          ) : (
            <Button variant="primary" className="mt-3 w-full" onClick={schedule} disabled={busy}>
              <Wrench size={13} /> {busy ? "SCHEDULING…" : "SCHEDULE MAINTENANCE"}
            </Button>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <div className="label mb-2">Component risk</div>
            <div className="space-y-1.5">
              {Object.entries(p.component_risks).map(([k, r]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-[92px] shrink-0 text-2xs text-ink-2">{COMPONENT_LABEL[k]}</span>
                  <Meter value={r} tone={r > 0.8 ? "crit" : r > 0.6 ? "serious" : r > 0.3 ? "warn" : "good"} />
                  <span className="num w-7 text-right text-3xs text-ink-3">{Math.round(r * 100)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* digital twin */}
      <div className="mt-3">
        <div className="label mb-2">Digital health profile · seven subsystems</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
          {digital_twin.map((s) => {
            const t: Tone = s.risk === "Critical" ? "crit" : s.risk === "High" ? "serious" : s.risk === "Medium" ? "warn" : "good";
            return (
              <div key={s.name} className="panel p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{s.name}</span>
                  <Badge tone={t}>{s.risk}</Badge>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <span className="num text-xl font-medium leading-none">{s.health_score}</span>
                    <span className="num text-2xs text-ink-3"> /100</span>
                  </div>
                  <Sparkline data={s.history} color={toneColor[t]} width={70} height={24} />
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-3xs uppercase tracking-wider text-ink-3">
                  {s.trend === "declining" ? <TrendingDown size={10} className="text-crit" /> : <Minus size={10} />} {s.trend}
                </div>
                <div className="num mt-2 border-t border-line pt-2 text-3xs text-ink-2">{s.metric}</div>
                <p className="mt-1 text-2xs leading-snug text-ink-3">{s.prediction}</p>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
