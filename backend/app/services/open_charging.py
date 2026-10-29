"""Vietnam Open Charging & Investment Intelligence: site economics and scoring.

INDEPENDENT PROPOSAL. Every site, demand figure, price and cost in this module
is SYNTHETIC or ILLUSTRATIVE. No Tesla, VinFast or V-Green partnership is
announced or implied, and none of these sites is a real V-Green station.

Three operating scenarios per site:
    A  VinFast-only baseline
    B  Hybrid: VinFast + Tesla
    C  Hybrid: VinFast + Tesla + other EV brands

Peak-hour waits (estimate, not a prediction) use an M/M/c queue with
non-preemptive priority (Cobham's formula, one common mean service time):
    W_k = ErlangC(c, a) / (c*mu) / ((1 - sigma_{k-1}) * (1 - sigma_k))
    sigma_k = sum of lambda_i / (c*mu) over classes with priority <= k
A class with sigma_k >= 1 has no stable wait and is reported as unbounded.

Money is VAT-exclusive throughout (tariffs are entered VAT-inclusive, as the
driver sees them, and divided by 1 + VAT):
    driver revenue      = paid kWh * tariff / (1 + VAT) + session fees / (1 + VAT)
    operator revenue    = driver revenue collected by the operator
                          + roaming wholesale fees + sponsor reimbursement (only if configured)
    contribution        = operator revenue - energy - payment fees - site-owner share
    operating profit    = contribution - maintenance - platform opex - demand charges

Investment (always incremental against the VinFast-only baseline):
    incremental CF_y    = (hybrid operating profit_y - baseline operating profit_y) * (1 - tax)
    simple ROI          = (sum of incremental CF - incremental capex) / incremental capex * 100
    payback             = first point where cumulative incremental CF >= incremental capex
    NPV                 = -capex + sum CF_y / (1 + r)^y           (end-of-year cash flows)

Site score = sum(w_i * f_i) / sum(w_i) over the factors that HAVE data (each
f_i in 0..1, score 0..100). Missing factors are excluded, never zero-filled or
assumed perfect, and completeness = sum(w_i with data) / sum(all w_i).
"""
from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, Field

DISCLAIMER = (
    "Independent simulation. No Tesla, VinFast, or V-Green partnership is announced or implied. "
    "Data and prices shown in demo mode are illustrative."
)
GROUPS = ("vinfast", "tesla", "other")
THIRD_PARTY = ("tesla", "other")
GROUP_LABEL = {"vinfast": "VinFast", "tesla": "Tesla", "other": "Other EV brands"}
SCENARIO_GROUPS = {"A": ("vinfast",), "B": ("vinfast", "tesla"), "C": ("vinfast", "tesla", "other")}
SCENARIO_LABEL = {"A": "VinFast-only baseline", "B": "Hybrid: VinFast + Tesla", "C": "Hybrid: VinFast + Tesla + other brands"}

# --- operating model constants (illustrative) ---------------------------------
OPERATING_HOURS = 18            # hours per day the site is staffed / open
MAX_PRACTICAL_UTIL = 0.85       # share of port-hours that can realistically be sold
POWER_DERATE = 0.80             # average delivered power / nameplate power over a session
PEAK_FACTOR = 1.8               # peak-hour arrival rate / average hourly arrival rate
PEAK_HOURS = 3                  # length of the daily peak window
RAMP_MONTHS = 6                 # third-party demand ramps linearly to 100 % over this many months
DAYS_PER_MONTH = 365 / 12

# --- capex building blocks, VND (illustrative) -----------------------------
PORT_HARDWARE_VND_PER_KW = 6_500_000    # DC port hardware incl. share of cabinet, per kW of port power
PORT_INSTALL_VND = 80_000_000
CONNECTOR_ALLOWANCE_VND = 40_000_000    # per opened port: connector / authorization changes, compatibility UNVERIFIED
SOFTWARE_INTEGRATION_VND = 250_000_000  # roaming / payment / priority-queue integration
PERMITTING_VND = 80_000_000
CIVIL_ADD_VND = 120_000_000
CIVIL_NEW_VND = 300_000_000
GRID_UNKNOWN_ESTIMATE_VND = 1_500_000_000  # used when grid cost is unknown, flagged as an estimate
GRID_NEW_SITE_VND = 900_000_000            # transformer + connection for a new site with known or estimated headroom

# --- scoring ----------------------------------------------------------------
WEIGHTS = {
    "local_demand": 0.10,
    "tesla_demand": 0.10,
    "other_demand": 0.08,
    "spare_capacity": 0.12,
    "incremental_contribution": 0.15,
    "investment_cost": 0.08,
    "grid_feasibility": 0.10,
    "accessibility": 0.06,
    "corridor_coverage": 0.06,
    "vinfast_wait_impact": 0.10,
    "readiness": 0.05,
}
FACTOR_LABEL = {
    "local_demand": "Local charging demand",
    "tesla_demand": "Estimated Tesla demand",
    "other_demand": "Other-brand demand",
    "spare_capacity": "Unused charging capacity",
    "incremental_contribution": "Incremental contribution",
    "investment_cost": "Investment cost (lower is better)",
    "grid_feasibility": "Grid connection feasibility",
    "accessibility": "Customer accessibility",
    "corridor_coverage": "Road / corridor coverage",
    "vinfast_wait_impact": "VinFast wait impact (lower wait is better)",
    "readiness": "Operational & technical readiness",
}
DEMAND_NORM_SESSIONS_PER_PORT = 12   # sessions/day/port that scores 1.0 for local demand
THIRD_PARTY_NORM_SESSIONS = 25       # Tesla or other-brand sessions/day that score 1.0
CONTRIBUTION_NORM_VND = 1_200_000_000
CAPEX_NORM_VND = 8_000_000_000
GRID_SCORE = {"confirmed": 1.0, "estimated": 0.6}       # unknown -> no data
COMPAT_SCORE = {"confirmed": 1.0, "unverified": 0.5, "incompatible": 0.0}
MIN_COMPLETENESS = 0.85              # below this the engine says "Investigate further"
OPEN_SPARE_MIN = 0.40                # baseline spare capacity needed to open without adding ports
SCORE_THRESHOLD = 55                 # minimum score for an investment recommendation

SIMULATED = "simulated"

