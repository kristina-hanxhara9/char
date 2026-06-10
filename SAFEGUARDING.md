# Safeguarding & the UK Children's Code — by design

YOPEY Befriender's chatbot is a digital service likely to be accessed by
under-18s. That brings it within scope of the **ICO Age Appropriate Design
Code ("Children's Code")** and YOPEY's own safeguarding policy. This document
records the measures built into the product so they can be shown to trustees,
funders, schools, and — if ever asked — the ICO.

This is engineering documentation. It does **not** replace YOPEY's written
safeguarding policy or the role of the Designated Safeguarding Lead (DSL). It
describes how the software supports those.

---

## 1. Human escalation on disclosure

If a young person discloses anything suggesting they may be at risk — self-harm
or suicidal thoughts, abuse, being unsafe, an eating disorder, substance abuse,
severe distress, being a victim of crime, or anyone in danger — the chatbot:

1. **Silently calls `raise_safeguarding_concern`** (an LLM tool). The young
   person is not told an alert was raised — it happens in the background so as
   not to discourage them from talking.
2. The backend **records a `safeguarding_alerts` row** and **emails the named
   safeguarding lead immediately** (`SAFEGUARDING_EMAIL`) via Resend.
3. The chatbot **then signposts** the young person to free confidential help:
   - The Mix (under-25s): 0808 808 4994 · themix.org.uk
   - Samaritans (24/7): 116 123
   - Childline (under-19s): 0800 1111
   - 999 if anyone is in immediate danger
4. The bot does **not** try to counsel, probe for details, or advise — it
   defers to humans and helplines.

**Severity tiers:** self-harm / abuse / danger are recorded as `high`;
distress / other as `medium`. The email subject carries the tier so the lead
can triage.

**Configuration required:** set `SAFEGUARDING_EMAIL` to the DSL's address and
`RESEND_API_KEY` so the email can send. If email isn't configured the alert is
still recorded on the dashboard and flagged as "email not sent" so it isn't
missed.

---

## 2. Reviewable conversations (data-minimised)

The DSL can read the **full transcript of a flagged conversation** from the
dashboard's **Safeguarding** tab → "Read conversation".

By deliberate design, transcripts are **only** readable for users who have a
safeguarding alert. There is no "browse everyone's chats" view. This follows
the Children's Code principle of **data minimisation** — staff see personal
conversation content only where there is a safeguarding reason to.

Technically: `GET /api/dashboard/conversation/{user_id}` returns `403` unless a
`safeguarding_alerts` row exists for that user.

---

## 3. No secret or off-platform contact

The system prompt forbids the bot from ever:
- Suggesting or agreeing to move to a private/off-platform channel (personal
  email, WhatsApp, Instagram, Snapchat, phone, meeting in person).
- Asking the young person to keep anything secret from parents, teachers, or
  YOPEY.

All contact stays on-platform or through YOPEY's official channels
(hello@yopey.org, 01440 821654, yopeybefriender.org). The only "private"
contacts the bot ever surfaces are the named helplines above.

---

## 4. Data minimisation & children's data

- **Age gate:** 16+ enforced on the onboarding form and server-side
  (`OnboardRequest.age >= 16`). DPA 2018 sets the UK age of consent for
  information-society services at 13; we sit well above it.
- **Only what's needed:** name, age, email, phone, postcode, school name, the
  10-question Dementia Attitudes survey, and chat content. Each purpose is
  disclosed in the privacy notice (`/privacy`), satisfying UK GDPR Art 13.
- **Explicit consent:** the onboarding wizard requires an explicit, unticked-by-
  default consent checkbox before any data is stored.
- **No model training:** OpenAI API data is excluded from training by default
  (since March 2023); each call also passes a hashed `user` identifier for
  abuse monitoring without exposing the user's id.
- **Right to erasure:** any young person can delete their entire record
  (account, chat history, contacts, surveys, alerts) from `/privacy`. The DSL
  can also delete from the dashboard.
- **PII in logs:** server logs redact email (`sa***@x.com`), postcode (outward
  code only), school name (initials), and user ids (first 8 chars). Render
  retains stdout, so nothing identifying is written there.

---

## 5. Retention

The privacy notice states data is kept while the account is active and deleted
after **12 months of inactivity**. Automatic enforcement (a purge cron) is a
planned follow-up; until then, deletion is available on demand via `/privacy`
and the dashboard. **Action for YOPEY:** decide whether to enable the auto-purge
cron before scaling beyond the pilot.

---

## 6. Access control

- The dashboard (including the Safeguarding tab and transcripts) is behind a
  shared password (`DASHBOARD_PASSWORD`). **Action for YOPEY:** use a strong,
  unique value and share it only with staff who need it (ideally just the DSL
  and coordinator). Consider per-user logins in a future iteration.
- Each young person's own records are protected by a per-user HMAC token, so
  knowing a user id alone does not grant access to their data.

---

## 7. What YOPEY still needs to do (not code)

These are organisational, not software, tasks:

1. **Name a Designated Safeguarding Lead** and set `SAFEGUARDING_EMAIL` to them.
2. **Confirm the escalation procedure** the DSL follows when an alert arrives
   (e.g. contact the young person, contact parents/school, contact the LADO or
   police if needed) — the software raises the flag; the human process handles it.
3. **Sign Data Processing Agreements** with OpenAI, Supabase, Resend, Vercel,
   Render.
4. **Complete a DPIA** (the ICO requires one for processing children's data) —
   this document plus the privacy notice provide most of the content.
5. **Register with the ICO** as a data controller (~£40/year for charities).
6. **Decide retention enforcement** (see §5).

---

## Quick reference — what fires where

| Trigger | Code | Result |
|---|---|---|
| Risk disclosure in chat | `raise_safeguarding_concern` tool | `safeguarding_alerts` row + email to DSL + helpline signposting |
| DSL reviews | `/dashboard` → Safeguarding tab | List of alerts, read flagged transcript, mark actioned |
| Young person deletes data | `/privacy` → Delete everything | Cascade delete of all their rows |
| Off-platform request | system prompt rule | Bot redirects to official channels |
