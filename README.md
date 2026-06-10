# YOPEY Befriender AI Agent

AI chatbot that helps young people (16+) find local CQC-registered care homes and start volunteering as dementia befrienders. Replaces Tony's manual phone/email outreach process.

## What's in here

```
backend/      FastAPI Python server (chat + LLM tools + nudge cron + dashboard API)
frontend/     Next.js 14 site (landing, onboard form, chat, admin dashboard)
```

## Features

- **Pre-chat form** — collects first name + age (16+ gate)
- **Chat** — Gemini (gemini-3.5-flash) conversation that collects surname, postcode, email naturally
- **Care home search** — live CQC API, returns 5 nearest care homes by distance
- **Email drafting** — bot writes personalised intro letters
- **Escalating nudges** — automated reminder emails at 3, 5, 7, 10 days
- **Dashboard** — password-protected admin view with stats and tables (name, surname, email, age, postcode)
- **Mobile-first** — Tailwind responsive design, safe-area insets, 16px inputs (no iOS zoom)

## Quick start (local dev)

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** → paste contents of [backend/supabase_setup.sql](backend/supabase_setup.sql) → Run
3. Copy your project URL and **service_role** key from Settings → API

### 2. Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your keys (Gemini, Supabase, Resend, dashboard password)
python agent.py
# server now on http://localhost:8000
```

Sanity check: `curl http://localhost:8000/health` → `{"ok": true}`

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local
# Edit .env.local if your backend isn't on http://localhost:8000
npm install
npm run dev
# open http://localhost:3000
```

### 4. Daily nudge cron

Run this every morning (Railway/Render cron, or system crontab):

```bash
cd /path/to/backend && python agent.py --nudge
```

Example crontab — 9am UTC daily:

```
0 9 * * * cd /path/to/backend && /path/to/venv/bin/python agent.py --nudge >> nudge.log 2>&1
```

## Environment variables

### Backend (`backend/.env`)

| Var | Required | Notes |
|-----|----------|-------|
| `GEMINI_API_KEY` | Yes | from aistudio.google.com — use a billing-enabled project (paid tier excludes data from training) |
| `SUPABASE_URL` | Yes | https://xxxxx.supabase.co |
| `SUPABASE_KEY` | Yes | **service_role** key |
| `RESEND_API_KEY` | For nudges | resend.com |
| `EMAIL_FROM` | For nudges | e.g. `YOPEY <hello@yopey.org>` |
| `DASHBOARD_PASSWORD` | Yes | shared password for Tony's dashboard |
| `ALLOWED_ORIGINS` | Yes | comma-separated frontend origins |
| `CQC_PARTNER_CODE` | Optional | from cqc.org.uk if you have one |
| `PORT` | Optional | defaults to 8000 |

### Frontend (`frontend/.env.local`)

| Var | Required | Notes |
|-----|----------|-------|
| `NEXT_PUBLIC_API_URL` | Yes | your backend URL |

## Deploy

**Frontend** → Vercel
1. Push to GitHub
2. Import the `frontend/` directory into Vercel
3. Add `NEXT_PUBLIC_API_URL` env var pointing to your Railway URL

**Backend** → Railway
1. Create a new project, connect the GitHub repo
2. Set root directory to `backend/`
3. Build command: `pip install -r requirements.txt`
4. Start command: `python agent.py`
5. Add all env vars from `.env.example`
6. Add a **Cron Job** with command `python agent.py --nudge`, schedule `0 9 * * *`

## End-to-end smoke test

1. Open http://localhost:3000 on a real phone (or Chrome devtools iPhone 14 Pro).
2. Click "Find a care home" → fill out onboard form.
3. Try age 15 → blocked. Try age 16 → continues.
4. In the chat: provide surname, real UK postcode (e.g. `CB8 8YN`), email.
5. Confirm Supabase `users` table has: first_name, surname, age, postcode, email.
6. Verify bot returns real care home names matching cqc.org.uk for that postcode.
7. Confirm `contacts` row written when bot logs the email send.
8. Test nudge: `UPDATE contacts SET contacted_at = NOW() - INTERVAL '3 days'`, then run `python agent.py --nudge` — confirm Resend dashboard shows the email.
9. Visit `/dashboard`, enter password, confirm tables populate and "Refresh" works.

## Costs (rough)

| Item | Cost |
|------|------|
| Supabase | Free tier |
| Gemini (3.5 Flash chat + grounded search) | ~£5/month for hundreds of conversations; web searches free under 5,000 grounded prompts/month, then $14/1k |
| Vercel | Free tier |
| Railway | ~£5/month for backend + cron |
| Resend | Free (100/day, 3k/month) |
| CQC + postcodes.io APIs | Free |
| **Total** | **~£10/month** |

## Roadmap

- **v1.1** — Replace live CQC API with a `care_homes` Supabase table loaded from the [CQC bulk CSV](https://www.cqc.org.uk/about-us/transparency/using-cqc-data) + PostGIS distance queries (sub-100ms searches, no `partnerCode` needed).
- **v1.2** — Visit reports flow inside the chat.
- **v1.3** — DBS check tracking.
