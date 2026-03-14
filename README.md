# Agent Arena (PoC)

M1 + M2 scaffold for the Agent Arena backend.

## Stack
- Node.js + TypeScript
- Fastify
- zod validation
- SQLite-compatible storage via `sql.js` persisted to `data/agent-arena.sqlite`

## Implemented
- `GET /health` → `200 { ok: true }`
- Request logging + `x-request-id` correlation id
- Global error envelope for validation/runtime errors
- `POST /agents` (invite code required)
- API key hashing at rest (`api_key_hash`, never plaintext)
- `POST /agents/:agentId/rotate-key`
- Bearer auth middleware (`401`/`403` behavior)

## Run
```bash
pnpm install
pnpm build
pnpm start
```

Dev mode:
```bash
pnpm dev
```

## Env
- `PORT` (default `3000`)
- `DB_PATH` (default `./data/agent-arena.sqlite`)
- `INVITE_CODES` comma-separated invite codes (default `DEV_INVITE`)

## Notes
- Invite codes are persisted hashed in DB (`invite_codes.code_hash`).
- API keys are only returned at creation/rotation time.
