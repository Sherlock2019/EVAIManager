// Shapes of the API payloads (mirrors backend/app/schemas).

export interface Summary {
  fleet_total: number;
  active_vehicles: number;
  healthy_pct: number;
  status_counts: Record<string, number>;
  risk_counts: Record<string, number>;
  adas_frames_today: number;
  auto_labeled_pct: number;
  review_queue: number;
  charging_stations: number;
  charging_ports: number;
  network_load_pct: number;
  overloaded_stations: number;
  predicted_maintenance_cases: number;
  recommended_new_sites: number;
  alerts: number;
  adas_model: { name: string; map: number };
  live: { running: boolean; seq: number };
}

export interface Insight {
  category: string;
  tone: "critical" | "warning" | "serious" | "info" | "muted";
  text: string;
  link: string;
}

/** rows: [lat, lon, soc, statusCode, speed, corridorFlag, onRouteFlag] */
export interface FleetMap {
  ids: string[];
  models: string[];
  rows: number[][];
}

export interface AdasEvent {
  id: string;
  frame_id: string;
  vehicle_id: string;
  city: string;
  lat: number;
  lon: number;
  cls: string;
  confidence: number;
  scenario: string;
  routing: "auto_accept" | "sample_review" | "human_review";
  ts: string;
}

export interface TickMessage {
  type: "tick" | "hello" | "state";
  seq?: number;
  positions?: number[][];
  chargers?: number[][];
  adas_events?: AdasEvent[];
  summary?: Summary;
}

export interface Vehicle {
  vehicle_id: string;
  model: string;
  year: number;
  city: string;
  zone: string;
  latitude: number;
  longitude: number;
  battery_soc: number;
  battery_soh: number;
  battery_temperature: number;
  motor_temperature: number;
  odometer_km: number;
  daily_km: number;
  charging_cycles: number;
  average_efficiency: number;
  tire_pressure_fl: number;
  tire_pressure_fr: number;
  tire_pressure_rl: number;
  tire_pressure_rr: number;
  fault_codes: string[];
  last_service: string;
  next_service: string;
  health_score: number;
  maintenance_risk: Risk;
  status: string;
  speed_kmh: number;
  moving: boolean;
  route_id: string | null;
}

export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Prediction {
  vehicle_id: string;
  model: string;
  city: string;
  maintenance_probability: number;
  maintenance_risk: Risk;
  health_score: number;
  predicted_component: string;
  component_key: string | null;
  predicted_days_to_service: number | null;
  service_by: string | null;
  confidence: number | null;
  reason_codes: string[];
  recommended_action: string;
  anomaly_score: number;
  component_risks: Record<string, number>;
  booked: boolean;
}

export interface TwinSection {
  name: string;
  health_score: number;
  trend: string;
  risk: string;
  metric: string;
  prediction: string;
  history: number[];
}

export interface Booking {
  vehicle_id: string;
  component: string;
  service_center: string;
  scheduled_for: string;
}

export interface VehicleDetail {
  vehicle: Vehicle;
  prediction: Prediction;
  estimated_range_km: number;
  motor_efficiency_pct: number;
  battery_kwh: number;
  digital_twin: TwinSection[];
  booking: Booking | null;
}

export interface TelemetryPoint {
  t: string;
  battery_temperature: number;
  motor_temperature: number;
  battery_soc: number;
  speed_kmh: number;
  power_kw: number;
  tire_pressure_low: number;
}

export interface Trip {
  vehicle_id: string;
  model: string;
  route_id: string;
  name: string;
  stops: string[];
  coords: [number, number][];
  summary: {
    distance_today_km: number;
    energy_consumed_kwh: number;
    charging_stops: number;
    average_efficiency_wh_km: number;
    duration_min: number;
  };
  timeline: { time: string; label: string; detail: string; index: number; type: string }[];
  samples: { lat: number; lon: number; time: string; speed_kmh: number; soc: number; energy_kwh: number; distance_km: number; state: string }[];
}

export interface RouteInfo {
  route_id: string;
  name: string;
  city: string;
  kind: "urban" | "corridor";
  stops: string[];
  coords: [number, number][];
  distance_km: number;
  trips_per_day: number;
  vehicles: string[];
}

