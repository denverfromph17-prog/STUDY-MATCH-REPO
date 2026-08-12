# Study Match PH

Day 1 foundation for an API-first study-buddy platform for Filipino adults.

## Architecture

```text
Web client (public/) ─┐
Future mobile app ────┼─> Express REST API (/api) ─> SQLite
Future admin UI ──────┘
```

All validation, age policy, authentication, and authorization live in the backend. The current frontend is dependency-free HTML/CSS/JavaScript; it can be replaced independently without changing the API.

## Run locally

Requires Node.js 22.5 or newer (for `node:sqlite`).

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Configuration options are documented in `.env.example`.

## API

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register an adult user and create an empty profile |
| POST | `/api/auth/login` | No | Create a session |
| POST | `/api/auth/logout` | No | Invalidate the current session |
| GET | `/api/auth/me` | Yes | Return the authenticated user |
| GET | `/api/health` | No | Health check |

Sessions are opaque random tokens stored as SHA-256 hashes in the database and sent in `HttpOnly`, `SameSite=Strict` cookies (`Secure` in production). Passwords are bcrypt-hashed. API responses use an explicit public-user projection and never expose hashes.

## Database

The schema is initialized automatically and contains `users`, one-to-one `profiles`, `admin_users`, and `sessions`. Day 2 adds normalized `subjects`, `study_goals`, `study_styles`, their profile junction tables, and structured `availability` rows.

## Day 2 profile API

Authenticated users can manage only the profile inferred from their session through `GET/PUT /api/profile`, `POST/DELETE /api/profile/photo`, and `GET/PUT /api/profile/availability`. Catalogs are available at `/api/subjects`, `/api/study-goals`, and `/api/study-styles`. Profile photos accept signature-validated JPEG, PNG, or WebP files up to 5 MB and use generated server filenames.

## Day 3 matching

`GET /api/matches` returns privacy-safe study-buddy candidates ranked by a deterministic 100-point score: subjects 35, goals 20, study styles 15, mode 10, and overlapping availability 20. The response includes the score breakdown, shared inputs, and plain-language reasons. The threshold, result limit, and bounded candidate scan are configurable.

Match requests use `POST /api/matches/:userId/request|accept|reject|cancel`; `GET /api/match-requests` returns the authenticated user's request and mutual-match state. Accepted requests create one normalized `matches` row. Chat and messaging are intentionally not implemented.

## Test

```bash
pnpm test
```

Tests cover registration validation and age boundaries, duplicate emails, login/logout, protected-route authorization, direct-API age bypass attempts, password storage, and origin-based CSRF protection.
