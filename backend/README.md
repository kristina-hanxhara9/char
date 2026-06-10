# YOPEY Befriender — Backend

FastAPI Python server. See the [root README](../README.md) for setup.

## File overview

| File | Purpose |
|------|---------|
| [agent.py](agent.py) | Main backend: FastAPI app, chat engine, LLM tools, nudges, dashboard API |
| [system_prompt.txt](system_prompt.txt) | AI personality and step-by-step guide |
| [supabase_setup.sql](supabase_setup.sql) | Database schema + dashboard views (run once) |
| [requirements.txt](requirements.txt) | Python dependencies |
| [.env.example](.env.example) | Environment variable template |

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | none | Liveness check |
| POST | `/api/onboard` | none | `{first_name, age, utm_source?}` → creates user, returns user_id |
| POST | `/api/chat` | none | `{user_id, message}` → reply (rate-limited 30/min/IP) |
| GET | `/api/dashboard/summary` | header | Stats counts |
| GET | `/api/dashboard/users` | header | All users |
| GET | `/api/dashboard/waiting` | header | Awaiting care home replies |
| GET | `/api/dashboard/stuck` | header | Registered 7+ days, no contact |
| GET | `/api/dashboard/matched` | header | Accepted matches |
| POST | `/api/dashboard/mark-reply` | header | Mark a contact accepted/rejected |

Dashboard endpoints require `X-Dashboard-Password: <DASHBOARD_PASSWORD>` header.

## LLM tools

The chat exposes seven tools to Gemini (it decides when to call them). The core three:

1. **`search_care_homes(postcode, radius_miles?, max_results?)`** — live CQC API search via postcodes.io for geocoding.
2. **`save_user_details(surname?, email?, postcode?, school?, stage?)`** — persists user fields collected mid-conversation.
3. **`log_care_home_contact(care_home_name, care_home_phone?, care_home_address?, method)`** — records outreach and starts the nudge clock.

## Nudge schedule

Run `python agent.py --nudge` daily. Each unreplied contact gets at most one nudge per day, moving through stages 1→4:

| Day | Stage | Subject |
|-----|-------|---------|
| 3   | 1     | Gentle check-in |
| 5   | 2     | Suggest calling |
| 7   | 3     | Try next home OR call |
| 10  | 4     | Move on to next home |

Nudges send via Resend (set `RESEND_API_KEY`). Without a key, they log to stdout instead.

## Manual smoke test (curl)

```bash
# 1. Health
curl http://localhost:8000/health

# 2. Onboard
curl -X POST http://localhost:8000/api/onboard \
  -H 'Content-Type: application/json' \
  -d '{"first_name":"Sarah","age":17}'
# → {"user_id":"...","first_name":"Sarah"}

# 3. Chat (use the user_id from step 2)
curl -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"<uuid>","message":"My postcode is CB8 8YN"}'
```