export interface Charger {
  station_id: string;
  name: string;
  city: string;
  zone: string;
  latitude: number;
  longitude: number;
  ports: number;
  available: number;
  utilization: number;
  avg_daily_sessions: number;
  peak_window: string;
  forecast_90d_pct: number;
  power_kw: number;
  fast: boolean;
  status: "normal" | "high" | "overloaded" | "low";
  action: string | null;
  recommendation: string | null;
  add_ports: number;
}

export interface SiteRecommendation {
  rank: number;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  score: number;
  factors: Record<string, number>;
  contributions: Record<string, number>;
  expected_sessions_per_day: number;
  recommended_ports: number;
  nearest_fast_km: number;
  nearby_utilization: number;
  reasons: string[];
  recommended: boolean;
  action: string;
}

export interface StationAction {
  station_id: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  ports: number;
  utilization: number;
  projected_utilization: number;
  forecast_90d_pct: number;
  action: string;
  add_ports: number;
  detail: string;
}

export interface PlannedSite {
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  planned_ports: number;
  nearby_utilization: number;
  nearby_chargers: number;
  predicted_demand_growth_pct: number;
  projected_utilization: number;
  action: string;
  avoided_investment_usd: number;
}

export interface Scenario {
  ev_growth_pct: number;
  avg_daily_km: number;
  fast_charging_adoption_pct: number;
  peak_concentration_pct: number;
}

export interface Plan {
  scenario: Scenario;
  formula: string;
  summary: {
    current_stations: number;
    current_ports: number;
    new_stations: number;
    added_ports: number;
    stations_to_expand: number;
    underutilized_stations: number;
    unnecessary_planned_sites: number;
    avoided_investment_usd: number;
    demand_multiplier: number;
    action_counts: Record<string, number>;
  };
  sites: SiteRecommendation[];
  expansions: StationAction[];
  underutilized: StationAction[];
  planned_sites: PlannedSite[];
  station_actions: Record<string, { action: string; add_ports: number; detail: string; projected_utilization: number }>;
  money_note: string;
}

export interface RideZone {
  name: string;
  lat: number;
  lon: number;
  kind: string;
  daily_pickups: number;
  daily_dropoffs: number;
  peak_pickup_hour: number;
  home_evs: number;
  cloud: [number, number][];
  ev_cloud: [number, number][];
}

export interface RideZoneHour {
  pickups: number;
  dropoffs: number;
  evs: number;
  ratio: number;
  status: "SHORTAGE" | "BALANCED" | "SURPLUS";
  wait_min: number;
}

/** `from` / `to` are indexes into RideForecast.zones */
export interface RideMove {
  from: number;
  to: number;
  evs: number;
  distance_km: number;
  eta_min: number;
  depart_by: string;
  arrive_for: string;
  extra_rides: number;
  reason: string;
}

export interface RideHour {
  hour: number;
  label: string;
  passengers: number;
  evs_on_duty: number;
  capacity: number;
  unserved: number;
  idle_evs: number;
  zones: RideZoneHour[];
  flows: { from: number; to: number; rides: number }[];
  moves: RideMove[];
}

export interface RideStation {
  station_id: string;
  name: string;
  zone: string;
  latitude: number;
  longitude: number;
  ports: number;
  utilization: number;
  power_kw: number;
  peak_hour: number;
  peak_busy_ports: number;
  required_ports: number;
  change_ports: number;
  verdict: "UNDERSIZED" | "RIGHT-SIZED" | "OVERSIZED";
  queue_at_peak: number;
  hourly_busy_ports: number[];
}

export interface RideForecast {
  city: string;
  day: "weekday" | "weekend";
  note: string;
  signals: { source: string; use: string }[];
  zones: RideZone[];
  hours: RideHour[];
  corridors: { from: number; to: number; rides: number; peak_hour: number; distance_km: number }[];
  shifts: { zone: number; start: number; end: number; label: string; zone_name: string; kind: string; requests_per_ev: number; pickups: number; evs: number; top_destination: string }[];
  stations: RideStation[];
  zone_capacity: { zone: number; stations: number; ports: number; required_ports: number; shortfall_ports: number; surplus_ports: number; peak_hour: number }[];
  proposed_sites: { name: string; zone: number; latitude: number; longitude: number; ports: number; zone_shortfall_ports: number; peak_hour: number; reason: string }[];
  summary: {
    evs: number;
    daily_rides: number;
    peak_hour: number;
    peak_passengers: number;
    peak_evs_on_duty: number;
    busiest_pickup_zone: string;
    busiest_dropoff_zone: string;
    unserved_rides: number;
    served_pct: number;
    worst_gap: { zone: string; hour: number; unserved: number };
    max_zone_pickups: number;
    max_zone_evs: number;
    stations: number;
    undersized_stations: number;
    oversized_stations: number;
    right_sized_stations: number;
    ports_to_add: number;
    ports_to_remove: number;
    proposed_sites: number;
  };
}

