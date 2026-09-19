# YOPEY Befriender — developer handoff (integrate the AI into yopey.org)

The AI is **not a plugin or a file you install into WordPress**. It is already a
live, hosted web app. You have three options depending on how "on yopey.org" you
need it to be. Most sites want **Option A** (or **B** for nicer branding).

## Where everything lives

| Piece | Where | URL |
|-------|-------|-----|
| Frontend (the site users see) | Vercel | https://yopey-befriender.vercel.app |
| Backend (the API / brain) | Render | https://char-rmun.onrender.com |
| Database | Supabase | (private project) |
| Source code | GitHub | https://github.com/kristina-hanxhara9/char |

---

## Option A — Embed it on the existing WordPress site (fastest, nothing to re-host)

The app keeps running on Vercel/Render; you just surface it on yopey.org.

### A1. Floating chat button (whole flow in a popup)

Add this one line before `</body>`:

```html
<script src="https://yopey-befriender.vercel.app/widget.js" async></script>
```

Easiest place in WordPress: install a header/footer plugin (**WPCode** or
**Insert Headers and Footers**), open its **Footer** box, paste the line, save.
A floating "Find a care home" button now appears on every page and opens the
onboarding → care-home search → email drafting flow in an iframe served from the
YOPEY origin (no API keys or CORS changes needed on the WordPress side).

Optional attributes on the same tag:

```html
<script
  src="https://yopey-befriender.vercel.app/widget.js"
  data-yopey-position="right"      <!-- left | right -->
  data-yopey-label="Find a care home"
  data-yopey-color="#FFAD00"
  async></script>
```

Preview/demo: https://yopey-befriender.vercel.app/widget-demo.html
Loader source: `frontend/public/widget.js`

If a security plugin sets `X-Frame-Options` / `frame-ancestors`, allow framing
or the widget popup will be blocked (most WordPress sites don't set this).

### A2. Or just a link / button / menu item

Because it's a normal website you can link straight to it:
- Public start: `https://yopey-befriender.vercel.app`
- Straight into the finder: `https://yopey-befriender.vercel.app/onboard`
- The how-to guide: `https://yopey-befriender.vercel.app/guide`
- Coordinator dashboard: `https://yopey-befriender.vercel.app/dashboard`

Add it in **Appearance → Menus → Custom Links**, or as a **Button block** on a
page (tick "Open in new tab"). You can use the widget *and* a button together.

---

## Option B — Give it a yopey.org web address (custom subdomain)

Same hosting as Option A, but the app answers on e.g. `befriender.yopey.org`
instead of the vercel.app URL. Do this once, then use that address in Option A.

1. **Vercel** → the `yopey-befriender` project → **Settings → Domains → Add** →
   enter `befriender.yopey.org`.
2. Vercel shows a **DNS record** to create (usually a `CNAME` to
   `cname.vercel-dns.com`). Add it in yopey.org's DNS panel (GoDaddy, Cloudflare,
   wherever the domain is managed).
3. Wait for Vercel to show the domain as **Valid/Active** (minutes to a couple of
   hours).
4. **Backend (Render)** — add the new origin so the browser can call the API:
   set `ALLOWED_ORIGINS` to include `https://befriender.yopey.org`, and set
   `FRONTEND_BASE_URL=https://befriender.yopey.org`. Redeploy.
5. Now use `https://befriender.yopey.org` in the Option A widget/link.

(If you also want the API on a yopey.org address, e.g. `api.yopey.org`, add that
as a custom domain on the **Render** service, point DNS at Render, and set the
frontend's `NEXT_PUBLIC_API_URL` to it — optional, cosmetic.)

---

## Option C — Fully re-host on YOPEY's own accounts (own the whole stack)

Only needed if YOPEY wants the app off the current Vercel/Render/Supabase and
onto its own accounts. Bigger job. High-level sequence:

1. **GitHub** — fork or transfer `kristina-hanxhara9/char` into YOPEY's org, or
   grant the developer access.
2. **Supabase** — create a project, open **SQL Editor**, run
   `backend/supabase_setup.sql` (fresh) — this creates every table, view, RLS and
   the `admin_users` login table. Copy the project URL and **service_role** key.
3. **Render** — new **Web Service** from the repo, root dir `backend/`, build
   `pip install -r requirements.txt`, start `python agent.py`, health check
   `/health`. Set the environment variables (see the full list in `README.md`
   and `backend/.env.example`). The essential ones:
   - `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` (service_role)
   - `RESEND_API_KEY`, `EMAIL_FROM` (from a **verified** sending domain in Resend)
   - `EMAIL_TOKEN_SECRET` (any long random string — signs dashboard logins)
   - `ADMIN_EMAIL_DOMAIN` (e.g. `yopey.org`), `SAFEGUARDING_EMAIL`,
     `YOPEY_SAFEGUARDING_CONTACT`
   - `ALLOWED_ORIGINS` (the frontend URL), `APP_BASE_URL` (this backend's URL)
   - Optional: `ORS_API_KEY` (walking distances), `CQC_PARTNER_CODE`,
     `CRON_SECRET` (daily reminder emails)
4. **Vercel** — import the repo's `frontend/` directory. Set
   `NEXT_PUBLIC_API_URL` to the new Render URL. Deploy. (Add a custom domain per
   Option B if wanted.)
5. **GitHub Actions** (optional keep-warm + daily reminders) — set repo variable
   `BACKEND_URL` to the new Render URL and repo secret `CRON_SECRET` to match
   Render. Workflows live in `.github/workflows/`.
6. Smoke test: `/health` returns ok, onboarding → chat → care-home search works,
   and a coordinator can create an account at `/dashboard` and receive the code.

Full detail is in `README.md` (env table + deploy) and `SETUP_FOR_YOPEY.md`
(coordinator login + WordPress embed).

---

## Which to choose

- **Just get it live on yopey.org:** Option A.
- **Nicer branding (befriender.yopey.org):** Option B, then A.
- **YOPEY owns the entire stack:** Option C.

Questions about the app itself: hello@yopey.org.
