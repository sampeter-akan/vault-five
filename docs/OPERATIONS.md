# VAULT FIVE — Operations and reliability runbook

This document is an operational checklist for the deployed multiplayer application, not a claim of certified availability or measured SLO compliance.

## Current production components

- Frontend: [Vercel deployment](https://vault-five-umber.vercel.app/), Vite-built static React application.
- Backend: Supabase project `jbjgnabbostmdsqdrkus`, Edge Function `game`, PostgreSQL, anonymous Auth and private Realtime.
- Source and CI: [GitHub repository](https://github.com/sampeter-akan/vault-five) and [GitHub Actions](https://github.com/sampeter-akan/vault-five/actions).
- Backend platform state at documentation time (2026-10-08): Supabase project `ACTIVE_HEALTHY`, `game` function `ACTIVE`, version 3, JWT verification enabled. These platform states do not prove application-level uptime.

## Release verification checklist

1. Check GitHub Actions: latest `verify` job on `main` is green (dependency installation, static checks, unit tests, build).
2. Open Vercel Deployments; confirm the production deployment is **Ready**, points to the expected commit, and has no build errors.
3. Open the production URL in two independent browser sessions. Create a room in session A, join with the code in B, and verify the same roster.
4. Start the game. Confirm both clients show the same round and approximately matching remaining time.
5. Submit a round answer; verify server-generated score. Allow a round to expire and verify synchronized transition.
6. Verify vault submission feedback, final winner/leaderboard and host replay.
7. Refresh one client mid-round and verify it recovers authoritative room state. If it fails, record a defect rather than marking the check passed.
8. Check Supabase Edge Function logs for new non-2xx responses or exceptions during the test.

Record: UTC timestamp, tested commit, deployment URL, browsers/devices, room code (non-secret), observed outcome, error timestamps, and remediation.

## Where to look during an incident

| Symptom | First investigation | Next check |
|---|---|---|
| Create/join/start returns non-2xx | Supabase Dashboard > Edge Functions > `game` > Logs | Match timestamp with function invocations, auth and Postgres logs |
| One client stays in lobby | Browser network requests for `game` state/tick; Realtime connection | Room membership, private channel permissions, state polling/reconnect |
| Round timer differs | Server `ends_at` and state responses | Browser background throttling and state reconciliation |
| Score or winner inconsistent | `submissions`, `scores`, `rooms` records | Duplicate requests, deadline checks, concurrent writes |
| Blank page or failed deployment | Vercel Deployments and build logs | GitHub Actions, build output, frontend environment variables |
| Anonymous auth fails | Supabase Authentication logs | Provider enabled, client publishable key, JWT handling |

Do not copy access tokens, authorization headers, service-role keys, or the vault combination into issues or screenshots.

## Supabase log queries

In Supabase Dashboard > Logs Explorer, filter **Edge Functions** to `game` and inspect status, method, timestamp, and execution time when available. The project's unified logs also contain `edge_logs`, `function_edge_logs`, `function_logs`, `realtime_logs`, `auth_logs` and `postgres_logs`. The existence of these streams was checked on 2026-10-08; it is **not** a measured error rate or latency baseline.

For an incident, compare a narrow UTC window before and after the error. Group function responses by HTTP status where available; do not count all platform edge requests as game API calls. For latency, compute p50/p95 from valid duration fields for the **game function** only, excluding unrelated traffic.

## Reliability signals and current evidence

| Signal | Evidence available | Missing instrumentation |
|---|---|---|
| Build health | GitHub Actions green workflow; Vercel deployment history | Branch-protection/deployment gating |
| API errors | Supabase function invocation/log views | Alert on game-function 5xx ratio |
| API latency | Function execution durations where exposed | Versioned p95 dashboard and load-test baseline |
| Concurrent players | Player and room database records | True active-session count and peak concurrency |
| Realtime health | Supabase Realtime logs/usage | Room-scoped WebSocket connection and resync metrics |
| Client recovery | Manual refresh/rejoin test | Automated network-loss/reconnect test |
| Availability | Manual production smoke test | Scheduled external synthetic monitor |

**No custom monitoring dashboard, paging alert, load-test benchmark, formal SLO, or guaranteed uptime is currently claimed.** Avoid presenting database row counts as concurrent connections.

## Failure response and rollback

1. Capture incident start time, affected actions, reproducibility, user impact, and deployment commit.
2. Determine whether the fault is frontend, Edge Function, Auth, Realtime, or PostgreSQL.
3. If the frontend deployment caused the regression, use Vercel's deployment history to restore/redeploy a known-good build where supported.
4. A frontend rollback does **not** revert Edge Functions, database schema, or secrets. Review API/schema compatibility before rolling back.
5. Re-run the two-client release checklist, then document the incident, root cause, mitigation, and prevention action.

## Next engineering improvements

- Add structured Edge Function logs: action, request ID, status, duration, room identifier hashed/redacted as needed; never log answers or credentials.
- Create an authenticated-safe health/synthetic test for create/join/start/state/replay in an isolated staging Supabase project; avoid writing test rooms to production.
- Add per-identity/IP throttling for room creation, joins and vault guesses.
- Measure p95 latency, 5xx rates, room synchronization delay and Realtime reconnection success before proposing SLO thresholds.
- Test simultaneous correct vault submissions and idempotent retries; validate winner arbitration under contention.
- Configure Vercel deployment checks or branch protection if production must wait for green CI.