export interface Detection {
  id: number;
  cls: string;
  confidence: number;
  bbox: [number, number, number, number];
  occluded: boolean;
  small: boolean;
  factors: string[];
  source: string;
  original_cls?: string | null;
  original_confidence?: number | null;
}

export interface Frame {
  frame_id: string;
  vehicle_id: string;
  city: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  weather: string;
  lighting: string;
  road_type: string;
  camera_front_path: string;
  lidar_available: boolean;
  objects: Detection[];
  objects_detected: number;
  model_confidence: number;
  label_status: string;
  review_required: boolean;
  dataset_version: string | null;
  scenario_category: string;
}

export interface FramePage {
  total: number;
  items: Frame[];
}

export interface DatasetVersion {
  version: string;
  frames_total: number;
  frames_added: number;
  status: string;
  created: string;
  human_corrections: number;
  edge_cases_added: number;
  model: string;
  class_distribution: Record<string, number>;
  weather_distribution: Record<string, number>;
  city_distribution: Record<string, number>;
}

export interface ReviewResponse {
  frame: Frame;
  headline: string;
  message: string;
  dataset_version: string | null;
  queue_remaining: number;
  dataset: DatasetVersion;
}

export interface EdgeCase {
  key: string;
  scenario: string;
  events: number;
  average_confidence: number;
  error_rate: number;
  priority: Risk;
  pending_review: number;
  human_corrected: number;
  top_city: string;
  top_city_events: number;
  frames_requested: number;
  sample_frames: string[];
}

export interface EdgeCaseReport {
  cases: EdgeCase[];
  recommendation: string;
  recommendations: { scenario: string; priority: string; text: string }[];
  note: string;
}

export interface PipelineStats {
  total_frames: number;
  total_labels: number;
  thresholds: { auto_accept: number; human_review: number };
  routing: { auto_accept: number; sample_review: number; human_review: number };
  label_status: Record<string, number>;
  review_queue: number;
  histogram: { bin: string; lo: number; count: number }[];
  confidence_by: Record<string, { key: string; avg_confidence: number; frames: number }[]>;
  confidence_by_class: { key: string; avg_confidence: number; labels: number }[];
  penalties: Record<string, Record<string, number>>;
}

export interface ModelMetrics {
  note: string;
  models: { name: string; status: string; precision: number; recall: number; map: number; false_positive_rate: number; false_negative_rate: number }[];
  comparison: { metric: string; v5: number; v6: number; lower_is_better?: boolean }[];
  breakdowns: Record<string, { slice: string; v5: number; v6: number }[]>;
  feedback_impact: { metric: string; before: number; after: number }[];
  candidate: {
    name: string;
    trained_on: string;
    session_corrections: number;
    motorcycle_recall: number;
    pedestrian_recall: number;
    map: number;
    baseline: { motorcycle_recall: number; pedestrian_recall: number; map: number };
  };
  history: { version: string; map: number; recall: number }[];
}

export interface CopilotAnswer {
  intent: string;
  answer: string;
  items: { title: string; value: string; caption: string }[];
  suggestions: string[];
  link: string | null;
}

export interface DemoStep {
  step: number;
  total: number;
  system: "FLEET" | "CHARGING" | "ADAS";
  title: string;
  detail: string;
  metrics: { label: string; before: string | number | null; after: string | number | null }[];
  link: string;
}

export interface SchedulePlan {
  summary: { vehicles_scheduled: number; service_centers: number; critical_same_day: number; within_window_pct: number; total_service_hours: number };
  grouping: string[];
  centers: {
    id: string;
    name: string;
    city: string;
    bays: number;
    vehicles: number;
    hours: number;
    peak_load_pct: number;
    days: {
      day_offset: number;
      date: string;
      hours: number;
      jobs: { vehicle_id: string; model: string; risk: Risk; probability: number; component: string; duration_h: number; parts: string; distance_km: number; window_days: number; within_window: boolean }[];
    }[];
  }[];
}

export interface SimState {
  running: boolean;
  speed: number;
  seq: number;
  tick_seconds: number;
  sim_seconds_per_tick: number;
  clients: number;
}
