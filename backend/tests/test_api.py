"""API tests against a freshly generated world: acceptance criteria plus the two headline flows."""
from __future__ import annotations


def test_world_matches_the_brief(client):
    s = client.get("/api/dashboard/summary").json()
    assert s["fleet_total"] >= 1000
    assert s["charging_stations"] == 186
    assert s["review_queue"] > 0
    assert s["predicted_maintenance_cases"] > 0
    assert s["recommended_new_sites"] > 0


def test_vehicle_lookup_accepts_short_ids(client):
    full = client.get("/api/vehicles/VF-EV-0821").json()
    short = client.get("/api/vehicles/VF-0821").json()
    assert full["vehicle"]["vehicle_id"] == short["vehicle"]["vehicle_id"] == "VF-EV-0821"
    assert full["prediction"]["predicted_component"] == "Battery Cooling System"
    assert len(full["digital_twin"]) == 7
    assert client.get("/api/vehicles/VF-EV-9999").status_code == 404


def test_charger_plan_adds_expands_and_declines(client):
    plan = client.get("/api/chargers/recommendations").json()
    assert [s["name"] for s in plan["sites"][:3]] == ["Thu Duc East", "Nha Be North", "Di An South"]
    assert plan["summary"]["added_ports"] > 0
    assert any(p["action"] == "DO NOT EXPAND" for p in plan["planned_sites"])
    # the what-if sliders change the answer
    boom = client.get("/api/chargers/recommendations", params={"ev_growth_pct": 100, "avg_daily_km": 80}).json()
    assert boom["summary"]["added_ports"] > plan["summary"]["added_ports"]
    assert client.get("/api/chargers/recommendations", params={"ev_growth_pct": 150}).status_code == 422


def test_ride_forecast_covers_24_hours_and_balances(client):
    f = client.get("/api/rides/forecast").json()
    assert [h["hour"] for h in f["hours"]] == list(range(24))
    assert len(f["zones"]) == len(f["hours"][0]["zones"]) == 14
    # every passenger picked up is dropped off somewhere
    assert abs(sum(z["daily_pickups"] for z in f["zones"]) - sum(z["daily_dropoffs"] for z in f["zones"])) <= 14
    night, rush = f["hours"][3], f["hours"][f["summary"]["peak_hour"]]
    assert rush["passengers"] > 5 * night["passengers"]
    assert any(z["status"] == "SHORTAGE" for z in rush["zones"])
    assert not night["moves"] and any(h["moves"] for h in f["hours"])
    # a move only takes EVs the origin zone actually has, and never sends them too far
    for h in f["hours"]:
        for m in h["moves"]:
            assert 3 <= m["evs"] <= h["zones"][m["from"]]["evs"] and m["eta_min"] <= 40
    verdicts = {s["verdict"] for s in f["stations"]}
    assert verdicts == {"UNDERSIZED", "RIGHT-SIZED", "OVERSIZED"}
    assert all((s["change_ports"] > 0) == (s["verdict"] == "UNDERSIZED") for s in f["stations"])
    assert f["proposed_sites"] and all(p["ports"] >= 4 for p in f["proposed_sites"])
    weekend = client.get("/api/rides/forecast", params={"day": "weekend"}).json()
    assert weekend["summary"]["daily_rides"] < f["summary"]["daily_rides"]
    assert client.get("/api/rides/forecast", params={"day": "holiday"}).status_code == 422


def test_trained_demand_model_beats_the_naive_baseline(client):
    card = client.get("/api/rides/model").json()
    m = card["metrics"]
    assert m["model"]["mae"] < m["baseline"]["mae"] and m["mae_improvement_pct"] > 10
    assert m["model"]["r2"] > 0.9
    assert abs(sum(f["share_pct"] for f in card["importance"]) - 100) < 1
    assert len(card["test_week"]["labels"]) == 168 and len(card["test_week"]["predicted"]) == 14
    # the model learned from the rows that rain raises demand
    dry = client.get("/api/rides/model/predict", params={"zone": 0, "hour": 17, "day_of_week": 4}).json()
    wet = client.get("/api/rides/model/predict", params={"zone": 0, "hour": 17, "day_of_week": 4, "rain": True}).json()
    assert wet["predicted_pickups"] > dry["predicted_pickups"] > 0
    assert client.get("/api/rides/model/predict", params={"zone": 99}).status_code == 422


def test_human_review_feeds_the_next_dataset(client):
    queue = client.get("/api/adas/review-queue").json()
    frame = queue["items"][0]
    v24_before = next(d for d in client.get("/api/datasets").json() if d["version"] == "ADAS-v24")
    target = min(frame["objects"], key=lambda o: o["confidence"])

    res = client.post(f"/api/adas/review/{frame['frame_id']}",
                      json={"action": "correct", "corrections": [{"object_id": target["id"], "cls": "motorcycle"}]})
    assert res.status_code == 200
    body = res.json()
    assert body["headline"] == "HUMAN FEEDBACK CAPTURED"
    assert body["message"] == "Correction will be added to Dataset v24."
    assert body["frame"]["dataset_version"] == "ADAS-v24"
    assert body["queue_remaining"] == queue["total"] - 1

    v24_after = next(d for d in client.get("/api/datasets").json() if d["version"] == "ADAS-v24")
    assert v24_after["human_corrections"] == v24_before["human_corrections"] + 1
    assert v24_after["frames_added"] == v24_before["frames_added"] + 1
    candidate = client.get("/api/adas/model-metrics").json()["candidate"]
    assert candidate["motorcycle_recall"] > candidate["baseline"]["motorcycle_recall"]


def test_rejected_frames_stay_out_of_training(client):
    frame = client.get("/api/adas/review-queue").json()["items"][0]
    body = client.post(f"/api/adas/review/{frame['frame_id']}", json={"action": "reject"}).json()
    assert body["frame"]["dataset_version"] is None
    assert body["frame"]["label_status"] == "human_rejected"


def test_guided_demo_runs_all_eleven_steps_and_is_repeatable(client):
    for _ in range(2):
        steps = [client.post(f"/api/demo/step/{n}").json() for n in range(1, 12)]
        assert [s["step"] for s in steps] == list(range(1, 12))
        assert "CRITICAL" in steps[2]["metrics"][0]["after"]          # maintenance AI flags the anomaly
        assert "Battery Cooling System" in steps[2]["detail"]
        assert steps[8]["metrics"][0]["after"] == "Human verified"    # human corrects the label
    assert client.post("/api/demo/step/12").status_code == 422


def test_copilot_answers_from_dashboard_data(client):
    ask = lambda q: client.post("/api/copilot/ask", json={"question": q}).json()  # noqa: E731
    assert ask("Where should we install new chargers?")["intent"] == "charger_sites"
    assert "Thu Duc East" in ask("Where should VinFast add charging capacity?")["answer"]
    assert ask("Why is VF-EV-0821 high risk?")["intent"] == "vehicle"
    assert ask("Which ADAS scenarios need more training data?")["intent"] == "edge_cases"
    assert ask("Where is charging capacity excessive?")["intent"] == "excess_capacity"