# --- synthetic sites --------------------------------------------------------------------
# SYNTHETIC SITE: names, coordinates, ports, demand and costs are invented for the demo.
SITES: list[dict[str, Any]] = [
    {
        "site_id": "OC-HCM-01", "name": "Riverside Mall D7", "city": "Ho Chi Minh City", "region": "HCMC", "setting": "destination",
        "lat": 10.7292, "lon": 106.7213, "site_type": "vinfast_only", "dc_ports": 8, "ac_ports": 4, "port_kw": 60,
        "demand": {"vinfast": 46, "tesla": 14, "other": 18},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "confirmed", "grid_spare_kw": 400, "accessibility": 0.9, "corridor": 0.3, "add_ports": 2,
        "risks": ["Mall parking rules may limit dwell time", "Tesla compatibility not yet tested on site"],
    },
    {
        "site_id": "OC-HCM-02", "name": "Thu Duc Transit Hub", "city": "Ho Chi Minh City", "region": "HCMC", "setting": "urban",
        "lat": 10.8507, "lon": 106.7718, "site_type": "vinfast_only", "dc_ports": 6, "ac_ports": 2, "port_kw": 60,
        "demand": {"vinfast": 65, "tesla": 20, "other": 24},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "confirmed", "grid_spare_kw": 0, "accessibility": 0.8, "corridor": 0.5, "add_ports": 2,
        "risks": ["VinFast peak-hour queue already near target", "No spare grid capacity for more ports"],
    },
    {
        "site_id": "OC-HN-01", "name": "Long Bien Retail Park", "city": "Hanoi", "region": "Hanoi", "setting": "urban",
        "lat": 21.0452, "lon": 105.8893, "site_type": "vinfast_only", "dc_ports": 6, "ac_ports": 4, "port_kw": 60,
        "demand": {"vinfast": 55, "tesla": 12, "other": 26},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "estimated", "grid_spare_kw": 300, "accessibility": 0.85, "corridor": 0.4, "add_ports": 2,
        "risks": ["Grid headroom is an estimate, not a utility confirmation", "Opening without new ports would crowd VinFast peak"],
    },
    {
        "site_id": "OC-HN-02", "name": "My Dinh Stadium Car Park", "city": "Hanoi", "region": "Hanoi", "setting": "destination",
        "lat": 21.0206, "lon": 105.7638, "site_type": "vinfast_only", "dc_ports": 10, "ac_ports": 6, "port_kw": 60,
        "demand": {"vinfast": 52, "tesla": 9, "other": 22},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "confirmed", "grid_spare_kw": 350, "accessibility": None, "corridor": 0.35, "add_ports": 2,
        "risks": ["Event days create short, extreme peaks", "Accessibility survey missing"],
    },
    {
        "site_id": "OC-COR-01", "name": "HCMC-Long Thanh Expressway km 28", "city": "Dong Nai", "region": "Corridor", "setting": "highway",
        "lat": 10.7905, "lon": 106.8710, "site_type": "vinfast_only", "dc_ports": 4, "ac_ports": 0, "port_kw": 120,
        "demand": {"vinfast": 20, "tesla": 9, "other": 11},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "confirmed", "grid_spare_kw": 150, "accessibility": 0.7, "corridor": 0.95, "add_ports": 2,
        "risks": ["Holiday traffic is highly seasonal", "Small site: one faulty port removes 25 % of capacity"],
    },
    {
        "site_id": "OC-COR-02", "name": "Hanoi-Hai Phong Expressway Rest Stop", "city": "Hai Duong", "region": "Corridor", "setting": "highway",
        "lat": 20.9402, "lon": 106.2531, "site_type": "vinfast_only", "dc_ports": 4, "ac_ports": 0, "port_kw": 120,
        "demand": {"vinfast": 30, "tesla": 8, "other": 14},
        "compat": {"tesla": "unverified", "other": "unverified"},
        "grid": "unknown", "grid_spare_kw": None, "accessibility": None, "corridor": 0.9, "add_ports": 2,
        "risks": ["Grid capacity unknown", "Compatibility for all third-party groups unverified"],
    },
    {
        "site_id": "OC-NEW-01", "name": "Thu Thiem New Urban Area", "city": "Ho Chi Minh City", "region": "HCMC", "setting": "urban",
        "lat": 10.7741, "lon": 106.7216, "site_type": "proposed", "dc_ports": 8, "ac_ports": 4, "port_kw": 60,
        "demand": {"vinfast": 60, "tesla": 28, "other": 38},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "estimated", "grid_spare_kw": None, "accessibility": 0.85, "corridor": 0.45, "add_ports": 0,
        "risks": ["New-build: land lease and permits not secured", "Demand is a simulated forecast for a growing district"],
    },
    {
        "site_id": "OC-NEW-02", "name": "Da Nang-Hoi An Coastal Road", "city": "Da Nang", "region": "Corridor", "setting": "highway",
        "lat": 15.9520, "lon": 108.2790, "site_type": "proposed", "dc_ports": 6, "ac_ports": 2, "port_kw": 120,
        "demand": {"vinfast": 12, "tesla": 4, "other": 8},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "unknown", "grid_spare_kw": None, "accessibility": 0.6, "corridor": 0.7, "add_ports": 0,
        "risks": ["Low simulated demand", "Grid capacity unknown"],
    },
    # --- airports: long parking dwell, ride-hailing and rental fleets, airport-authority approval needed ---
    {
        "site_id": "OC-AIR-LTH", "name": "Long Thanh International Airport (landside car park)", "city": "Dong Nai", "region": "Airports", "setting": "airport",
        "lat": 10.7600, "lon": 107.0290, "site_type": "proposed", "dc_ports": 12, "ac_ports": 8, "port_kw": 60,
        "demand": {"vinfast": 110, "tesla": 40, "other": 65},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "estimated", "grid_spare_kw": None, "accessibility": 0.95, "corridor": 0.9, "add_ports": 0,
        "risks": ["Airport opening ramp-up: traffic forecast is simulated", "Concession and airport-authority approval required",
                  "Grid offer for the landside zone not yet obtained"],
    },
    {
        "site_id": "OC-AIR-SGN", "name": "Tan Son Nhat Airport Parking", "city": "Ho Chi Minh City", "region": "Airports", "setting": "airport",
        "lat": 10.8165, "lon": 106.6600, "site_type": "vinfast_only", "dc_ports": 8, "ac_ports": 6, "port_kw": 60,
        "demand": {"vinfast": 78, "tesla": 22, "other": 34},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "confirmed", "grid_spare_kw": 200, "accessibility": 0.9, "corridor": 0.6, "add_ports": 2,
        "risks": ["Ride-hailing peaks around flight banks", "Parking space is scarce; added bays compete with paid parking"],
    },
    {
        "site_id": "OC-AIR-HAN", "name": "Noi Bai Airport Terminal 2 Parking", "city": "Hanoi", "region": "Airports", "setting": "airport",
        "lat": 21.2150, "lon": 105.8060, "site_type": "vinfast_only", "dc_ports": 8, "ac_ports": 6, "port_kw": 60,
        "demand": {"vinfast": 50, "tesla": 12, "other": 26},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "confirmed", "grid_spare_kw": 250, "accessibility": 0.9, "corridor": 0.7, "add_ports": 2,
        "risks": ["Airport-authority approval needed to change access rules", "Tesla compatibility not yet tested on site"],
    },
    {
        "site_id": "OC-AIR-DAD", "name": "Da Nang Airport Parking", "city": "Da Nang", "region": "Airports", "setting": "airport",
        "lat": 16.0500, "lon": 108.2010, "site_type": "vinfast_only", "dc_ports": 4, "ac_ports": 4, "port_kw": 60,
        "demand": {"vinfast": 28, "tesla": 6, "other": 16},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "confirmed", "grid_spare_kw": 150, "accessibility": 0.85, "corridor": 0.5, "add_ports": 2,
        "risks": ["Tourist seasonality", "Small site: one faulty port removes 25 % of capacity"],
    },
    {
        "site_id": "OC-AIR-CXR", "name": "Cam Ranh Airport (Nha Trang)", "city": "Khanh Hoa", "region": "Airports", "setting": "airport",
        "lat": 11.9990, "lon": 109.2170, "site_type": "proposed", "dc_ports": 6, "ac_ports": 4, "port_kw": 60,
        "demand": {"vinfast": 26, "tesla": 8, "other": 20},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "estimated", "grid_spare_kw": None, "accessibility": 0.8, "corridor": 0.6, "add_ports": 0,
        "risks": ["Rental-fleet demand assumed, not contracted", "Tourist seasonality"],
    },
    {
        "site_id": "OC-AIR-PQC", "name": "Phu Quoc Airport", "city": "Kien Giang", "region": "Airports", "setting": "airport",
        "lat": 10.1720, "lon": 103.9950, "site_type": "proposed", "dc_ports": 4, "ac_ports": 4, "port_kw": 60,
        "demand": {"vinfast": 18, "tesla": 3, "other": 10},
        "compat": {"tesla": "unverified", "other": "confirmed"},
        "grid": "unknown", "grid_spare_kw": None, "accessibility": None, "corridor": 0.4, "add_ports": 0,
        "risks": ["Island grid capacity unknown", "Few Tesla vehicles on the island in this simulation"],
    },
    {
        "site_id": "OC-AIR-HPH", "name": "Cat Bi Airport (Hai Phong)", "city": "Hai Phong", "region": "Airports", "setting": "airport",
        "lat": 20.8200, "lon": 106.7230, "site_type": "vinfast_only", "dc_ports": 4, "ac_ports": 2, "port_kw": 60,
        "demand": {"vinfast": 24, "tesla": 5, "other": 12},
        "compat": {"tesla": "unverified", "other": "unverified"},
        "grid": "estimated", "grid_spare_kw": 100, "accessibility": 0.8, "corridor": 0.5, "add_ports": 2,
        "risks": ["Close to the VinFast Hai Phong home market: VinFast demand may grow fast", "Third-party compatibility unverified"],
    },
]


