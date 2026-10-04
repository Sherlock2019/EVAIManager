// What the app is for and how to use each page. Shown on the Overview and above every page.

export const APP_PURPOSE = {
  headline: "Turn EV fleet data into decisions",
  summary:
    "A working demo of how one EV fleet's data (cameras, telemetry, GPS, passenger and charging signals) can drive three kinds of decision: which ADAS labels a human must check, which vehicles to service before they fail, and where to put EVs and chargers.",
  audience: ["ADAS data teams", "Fleet operations", "Charging network planners", "Ride-hailing drivers"],
};

export const PROBLEMS = [
  {
    area: "ADAS",
    problem: "Labeling driving data by hand is slow and costly, and AI-only labels let mistakes into training unnoticed.",
    solution: "AI labels every frame and scores its own confidence. Only the uncertain ones go to a person, and each correction joins the next training dataset.",
    to: "/adas/review",
  },
  {
    area: "Fleet",
    problem: "Vehicle data is mostly looked at after something has already broken.",
    solution: "Telemetry is scored for risk continuously, with reasons, so service is booked days before a failure.",
    to: "/fleet/maintenance",
  },
  {
    area: "Charging",
    problem: "Charger sites and sizes are chosen from static plans, not from where vehicles really drive and charge.",
    solution: "Observed demand scores new sites, sizes expansions and flags planned stations that are not needed.",
    to: "/energy/charging",
  },
  {
    area: "Ride demand",
    problem: "Drivers wait where the last passenger got out, not where the next one is, so riders wait and EVs sit idle.",
    solution: "A 24-hour forecast of passengers and EVs per zone tells drivers where to be and when, and shows which stations are the wrong size.",
    to: "/energy/demand",
  },
];

export interface PageGuideEntry {
  title: string;
  /** what the page is for, in one sentence */
  purpose: string;
  /** the problem it solves */
  problem: string;
  /** how to use it */
  steps: string[];
  /** shown as a card on the Overview */
  main?: boolean;
}

