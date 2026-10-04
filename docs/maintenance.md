# Maintenance framework

> Independent technology demonstration on synthetic data. Not an official VinFast product.

How this codebase is kept healthy as it grows. Each practice lists what exists in the repository **today** and what to add at the **MVP** and **production** stages of the [roadmap](roadmap.md). The aim throughout is the same: a change should be easy to make, easy to review, safe to release and easy to undo.

## 1. Ownership

| Practice | Today | MVP | Production |
|---|---|---|---|
| Every path has an owner who must review changes to it | [.github/CODEOWNERS](../.github/CODEOWNERS), one owner | Owners per area (data, models, frontend, platform) | Team aliases, not individuals; ownership reviewed when people move |
| Every running service, dataset and model has a named owner | Not applicable | Listed in the service's README | In a service catalogue with on-call and escalation |

## 2. Code health

| Practice | Today | MVP | Production |
|---|---|---|---|
| One-way layering | Enforced by `backend/tests/test_architecture.py` | Same | Extended across service boundaries (no shared database between services) |
| Small, reviewed changes | [Pull request template](../.github/pull_request_template.md) | Branch protection: one approval and green CI to merge | Two approvals for data-schema and model-serving changes |
| One command to verify | `make check` | Adds lint and formatting (ruff, eslint, prettier) | Adds contract tests between services |
| Style is automatic, not debated | TypeScript strict mode | Formatters run in CI and fail on diff | Same |
| Tunable values are named constants; config in one module | Yes (`config.py`, tested) | Config validated at start-up | Config changes go through review like code |
| Tech debt is tracked and paid down | Not tracked | A labelled issue list | A fixed share of each cycle reserved for it |

## 3. Testing

The shape to keep: many fast tests of rules, fewer tests through the API, a handful through the browser.

| Level | Today | MVP | Production |
|---|---|---|---|
| Unit (decision rules) | `test_engines.py` | Property tests for the forecast and sizing maths | Same |
| API contract | `test_api.py` on a seeded world | Runs against a PostgreSQL test container | Consumer-driven contracts between services |
| Architecture | `test_architecture.py` | Same | Same |
| End to end | None automated; pages were checked by screenshot | Playwright smoke test of the main flows in CI | Runs against staging before every release |
| Data | None | Schema and range checks on every load | Checks block a bad load from reaching models |
| Model | Beats-baseline assertion in `test_api.py` | Same test on real held-out data; a regression fails CI | Shadow evaluation before promotion |
| Load | None | None | 3× peak before each major release |

Flaky tests are fixed or deleted within a week. A test that is sometimes red teaches people to ignore red.

## 4. Release

| Practice | Today | MVP | Production |
|---|---|---|---|
| Trunk-based development | `main` only | `main` plus short-lived branches | Same |
| CI on every change | [.github/workflows/ci.yml](../.github/workflows/ci.yml): tests, typecheck, build | Adds image build and deploy to staging on merge | Adds security scans and canary analysis |
| Releases are routine and reversible | `./start.sh` rebuilds in place | Versioned images; rollback is redeploying the previous tag | Canary to a small share of traffic, automatic rollback on SLO burn |
| Risky changes ship dark | Not applicable | Feature flags for new pages | Flags with owners and expiry dates |
| Database changes are backward compatible | Not applicable (regenerated from seed) | Migrations (Alembic), expand then contract | Same, rehearsed on a production copy |

## 5. Reliability

Not applicable to a demo; this is the proposed starting point for the pilot. The numbers are proposals to be agreed with users, not measurements.

| Indicator | Proposed objective |
|---|---|
| Dashboard API availability | 99.5% of requests succeed, per month |
| Dashboard API latency | 95% of requests under 500 ms |
| Forecast freshness | Today's forecast available by 05:00 local time on 99% of days |
| Live position delay | 95% of updates shown within 10 s of the vehicle reporting |

- **Error budget.** If an objective is missed, feature work on that service pauses until it is back inside the budget.
- **On-call.** A rotation with a primary and a secondary, a runbook for each alert, and no alert without an action.
- **Postmortems.** Written for every user-visible incident. Blameless: they name causes and fixes, not people. Action items have owners and dates.
- **Backups.** Automated, and restored in a drill each quarter. An untested backup is not a backup.