class Assumptions(BaseModel):
    """Every number the dashboards depend on. Defaults are ILLUSTRATIVE, not real tariffs or costs."""
    # pricing: VAT-inclusive, what the driver sees
    tariff_vinfast: float = Field(3000, ge=0, le=20000)
    tariff_tesla: float = Field(4000, ge=0, le=20000)
    tariff_other: float = Field(4500, ge=0, le=20000)
    vinfast_discount_pct: float = Field(0, ge=0, le=100)
    # VinFast EVs charge free for their first 3 years; this is the share of VinFast kWh from vehicles still inside that period
    vinfast_free_share_pct: float = Field(80, ge=0, le=100, description="share of VinFast kWh delivered free (3-year free-charging period)")
    sponsor_reimbursement_vnd_per_kwh: float = Field(0, ge=0, le=20000, description="0 = no reimbursement agreement modelled")
    third_party_session_fee_vnd: float = Field(0, ge=0, le=500000)
    vat_pct: float = Field(10, ge=0, le=30)
    # demand and operations
    demand_scale_pct: float = Field(100, ge=10, le=300)
    kwh_vinfast: float = Field(32, ge=5, le=120)
    kwh_tesla: float = Field(40, ge=5, le=120)
    kwh_other: float = Field(30, ge=5, le=120)
    annual_growth_pct: float = Field(8, ge=-20, le=60)
    assume_unverified_compatible: bool = True
    third_party_peak_cap_pct: float = Field(30, ge=0, le=100, description="max share of peak capacity third parties may use")
    target_vinfast_avg_wait_min: float = Field(10, ge=1, le=120)
    target_vinfast_p90_wait_min: float = Field(25, ge=1, le=240)
    # costs (VAT-exclusive)
    energy_cost_vnd_per_kwh: float = Field(2400, ge=0, le=20000)
    demand_charge_vnd_per_kw_month: float = Field(0, ge=0, le=500000)
    payment_fee_pct: float = Field(2, ge=0, le=10)
    maintenance_vnd_per_port_year: float = Field(20_000_000, ge=0, le=500_000_000)
    hybrid_platform_opex_vnd_year: float = Field(60_000_000, ge=0, le=2_000_000_000)
    site_owner_share_pct: float = Field(0, ge=0, le=100)
    capex_scale_pct: float = Field(100, ge=10, le=300)
    # commercial model
    operating_model: Literal["direct", "roaming", "joint"] = "direct"
    msp_margin_pct: float = Field(12, ge=0, le=100, description="roaming: share of third-party driver revenue kept by the mobility provider")
    partner_capex_share_pct: float = Field(50, ge=0, le=100)
    partner_cashflow_share_pct: float = Field(50, ge=0, le=100)
    # finance
    horizon_years: int = Field(8, ge=1, le=15)
    discount_rate_pct: float = Field(10, ge=0, le=40)
    tax_pct: float = Field(0, ge=0, le=50, description="0 = pre-tax")
    residual_value_pct: float = Field(0, ge=0, le=100)
    hybrid_mode: Literal["B", "C"] = "C"

    def tariff(self, g: str) -> float:
        return {"vinfast": self.tariff_vinfast, "tesla": self.tariff_tesla, "other": self.tariff_other}[g]

    def kwh(self, g: str) -> float:
        return {"vinfast": self.kwh_vinfast, "tesla": self.kwh_tesla, "other": self.kwh_other}[g]


class EvaluateRequest(BaseModel):
    assumptions: Assumptions = Assumptions()
    weights: dict[str, float] = Field(default_factory=lambda: dict(WEIGHTS))


# --- queueing --------------------------------------------------------------------------
def erlang_c(c: int, a: float) -> float:
    """Probability an arrival waits in an M/M/c queue with offered load a (erlangs)."""
    if a <= 0:
        return 0.0
    if a >= c:
        return 1.0
    total, term = 0.0, 1.0
    for k in range(c):
        total += term
        term *= a / (k + 1)
    top = term * c / (c - a)
    return top / (total + top)


