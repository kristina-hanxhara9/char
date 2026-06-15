# Data Protection Impact Assessment — YOPEY Befriender

**Status:** Draft for YOPEY review · **Last updated:** June 2026
**Owner:** YOPEY (registered charity 1145573) — to be signed off by the trustees
and the Designated Safeguarding Lead (DSL).

> A DPIA is required under UK GDPR Art 35 because this service processes
> children's personal data (including, at times, special-category and
> safeguarding data) at scale via automated tools. This document is the
> engineering and processing record; YOPEY's DSL and trustees own the
> organisational decisions and the final sign-off. It is a living document —
> revisit it whenever the processing changes.

---

## 1. Description of the processing

**What it is.** A web chatbot that helps young people aged 16–21 volunteer as
dementia befrienders: it finds nearby CQC-registered care homes, drafts an
introduction email the young person sends themselves, sends reminder emails, and
shares dementia-awareness training. A coordinator dashboard lets YOPEY staff
track progress and review safeguarding alerts.

**Nature of the processing.** Collection (onboarding form + chat), storage
(Supabase, London region), automated processing (Google Gemini API for the
chat; CQC API, postcodes.io, Nominatim, and grounded web search for care-home
data), and email (Resend). Hosting: Vercel (frontend) and Render (backend).

**Scope & context.** Data subjects are mainly 16–21-year-olds, some of them
minors. The service is "likely to be accessed by children", so the ICO Age
Appropriate Design Code (Children's Code) applies in addition to UK GDPR.

**Data categories.**

| Category | Items | Source |
|---|---|---|
| Identity & contact | first name, surname, age, email, phone | onboarding form |
| Location | postcode (home or school search anchor — never full address) | onboarding form |
| Education | school/college name | onboarding form |
| Research | 10-item Dementia Attitudes survey (Likert) | onboarding form |
| Activity | care homes contacted, replies, reminder responses | chat / email clicks |
| Chat content | full transcript of the young person's conversation | chat |
| **Special category / safeguarding** | a young person's disclosure of self-harm, abuse, distress, or a care-home concern, recorded as a safeguarding alert + transcript | chat (model tool call or deterministic backstop) |

---

## 2. Necessity & proportionality

- **Lawful basis (Art 6):** consent — an explicit, unticked checkbox at
  onboarding (`Step3Consent`), plus an explicit "I confirm I am 16 or over"
  attestation. For safeguarding records, the basis shifts to legitimate
  interests / vital interests (Art 6(1)(f)/(d)) because protecting a child does
  not depend on consent.
- **Special-category basis (Art 9):** for safeguarding disclosures, Art 9(2)(b)
  and (g) with the DPA 2018 Sch 1 "safeguarding of children and individuals at
  risk" condition.
- **Data minimisation:** only fields needed for the purpose are collected; the
  bot is instructed never to solicit more (address, socials, photos, parents'
  details). Location is stored as a postcode only. A young person's contact
  details are **not** broadcast in the drafted care-home email — it is signed
  with their name only, and the care home is pointed to YOPEY to reply/verify.
- **Purpose limitation:** each purpose is disclosed in the privacy notice
  (`/privacy`, UK GDPR Art 13). Survey data is used only in anonymous aggregate.
- **Automated processing:** the chatbot is a guidance tool. It makes no decision
  with legal/similarly-significant effect on the young person (no eligibility,
  no profiling). A human coordinator handles matching and acceptance.

---

## 3. Risks and mitigations

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | A young person discloses harm and it isn't acted on | Low / **High** | Two-path safeguarding flow: the bot silently raises an alert (`raise_safeguarding_concern`), emails the DSL immediately, and signposts to a named YOPEY contact + 24/7 helplines (Samaritans, Shout, Childline, The Mix, 999). A **deterministic server-side backstop** raises the alert even if the model misses an explicit disclosure. An **always-visible "Get help" link** in the chat means help never depends on detection at all. |
| R2 | Off-platform / grooming-style contact | Low / **High** | System prompt forbids the bot from moving to private channels or asking the young person to keep secrets; all contact stays on official channels. |
| R3 | Inaccurate care-home information shown to a child | Medium / **High** | CQC ratings come live from the CQC register; the web fallback never states a rating (it links to the CQC profile to check). Postcodes validated against postcodes.io; invented emails/links suppressed. |
| R4 | A minor's contact details exposed to an un-vetted institution | Medium / Medium | The drafted email is signed with the young person's name only — no email, phone, age or postcode in the body; the care home reaches them via YOPEY. (Further hardening — a YOPEY-controlled reply relay — is a documented option.) |
| R5 | Excessive retention of children's data | Medium / Medium | Ordinary accounts auto-delete after 12 months of inactivity (`purge_inactive_users`). Safeguarding records are exempt from that purge but governed by a defined safeguarding-retention period (`SAFEGUARDING_RETENTION_DAYS`), deleting only resolved, time-elapsed records. Right to erasure on demand at `/privacy`. |
| R6 | Unauthorised access to children's data | Low / High | RLS on all tables; backend uses the service-role key; per-user HMAC tokens gate a young person's own records; transcripts are readable by staff **only** where a safeguarding flag exists; dashboard behind a password (per-user logins flagged as a future improvement). |
| R7 | Prompt injection via chat or retrieved web/care-home data | Medium / Medium | All untrusted text is flattened (`_inline_safe`) before entering a prompt; a fixed 6-tool allow-list with validated arguments; SSRF guard on website scraping; rate limiting and a CORS allow-list. |
| R8 | Third-country transfer / model training on children's data | Low / Medium | Gemini used on the paid API tier (no training on submitted data) under EU SCCs; DPAs to be signed with all processors (action below). |

---

## 4. Safeguarding response — wording and SLA (to confirm)

- **Immediate (bot, 24/7):** on disclosure the young person is shown a named
  YOPEY contact plus 24/7 lines (Samaritans 116 123, Shout text 85258, Childline
  0800 1111, The Mix 0808 808 4994, 999). This does not wait for a human.
- **Asynchronous (DSL):** the alert emails the DSL immediately and appears on the
  dashboard. **Proposed review SLA — YOPEY to confirm:** high-severity alerts
  (self-harm, abuse, danger, care-home concern) reviewed within **1 working
  day**; out-of-hours risk is covered by the 24/7 lines above. The DSL records
  the action taken via "resolve".

---

## 5. Consultation & sign-off

- **Data subjects / advocates:** the privacy notice is written in plain,
  age-appropriate language. (Consider piloting with a small group of young
  people and a school safeguarding lead.)
- **Outstanding organisational actions** (see also `SAFEGUARDING.md §8`):
  1. Name the DSL; set `SAFEGUARDING_EMAIL`.
  2. Confirm the safeguarding review SLA (§4) and the escalation procedure.
  3. Set `SAFEGUARDING_RETENTION_DAYS` to the agreed safeguarding-record period.
  4. Keep `CQC_SUBSCRIPTION_KEY` configured in production.
  5. Sign DPAs with Google, Supabase, Resend, Vercel, Render.
  6. Register with the ICO as a data controller.
  7. Trustee + DSL sign-off of this DPIA.

**Residual risk after mitigations:** assessed as **low**, contingent on the
organisational actions above being completed before scaling beyond the pilot.

---

*This DPIA cross-references the engineering safeguarding record in
`SAFEGUARDING.md` and the public privacy notice at `/privacy`.*
