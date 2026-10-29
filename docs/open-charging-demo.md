# Vietnam Open Charging & Investment Intelligence: demo guide

> **Independent simulation.** No Tesla, VinFast or V-Green partnership is announced or implied. Every site, demand figure, compatibility status, grid status, price, cost and financial result in this module is synthetic, simulated or illustrative. None of the sites is a real V-Green station, and nothing here represents an airport authority's plan.

Open it from **Energy → VinFast / Tesla / Other EV** in the sidebar, or from the button on the Charging Network page (`/energy/open-charging`).

## 3–5 minute walkthrough

1. **Existing network (20 s).** Open **Charging Network**. "This is today's charging planner: where to add, expand or not build." Click **VinFast / Tesla / Other EV charging**.
2. **Load the scenario (10 s).** Press **Load Demo Scenario**. Point at the orange banner: independent simulation, illustrative prices.
3. **Opportunity map (40 s).** Filter **✈ Airports**. The pin colour is the suggestion, the number is the score and the halo is simulated demand. **Long Thanh International** is selected: a new-build hybrid site with a score of about 81, payback of about 4 years and a VinFast peak wait of about 6 min against a 10 min target.
4. **A promising hybrid site (30 s).** Filter **HCMC** and click **Riverside Mall D7**. Utilization is low, so the suggestion is to open selected spare capacity. Scroll the detail panel: compatibility is *unverified* for Tesla, the risks are listed, and the next validation step is named.
5. **Compare economics (40 s).** Press **Compare Scenarios** to open ROI & Comparison. Compare *Open spare capacity* against *Add ports*: capex, cumulative cash flow and sensitivity. Change **Energy cost** or **Capex scale** and watch ROI and payback move.
6. **Priority queue (60 s).** Open **Priority Queue** and press **Play**. VinFast (P1), Tesla (P2) and other-brand (P3) vehicles arrive. Point out:
   - an incompatible or unverified vehicle that is never assigned;
   - port P4 going offline only after its session ends;
   - an absent driver being skipped.

   Turn **Anti-starvation** to 30 min. Tesla waits fall, but VinFast passes its targets and playback pauses on the alert. Switch back and set **Reserved VinFast ports = 1**: VinFast is protected and Tesla waits rise. *The policy is a trade-off the operator configures.*
7. **Price and bid (40 s).** Open **Pricing & Bids**. Show the Tesla quote: price, VAT included and excluded, who pays, and that the quote is valid for 30 min. In the bid table, B5 (other brand, 8,000 ₫/kWh) is rejected for being above the cap, and B1 loses to the Tesla and VinFast bids despite bidding more. *Priority beats price.*
8. **Revenue (30 s).** Open **Revenue Dashboard** and compare cards A, B and C, the monthly revenue by brand, and the incremental contribution by site. Switch **Operating model** to *Roaming*: the mobility-provider margin is shown separately and is not counted as operator revenue.
9. **A congested site (20 s).** Back on Investment, open **Thu Duc Transit Hub**. Opening it would push the VinFast peak wait from about 9 to about 26 min, so it stays **VinFast-only**. Also open **Hanoi–Hai Phong Rest Stop**: grid capacity is *unknown*, so the suggestion is to **investigate further**. The missing data is excluded from the score, not filled in.
10. **Close (10 s).** "All illustrative. The value is the method: transparent, explainable, and VinFast drivers stay protected."

## What the numbers are

| Item | Source | Notes |
|---|---|---|
| 15 sites | Synthetic (`backend/app/services/open_charging.py`, `SITES`) | 6 existing VinFast-only sites in HCMC, Hanoi and corridors; 2 new-builds; 7 airports (Long Thanh, Tan Son Nhat, Noi Bai, Da Nang, Cam Ranh, Phu Quoc, Cat Bi) |
| Demand | Simulated sessions/day per group | Scaled by *Demand / utilization* and *Annual growth*; third-party demand ramps up over 6 months |
| Compatibility | Assumed | `unverified` is admitted by default in the economics (switchable) but not in the queue (switchable) |
| Prices | Illustrative, VAT-inclusive | VinFast 3,000 · Tesla 4,000 · other 4,500 ₫/kWh. **Not current tariffs** |
| Costs | Illustrative | Energy 2,400 ₫/kWh, 2 % payment fee, maintenance 20M ₫ per port per year, hybrid platform 60M ₫ per year |
| Queue | Seeded busy period (seed 7) | 6 ports, 44 arrivals, scripted no-shows, a cancellation, an outage and an unverified vehicle |

## Formulas

- **Accounting basis:** VND, VAT-exclusive (driver revenue = paid kWh × tariff ÷ (1 + VAT)). VAT is shown as a pass-through memo line.
- **Operator revenue:** driver revenue collected by the operator, plus roaming wholesale (driver revenue × (1 − provider margin)), plus sponsor reimbursement only if a rate is configured. Free kWh are never revenue.
- **Contribution:** operator revenue − electricity − payment fees − site-owner share.
- **Operating profit:** contribution − maintenance − hybrid platform opex − demand charges.
- **Incremental revenue:** hybrid revenue − VinFast-only baseline revenue.
- **Incremental annual cash flow:** (hybrid operating profit − baseline operating profit) × (1 − tax, when positive).
- **Simple ROI:** (Σ incremental cash flow − incremental capex) ÷ incremental capex × 100. Shown as *not applicable* when capex is 0.
- **Payback:** the first point where cumulative incremental cash flow ≥ capex, interpolated within the year. Otherwise "No payback within modeled horizon".
- **NPV:** −capex + Σ CF_y ÷ (1 + r)^y, end-of-year cash flows. **IRR** is shown only when cash flows change sign exactly once.
- **Peak wait (estimate):** M/M/c non-preemptive priority (Cobham): W_k = ErlangC(c, a) ÷ (cμ) ÷ ((1 − σ_{k−1})(1 − σ_k)). A class with σ_k ≥ 1 is reported as *unbounded*.
- **Site score:** Σ(weight × factor) ÷ Σ(weights of factors that have data) × 100. Completeness = the share of weight that has data. Below 85 % completeness the suggestion is *Investigate further*.
- **Queue ETA:** the same dispatch rules run forward from the current state with no new arrivals, recomputed after every event.

## What a real pilot would need

- **Permissions and agreements.** Written agreement between the parties involved (for example, the charging operator and any partner automaker). VinFast and V-Green are distinct parties. The agreement should define access, priority, pricing, revenue allocation, liability and data sharing. Airport sites also need the airport authority's and the concessionaire's approval.
- **Real data.** Session logs, utilization, queue and wait times per site; grid connection studies; site surveys (access, parking, safety); actual tariffs and energy costs.
- **Compatibility testing.** A matching connector does not prove interoperability. Each vehicle model needs testing of charging protocol, authorization, payment and software at each charger model. No specific Tesla port or adapter is assumed for Vietnam.
- **Technical and legal review.** Brand priority, differentiated pricing and bidding need legal, consumer-protection and competition review, plus invoicing and VAT treatment.
- **Operational and financial validation.** Shadow-run the queue policy on real data before enforcing it. Agree VinFast wait targets and the stop criteria. Validate capex quotes, and re-run the ROI on observed data after the pilot.