## 6. Observability

| Signal | Today | MVP | Production |
|---|---|---|---|
| Logs | uvicorn access log to a file | Structured JSON logs with a request ID | Centralised, searchable, with retention |
| Metrics | None | Request rate, errors, latency per route; job success | Dashboards per service, tied to SLOs |
| Traces | None | None | Distributed tracing across services |
| Health | `/api/health`, Docker healthcheck | Separate liveness and readiness | Same, plus dependency checks |
| Alerts | None | Uptime and failed-job alerts | SLO burn-rate alerts that page |

## 7. Model maintenance

Models decay in ways code does not: the world changes while the code stays the same.

| Practice | Today | MVP | Production |
|---|---|---|---|
| Every model has a card | Yes, served at `/api/rides/model` and shown in the UI | Stored with each trained version | Kept for audit |
| Evaluated against a naive baseline on held-out data | Yes | On real data, each retrain | Plus sliced by zone, hour and weather |
| Versioned and reproducible | Seeded; retrained at start-up | Model registry; training data snapshot recorded | Lineage from data to model to decision |
| Retraining | On start-up | Scheduled, weekly | Triggered by drift as well as schedule |
| Drift monitoring | None | Error tracked daily against the baseline | Input distribution and error alerts |
| Safe rollout | Not applicable | New model compared offline before swap | Shadow, then canary, with one-step rollback |
| Human feedback | Label corrections feed the next dataset (simulated) | Overrides of recommendations recorded | Feedback reviewed and used in retraining |

## 8. Data maintenance

| Practice | Today | MVP | Production |
|---|---|---|---|
| Schema is a contract | Pydantic response models; `types.ts` mirrors them by hand | Types generated from the OpenAPI schema | Versioned schemas for events and tables |
| Quality checks | None | Null, range and freshness checks per load | Checks gate downstream jobs |
| Privacy | No personal data (synthetic) | Location data minimised and aggregated to zones; retention set | Access audited; privacy review per new use |
| Retention | Not applicable | Defined per table | Enforced automatically |

## 9. Dependencies and security

| Practice | Today | MVP | Production |
|---|---|---|---|
| Dependency updates | [Dependabot](../.github/dependabot.yml), monthly grouped pull requests | Same, merged within two weeks | Same, with automatic merge for patch updates that pass CI |
| Pinned, reproducible builds | `package-lock.json`; Python ranges, not pins | Python lock file | Same, images built from pinned bases |
| Vulnerability scanning | None | `pip-audit` and `npm audit` in CI | Container and infrastructure scanning |
| Secrets | None needed | Secret manager; none in the repository or images | Rotation; scanning for leaked secrets |
| Access | Open on a port | Single sign-on, two roles | Least privilege, reviewed quarterly |

## 10. Documentation

| Document | Today | Kept current by |
|---|---|---|
| README: what, how to run, architecture, how to extend | Yes | Changed in the same pull request as the code |
| Architecture and roadmap | `docs/architecture.md`, `docs/roadmap.md` | Reviewed at each stage gate |
| In-app guide | `frontend/src/lib/guide.ts` | Required when a page is added (step 6 of the README recipe) |
| Design docs | None | One per significant change, before the code: problem, options, decision |
| Decision records | "Design decisions" table in `docs/architecture.md` | One short record per irreversible choice |
| Runbooks | None | Written with each alert, from the pilot stage |

## 11. Deprecation

Adding is easy; removing is what keeps a system maintainable.

- An API or page is deprecated with a notice, a replacement and a removal date.
- Usage is measured before removal; nothing with active users is removed silently.
- Mock and simulated components are deleted, not left dormant, when their real replacement ships.

## Routine

| When | What |
|---|---|
| Every change | `make check` green, reviewed, docs updated in the same pull request |
| Weekly | Triage new issues; merge dependency updates; look at flaky tests |
| Monthly | Review model error against baseline; review open tech debt |
| Quarterly | Restore drill; access review; SLO review; prune dead code and flags |
| Each stage gate | Re-read the roadmap's exit criteria and decide: continue, change, or stop |
