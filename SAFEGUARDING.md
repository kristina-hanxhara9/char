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

**Deterministic backstop (escalation does not rely on the model alone).**
Because an LLM could in principle fail to call the tool, a conservative,
self-referential keyword net (`_detect_crisis`) runs over every young person's
message. If it matches an explicit high-severity disclosure (self-harm/suicide,
abuse, immediate danger) and the model did **not** raise a concern that turn,
the backend raises the alert itself **and** guarantees the helpline signposting
is appended to the reply. Patterns are anchored to the first person to keep
false positives low (a teen describing a resident does not trip it); the bias is
deliberately toward over-alerting on genuine self-disclosure, which the DSL then
triages.

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

- **Age assurance:** This is self-declared age, not hard identity
  verification — proportionate for a befriending signpost that sits inside
  YOPEY's existing (DBS-checked, coordinator-run) onboarding. It is enforced in
  depth: the onboarding form blocks under-16 (`Step1Personal`), the API rejects
  it (`OnboardRequest.age = Field(ge=16)`), and the database refuses it
  (`users.age CHECK (age >= 16)`). On top of the age field, the consent step
  requires an explicit, unticked **"I confirm I am 16 or over"** attestation
  (`Step3Consent`) so eligibility is a deliberate declaration, not just a number.
  DPA 2018 sets the UK age of consent for information-society services at 13; we
  sit well above it.
- **Only what's needed:** name, age, email, phone, postcode, school name, the
  10-question Dementia Attitudes survey, and chat content. Each purpose is
  disclosed in the privacy notice (`/privacy`), satisfying UK GDPR Art 13.
- **Location minimisation:** only the **postcode** is stored (the search anchor),
  never a full address. It is never shared with care homes or third parties, is
  redacted in logs (outward code only), and is deleted with the account.
- **Explicit consent:** the onboarding wizard requires an explicit, unticked-by-
  default consent checkbox before any data is stored.
- **No model training:** chat runs on Google's Gemini API under a paid
  (billing-enabled) project, where Google does not use prompts or responses
  to train its models. **Keep the key on the paid tier** — the free tier's
  terms allow Google to use submitted data to improve its products.
- **Right to erasure:** any young person can delete their entire record
  (account, chat history, contacts, surveys, alerts) from `/privacy`. The DSL
  can also delete from the dashboard.
- **PII in logs:** server logs redact email (`sa***@x.com`), postcode (outward
  code only), school name (initials), and user ids (first 8 chars). Render
  retains stdout, so nothing identifying is written there.

---

## 5. Retention

Data is kept while the account is active and **automatically deleted after 12
months of inactivity** (`RETENTION_DAYS`, default 365). Enforcement is real, not
aspirational: the daily cron (`/api/cron/daily`) runs `purge_inactive_users()`,
which deletes accounts whose most recent activity — across the user row, their
conversation, and their care-home contacts — is older than the window. Cascade
deletes remove every child row. On-demand deletion is also available any time
via `/privacy` and the dashboard.

**Safeguarding-records exception:** accounts that have raised a
`safeguarding_alerts` row are **never** auto-purged. Those records are retained
for the DSL to handle under YOPEY's safeguarding-records policy rather than being
silently erased by a cron. **Action for YOPEY:** set the safeguarding-record
retention period in policy and review flagged accounts accordingly.

---

## 6. Access control

- The dashboard (including the Safeguarding tab and transcripts) is behind a
  shared password (`DASHBOARD_PASSWORD`). **Action for YOPEY:** use a strong,
  unique value and share it only with staff who need it (ideally just the DSL
  and coordinator). Consider per-user logins in a future iteration.
- Each young person's own records are protected by a per-user HMAC token, so
  knowing a user id alone does not grant access to their data.

---

## 7. Care-home information accuracy (CQC ratings)

The Children's Code expects information shown to young people to be accurate. A
care-home CQC rating is high-stakes: a wrong "Good"/"Outstanding" on a home we
point a young person toward is a serious error.

- **Primary source is the live CQC register.** When `CQC_SUBSCRIPTION_KEY` is
  set, ratings come straight from the CQC API
  (`currentRatings.overall.rating`) and are tagged `cqc_rating_source: "cqc"`.
  The bot may state these as fact.
- **The web fallback never asserts a rating.** When CQC is unavailable, results
  come from a grounded web search. The model's claimed rating is **discarded**
  for display (kept only as `cqc_rating_claim` for the coordinator), the home is
  tagged `cqc_rating_source: "web_unverified"`, and the bot is instructed to show
  **no** rating and instead link out to the home's CQC profile
  (`cqc_search_url`) so the real, current rating can be read at source.
- This is enforced server-side (`_search_care_homes_via_web`) **and** in the
  system prompt's "CQC RATING" rule — defence in depth, so a model lapse can't
  surface an unverified rating on its own.

**Action for YOPEY:** keep `CQC_SUBSCRIPTION_KEY` configured in production so the
primary (verified) path is used; the fallback is a safety net, not the default.

---

## 8. What YOPEY still needs to do (not code)

These are organisational, not software, tasks:

1. **Name a Designated Safeguarding Lead** and set `SAFEGUARDING_EMAIL` to them.
2. **Confirm the escalation procedure** the DSL follows when an alert arrives
   (e.g. contact the young person, contact parents/school, contact the LADO or
   police if needed) — the software raises the flag; the human process handles it.
3. **Sign Data Processing Agreements** with Google (Gemini API), Supabase,
   Resend, Vercel, Render.
4. **Complete a DPIA** (the ICO requires one for processing children's data) —
   this document plus the privacy notice provide most of the content.
5. **Register with the ICO** as a data controller (~£40/year for charities).
6. **Set the safeguarding-record retention period** in policy (auto-purge now
   runs for ordinary accounts; flagged accounts are deliberately exempt — §5).

**Coordinator oversight of first outreach — decision recorded.** YOPEY has opted
to keep the current model: the bot drafts the introduction email and the young
person sends it themselves, and the coordinator enters at the acceptance/match
stage (no one visits without the coordinator marking them accepted and the DBS
check the care home arranges). The accepted safeguards on that first email are:
it only ever goes to **CQC-registered** homes; it carries YOPEY's **verifiable
charity identity** (1145573 + hello@yopey.org + 01440 821654 + website); it
commits the volunteer to a **DBS check**; and the bot **never** brokers
private/off-platform contact (§3). Revisit this if the programme scales or the
risk profile changes.

---

## Quick reference — what fires where

| Trigger | Code | Result |
|---|---|---|
| Risk disclosure in chat | `raise_safeguarding_concern` tool | `safeguarding_alerts` row + email to DSL + helpline signposting |
| Explicit crisis language, model missed it | `_detect_crisis` backstop | Alert raised server-side + signposting appended |
| DSL reviews | `/dashboard` → Safeguarding tab | List of alerts, read flagged transcript, mark actioned |
| Young person deletes data | `/privacy` → Delete everything | Cascade delete of all their rows |
| Account inactive 12 months | `purge_inactive_users()` (daily cron) | Auto-delete (flagged accounts exempt) |
| Care-home rating shown | CQC API vs web fallback | Stated only if `cqc_rating_source: "cqc"`; else link to CQC |
| Off-platform request | system prompt rule | Bot redirects to official channels |
