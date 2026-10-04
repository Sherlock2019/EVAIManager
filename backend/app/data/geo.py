"""Static geography used to seed the synthetic world.

Coordinates are approximate real-world centres; everything placed around them
(vehicles, stations, routes) is synthetic.
"""
from __future__ import annotations

import math
from typing import TypedDict


class City(TypedDict):
    lat: float
    lon: float
    share: float       # share of the fleet
    sigma_lat: float   # spread of generated points, degrees
    sigma_lon: float
    stations: int


CITIES: dict[str, City] = {
    "Ho Chi Minh City": {"lat": 10.7769, "lon": 106.7009, "share": 0.45, "sigma_lat": 0.02, "sigma_lon": 0.02, "stations": 78},
    "Hanoi": {"lat": 21.0285, "lon": 105.8342, "share": 0.28, "sigma_lat": 0.035, "sigma_lon": 0.035, "stations": 52},
    "Da Nang": {"lat": 16.0500, "lon": 108.1900, "share": 0.10, "sigma_lat": 0.022, "sigma_lon": 0.016, "stations": 22},
    "Hai Phong": {"lat": 20.8500, "lon": 106.6700, "share": 0.09, "sigma_lat": 0.022, "sigma_lon": 0.024, "stations": 18},
    "Nha Trang": {"lat": 12.2550, "lon": 109.1750, "share": 0.08, "sigma_lat": 0.026, "sigma_lon": 0.010, "stations": 16},
}


class Zone(TypedDict):
    lat: float
    lon: float
    demand: float   # relative mobility / charging demand, 0-1
    growth: float   # predicted EV growth, 0-1


# Ho Chi Minh City metro zones. The demand weights drive the heatmap, the fleet
# distribution and the charger planning features.
HCMC_ZONES: dict[str, Zone] = {
    "District 1": {"lat": 10.7757, "lon": 106.7004, "demand": 1.00, "growth": 0.55},
    "Thu Duc": {"lat": 10.8494, "lon": 106.7537, "demand": 0.95, "growth": 0.90},
    "Tan Binh": {"lat": 10.8015, "lon": 106.6526, "demand": 0.88, "growth": 0.60},
    "District 7": {"lat": 10.7340, "lon": 106.7216, "demand": 0.84, "growth": 0.50},
    "Binh Thanh": {"lat": 10.8106, "lon": 106.7091, "demand": 0.86, "growth": 0.62},
    "Phu Nhuan": {"lat": 10.7992, "lon": 106.6803, "demand": 0.62, "growth": 0.45},
    "Go Vap": {"lat": 10.8387, "lon": 106.6653, "demand": 0.58, "growth": 0.55},
    "Thao Dien": {"lat": 10.8030, "lon": 106.7340, "demand": 0.60, "growth": 0.66},
    "Binh Tan": {"lat": 10.7653, "lon": 106.6037, "demand": 0.48, "growth": 0.52},
    "District 12": {"lat": 10.8672, "lon": 106.6414, "demand": 0.40, "growth": 0.58},
    "Tan Phu": {"lat": 10.7900, "lon": 106.6280, "demand": 0.46, "growth": 0.40},
    "Nha Be": {"lat": 10.6953, "lon": 106.7405, "demand": 0.44, "growth": 0.86},
    "Di An": {"lat": 10.9042, "lon": 106.7693, "demand": 0.52, "growth": 0.84},
    "District 7 West": {"lat": 10.7300, "lon": 106.6950, "demand": 0.22, "growth": 0.04},
}

OTHER_CITY_ZONES: dict[str, list[str]] = {
    "Hanoi": ["Hoan Kiem", "Ba Dinh", "Cau Giay", "Dong Da", "Long Bien", "Ha Dong", "Tay Ho", "Hoang Mai", "Nam Tu Liem", "Thanh Xuan"],
    "Da Nang": ["Hai Chau", "Son Tra", "Ngu Hanh Son", "Thanh Khe", "Lien Chieu", "Cam Le"],
    "Hai Phong": ["Hong Bang", "Le Chan", "Ngo Quyen", "Hai An", "Kien An"],
    "Nha Trang": ["Loc Tho", "Vinh Hai", "Phuoc Hai", "Vinh Nguyen", "Phuoc Long"],
}