def priority_waits(c: int, lambdas: dict[str, float], service_h: dict[str, float]) -> dict[str, dict[str, float | None]]:
    """Mean and approximate p90 wait (minutes) per class, classes ordered as given (highest first)."""
    total = sum(lambdas.values())
    out: dict[str, dict[str, float | None]] = {}
    if total <= 0 or c <= 0:
        return {g: {"avg": 0.0, "p90": 0.0} for g in lambdas}
    mean_s = sum(lambdas[g] * service_h[g] for g in lambdas) / total
    cmu = c / mean_s
    pw = erlang_c(c, total * mean_s)
    sigma_prev = 0.0
    for g, lam in lambdas.items():
        sigma = sigma_prev + lam / cmu
        if sigma >= 1:
            out[g] = {"avg": None, "p90": None}
        else:
            w = pw / cmu / ((1 - sigma_prev) * (1 - sigma)) * 60
            # conditional wait treated as exponential: P(W > t) = pw * exp(-t / (w / pw))
            p90 = (w / pw) * math.log(pw / 0.1) if pw > 0.1 else 0.0
            out[g] = {"avg": round(w, 1), "p90": round(p90, 1)}
        sigma_prev = sigma
    return out


def _excluded(site: dict[str, Any], g: str, a: Assumptions) -> str | None:
    if g == "vinfast":
        return None
    status = site["compat"][g]
    if status == "incompatible":
        return "incompatible"
    if status == "unverified" and not a.assume_unverified_compatible:
        return "unverified compatibility not admitted"
    return None


def operate(site: dict[str, Any], a: Assumptions, groups: tuple[str, ...], ports: int,
            growth: float = 1.0, tp_factor: float = 1.0) -> dict[str, Any]:
    """One average day at the site: demand, served sessions, kWh, utilization and peak waits."""
    scale = a.demand_scale_pct / 100 * growth
    svc = {g: a.kwh(g) / (site["port_kw"] * POWER_DERATE) for g in GROUPS}
    demand = {g: 0.0 for g in GROUPS}
    excluded = {}
    for g in groups:
        why = _excluded(site, g, a)
        if why:
            excluded[g] = why
            continue
        demand[g] = site["demand"][g] * scale * (tp_factor if g != "vinfast" else 1.0)

    peak = {g: demand[g] / OPERATING_HOURS * PEAK_FACTOR for g in GROUPS}
    turned_away = {g: 0.0 for g in GROUPS}
    tp_peak = sum(peak[g] for g in THIRD_PARTY)
    cap_binding = False
    if tp_peak > 0:
        mean_tp_svc = sum(peak[g] * svc[g] for g in THIRD_PARTY) / tp_peak
        allowed = a.third_party_peak_cap_pct / 100 * ports / mean_tp_svc
        if tp_peak > allowed:
            cap_binding = True
            ratio = allowed / tp_peak
            for g in THIRD_PARTY:
                turned_away[g] = peak[g] * (1 - ratio) * PEAK_HOURS
                peak[g] *= ratio

    remaining = ports * OPERATING_HOURS * MAX_PRACTICAL_UTIL
    served = {}
    for g in GROUPS:  # priority order: capacity goes to VinFast first, then Tesla, then others
        want = max(0.0, demand[g] - turned_away[g])
        served[g] = min(want, remaining / svc[g]) if want > 0 else 0.0
        remaining -= served[g] * svc[g]
        turned_away[g] = demand[g] - served[g]

    active = {g: peak[g] for g in GROUPS if g in groups and g not in excluded}
    waits = priority_waits(ports, active, svc)
    return {
        "ports": ports,
        "demand": demand,
        "served": served,
        "turned_away": turned_away,
        "kwh": {g: served[g] * a.kwh(g) for g in GROUPS},
        "utilization": sum(served[g] * svc[g] for g in GROUPS) / (ports * OPERATING_HOURS),
        "waits": {g: waits.get(g, {"avg": None, "p90": None}) for g in GROUPS},
        "peak_cap_binding": cap_binding,
        "excluded": excluded,
    }


def money(site: dict[str, Any], op: dict[str, Any], a: Assumptions, hybrid: bool, days: float) -> dict[str, Any]:
    """Revenue and cost for `days` of operation at the given daily operating point. VAT-exclusive."""
    vat = 1 + a.vat_pct / 100
    kwh = {g: op["kwh"][g] * days for g in GROUPS}
    sessions = {g: op["served"][g] * days for g in GROUPS}
    free_kwh = kwh["vinfast"] * a.vinfast_free_share_pct / 100
    paid_kwh = {**kwh, "vinfast": kwh["vinfast"] - free_kwh}

    driver = {"vinfast": paid_kwh["vinfast"] * a.tariff_vinfast * (1 - a.vinfast_discount_pct / 100) / vat}
    for g in THIRD_PARTY:
        driver[g] = (paid_kwh[g] * a.tariff(g) + sessions[g] * a.third_party_session_fee_vnd) / vat
    discount = kwh["vinfast"] * a.tariff_vinfast / vat - driver["vinfast"]  # free + discounted value given away
    sponsor = free_kwh * a.sponsor_reimbursement_vnd_per_kwh  # only non-zero when a reimbursement is configured

    roaming = a.operating_model == "roaming"
    msp_margin = sum(driver[g] for g in THIRD_PARTY) * a.msp_margin_pct / 100 if roaming else 0.0
    operator_revenue = sum(driver.values()) - msp_margin + sponsor
    # payment fees apply to what the operator itself collects from drivers (VAT-inclusive amount)
    collected = driver["vinfast"] + (0.0 if roaming else sum(driver[g] for g in THIRD_PARTY))
    payment_fees = collected * vat * a.payment_fee_pct / 100
    energy = sum(kwh.values()) * a.energy_cost_vnd_per_kwh
    site_owner = operator_revenue * a.site_owner_share_pct / 100
    contribution = operator_revenue - energy - payment_fees - site_owner
    maintenance = op["ports"] * a.maintenance_vnd_per_port_year * days / 365
    platform = a.hybrid_platform_opex_vnd_year * days / 365 if hybrid else 0.0
    demand_charges = a.demand_charge_vnd_per_kw_month * op["ports"] * site["port_kw"] * days / DAYS_PER_MONTH
    return {
        "sessions": sessions, "kwh": kwh, "paid_kwh": paid_kwh, "free_kwh": free_kwh,
        "driver_revenue": driver, "discount_value": discount, "sponsor_reimbursement": sponsor,
        "msp_margin": msp_margin, "operator_revenue": operator_revenue,
        "vat_collected": sum(driver.values()) * (vat - 1),
        "energy_cost": energy, "payment_fees": payment_fees, "site_owner_share": site_owner,
        "contribution": contribution, "maintenance": maintenance, "platform_opex": platform,
        "demand_charges": demand_charges,
        "operating_profit": contribution - maintenance - platform - demand_charges,
    }


def _add(acc: dict[str, Any], m: dict[str, Any]) -> dict[str, Any]:
    for k, v in m.items():
        if isinstance(v, dict):
            acc.setdefault(k, {g: 0.0 for g in v})
            for g, x in v.items():
                acc[k][g] += x
        else:
            acc[k] = acc.get(k, 0.0) + v
    return acc