export const PAGE_GUIDE: Record<string, PageGuideEntry> = {
  "/": {
    title: "Overview",
    purpose: "The whole fleet on one screen: vehicles, chargers, routes and what the AI is flagging right now.",
    problem: "Leaders need one place to see what needs attention across ADAS, fleet and charging.",
    steps: ["Press RUN AI DEMO (top right) for an 11-step tour.", "Pick a city above the map to see every vehicle and charger.", "Click an AI Insight on the right to open the page behind it."],
  },
  "/adas": {
    title: "ADAS Intelligence",
    purpose: "A summary of the labeling loop: frames in, labels accepted by AI, frames sent to people.",
    problem: "It is hard to see how much labeling work the AI is really saving.",
    steps: ["Read the pipeline numbers from left to right.", "Open Human Review to see the frames the AI was unsure about."],
  },
  "/adas/labeling": {
    title: "Labeling Pipeline",
    purpose: "Shows how every frame is routed by the AI's confidence: accept, spot-check or human review.",
    problem: "Reviewing every label by hand does not scale; trusting every label is unsafe.",
    steps: ["Check the confidence histogram and the two thresholds.", "Compare confidence by weather, lighting and object class to see where the AI struggles."],
  },
  "/adas/review": {
    title: "Human Review",
    purpose: "The queue of low-confidence frames a person must accept, correct or reject.",
    problem: "Wrong labels silently enter training data unless someone checks the uncertain ones.",
    steps: ["Pick a frame from the queue (lowest confidence first).", "Select a box, press CORRECT, change its class or shape, then save.", "The correction is added to the next dataset version."],
    main: true,
  },
  "/adas/edge-cases": {
    title: "Edge Cases",
    purpose: "Ranks the driving scenarios where the model is most likely to be wrong.",
    problem: "Teams collect more data everywhere when only a few scenarios are failing.",
    steps: ["Read the list from highest priority down.", "Use the recommendation to decide which frames to collect next."],
    main: true,
  },
  "/adas/datasets": {
    title: "Training Datasets",
    purpose: "Dataset versions and what went into each one, including human corrections.",
    problem: "Without versions nobody can say which data trained which model.",
    steps: ["Open the version marked Building to see corrections arriving.", "Compare class, weather and city mix between versions."],
  },
  "/adas/metrics": {
    title: "Model Metrics",
    purpose: "Compares the current ADAS model with the previous one and the next candidate (mock numbers).",
    problem: "A new model should be shipped on evidence, not on hope.",
    steps: ["Compare v5 and v6 on each metric.", "Correct a label in Human Review, then come back to see the candidate move."],
  },
  "/fleet": {
    title: "Fleet Command",
    purpose: "Live map of every vehicle with its status, plus trip replay.",
    problem: "Operators need to find the vehicles that need attention among a thousand that do not.",
    steps: ["Zoom into a city; red and amber dots need attention.", "Click a vehicle to see its details and replay its trip."],
  },
  "/fleet/health": {
    title: "Vehicle Health",
    purpose: "One vehicle in depth: telemetry, predicted failure, and the reasons behind the prediction.",
    problem: "A risk score nobody can explain will not be acted on.",
    steps: ["Open a vehicle, for example VF-EV-0821.", "Read the predicted component, days to service and reason codes.", "Book the service from the same page."],
    main: true,
  },
  "/fleet/maintenance": {
    title: "Maintenance",
    purpose: "All predicted maintenance cases ranked by urgency, and a schedule that groups them by service centre.",
    problem: "Unplanned breakdowns take vehicles off the road and overload workshops.",
    steps: ["Start with the critical cases at the top.", "Run the schedule optimizer to spread jobs across service centres.", "Book a vehicle in."],
    main: true,
  },
  "/energy/charging": {
    title: "Charging Network",
    purpose: "Where to add stations, which to expand, and which planned sites to drop.",
    problem: "Building chargers in the wrong place wastes money and leaves busy areas short.",
    steps: ["Press AI Optimize Network.", "Blue diamonds are new sites, + marks stations to expand, ✕ marks plans to cancel.", "Move the what-if sliders to test growth scenarios."],
    main: true,
  },
  "/energy/routes": {
    title: "Route Intelligence",
    purpose: "The routes vehicles really drive, how busy each is, and heatmaps of travel and charging demand.",
    problem: "Charging demand follows travel patterns that static plans do not capture.",
    steps: ["Switch the heatmap between travel, charging demand and capacity.", "Pick a route, then a vehicle on it, and replay the trip."],
  },
  "/energy/demand": {
    title: "Ride Demand 24h",
    purpose: "Where passengers and EVs are across the city, hour by hour, and what to do about the gap.",
    problem: "Riders wait in one district while EVs sit idle in another; stations are sized without knowing the peak hour.",
    steps: ["Press play to run through 24 hours, or drag the slider.", "Drivers: follow 'Where to be' and the shift plan.", "Network team: switch to 'For the charging network' to see stations that are too small or too big."],
    main: true,
  },
  "/energy/model": {
    title: "Demand Forecast Model",
    purpose: "The trained AI model behind demand forecasting: its data, accuracy, what it relies on, and a what-if predictor.",
    problem: "A forecast is only useful if you can see how accurate it is and why it says what it says.",
    steps: ["Check the error against the naive forecast.", "Pick a zone to compare predicted and actual pickups over the held-out week.", "Use the what-if box: choose zone, day, hour and rain to get a forecast."],
    main: true,
  },
  "/copilot": {
    title: "AI Recommendations",
    purpose: "Ask questions in plain words and get answers drawn from the same data as the dashboards.",
    problem: "Not everyone has time to read ten dashboards to find one answer.",
    steps: ["Click a suggested question or type your own.", "Follow the link in the answer to the page with the detail."],
    main: true,
  },
  "/system/architecture": {
    title: "Architecture",
    purpose: "How the demo is built and what would replace each part in production.",
    problem: "A demo should be clear about what is real and what is simulated.",
    steps: ["Follow the data flow from vehicle to decision.", "Read the demo-versus-production table."],
  },
  "/system/simulation": {
    title: "Simulation Controls",
    purpose: "Pause, speed up or reset the live simulation, and inject a fault into a vehicle.",
    problem: "A live demo needs a way to make something happen on cue.",
    steps: ["Inject a fault, for example battery cooling, into a vehicle.", "Watch it appear in Maintenance and Vehicle Health.", "Reset the world when you are done."],
  },
};

export const MAIN_FEATURES = Object.entries(PAGE_GUIDE)
  .filter(([, g]) => g.main)
  .map(([to, g]) => ({ to, ...g }));
