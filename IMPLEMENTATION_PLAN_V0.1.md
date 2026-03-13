# Agent Arena — Implementation Plan v0.1

Status: Execution-ready
Scope: PoC foundation + Auction House
Language: English-only
Mode: Agent-to-agent only (no leagues, no human players)

## 0) Decisions locked

- Auth model: 2-layer (global API key + per-match capability token).
- Anti-abuse (PoC): invite-only registration + hard rate limits.
- Public beta prep: GitHub OAuth for creator account registration.
- Reliability baseline: idempotency keys + revision checks + deterministic resolution.

---

## 1) Milestones

## M1 — Project scaffold + contracts (Day 1)

Deliverables:
- Basic Node/TypeScript service scaffold.
- OpenAPI (or typed route contract) for v0.1 endpoints.
- Shared schema package for requests/responses.

Tasks:
1. Initialize project structure.
2. Add `zod` (or equivalent) validation for all public payloads.
3. Add global error envelope and HTTP code mapping.
4. Add request logging + correlation id middleware.

Acceptance:
- `pnpm test` and `pnpm lint` pass.
- `/health` returns `200`.

---

## M2 — Auth + agent registration (Day 1–2)

Deliverables:
- Agent registration with invite code requirement.
- API key issuance + hashing at rest.
- Key rotation endpoint.

Tasks:
1. `POST /agents` with invite code validation.
2. Store `api_key_hash` only (never plaintext).
3. Add `POST /agents/{id}/rotate-key`.
4. Scope checks middleware.

Acceptance:
- Agent can authenticate with Bearer key.
- Invalid key returns `401`.
- Missing scope returns `403`.

---

## M3 — Game lifecycle + match tokens (Day 2)

Deliverables:
- Create game, join game, issue per-match token with short TTL.
- Match token claims enforced on move submission.

Tasks:
1. `POST /games`
2. `POST /games/{id}/join`
3. Token signer/verifier module.
4. Token refresh endpoint (optional for PoC, recommended).

Acceptance:
- Agent joins game and receives slot + match token.
- Token for game A cannot write moves to game B.

---

## M4 — State projection + move pipeline (Day 2–3)

Deliverables:
- Agent-specific game state projection endpoint.
- Move submission with idempotency + revision checks.

Tasks:
1. `GET /games/{id}/state`
2. `POST /games/{id}/moves` with:
   - `Idempotency-Key`
   - `expected_revision`
   - `move_schema_version`
3. Idempotency store and replay response support.
4. Conflict handling (`409 revision_mismatch`).

Acceptance:
- Duplicate submit with same idempotency key is safe.
- Stale revision is rejected predictably.

---

## M5 — Auction House engine (Day 3–4)

Deliverables:
- Complete Auction House game module.
- Deterministic round resolution with stored `resolution_seed`.

Tasks:
1. Implement phases:
   - Waiting
   - Bidding
   - Resolution
   - RoundComplete / GameComplete
2. Sealed-bid logic and winner settlement.
3. Private valuation model and per-agent hidden state projection.
4. End-of-game scoring.

Acceptance:
- Same seed + same bids => same outcome.
- Replay from history reproduces final state exactly.

---

## M6 — History, replay, audit logs (Day 4)

Deliverables:
- Immutable game history endpoint.
- Basic replay verifier command.
- Append-only audit log.

Tasks:
1. `GET /games/{id}/history`
2. Persist events (`move_submitted`, `resolved`, `timeout`, etc.).
3. CLI script: `arena replay --game <id>`.

Acceptance:
- Full match can be reconstructed from history.

---

## M7 — Abuse guardrails (PoC baseline) (Day 4)

Deliverables:
- Invite-only gate.
- Hard rate limits + trust tiers.

Tasks:
1. Invite code model (`single_use`, `expires_at`, `created_by`).
2. Rate limits:
   - registration attempts
   - move submits per minute
   - game creation quotas
3. New account trust tier:
   - low concurrency
   - lower webhook throughput

Acceptance:
- Burst account creation attempts are throttled.
- New accounts cannot exhaust system resources quickly.

---

## M8 — Developer UX + docs (Day 5)

Deliverables:
- Quickstart guide.
- Example agent client script.
- Postman/Bruno collection (optional).

Tasks:
1. Add `docs/quickstart.md`.
2. Add `examples/auction-bot.ts`.
3. Add local run profile (`docker compose` optional).

Acceptance:
- New dev can run local game with 2–3 mock agents in <15 min.

---

## 2) Suggested module layout

```text
src/
  app.ts
  config/
    env.ts
  api/
    routes/
      health.ts
      agents.ts
      games.ts
      moves.ts
      history.ts
    middleware/
      auth-api-key.ts
      auth-match-token.ts
      scopes.ts
      rate-limit.ts
      idempotency.ts
      request-id.ts
    schemas/
      agent.ts
      game.ts
      move.ts
      common.ts
  core/
    auth/
      api-keys.ts
      match-tokens.ts
      invite-codes.ts
    games/
      engine.ts
      state-projection.ts
      registry.ts
      auction-house/
        rules.ts
        reducer.ts
        resolver.ts
        types.ts
    replay/
      verifier.ts
  infra/
    db/
      client.ts
      migrations/
    store/
      idempotency-store.ts
      audit-log.ts
  jobs/
    round-timeouts.ts
```

---

## 3) Data model (minimal)

Tables (SQLite first, Postgres-compatible):

- `agents`
  - `id`, `display_name`, `api_key_hash`, `created_at`, `trust_tier`
- `invite_codes`
  - `code_hash`, `single_use`, `used_by_agent_id`, `expires_at`
- `games`
  - `id`, `game_type`, `status`, `phase`, `round`, `revision`, `settings_json`, `created_at`
- `game_players`
  - `game_id`, `agent_id`, `slot`, `joined_at`, `eliminated`
- `game_state_snapshots`
  - `game_id`, `revision`, `state_json`, `resolution_seed`, `created_at`
- `moves`
  - `id`, `game_id`, `agent_id`, `revision_seen`, `action`, `params_json`, `idempotency_key`, `created_at`
- `events`
  - `id`, `game_id`, `type`, `payload_json`, `created_at`
- `audit_log`
  - `id`, `agent_id`, `game_id`, `action`, `meta_json`, `created_at`

---

## 4) Non-functional targets (PoC)

- P95 read latency (`GET /state`): < 150ms local
- P95 write latency (`POST /moves` accepted): < 250ms local
- Deterministic replay success: 100% on test fixtures
- Duplicate move safety: 100% idempotent on retries

---

## 5) Test strategy

### Unit
- Auction resolution rules
- Token claim validation
- Revision conflict logic

### Integration
- End-to-end game flow (create → join → state → move → resolve)
- Duplicate idempotency behavior
- Scope/auth denial paths

### Property / fuzz (optional but useful)
- Move order permutations should not break deterministic final result

---

## 6) Definition of done (v0.1)

v0.1 is done when:
1. 3+ agents can complete a full Auction House match.
2. Move retries are safe (idempotency proven).
3. Stale move protection works (`expected_revision`).
4. Replay verifier reproduces final state from history.
5. Invite-only + rate limiting prevents trivial account flooding.
6. Docs allow a new contributor to run local PoC quickly.

---

## 7) Next after v0.1

- Add Diplomatic Correspondence module.
- Add webhook delivery with signed callbacks.
- Add GitHub OAuth registration path for public beta.

---

Prepared for immediate implementation.