def year_one(site: dict[str, Any], a: Assumptions, scenario: str, ports: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Year-1 totals as the sum of 12 months (third-party demand ramps up, demand grows monthly)."""
    groups = SCENARIO_GROUPS[scenario]
    g = 1 + a.annual_growth_pct / 100
    total: dict[str, Any] = {}
    months = []
    for m in range(12):
        op = operate(site, a, groups, ports, growth=g ** (m / 12), tp_factor=min(1.0, (m + 1) / RAMP_MONTHS))
        mm = money(site, op, a, scenario != "A", DAYS_PER_MONTH)
        months.append({"month": m + 1, "driver_revenue": mm["driver_revenue"], "operator_revenue": mm["operator_revenue"],
                       "contribution": mm["contribution"], "operating_profit": mm["operating_profit"]})
        _add(total, mm)
    return total, months


def annual_profits(site: dict[str, Any], a: Assumptions, scenario: str, ports: int) -> list[float]:
    """Operating profit for years 1..horizon (year 1 includes the third-party ramp-up)."""
    if ports == 0:
        return [0.0] * a.horizon_years
    y1, _ = year_one(site, a, scenario, ports)
    out = [y1["operating_profit"]]
    g = 1 + a.annual_growth_pct / 100
    for y in range(2, a.horizon_years + 1):
        op = operate(site, a, SCENARIO_GROUPS[scenario], ports, growth=g ** (y - 1))
        out.append(money(site, op, a, scenario != "A", 365)["operating_profit"])
    return out


# --- investment metrics ---------------------------------------------------------------
def investment_metrics(capex: float, cash_flows: list[float], rate_pct: float, residual: float = 0.0) -> dict[str, Any]:
    """Simple ROI, cumulative payback, NPV and (only when well-defined) IRR."""
    cfs = list(cash_flows)
    if residual:
        cfs[-1] += residual
    cumulative, running = [], 0.0
    for cf in cfs:
        running += cf
        cumulative.append(running)

    if capex <= 0:
        roi, roi_note = None, "Not applicable: incremental capex is zero, so there is nothing to return on."
        payback, payback_note = 0.0, "Immediate: no incremental capex."
    else:
        roi, roi_note = (running - capex) / capex * 100, None
        payback, payback_note, prev = None, "No payback within modeled horizon.", 0.0
        for y, cum in enumerate(cumulative, start=1):
            if cum >= capex:
                payback = (y - 1) + (capex - prev) / (cum - prev) if cum > prev else float(y)
                payback_note = None
                break
            prev = cum

    r = rate_pct / 100
    npv = -capex + sum(cf / (1 + r) ** y for y, cf in enumerate(cfs, start=1))
    irr, irr_note = _irr([-capex, *cfs])
    return {
        "capex": capex, "cash_flows": cfs, "cumulative": cumulative,
        "simple_roi_pct": None if roi is None else round(roi, 1), "roi_note": roi_note,
        "payback_years": None if payback is None else round(payback, 2), "payback_note": payback_note,
        "npv": npv, "irr_pct": irr, "irr_note": irr_note,
    }


def _irr(flows: list[float]) -> tuple[float | None, str | None]:
    signs = [f for f in flows if abs(f) > 1e-6]
    changes = sum(1 for x, y in zip(signs, signs[1:]) if (x < 0) != (y < 0))
    if changes == 0:
        return None, "Undefined: cash flows never change sign."
    if changes > 1:
        return None, "Not shown: cash flows change sign more than once, so IRR may not be unique."

    def npv(rate: float) -> float:
        return sum(f / (1 + rate) ** t for t, f in enumerate(flows))

    lo, hi = -0.99, 10.0
    if npv(lo) * npv(hi) > 0:
        return None, "Undefined: no rate between -99 % and 1000 % sets NPV to zero."
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(lo) * npv(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return round(mid * 100, 1), None


# --- options -----------------------------------------------------------------------
def capex_breakdown(site: dict[str, Any], option: str, a: Assumptions) -> dict[str, Any]:
    k = a.capex_scale_pct / 100
    opened = site["dc_ports"] if option != "new_site" else 0
    add = site["add_ports"] if option == "add_ports" else 0
    grid_needed_kw = add * site["port_kw"]
    estimate = False
    hw = PORT_HARDWARE_VND_PER_KW * site["port_kw"]
    if option == "new_site":
        n = site["dc_ports"]
        grid = GRID_UNKNOWN_ESTIMATE_VND if site["grid"] == "unknown" else GRID_NEW_SITE_VND
        estimate = site["grid"] != "confirmed"
        items = {
            "charger_hardware": n * hw, "installation": n * PORT_INSTALL_VND, "civil_works": CIVIL_NEW_VND,
            "grid_connection": grid, "software_integration": SOFTWARE_INTEGRATION_VND, "permitting": PERMITTING_VND * 2,
        }
    else:
        grid = 0.0
        if add:
            spare = site["grid_spare_kw"]
            if spare is None:
                grid, estimate = GRID_UNKNOWN_ESTIMATE_VND, True
            elif spare < grid_needed_kw:
                grid = GRID_UNKNOWN_ESTIMATE_VND * (grid_needed_kw - spare) / grid_needed_kw
        items = {
            "charger_hardware": add * hw + opened * CONNECTOR_ALLOWANCE_VND,
            "installation": add * PORT_INSTALL_VND, "civil_works": CIVIL_ADD_VND if add else 0.0,
            "grid_connection": grid, "software_integration": SOFTWARE_INTEGRATION_VND, "permitting": PERMITTING_VND,
        }
    items = {key: v * k for key, v in items.items()}
    return {"items": items, "total": sum(items.values()), "grid_is_estimate": estimate}


OPTION_LABEL = {
    "open_spare": "Open selected spare capacity",
    "add_ports": "Upgrade: add compatible ports",
    "new_site": "Develop new hybrid site",
}


def evaluate_option(site: dict[str, Any], option: str, a: Assumptions) -> dict[str, Any]:
    scen = a.hybrid_mode
    if option == "new_site":
        base_ports, ports = 0, site["dc_ports"]
    else:
        base_ports = site["dc_ports"]
        ports = site["dc_ports"] + (site["add_ports"] if option == "add_ports" else 0)
    capex = capex_breakdown(site, option, a)
    base = annual_profits(site, a, "A", base_ports)
    hyb = annual_profits(site, a, scen, ports)
    inc = [(h - b) for h, b in zip(hyb, base)]
    inc = [cf * (1 - a.tax_pct / 100) if cf > 0 else cf for cf in inc]
    residual = capex["total"] * a.residual_value_pct / 100
    metrics = investment_metrics(capex["total"], inc, a.discount_rate_pct, residual)
    op = operate(site, a, SCENARIO_GROUPS[scen], ports)
    out = {
        **metrics,
        "option": option, "label": OPTION_LABEL[option], "scenario": scen, "ports": ports,
        "capex": capex, "baseline_profit": base, "hybrid_profit": hyb,
        "annual_incremental_cf_y1": inc[0], "vinfast_wait": op["waits"]["vinfast"], "utilization": op["utilization"],
    }
    if a.operating_model == "joint":
        out["parties"] = _joint_split(capex["total"], inc, a)
    return out


def _joint_split(capex: float, inc: list[float], a: Assumptions) -> dict[str, Any]:
    p_cap, p_cf = a.partner_capex_share_pct / 100, a.partner_cashflow_share_pct / 100
    return {
        "operator": investment_metrics(capex * (1 - p_cap), [cf * (1 - p_cf) for cf in inc], a.discount_rate_pct),
        "partner_investor": investment_metrics(capex * p_cap, [cf * p_cf for cf in inc], a.discount_rate_pct),
    }


def site_options(site: dict[str, Any]) -> list[str]:
    return ["new_site"] if site["site_type"] == "proposed" else ["open_spare", "add_ports"]


# --- scoring and recommendation -----------------------------------------------------------
def score(site: dict[str, Any], a: Assumptions, weights: dict[str, float], best: dict[str, Any], base_op: dict[str, Any]) -> dict[str, Any]:
    ports = best["ports"]
    hyb_wait = best["vinfast_wait"]["avg"]
    compat = [COMPAT_SCORE[site["compat"][g]] for g in THIRD_PARTY]
    factors: dict[str, float | None] = {
        "local_demand": min(1.0, sum(site["demand"].values()) * a.demand_scale_pct / 100 / (ports * DEMAND_NORM_SESSIONS_PER_PORT)),
        "tesla_demand": min(1.0, site["demand"]["tesla"] * a.demand_scale_pct / 100 / THIRD_PARTY_NORM_SESSIONS),
        "other_demand": min(1.0, site["demand"]["other"] * a.demand_scale_pct / 100 / THIRD_PARTY_NORM_SESSIONS),
        "spare_capacity": max(0.0, 1 - base_op["utilization"]) if base_op else 1.0,
        "incremental_contribution": max(0.0, min(1.0, best["annual_incremental_cf_y1"] / CONTRIBUTION_NORM_VND)),
        "investment_cost": max(0.0, 1 - best["capex"]["total"] / CAPEX_NORM_VND),
        "grid_feasibility": GRID_SCORE.get(site["grid"]),
        "accessibility": site["accessibility"],
        "corridor_coverage": site["corridor"],
        "vinfast_wait_impact": 0.0 if hyb_wait is None else max(0.0, 1 - hyb_wait / a.target_vinfast_avg_wait_min),
        "readiness": sum(compat) / len(compat),
    }
    w = {k: max(0.0, weights.get(k, 0.0)) for k in WEIGHTS}
    w_all = sum(w.values()) or 1.0
    w_have = sum(w[k] for k, v in factors.items() if v is not None) or 1.0
    breakdown = []
    for k, v in factors.items():
        breakdown.append({
            "factor": k, "label": FACTOR_LABEL[k], "weight": w[k], "value": None if v is None else round(v, 3),
            "contribution": None if v is None else round(100 * w[k] * v / w_have, 1), "missing": v is None,
        })
    total = sum(b["contribution"] or 0 for b in breakdown)
    return {
        "score": round(total, 1),
        "completeness": round(sum(w[k] for k, v in factors.items() if v is not None) / w_all, 3),
        "missing": [FACTOR_LABEL[k] for k, v in factors.items() if v is None],
        "breakdown": breakdown,
    }


def recommend(site: dict[str, Any], a: Assumptions, sc: dict[str, Any], options: dict[str, dict[str, Any]], base_op: dict[str, Any] | None) -> dict[str, Any]:
    """Deterministic rules. Returns the suggestion, the investment category, and why."""
    target, target90 = a.target_vinfast_avg_wait_min, a.target_vinfast_p90_wait_min
    reasons: list[str] = []

    def wait_ok(opt: dict[str, Any]) -> bool:
        w = opt["vinfast_wait"]
        return w["avg"] is not None and w["avg"] <= target and (w["p90"] or 0) <= target90

    if site["site_type"] == "proposed":
        opt = options["new_site"]
        if site["grid"] == "unknown" or sc["completeness"] < MIN_COMPLETENESS:
            return _rec("Investigate further", "defer", "new_site", [f"Grid capacity is {site['grid']}; data completeness {sc['completeness']:.0%}."], site)
        if sc["score"] >= SCORE_THRESHOLD and opt["npv"] > 0 and wait_ok(opt):
            return _rec("Develop new hybrid site", "new_multibrand_site", "new_site",
                        [f"Score {sc['score']:.0f} ≥ {SCORE_THRESHOLD}", f"NPV positive over {a.horizon_years} years at {a.discount_rate_pct:.0f} %"], site)
        why = [f"Score {sc['score']:.0f} or NPV ({opt['npv'] / 1e9:.1f}B VND) does not yet justify a new build."]
        if a.vinfast_free_share_pct > 0 and a.sponsor_reimbursement_vnd_per_kwh == 0:
            why.append(f"{a.vinfast_free_share_pct:.0f}% of VinFast charging is free (3-year programme) and no reimbursement is configured, "
                       "so VinFast sessions add electricity cost but little revenue.")
        return _rec("Investigate further", "defer", "new_site", why, site)

    open_, add = options["open_spare"], options["add_ports"]
    base_wait = base_op["waits"]["vinfast"]["avg"] if base_op else None
    if sc["completeness"] < MIN_COMPLETENESS:
        reasons.append(f"Data completeness {sc['completeness']:.0%} is below {MIN_COMPLETENESS:.0%}: missing {', '.join(sc['missing'])}.")
        return _rec("Investigate further", "defer", "open_spare", reasons, site)
    if wait_ok(open_) and base_op and 1 - base_op["utilization"] >= OPEN_SPARE_MIN and open_["annual_incremental_cf_y1"] > 0:
        reasons.append(f"Baseline utilization {base_op['utilization']:.0%} leaves spare capacity; VinFast peak wait stays at "
                       f"{open_['vinfast_wait']['avg']} min (target {target:.0f}).")
        return _rec("Open selected spare capacity", "upgrade_to_multibrand", "open_spare", reasons, site)
    if wait_ok(add) and add["npv"] > 0 and sc["score"] >= SCORE_THRESHOLD and site["grid_spare_kw"] and site["grid_spare_kw"] >= site["add_ports"] * site["port_kw"]:
        reasons.append(f"Opening as-is would push VinFast peak wait to {_fmt_wait(open_['vinfast_wait']['avg'])}; "
                       f"adding {site['add_ports']} ports keeps it at {add['vinfast_wait']['avg']} min with positive NPV.")
        return _rec("Upgrade capacity", "add_capacity", "add_ports", reasons, site)
    if not wait_ok(open_):
        reasons.append(f"Opening would push VinFast peak wait from {_fmt_wait(base_wait)} to {_fmt_wait(open_['vinfast_wait']['avg'])} "
                       f"(target {target:.0f} min).")
    if not (site["grid_spare_kw"] and site["grid_spare_kw"] >= site["add_ports"] * site["port_kw"]):
        reasons.append("No confirmed grid headroom for additional ports.")
    if add["npv"] <= 0:
        reasons.append("Adding ports does not pay back at current assumptions.")
    return _rec("Keep VinFast-only", "keep_vinfast_only", None, reasons or ["No option meets the VinFast wait and return criteria."], site)


def _fmt_wait(w: float | None) -> str:
    return "unbounded (overloaded)" if w is None else f"{w} min"


NEXT_STEP = {
    "upgrade_to_multibrand": "Validate Tesla and other-brand compatibility on site, and confirm VinFast peak-hour wait with real session data.",
    "add_capacity": "Get a utility confirmation of grid headroom and a contractor quote for the added ports.",
    "new_multibrand_site": "Secure land and permits, and obtain a grid-connection offer before committing capex.",
    "keep_vinfast_only": "Re-test after VinFast capacity grows or peak demand falls.",
    "defer": "Collect the missing data (grid study, site survey, compatibility test) and re-run the evaluation.",
}
CATEGORY_LABEL = {
    "upgrade_to_multibrand": "Upgrade an existing VinFast-only site to support multiple brands",
    "add_capacity": "Add compatible charging capacity at an existing site",
    "new_multibrand_site": "Develop a new multi-brand site",
    "keep_vinfast_only": "Maintain the site as VinFast-only",
    "defer": "Defer: data or grid information insufficient",
}


def _rec(action: str, category: str, option: str | None, reasons: list[str], site: dict[str, Any]) -> dict[str, Any]:
    return {"action": action, "category": category, "category_label": CATEGORY_LABEL[category], "option": option,
            "reasons": reasons, "risks": site["risks"], "next_step": NEXT_STEP[category]}


def _narrative(site: dict[str, Any], rec: dict[str, Any], opt: dict[str, Any] | None) -> str:
    """Plain-language recommendation. Deterministic calculation on simulated data, not an AI prediction."""
    if rec["category"] == "upgrade_to_multibrand":
        return (f"Consider opening {site['dc_ports']} existing ports at {site['name']} to Tesla and other brands outside VinFast priority. "
                f"In this simulation the site has unused capacity and the VinFast peak wait stays within target. {rec['next_step']}")
    if rec["category"] == "add_capacity":
        return (f"Consider adding {site['add_ports']} compatible ports at {site['name']}: the simulated area has unmet third-party demand "
                f"and estimated grid headroom. {rec['next_step']}")
    if rec["category"] == "new_multibrand_site":
        return f"{site['name']} scores well as a new multi-brand site under these assumptions. {rec['next_step']}"
    if rec["category"] == "keep_vinfast_only":
        return f"Keep {site['name']} VinFast-only for now: {rec['reasons'][0]}"
    return f"Defer a decision on {site['name']}: {rec['reasons'][0]} {rec['next_step']}"


SENSITIVITY_STEP = 0.20


def sensitivity(site: dict[str, Any], option: str, a: Assumptions) -> list[dict[str, Any]]:
    """NPV of the option with each driver moved -20 % and +20 %."""
    drivers = {
        "Energy cost": lambda f: {"energy_cost_vnd_per_kwh": a.energy_cost_vnd_per_kwh * f},
        "Demand / utilization": lambda f: {"demand_scale_pct": a.demand_scale_pct * f},
        "Third-party tariffs": lambda f: {"tariff_tesla": a.tariff_tesla * f, "tariff_other": a.tariff_other * f},
        "Capex": lambda f: {"capex_scale_pct": a.capex_scale_pct * f},
    }
    out = []
    for name, change in drivers.items():
        low = evaluate_option(site, option, a.model_copy(update=change(1 - SENSITIVITY_STEP)))["npv"]
        high = evaluate_option(site, option, a.model_copy(update=change(1 + SENSITIVITY_STEP)))["npv"]
        out.append({"driver": name, "npv_low": low, "npv_high": high, "swing": abs(high - low)})
    out.sort(key=lambda d: -d["swing"])
    return out


def _scenario_block(site: dict[str, Any], a: Assumptions, scen: str, ports: int) -> dict[str, Any]:
    if ports == 0:
        return {}
    total, months = year_one(site, a, scen, ports)
    op = operate(site, a, SCENARIO_GROUPS[scen], ports)
    return {"scenario": scen, "label": SCENARIO_LABEL[scen], "ports": ports, "year1": total, "monthly": months,
            "utilization": op["utilization"], "waits": op["waits"], "peak_cap_binding": op["peak_cap_binding"],
            "excluded": op["excluded"], "turned_away_per_day": op["turned_away"]}


def evaluate_site(site: dict[str, Any], a: Assumptions, weights: dict[str, float]) -> dict[str, Any]:
    options = {o: evaluate_option(site, o, a) for o in site_options(site)}
    existing = site["site_type"] != "proposed"
    base_op = operate(site, a, ("vinfast",), site["dc_ports"]) if existing else None
    candidates = [o for o in options.values() if o["vinfast_wait"]["avg"] is not None] or list(options.values())
    best = max(candidates, key=lambda o: o["npv"])
    sc = score(site, a, weights, best, base_op)
    rec = recommend(site, a, sc, options, base_op)
    chosen = rec["option"] or best["option"]
    hybrid_ports = site["dc_ports"]
    scenarios = {s: _scenario_block(site, a, s, hybrid_ports) for s in ("A", "B", "C")}
    return {
        **{k: site[k] for k in ("site_id", "name", "city", "region", "setting", "lat", "lon", "site_type", "dc_ports", "ac_ports", "port_kw", "grid", "grid_spare_kw", "accessibility", "corridor", "add_ports")},
        "compatibility": {"vinfast": "confirmed", **site["compat"]},
        "simulated_demand": {g: round(site["demand"][g] * a.demand_scale_pct / 100, 1) for g in GROUPS},
        "baseline_utilization": base_op["utilization"] if base_op else None,
        "baseline_vinfast_wait": base_op["waits"]["vinfast"] if base_op else None,
        "scenarios": scenarios,
        "options": options,
        "score": sc,
        "recommendation": {**rec, "narrative": _narrative(site, rec, options.get(chosen))},
        "sensitivity": sensitivity(site, chosen, a),
        "provenance": {
            "site": "synthetic", "demand": SIMULATED, "grid": f"{site['grid']} (synthetic)",
            "compatibility": "assumed, unverified" if "unverified" in site["compat"].values() else "assumed (synthetic)",
            "prices": "illustrative", "financials": "estimated",
        },
        "labels": ["SYNTHETIC SITE", "SIMULATED DEMAND", "ILLUSTRATIVE PRICING", "ESTIMATED FINANCIAL RESULTS"],
    }


PORTFOLIO_KEYS = ("operator_revenue", "contribution", "operating_profit", "energy_cost", "payment_fees", "site_owner_share",
                  "maintenance", "platform_opex", "demand_charges", "sponsor_reimbursement", "msp_margin", "free_kwh", "discount_value", "vat_collected")


def portfolio(sites: list[dict[str, Any]]) -> dict[str, Any]:
    """Scenario totals across all sites; each is the plain sum of the site-level year-1 figures."""
    out = {}
    for s in ("A", "B", "C"):
        acc: dict[str, Any] = {"stations": 0, "ports": 0}
        months = [{"month": m + 1, "driver_revenue": {g: 0.0 for g in GROUPS}, "operator_revenue": 0.0, "contribution": 0.0} for m in range(12)]
        for site in sites:
            blk = site["scenarios"][s]
            if not blk:
                continue
            acc["stations"] += 1
            acc["ports"] += blk["ports"]
            y = blk["year1"]
            for k in PORTFOLIO_KEYS:
                acc[k] = acc.get(k, 0.0) + y[k]
            for k in ("sessions", "kwh", "paid_kwh", "driver_revenue"):
                acc.setdefault(k, {g: 0.0 for g in GROUPS})
                for g in GROUPS:
                    acc[k][g] += y[k][g]
            for i, mm in enumerate(blk["monthly"]):
                months[i]["operator_revenue"] += mm["operator_revenue"]
                months[i]["contribution"] += mm["contribution"]
                for g in GROUPS:
                    months[i]["driver_revenue"][g] += mm["driver_revenue"][g]
        acc["monthly"] = months
        out[s] = acc
    for s in ("B", "C"):
        out[s]["incremental_revenue"] = out[s]["operator_revenue"] - out["A"]["operator_revenue"]
        out[s]["incremental_contribution"] = out[s]["contribution"] - out["A"]["contribution"]
    return out


def evaluate(req: EvaluateRequest) -> dict[str, Any]:
    a = req.assumptions
    sites = [evaluate_site(s, a, req.weights) for s in SITES]
    return {
        "disclaimer": DISCLAIMER,
        "note": "SYNTHETIC SITES · SIMULATED DEMAND · ILLUSTRATIVE PRICING · ESTIMATED FINANCIAL RESULTS. Deterministic rules and formulas, not an AI prediction.",
        "accounting_basis": f"All money in VND, VAT-exclusive (tariffs entered VAT-inclusive at {a.vat_pct:g} % VAT). Year 1 = 12 simulated months.",
        "assumptions": a.model_dump(),
        "weights": req.weights,
        "sites": sites,
        "portfolio": portfolio(sites),
    }


# --- pilot -------------------------------------------------------------------------------
PILOT_RUN_COST_VND_PER_WEEK = 15_000_000   # staff, monitoring and support during the pilot, per site


class PilotRequest(BaseModel):
    site_ids: list[str] = Field(default_factory=lambda: ["OC-HCM-01", "OC-COR-01"], min_length=1, max_length=len(SITES))
    weeks: int = Field(12, ge=2, le=52)
    scenario: Literal["B", "C"] = "C"
    min_success_rate: float = Field(0.8, ge=0, le=1)
    assumptions: Assumptions = Assumptions()


def pilot(req: PilotRequest) -> dict[str, Any]:
    """Simulate a pilot on selected existing sites using spare capacity only (no new ports)."""
    a = req.assumptions
    by_id = {s["site_id"]: s for s in SITES}
    rows = []
    for sid in req.site_ids:
        site = by_id.get(sid)
        if site is None or site["site_type"] == "proposed":
            continue
        ports = site["dc_ports"]
        base = operate(site, a, ("vinfast",), ports)
        months = req.weeks * 7 / DAYS_PER_MONTH
        total: dict[str, Any] = {}
        base_total: dict[str, Any] = {}
        tp_demand = tp_served = 0.0
        for m in range(math.ceil(months)):
            frac = min(1.0, months - m)
            tp = min(1.0, (m + 1) / RAMP_MONTHS)
            op = operate(site, a, SCENARIO_GROUPS[req.scenario], ports, tp_factor=tp)
            _add(total, money(site, op, a, True, DAYS_PER_MONTH * frac))
            _add(base_total, money(site, base, a, False, DAYS_PER_MONTH * frac))
            raw = operate(site, a.model_copy(update={"assume_unverified_compatible": True, "third_party_peak_cap_pct": 100}),
                          SCENARIO_GROUPS[req.scenario], ports, tp_factor=tp)
            tp_demand += sum(raw["demand"][g] for g in THIRD_PARTY) * DAYS_PER_MONTH * frac
            tp_served += sum(op["served"][g] for g in THIRD_PARTY) * DAYS_PER_MONTH * frac
        hyb = operate(site, a, SCENARIO_GROUPS[req.scenario], ports)
        capex = capex_breakdown(site, "open_spare", a)["total"]
        run_cost = PILOT_RUN_COST_VND_PER_WEEK * req.weeks
        inc = total["operating_profit"] - base_total["operating_profit"]
        success = tp_served / tp_demand if tp_demand else 0.0
        vw = hyb["waits"]["vinfast"]
        wait_ok = vw["avg"] is not None and vw["avg"] <= a.target_vinfast_avg_wait_min and (vw["p90"] or 0) <= a.target_vinfast_p90_wait_min
        if not wait_ok:
            verdict, why = "Stop", "VinFast wait target exceeded during the pilot."
        elif success < req.min_success_rate:
            verdict, why = "Modify", f"Only {success:.0%} of third-party demand was served (compatibility, peak cap or capacity)."
        elif inc - run_cost <= 0:
            verdict, why = "Modify", "Pilot contribution does not yet cover pilot running cost; review tariffs or duration."
        else:
            verdict, why = "Expand", "VinFast wait within target, third-party sessions succeed and contribution is positive."
        rows.append({
            "site_id": sid, "name": site["name"], "ports": ports,
            "sessions": total["sessions"], "third_party_success_rate": success,
            "vinfast_wait_baseline": base["waits"]["vinfast"], "vinfast_wait_pilot": vw,
            "utilization_baseline": base["utilization"], "utilization_pilot": hyb["utilization"],
            "incremental_contribution": total["contribution"] - base_total["contribution"],
            "incremental_operating_profit": inc,
            "investor_cost": capex + run_cost, "capex": capex, "pilot_run_cost": run_cost,
            "investor_return_in_pilot": inc - run_cost,
            "verdict": verdict, "why": why,
        })
    return {
        "disclaimer": DISCLAIMER, "weeks": req.weeks, "scenario": req.scenario, "sites": rows,
        "note": "Simulated pilot on synthetic sites. A real pilot needs partner agreements, compatibility testing and real session data.",
    }
