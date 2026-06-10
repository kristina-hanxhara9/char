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

## 1. Human escalation on disclosure — two paths

The bot recognises **two kinds** of concern and, in both, (a) silently raises an
alert to a human, (b) signposts the young person to a **real person at YOPEY**
first, then the appropriate external services. It never tries to counsel,
investigate, probe for detail, or advise — it defers to humans.

In both paths the bot **silently calls `raise_safeguarding_concern`** (an LLM
tool — the young person is not told). The backend **records a
`safeguarding_alerts` row** and **emails the safeguarding lead immediately**
(`SAFEGUARDING_EMAIL`) via Resend.

### Path 1 — the young person's own welfare
Triggers: self-harm/suicidal thoughts, abuse, being unsafe, eating disorder,
substance abuse, severe distress/hopelessness, victim of crime, anyone in danger.

The bot points them to **YOPEY's safeguarding lead** (`YOPEY_SAFEGUARDING_CONTACT`),
then the helplines:
- The Mix (under-25s): 0808 808 4994 · themix.org.uk
- Samaritans (24/7): 116 123
- Childline (under-19s): 0800 1111
- 999 if anyone is in immediate danger

### Path 2 — a concern about a care home (adult safeguarding)
Triggers: the young person reports that a **resident** is being mistreated,
neglected, spoken to harshly, left unsafe, or anything at the home that worried
them. This protects a vulnerable elderly adult and is a distinct, serious path.

The bot reassures them they did the right thing by speaking up, then points to:
- **YOPEY's safeguarding lead** (`YOPEY_SAFEGUARDING_CONTACT`)
- The **Care Quality Commission** (the regulator):
  cqc.org.uk/give-feedback-on-care · 03000 616161
- 999 if a resident is in immediate danger

The escalation email to the DSL for a care-home concern includes the CQC and
local-authority adult-safeguarding routes, since the human follow-up differs
from a young-person-welfare case.

**Severity tiers:** self_harm / abuse / danger / care_home_concern are `high`;
distress / other are `medium`. The email subject carries the tier for triage.

**Configuration required:**
- `SAFEGUARDING_EMAIL` — internal escalation inbox (the DSL). NOT shown to teens.
- `YOPEY_SAFEGUARDING_CONTACT` — the teen-facing "talk to a real person" string.
- `RESEND_API_KEY` — so the alert email can send. If email isn't configured the
  alert is still recorded on the dashboard and flagged "email not sent".

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
