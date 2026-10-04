import clsx from "clsx";
import { ArrowDown, Box, Car, Cpu, Database, HardDrive, Layers, Users, Workflow, Zap, type LucideIcon } from "lucide-react";
import { MockTag, PageHeader, Panel } from "../components/ui";

const LAYERS: { name: string; icon: LucideIcon; items: string[]; demo: string }[] = [
  { name: "Vehicle layer", icon: Car, items: ["Camera", "LiDAR", "GPS", "Battery Management System", "Vehicle CAN / Telemetry", "IoT Sensors"], demo: "Synthetic fleet + frame generator" },
  { name: "Edge / connectivity", icon: Zap, items: ["Vehicle Gateway", "MQTT / Event Streaming", "5G / WiFi"], demo: "Simulation tick + WebSocket" },
  { name: "Data platform", icon: Database, items: ["Object Storage", "Telemetry Store", "Data Lake", "Feature Store"], demo: "SQLite + CSV/JSON datasets" },
  { name: "AI / ML", icon: Cpu, items: ["Computer Vision", "Auto Labeling", "Anomaly Detection", "Predictive Maintenance", "Demand Forecasting", "Route Intelligence"], demo: "Python service layer, scikit-learn" },
  { name: "MLOps", icon: Workflow, items: ["Dataset Versioning", "Experiment Tracking", "Model Registry", "CI/CD", "Model Deployment", "Monitoring"], demo: "Dataset versions, edge-case miner" },
  { name: "Applications", icon: Layers, items: ["ADAS Operations", "Fleet Operations", "Service Planning", "Charging Optimization"], demo: "This dashboard · FastAPI" },
  { name: "Human", icon: Users, items: ["ADAS Reviewer", "Fleet Operator", "Engineer", "Service Manager", "Network Planner"], demo: "Review console, schedulers" },
];

const LOOPS = [
  { head: "ADAS data", steps: ["Auto labeling", "Human review", "Dataset"] },
  { head: "Telemetry", steps: ["Health AI", "Maintenance", "Service planning"] },
  { head: "Routes", steps: ["Mobility AI", "Charger demand", "Network optimization"] },
];

const SERVICES = [
  "vehicle-ingestion-service",
  "adas-label-service",
  "human-review-service",
  "fleet-health-service",
  "maintenance-prediction-service",
  "charging-optimizer-service",
  "route-analysis-service",
  "api-gateway",
  "dashboard",
];

function Chip({ children, accent }: { children: string; accent?: boolean }) {
  return <span className={clsx("whitespace-nowrap rounded border px-2 py-1 text-2xs", accent ? "border-accent/50 bg-accent/10 text-accent" : "border-line-strong bg-raised text-ink-2")}>{children}</span>;
}

function Workload({ icon: Icon, title, items, tone }: { icon: LucideIcon; title: string; items: string[]; tone: string }) {
  return (
    <div className="rounded-md border border-line bg-raised/50 p-3">
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color: tone }} />
        <span className="label" style={{ color: tone }}>{title}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((i) => (
          <Chip key={i}>{i}</Chip>
        ))}
      </div>
    </div>
  );
}