# (name, zone, lat, lon, ports, avg utilisation, forecast 90d %, avg daily sessions)
HCMC_STATION_SEEDS: list[tuple[str, str, float, float, int, float, float, int]] = [
    ("Thu Duc EV Hub", "Thu Duc", 10.8480, 106.7560, 24, 0.83, 31, 217),
    ("Thu Duc Tech Park Station", "Thu Duc", 10.8415, 106.7710, 12, 0.91, 28, 131),
    ("Vo Van Ngan Fast Charge", "Thu Duc", 10.8510, 106.7480, 10, 0.84, 12, 104),
    ("District 1 Central Station", "District 1", 10.7770, 106.7010, 20, 0.79, 14, 188),
    ("Ben Thanh Charging Plaza", "District 1", 10.7725, 106.6980, 16, 0.74, 12, 142),
    ("Nguyen Hue Riverside Hub", "District 1", 10.7745, 106.7045, 12, 0.68, 11, 96),
    ("Tan Binh Airport Hub", "Tan Binh", 10.8125, 106.6630, 22, 0.86, 9, 204),
    ("Cong Hoa Station", "Tan Binh", 10.8010, 106.6490, 12, 0.72, 16, 98),
    ("Binh Thanh Landmark Station", "Binh Thanh", 10.7950, 106.7215, 18, 0.77, 19, 156),
    ("Dien Bien Phu Fast Charge", "Binh Thanh", 10.8010, 106.7100, 10, 0.81, 16, 92),
    ("District 7 Crescent Station", "District 7", 10.7290, 106.7190, 16, 0.58, 9, 104),
    ("Phu My Hung Station", "District 7", 10.7260, 106.7080, 14, 0.41, 6, 66),
    ("District 7 West Plaza", "District 7 West", 10.7300, 106.6950, 16, 0.18, 4, 31),
    ("Nguyen Van Linh Depot", "District 7 West", 10.7335, 106.6880, 14, 0.22, 5, 34),
    ("Nha Be Gateway Station", "Nha Be", 10.6990, 106.7390, 8, 0.87, 29, 78),
    ("Di An Central Station", "Di An", 10.9020, 106.7680, 10, 0.88, 27, 99),
    ("Go Vap Station", "Go Vap", 10.8380, 106.6660, 12, 0.63, 15, 84),
    ("Phu Nhuan Station", "Phu Nhuan", 10.7990, 106.6810, 10, 0.66, 12, 73),
    ("Thao Dien Riverside Station", "Thao Dien", 10.8040, 106.7350, 12, 0.71, 20, 95),
    ("Binh Tan West Station", "Binh Tan", 10.7650, 106.6040, 12, 0.27, 7, 36),
    ("Tan Phu Station", "Tan Phu", 10.7905, 106.6290, 12, 0.29, 6, 39),
    ("District 12 North Station", "District 12", 10.8670, 106.6420, 8, 0.52, 17, 47),
]


class CandidateSeed(TypedDict):
    name: str
    city: str
    lat: float
    lon: float
    route_density: float      # 0-1 share of observed trips passing nearby
    charging_demand: float    # 0-1 unmet charging demand
    nearest_fast_km: float    # distance to nearest fast charger
    growth: float             # 0-1 predicted EV growth
    accessibility: float      # 0-1 mock parking / access factor
    nearby_utilization: float
    reasons: list[str]


