import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import AdasIntelligence from "./pages/AdasIntelligence";
import Architecture from "./pages/Architecture";
import ChargingNetwork from "./pages/ChargingNetwork";
import Copilot from "./pages/Copilot";
import Datasets from "./pages/Datasets";
import DemandModel from "./pages/DemandModel";
import EdgeCases from "./pages/EdgeCases";
import FleetCommand from "./pages/FleetCommand";
import HumanReview from "./pages/HumanReview";
import LabelingPipeline from "./pages/LabelingPipeline";
import Maintenance from "./pages/Maintenance";
import ModelMetrics from "./pages/ModelMetrics";
import Overview from "./pages/Overview";
import RideDemand from "./pages/RideDemand";
import RouteIntelligence from "./pages/RouteIntelligence";
import SimulationControls from "./pages/SimulationControls";
import VehicleHealth from "./pages/VehicleHealth";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="adas" element={<AdasIntelligence />} />
        <Route path="adas/labeling" element={<LabelingPipeline />} />
        <Route path="adas/review" element={<HumanReview />} />
        <Route path="adas/edge-cases" element={<EdgeCases />} />
        <Route path="adas/datasets" element={<Datasets />} />
        <Route path="adas/metrics" element={<ModelMetrics />} />
        <Route path="fleet" element={<FleetCommand />} />
        <Route path="fleet/health" element={<VehicleHealth />} />
        <Route path="fleet/maintenance" element={<Maintenance />} />
        <Route path="energy/charging" element={<ChargingNetwork />} />
        <Route path="energy/routes" element={<RouteIntelligence />} />
        <Route path="energy/demand" element={<RideDemand />} />
        <Route path="energy/model" element={<DemandModel />} />
        <Route path="copilot" element={<Copilot />} />
        <Route path="system/architecture" element={<Architecture />} />
        <Route path="system/simulation" element={<SimulationControls />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