export default function Architecture() {
  return (
    <div>
      <PageHeader kicker="System · Reference architecture" title="Architecture" description="How the demo maps onto a production platform: from sensors on the vehicle to the people who act on AI decisions, and back again as new data.">
        <MockTag>Conceptual · the demo implements a slice of each layer</MockTag>
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        {/* three feedback loops */}
        <Panel title="One Fleet, Three Feedback Loops" kicker="Conceptual architecture">
          <div className="mx-auto max-w-[640px]">
            <div className="mx-auto w-44 rounded-md border border-accent/60 bg-accent/10 py-2 text-center">
              <Car size={16} className="mx-auto text-accent" />
              <div className="mt-1 font-mono text-xs font-bold tracking-[0.18em] text-accent">EV FLEET</div>
            </div>
            <svg viewBox="0 0 600 34" className="block w-full" aria-hidden>
              {[100, 300, 500].map((x) => (
                <path key={x} d={`M300,0 C300,20 ${x},12 ${x},32`} fill="none" stroke="#3BC9F5" strokeWidth={1.5} className="flow-line" opacity={0.8} />
              ))}
            </svg>
            <div className="grid grid-cols-3 gap-3">
              {LOOPS.map((loop) => (
                <div key={loop.head} className="text-center">
                  <div className="rounded-md border border-line-strong bg-raised py-1.5 font-mono text-2xs font-medium uppercase tracking-[0.12em] text-ink">{loop.head}</div>
                  {loop.steps.map((s) => (
                    <div key={s}>
                      <ArrowDown size={12} className="mx-auto my-1 text-ink-3" />
                      <div className="rounded-md border border-line bg-panel py-1.5 text-xs text-ink-2">{s}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <svg viewBox="0 0 600 34" className="block w-full" aria-hidden>
              {[100, 300, 500].map((x) => (
                <path key={x} d={`M${x},2 C${x},22 300,14 300,34`} fill="none" stroke="#3BC9F5" strokeWidth={1.5} className="flow-line" opacity={0.8} />
              ))}
            </svg>
            <div className="mx-auto w-56 rounded-md border border-line-strong bg-raised py-2 text-center font-mono text-xs font-medium tracking-[0.14em]">CONTINUOUS LEARNING</div>
            <ArrowDown size={13} className="mx-auto my-1 text-accent" />
            <div className="mx-auto w-56 rounded-md border border-accent/60 bg-accent/10 py-2 text-center font-mono text-xs font-bold tracking-[0.14em] text-accent">BETTER EV ECOSYSTEM</div>
          </div>
        </Panel>

        {/* philosophy */}
        <Panel title="Engineering Philosophy" kicker="The most important message">
          <p className="text-base font-medium leading-snug">Do not build an isolated AI model. Build a system.</p>
          <ol className="mt-4 space-y-2.5">
            {["Data creates intelligence.", "Intelligence creates decisions.", "Humans validate important decisions.", "Actions create new data.", "The complete system continuously improves."].map((line, i) => (
              <li key={line} className="flex items-center gap-3">
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/50 text-2xs text-accent">{i + 1}</span>
                <span className="text-sm text-ink-2">{line}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4">
            {[
              { l: "Safer ADAS", d: "Human-corrected edge cases train the next model." },
              { l: "Healthier vehicles", d: "Telemetry predicts service before failure." },
              { l: "Smarter charging", d: "Journeys decide where capacity goes." },
            ].map((x) => (
              <div key={x.l}>
                <div className="text-xs font-semibold text-accent">{x.l}</div>
                <p className="mt-1 text-2xs leading-relaxed text-ink-3">{x.d}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* layered architecture */}
      <Panel title="Platform Layers" kicker="Vehicle to human" className="mt-3" bodyClassName="p-0">
        {LAYERS.map((layer, i) => (
          <div key={layer.name} className={clsx("grid items-center gap-3 px-4 py-2.5 md:grid-cols-[190px_minmax(0,1fr)_230px]", i > 0 && "border-t border-line")}>
            <div className="flex items-center gap-2.5">
              <span className="num w-4 text-3xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
                <layer.icon size={14} />
              </span>
              <span className="font-mono text-2xs font-medium uppercase tracking-[0.12em]">{layer.name}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {layer.items.map((item) => (
                <Chip key={item}>{item}</Chip>
              ))}
            </div>
            <div className="text-2xs text-ink-3">
              <span className="label mr-1.5">In this demo</span>
              {layer.demo}
            </div>
          </div>
        ))}
      </Panel>

      {/* cloud-native deployment */}
      <Panel title="Cloud-Native Deployment View" kicker="Conceptual · Kubernetes" className="mt-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="rounded-lg border border-dashed border-line-strong p-3">
            <div className="mb-3 flex items-center gap-2">
              <Box size={14} className="text-accent" />
              <span className="font-mono text-2xs font-medium uppercase tracking-[0.14em]">Kubernetes cluster</span>
              <span className="text-3xs text-ink-3">· one deployment per service, autoscaled independently</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              {SERVICES.map((s) => (
                <div key={s} className="flex items-center gap-2 rounded-md border border-line bg-raised px-2.5 py-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" />
                  <span className="truncate font-mono text-2xs text-ink-2">{s}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Workload icon={Zap} title="GPU workload" tone="#C98500" items={["ADAS inference", "Model training"]} />
              <Workload icon={Cpu} title="CPU workload" tone="#3987E5" items={["ETL", "APIs", "Telemetry", "Optimization"]} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Workload icon={HardDrive} title="Object storage" tone="#199E70" items={["Camera", "LiDAR", "Model artifacts"]} />
            <Workload icon={Database} title="Database" tone="#D95926" items={["Fleet", "Labels", "Maintenance", "Charging"]} />
            <div className="rounded-md border border-line bg-raised/50 p-3">
              <div className="label">How this demo actually runs</div>
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-2">
                <span className="font-mono text-ink">docker compose up --build</span> starts two containers: an nginx-served React dashboard and a FastAPI backend with SQLite. Kubernetes manifests in <span className="font-mono text-ink">deployment/k8s</span> are optional examples.
              </p>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