CANDIDATE_SITES: list[CandidateSeed] = [
    {"name": "Thu Duc East", "city": "Ho Chi Minh City", "lat": 10.8520, "lon": 106.8050, "route_density": 0.97, "charging_demand": 0.95, "nearest_fast_km": 7.8, "growth": 0.85, "accessibility": 0.88, "nearby_utilization": 0.87,
     "reasons": ["High commuter traffic", "Nearest fast charger 7.8 km", "Existing stations >85% utilization"]},
    {"name": "Nha Be North", "city": "Ho Chi Minh City", "lat": 10.7080, "lon": 106.7350, "route_density": 0.90, "charging_demand": 0.88, "nearest_fast_km": 7.6, "growth": 0.86, "accessibility": 0.82, "nearby_utilization": 0.87,
     "reasons": ["Fast-growing residential corridor", "Nearest fast charger 7.6 km", "Single saturated station serves the area"]},
    {"name": "Di An South", "city": "Ho Chi Minh City", "lat": 10.8850, "lon": 106.7650, "route_density": 0.88, "charging_demand": 0.87, "nearest_fast_km": 6.8, "growth": 0.84, "accessibility": 0.80, "nearby_utilization": 0.88,
     "reasons": ["Cross-province commuter flow", "Nearest fast charger 6.8 km", "Di An Central at 88% utilization"]},
    {"name": "Tan Binh North", "city": "Ho Chi Minh City", "lat": 10.8200, "lon": 106.6400, "route_density": 0.86, "charging_demand": 0.84, "nearest_fast_km": 5.2, "growth": 0.62, "accessibility": 0.74, "nearby_utilization": 0.86,
     "reasons": ["Airport ride-hailing demand", "Tan Binh Airport Hub at 86% utilization"]},
    {"name": "Binh Thanh Riverside", "city": "Ho Chi Minh City", "lat": 10.8180, "lon": 106.7180, "route_density": 0.84, "charging_demand": 0.80, "nearest_fast_km": 4.9, "growth": 0.64, "accessibility": 0.70, "nearby_utilization": 0.79,
     "reasons": ["Dense through-traffic to Thu Duc", "Evening peak queues observed"]},
    {"name": "Long Bien East", "city": "Hanoi", "lat": 21.0400, "lon": 105.9000, "route_density": 0.80, "charging_demand": 0.78, "nearest_fast_km": 5.6, "growth": 0.70, "accessibility": 0.78, "nearby_utilization": 0.82,
     "reasons": ["Bridge commuter corridor", "Nearest fast charger 5.6 km"]},
    {"name": "Ngu Hanh Son Coast", "city": "Da Nang", "lat": 16.0100, "lon": 108.2500, "route_density": 0.74, "charging_demand": 0.76, "nearest_fast_km": 5.4, "growth": 0.68, "accessibility": 0.84, "nearby_utilization": 0.78,
     "reasons": ["Tourism corridor demand", "Seasonal peaks exceed capacity"]},
    {"name": "Thao Dien North", "city": "Ho Chi Minh City", "lat": 10.8130, "lon": 106.7400, "route_density": 0.70, "charging_demand": 0.66, "nearest_fast_km": 3.4, "growth": 0.66, "accessibility": 0.62, "nearby_utilization": 0.71,
     "reasons": ["Moderate demand", "Existing coverage adequate at current growth"]},
    {"name": "Go Vap East", "city": "Ho Chi Minh City", "lat": 10.8440, "lon": 106.6850, "route_density": 0.66, "charging_demand": 0.62, "nearest_fast_km": 3.9, "growth": 0.55, "accessibility": 0.66, "nearby_utilization": 0.63,
     "reasons": ["Residential demand growing steadily"]},
    {"name": "District 12 West", "city": "Ho Chi Minh City", "lat": 10.8700, "lon": 106.6200, "route_density": 0.52, "charging_demand": 0.56, "nearest_fast_km": 4.6, "growth": 0.58, "accessibility": 0.60, "nearby_utilization": 0.52,
     "reasons": ["Coverage gap but low observed trip density"]},
    {"name": "Ha Dong South", "city": "Hanoi", "lat": 20.9500, "lon": 105.7700, "route_density": 0.62, "charging_demand": 0.60, "nearest_fast_km": 4.4, "growth": 0.60, "accessibility": 0.64, "nearby_utilization": 0.61,
     "reasons": ["Emerging suburb demand"]},
    {"name": "Hai An Port", "city": "Hai Phong", "lat": 20.8300, "lon": 106.7300, "route_density": 0.58, "charging_demand": 0.55, "nearest_fast_km": 4.8, "growth": 0.52, "accessibility": 0.70, "nearby_utilization": 0.57,
     "reasons": ["Logistics traffic, limited passenger EV demand"]},
    {"name": "Binh Tan South", "city": "Ho Chi Minh City", "lat": 10.7450, "lon": 106.6000, "route_density": 0.42, "charging_demand": 0.40, "nearest_fast_km": 3.0, "growth": 0.48, "accessibility": 0.58, "nearby_utilization": 0.27,
     "reasons": ["Nearby station underutilized"]},
    {"name": "Vinh Hai North", "city": "Nha Trang", "lat": 12.2900, "lon": 109.1900, "route_density": 0.50, "charging_demand": 0.52, "nearest_fast_km": 3.8, "growth": 0.50, "accessibility": 0.72, "nearby_utilization": 0.49,
     "reasons": ["Seasonal demand only"]},
]

# Sites already pencilled into a (fictional) static expansion plan. The optimizer
# checks whether observed demand actually supports them.
PLANNED_SITES: list[dict] = [
    {"name": "District 7 West", "city": "Ho Chi Minh City", "lat": 10.7270, "lon": 106.6990, "planned_ports": 12, "nearby_utilization": 0.18, "nearby_chargers": 62, "growth": 0.04},
    {"name": "Phu My Hung South", "city": "Ho Chi Minh City", "lat": 10.7180, "lon": 106.7090, "planned_ports": 8, "nearby_utilization": 0.24, "nearby_chargers": 48, "growth": 0.06},
    {"name": "Tan Phu Central", "city": "Ho Chi Minh City", "lat": 10.7860, "lon": 106.6330, "planned_ports": 10, "nearby_utilization": 0.28, "nearby_chargers": 36, "growth": 0.06},
    {"name": "Go Vap North", "city": "Ho Chi Minh City", "lat": 10.8480, "lon": 106.6600, "planned_ports": 8, "nearby_utilization": 0.63, "nearby_chargers": 20, "growth": 0.15},
    {"name": "Cau Giay West", "city": "Hanoi", "lat": 21.0330, "lon": 105.7800, "planned_ports": 10, "nearby_utilization": 0.74, "nearby_chargers": 26, "growth": 0.19},
]

# Named commuter routes through HCMC zones (waypoints are zone names).
HCMC_ROUTES: list[tuple[list[str], int]] = [
    (["District 1", "Thu Duc", "Di An"], 940),
    (["Tan Binh", "District 7", "Nha Be"], 610),
    (["District 1", "Binh Thanh", "Thu Duc"], 1020),
    (["Tan Binh", "Phu Nhuan", "District 1"], 880),
    (["Go Vap", "Binh Thanh", "District 1"], 720),
    (["District 7", "District 1", "Binh Thanh"], 790),
    (["Binh Tan", "Tan Phu", "Tan Binh"], 430),
    (["District 12", "Go Vap", "Phu Nhuan"], 390),
    (["Thao Dien", "Thu Duc", "Di An"], 560),
    (["District 1", "Thao Dien", "Thu Duc"], 830),
    (["Nha Be", "District 7", "District 1"], 520),
    (["Tan Binh", "Binh Thanh", "Thao Dien"], 640),
    (["Di An", "Thu Duc", "Binh Thanh"], 700),
    (["Phu Nhuan", "Go Vap", "District 12"], 350),
    (["District 7 West", "District 7", "District 1"], 160),
    (["Tan Phu", "Tan Binh", "Go Vap"], 370),
]

# Inter-city corridors drawn on the national map (lat, lon waypoints).
CORRIDORS: list[tuple[str, list[tuple[float, float]], int]] = [
    ("Hanoi - Hai Phong Expressway", [(21.0285, 105.8542), (20.960, 106.050), (20.900, 106.330), (20.8500, 106.6700)], 420),
    ("Da Nang - Nha Trang Coastal", [(16.0500, 108.1900), (15.120, 108.800), (13.780, 109.220), (12.2550, 109.1750)], 180),
    ("Nha Trang - Ho Chi Minh City", [(12.2550, 109.1750), (11.560, 108.990), (10.930, 108.100), (10.950, 107.010), (10.7769, 106.7009)], 260),
    ("Hanoi - Da Nang North-South", [(21.0285, 105.8342), (19.800, 105.780), (18.670, 105.690), (17.470, 106.620), (16.0500, 108.1900)], 150),
]

SERVICE_CENTERS: list[dict] = [
    {"id": "SC-HCM-01", "name": "Thu Duc Service Center", "city": "Ho Chi Minh City", "lat": 10.8450, "lon": 106.7620, "bays": 6},
    {"id": "SC-HCM-02", "name": "Tan Binh Service Center", "city": "Ho Chi Minh City", "lat": 10.8040, "lon": 106.6500, "bays": 5},
    {"id": "SC-HCM-03", "name": "District 7 Service Center", "city": "Ho Chi Minh City", "lat": 10.7320, "lon": 106.7180, "bays": 4},
    {"id": "SC-HAN-01", "name": "Long Bien Service Center", "city": "Hanoi", "lat": 21.0450, "lon": 105.8900, "bays": 6},
    {"id": "SC-HAN-02", "name": "Cau Giay Service Center", "city": "Hanoi", "lat": 21.0320, "lon": 105.7950, "bays": 4},
    {"id": "SC-DAD-01", "name": "Hai Chau Service Center", "city": "Da Nang", "lat": 16.0600, "lon": 108.2100, "bays": 4},
    {"id": "SC-HPH-01", "name": "Le Chan Service Center", "city": "Hai Phong", "lat": 20.8450, "lon": 106.6800, "bays": 3},
    {"id": "SC-NHA-01", "name": "Loc Tho Service Center", "city": "Nha Trang", "lat": 12.2450, "lon": 109.1850, "bays": 3},
]

VEHICLE_MODELS: dict[str, dict[str, float]] = {
    # share of fleet, usable battery kWh, rated range km, nominal Wh/km
    "VF 3": {"share": 0.22, "battery_kwh": 18.6, "range_km": 210, "wh_km": 105},
    "VF 5": {"share": 0.20, "battery_kwh": 37.2, "range_km": 326, "wh_km": 125},
    "VF 6": {"share": 0.18, "battery_kwh": 59.6, "range_km": 399, "wh_km": 155},
    "VF 7": {"share": 0.15, "battery_kwh": 75.3, "range_km": 431, "wh_km": 171},
    "VF 8": {"share": 0.15, "battery_kwh": 87.7, "range_km": 471, "wh_km": 190},
    "VF 9": {"share": 0.10, "battery_kwh": 123.0, "range_km": 594, "wh_km": 215},
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
