"""
YOPEY Befriender AI Agent
=========================
FastAPI backend with: Supabase database, GPT-4o-mini chat with tool use,
live CQC care home search, escalating nudge reminders (3/5/7/10 days),
and dashboard endpoints.
"""

import base64
import hashlib
import hmac
import json
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Union

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from openai import OpenAI
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from supabase import Client, create_client

load_dotenv()


# ============================================================
# CONFIG
# ============================================================

def _real_env(name: str) -> str | None:
    """Return an env var only if it's non-empty AND doesn't look like a placeholder."""
    v = os.environ.get(name, "").strip()
    if not v or v.startswith(("xxxx", "sk-...", "re_...", "eyJ...", "https://xxxx")):
        return None
    return v


OPENAI_KEY = _real_env("OPENAI_API_KEY")
SUPABASE_URL = _real_env("SUPABASE_URL")
SUPABASE_KEY = _real_env("SUPABASE_KEY")
RESEND_API_KEY = _real_env("RESEND_API_KEY")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "YOPEY Befriender <hello@yopey.org>")
CQC_PARTNER_CODE = os.environ.get("CQC_PARTNER_CODE", "").strip()
DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "changeme")
EMAIL_TOKEN_SECRET = os.environ.get("EMAIL_TOKEN_SECRET") or DASHBOARD_PASSWORD
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:8000").rstrip("/")
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
]

if not (OPENAI_KEY and SUPABASE_URL and SUPABASE_KEY):
    print(
        "[warn] Missing real OPENAI_API_KEY / SUPABASE_URL / SUPABASE_KEY — "
        "server will start but /api/onboard and /api/chat will return 503."
    )

openai_client: Optional[OpenAI] = OpenAI(api_key=OPENAI_KEY) if OPENAI_KEY else None
supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[warn] Could not init Supabase client: {e}")


def _require_services() -> None:
    if not (openai_client and supabase):
        raise HTTPException(
            status_code=503,
            detail="Server not fully configured. Set OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY in backend/.env.",
        )

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
with open(_PROMPT_PATH, "r") as f:
    SYSTEM_PROMPT = f.read()


# Keep last N message pairs in the LLM context — bounds token cost
MAX_LLM_HISTORY = 40  # 20 user/assistant turns


# ============================================================
# PART 1: CARE HOME SEARCH TOOL (live CQC API)
# ============================================================

def postcode_to_latlng(postcode: str) -> dict:
    clean = postcode.strip().replace(" ", "")
    if not clean:
        return {"error": "Empty postcode"}
    resp = requests.get(f"https://api.postcodes.io/postcodes/{clean}", timeout=10)
    data = resp.json()
    if data.get("status") != 200:
        return {"error": f"Could not find postcode: {postcode}"}
    return {
        "latitude": data["result"]["latitude"],
        "longitude": data["result"]["longitude"],
        "admin_district": data["result"]["admin_district"],  # e.g. "West Suffolk"
        "admin_county": data["result"].get("admin_county"),
    }


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3959
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def search_care_homes(postcode: str, radius_miles: int = 10, max_results: int = 5) -> dict:
    """
    Live CQC API search. Returns nearest care homes by haversine distance.

    Note: the CQC public dataset does NOT include email addresses. The bot must
    tell the user how to find them (call the home, or use carehome.co.uk).

    Pre-loaded Supabase + PostGIS approach is the v1.1 upgrade for speed.
    """
    location = postcode_to_latlng(postcode)
    if "error" in location:
        return {"error": location["error"], "results": []}

    user_lat = location["latitude"]
    user_lng = location["longitude"]
    local_authority = location["admin_district"]
    care_homes: list[dict] = []

    headers = {}
    if CQC_PARTNER_CODE:
        # The CQC API uses partnerCode as a query param, not a header.
        # Subscription key is needed only if you have one — public access works without.
        pass

    # Filter by localAuthority first — drastically reduces the result set vs
    # paginating through all of England.
    page = 1
    max_pages = 6
    seen_ids: set[str] = set()
    while len(care_homes) < 30 and page <= max_pages:
        try:
            params: dict[str, Any] = {
                "careHome": "Y",
                "page": page,
                "perPage": 50,
                "localAuthority": local_authority,
            }
            if CQC_PARTNER_CODE:
                params["partnerCode"] = CQC_PARTNER_CODE

            resp = requests.get(
                "https://api.cqc.org.uk/public/v1/locations",
                params=params,
                headers=headers,
                timeout=20,
            )
            data = resp.json()
        except Exception as e:
            return {"error": f"CQC API error: {e}", "results": care_homes}

        locations = data.get("locations", [])
        if not locations:
            break

        for loc in locations:
            loc_id = loc.get("locationId")
            if not loc_id or loc_id in seen_ids:
                continue
            seen_ids.add(loc_id)
            try:
                detail_resp = requests.get(
                    f"https://api.cqc.org.uk/public/v1/locations/{loc_id}",
                    params={"partnerCode": CQC_PARTNER_CODE} if CQC_PARTNER_CODE else None,
                    headers=headers,
                    timeout=10,
                )
                detail = detail_resp.json()
            except Exception:
                continue

            lat = detail.get("onspdLatitude")
            lng = detail.get("onspdLongitude")
            if not (lat and lng):
                continue

            distance = haversine_miles(user_lat, user_lng, lat, lng)
            if distance > radius_miles:
                continue

            manager_name: Optional[str] = None
            for activity in detail.get("regulatedActivities", []):
                for contact in activity.get("contacts", []):
                    if "Registered Manager" in contact.get("personRoles", []):
                        parts = [
                            contact.get("personTitle", ""),
                            contact.get("personGivenName", ""),
                            contact.get("personFamilyName", ""),
                        ]
                        joined = " ".join(p for p in parts if p).strip()
                        if joined:
                            manager_name = joined
                            break
                if manager_name:
                    break

            # Service types — e.g. "Care home service with nursing"
            service_types: list[str] = []
            for st in detail.get("gacServiceTypes", []) or []:
                name = st.get("name") if isinstance(st, dict) else st
                if name:
                    service_types.append(name)

            # Specialisms — e.g. "Dementia", "Older people"
            specialisms: list[str] = []
            for sp in detail.get("specialisms", []) or []:
                name = sp.get("name") if isinstance(sp, dict) else sp
                if name:
                    specialisms.append(name)

            # Most recent inspection date
            last_inspection = (
                detail.get("lastInspection", {}).get("date")
                if isinstance(detail.get("lastInspection"), dict)
                else None
            )

            care_homes.append({
                "name": detail.get("name", "Unknown"),
                "address": ", ".join(
                    p for p in [
                        detail.get("postalAddressLine1", ""),
                        detail.get("postalAddressLine2", ""),
                        detail.get("postalAddressTownCity", ""),
                    ] if p
                ),
                "postcode": detail.get("postalCode", ""),
                "phone": detail.get("mainPhoneNumber", "Not listed"),
                "website": detail.get("website") or None,
                "manager": manager_name or "the Manager (not listed)",
                "distance_miles": round(distance, 1),
                "cqc_rating": detail.get("currentRatings", {})
                    .get("overall", {})
                    .get("rating", "Not yet rated"),
                "service_types": service_types,
                "specialisms": specialisms,
                "number_of_beds": detail.get("numberOfBeds", "Unknown"),
                "last_inspection_date": last_inspection,
                "cqc_url": f"https://www.cqc.org.uk/location/{loc_id}",
                "carehome_co_uk_search_url": (
                    "https://www.carehome.co.uk/search.cfm?searchquery="
                    + requests.utils.quote(detail.get("name", ""))
                ),
            })
        page += 1

    care_homes.sort(key=lambda x: x["distance_miles"])
    return {
        "search_area": local_authority,
        "email_note": (
            "Care home email addresses are NOT in the CQC public dataset. "
            "To find an email: call the care home directly and ask for the manager's email, "
            "OR search the care home by name on carehome.co.uk and use their 'Send Email' button, "
            "OR check the care home's own website for a contact form."
        ),
        "results": care_homes[:max_results],
    }


# ============================================================
# PART 1b: EMAIL LOOKUP TOOL (OpenAI built-in web search)
# ============================================================
# Uses gpt-4o-mini-search-preview to search the web for a care home's
# manager email. Results cached in care_home_emails table so we never
# pay for the same lookup twice. Tony's manually-confirmed emails go
# in the same table with source='tony_seed' and verified=true, so
# verified records always win.

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# Generic inboxes we don't want to return as "the manager's email" if we can avoid it
GENERIC_LOCAL_PARTS = {"info", "enquiries", "contact", "admin", "reception", "office", "hello"}


def _looks_like_generic(email: str) -> bool:
    local = email.split("@", 1)[0].lower()
    return local in GENERIC_LOCAL_PARTS


def _check_email_cache(care_home_name: str, postcode: Optional[str] = None) -> Optional[dict]:
    if not supabase:
        return None
    q = supabase.table("care_home_emails").select("*").ilike(
        "care_home_name", care_home_name
    ).limit(1)
    res = q.execute()
    if not res.data:
        return None
    row = res.data[0]
    try:
        supabase.table("care_home_emails").update(
            {"last_used_at": _now_iso()}
        ).eq("id", row["id"]).execute()
    except Exception:
        pass
    return {
        "found": True,
        "email": row["email"],
        "source": row.get("source") or "cached",
        "verified": bool(row.get("verified")),
    }


def _save_email_to_cache(
    care_home_name: str,
    email: str,
    postcode: Optional[str],
    source: str,
    notes: Optional[str] = None,
) -> None:
    if not supabase:
        return
    try:
        supabase.table("care_home_emails").insert({
            "care_home_name": care_home_name,
            "postcode": postcode,
            "email": email,
            "source": source,
            "notes": notes,
            "last_used_at": _now_iso(),
        }).execute()
    except Exception as e:
        print(f"[email-cache] insert failed: {e}")


def find_email_via_web_search(
    care_home_name: str,
    town_or_postcode: Optional[str] = None,
    manager_name: Optional[str] = None,
) -> dict:
    """
    1. Check the care_home_emails cache (instant, free, trusted).
    2. If miss, ask gpt-4o-mini-search-preview to search the web.
    3. Pull the email from its response with regex; cache it.

    Returns: {found: bool, email?: str, source: str, verified: bool, confidence: str}
    """
    cached = _check_email_cache(care_home_name)
    if cached:
        cached["confidence"] = "verified" if cached["verified"] else "cached"
        return cached

    if not openai_client:
        return {"found": False, "reason": "OpenAI not configured"}

    locator = town_or_postcode or "UK"
    manager_hint = f" The registered manager is {manager_name}." if manager_name else ""
    query = (
        f"Find the public contact email address for the UK care home "
        f"'{care_home_name}' in {locator}.{manager_hint} "
        f"Prefer the registered manager's direct email if listed on the "
        f"care home's own website. Otherwise return the general contact "
        f"email. Reply with ONLY the email address (or the literal text "
        f"'NOT FOUND' if you cannot find one). Do not invent or guess."
    )

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini-search-preview",
            messages=[{"role": "user", "content": query}],
            web_search_options={},
        )
        text = (response.choices[0].message.content or "").strip()
    except Exception as e:
        return {"found": False, "reason": f"Web search error: {e}"}

    matches = EMAIL_RE.findall(text)
    if not matches:
        return {"found": False, "reason": "No email found via web search"}

    # Prefer non-generic addresses if both kinds appear in the response
    non_generic = [m for m in matches if not _looks_like_generic(m)]
    chosen = non_generic[0] if non_generic else matches[0]
    is_generic = _looks_like_generic(chosen)

    _save_email_to_cache(
        care_home_name=care_home_name,
        email=chosen,
        postcode=town_or_postcode,
        source="web_search",
        notes=("generic inbox" if is_generic else None),
    )

    return {
        "found": True,
        "email": chosen,
        "source": "web_search",
        "verified": False,
        "confidence": "medium" if is_generic else "high",
        "is_generic_inbox": is_generic,
    }


# ============================================================
# PART 2: TOOL DEFINITIONS
# ============================================================

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_care_homes",
            "description": (
                "Search for care homes near a UK postcode. Returns the closest care homes "
                "with name, address, phone, manager name, CQC rating, and distance. "
                "Use as soon as the young person provides their postcode."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "postcode": {"type": "string", "description": "A valid UK postcode, e.g. 'CB8 8YN'"},
                    "radius_miles": {"type": "integer", "description": "Search radius. Default 10.", "default": 10},
                    "max_results": {"type": "integer", "description": "Max care homes. Default 5.", "default": 5},
                },
                "required": ["postcode"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_user_details",
            "description": (
                "Save user details collected during chat (surname, email, postcode, school, stage). "
                "Call this whenever you've just learnt a new piece of information about the user."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "surname": {"type": "string"},
                    "email": {"type": "string", "description": "A valid email"},
                    "postcode": {"type": "string"},
                    "school": {"type": "string"},
                    "stage": {"type": "string", "enum": ["sixth_form", "undergraduate"]},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_care_home_email",
            "description": (
                "Look up a care home's contact email. First checks our cached database "
                "(Tony's confirmed contacts + previously found emails), then falls back "
                "to a web search. Use BEFORE drafting an email — never invent an address. "
                "Returns either a real email with confidence level, or {found: false} so "
                "you can tell the user to call/use carehome.co.uk instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "care_home_name": {
                        "type": "string",
                        "description": "Exact care home name from search_care_homes",
                    },
                    "town_or_postcode": {
                        "type": "string",
                        "description": "Town or postcode to disambiguate (helps with common names)",
                    },
                    "manager_name": {
                        "type": "string",
                        "description": "Registered manager name if known (helps target the right inbox)",
                    },
                },
                "required": ["care_home_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mark_care_home_replied",
            "description": (
                "Record that a care home has replied to the young person, with the "
                "outcome. Call this whenever they tell you they've heard back — e.g. "
                "'they emailed me back saying yes', 'they called and said no', 'they "
                "said come in next Tuesday'. If accepted, this triggers the welcome "
                "email series automatically."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "care_home_name": {
                        "type": "string",
                        "description": "Care home name (must match an existing contact)",
                    },
                    "outcome": {
                        "type": "string",
                        "enum": ["accepted", "rejected"],
                        "description": "'accepted' if they said yes / inviting visit. 'rejected' if no / not taking volunteers.",
                    },
                },
                "required": ["care_home_name", "outcome"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "log_care_home_contact",
            "description": (
                "Log that the young person has contacted a care home. "
                "Call when they confirm they've sent an email, made a call, or delivered a letter. "
                "This starts the reminder countdown."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "care_home_name": {"type": "string", "description": "Name of the care home contacted"},
                    "care_home_phone": {"type": "string", "description": "Phone number of the care home"},
                    "care_home_address": {"type": "string", "description": "Address of the care home"},
                    "method": {
                        "type": "string",
                        "enum": ["email", "phone", "in_person"],
                        "description": "How they contacted them",
                    },
                },
                "required": ["care_home_name", "method"],
            },
        },
    },
]


# ============================================================
# PART 3: SUPABASE HELPERS
# ============================================================

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_user(first_name: str, age: int, utm_source: str | None = None) -> dict:
    """Insert a brand-new user from the onboard form. Returns the created row."""
    payload = {"first_name": first_name, "age": age, "status": "new"}
    if utm_source:
        payload["utm_source"] = utm_source
    result = supabase.table("users").insert(payload).execute()
    return result.data[0]


def get_user(user_id: str) -> dict | None:
    result = supabase.table("users").select("*").eq("id", user_id).execute()
    return result.data[0] if result.data else None


def update_user(user_id: str, **fields) -> None:
    fields["updated_at"] = _now_iso()
    supabase.table("users").update(fields).eq("id", user_id).execute()


def log_contact(
    user_id: str,
    care_home_name: str,
    phone: str | None = None,
    address: str | None = None,
    method: str = "email",
) -> None:
    supabase.table("contacts").insert({
        "user_id": user_id,
        "care_home_name": care_home_name,
        "care_home_phone": phone,
        "care_home_address": address,
        "method": method,
        "contacted_at": _now_iso(),
        "nudge_stage": 0,
    }).execute()
    update_user(user_id, status="waiting")


def save_conversation(user_id: str, messages: list) -> None:
    existing = supabase.table("conversations").select("id").eq("user_id", user_id).execute()
    data = {"user_id": user_id, "messages": messages, "updated_at": _now_iso()}
    if existing.data:
        supabase.table("conversations").update(data).eq("user_id", user_id).execute()
    else:
        supabase.table("conversations").insert(data).execute()


def load_conversation(user_id: str) -> list:
    result = supabase.table("conversations").select("messages").eq("user_id", user_id).execute()
    if result.data and result.data[0]["messages"]:
        msgs = result.data[0]["messages"]
        return msgs if isinstance(msgs, list) else json.loads(msgs)
    return []


# ============================================================
# PART 4: ESCALATING NUDGE REMINDERS
# ============================================================

NUDGE_SCHEDULE = [
    {
        "stage": 1,
        "days": 3,
        "subject": "Heard back yet, {name}?",
        "intro": "It's been 3 days since you contacted {care_home}.",
        "waiting_tip_html": (
            "<p>Still early — give it a few more days. Care home managers are busy.</p>"
            "<p>Quick thing to do while you wait: become a "
            "<a href='https://www.dementiafriends.org.uk/'>Dementia Friend</a> (15 min, free).</p>"
        ),
    },
    {
        "stage": 2,
        "days": 5,
        "subject": "Heard from {care_home}?",
        "intro": "5 days now since you contacted {care_home}.",
        "waiting_tip_html": (
            "<p>Sometimes emails get lost — a quick call usually sorts it.</p>"
            "<p>📞 <strong>{phone}</strong></p>"
            "<p>Just say: <em>\"I sent an email about volunteering as a YOPEY Befriender — "
            "did the manager get it?\"</em></p>"
        ),
    },
    {
        "stage": 3,
        "days": 7,
        "subject": "One week in — any news?",
        "intro": "A week since you contacted {care_home}.",
        "waiting_tip_html": (
            "<p>Two options:</p>"
            "<p>📞 <strong>Call them:</strong> {phone}</p>"
            "<p>🔄 <strong>Try the next care home:</strong> come back to the "
            "<a href='https://www.yopeybefriender.org'>chat</a> and I'll help.</p>"
            "<p>Most befrienders try 2–3 homes before a match — you're doing brilliantly.</p>"
        ),
    },
    {
        "stage": 4,
        "days": 10,
        "subject": "10 days, {name} — time to move on?",
        "intro": "It's been 10 days since you contacted {care_home}.",
        "waiting_tip_html": (
            "<p>Time to try another home. Come back to the "
            "<a href='https://www.yopeybefriender.org'>chat</a> and I'll find one nearby.</p>"
            "<p>Most people give up after one home. You're still going. 💪</p>"
        ),
    },
]


def render_nudge_email(stage_def: dict, user: dict, contact: dict) -> tuple[str, str, str]:
    """Render nudge email with 3-button question. Returns (subject, text, html)."""
    links = build_nudge_links(user["id"], contact["id"], stage_def["stage"])
    phone = contact.get("care_home_phone") or "not listed"
    fmt = {
        "name": user["first_name"],
        "care_home": contact["care_home_name"],
        "phone": phone,
    }
    subject = stage_def["subject"].format(**fmt)
    intro = stage_def["intro"].format(**fmt)
    question = f"Have you heard back from {contact['care_home_name']}?"

    text_body = (
        f"Hi {user['first_name']}!\n\n"
        f"{intro}\n\n"
        f"{question}\n\n"
        f"🎉 They said YES (accepted): {links['accepted_url']}\n"
        f"😔 They said NO: {links['rejected_url']}\n"
        f"⏳ Still waiting: {links['waiting_url']}\n\n"
        f"— YOPEY"
    )

    html_body = f"""<!DOCTYPE html>
<html><body style="font-family:-apple-system,system-ui,sans-serif;background:#fdf4ff;margin:0;padding:24px;color:#1f2937;">
  <div style="max-width:520px;margin:24px auto;background:white;border-radius:24px;padding:28px;box-shadow:0 4px 24px rgba(124,58,237,0.1);">
    <p style="margin:0 0 12px;font-size:16px;">Hi {user['first_name']}!</p>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">{intro}</p>
    <p style="margin:0 0 18px;font-size:17px;font-weight:600;color:#1f2937;">{question}</p>
    <div style="text-align:center;margin:22px 0;">
      <div style="margin:6px 0;">
        <a href="{links['accepted_url']}" style="display:inline-block;padding:13px 22px;background:#10b981;color:white;text-decoration:none;border-radius:14px;font-weight:600;font-size:15px;min-width:240px;">🎉 They said YES (accepted)</a>
      </div>
      <div style="margin:6px 0;">
        <a href="{links['rejected_url']}" style="display:inline-block;padding:13px 22px;background:#f3f4f6;color:#374151;text-decoration:none;border-radius:14px;font-weight:600;font-size:15px;border:1px solid #e5e7eb;min-width:240px;">😔 They said NO</a>
      </div>
      <div style="margin:6px 0;">
        <a href="{links['waiting_url']}" style="display:inline-block;padding:13px 22px;background:#7c3aed;color:white;text-decoration:none;border-radius:14px;font-weight:600;font-size:15px;min-width:240px;">⏳ Still waiting</a>
      </div>
    </div>
    <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;text-align:center;">— YOPEY Befriender · hello@yopey.org</p>
  </div>
</body></html>"""

    return subject, text_body, html_body


# ============================================================
# POST-ACCEPTANCE EMAIL DRIP
# Fires when Tony marks a contact as accepted. The Day-0 welcome
# goes out immediately; subsequent emails fire via the daily cron
# as days_since_match crosses each threshold.
# ============================================================

# ----- HMAC tokens for clickable email links -----
# Each payload has a "k" (kind) field that the /r/{token} handler dispatches on:
#   k=pm     → post-match yes/no             {u, s, a}
#   k=out    → care home outcome from nudge  {u, c, o}    o ∈ accepted|rejected
#   k=wait   → "still waiting" nudge ack     {u, c, stage}

def make_token(payload: dict) -> str:
    """Sign a JSON payload so we can verify clicks came from our emails."""
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    sig = hmac.new(EMAIL_TOKEN_SECRET.encode(), msg, hashlib.sha256).digest()[:18]
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    msg_b64 = base64.urlsafe_b64encode(msg).rstrip(b"=").decode()
    return f"{sig_b64}.{msg_b64}"


def verify_token(token: str) -> Optional[dict]:
    try:
        sig_b64, msg_b64 = token.split(".", 1)
        msg = base64.urlsafe_b64decode(msg_b64 + "==")
        expected = hmac.new(EMAIL_TOKEN_SECRET.encode(), msg, hashlib.sha256).digest()[:18]
        expected_b64 = base64.urlsafe_b64encode(expected).rstrip(b"=").decode()
        if not hmac.compare_digest(sig_b64, expected_b64):
            return None
        return json.loads(msg.decode())
    except Exception:
        return None


# ----- Short post-match emails, each with a single yes/no question -----

POST_MATCH_SCHEDULE = [
    {
        "stage": 1,
        "days": 0,
        "subject": "🎉 You're in, {name}!",
        "question": "Has the care home manager talked you through the DBS check?",
        "yes_label": "✅ Yes, sorted",
        "no_label": "❌ No, help",
        "intro": (
            "{care_home} said YES! You're a YOPEY Befriender 🎉\n\n"
            "One thing to sort before your first visit: a DBS check "
            "(free for volunteers). Your care home manager will normally arrange it."
        ),
    },
    {
        "stage": 2,
        "days": 2,
        "subject": "Feeling nervous about your first visit?",
        "question": "Feeling a bit nervous about visiting {care_home}?",
        "yes_label": "😅 A bit",
        "no_label": "😎 I'm fine",
        "intro": "Your first visit is coming up.",
    },
    {
        "stage": 3,
        "days": 7,
        "subject": "How did the first visit go?",
        "question": "How was your first visit to {care_home}?",
        "yes_label": "🌟 Went well",
        "no_label": "😬 Bit tricky",
        "intro": "Hope you've had your first visit by now!",
    },
    {
        "stage": 4,
        "days": 14,
        "subject": "Want some next-level tips?",
        "question": "Want some next-level befriender tips?",
        "yes_label": "👍 Yes please",
        "no_label": "🙂 I'm good",
        "intro": "Two weeks in — well done!",
    },
    {
        "stage": 5,
        "days": 30,
        "subject": "One month in! 🎉",
        "question": "Still loving it after your first month?",
        "yes_label": "💜 Going strong",
        "no_label": "😴 Need a break",
        "intro": "You've been a YOPEY Befriender for a month. That genuinely matters.",
    },
]


# Branched follow-up content shown on the response page after they click Yes/No
POST_MATCH_RESPONSES = {
    (1, "yes"): {
        "title": "Brilliant! 🎉",
        "html": """
            <p>DBS is sorted — hardest bit done!</p>
            <p><strong>This week, do these two short things:</strong></p>
            <ol>
              <li>Watch the <a href="https://www.youtube.com/watch?v=nmeWyo_wqrg">Bookcase Analogy video</a> (5 min)</li>
              <li>Become a <a href="https://www.dementiafriends.org.uk/">Dementia Friend</a> (15 min, free)</li>
            </ol>
            <p>I'll email again before your first visit.</p>
        """,
    },
    (1, "no"): {
        "title": "No worries — we'll help!",
        "html": """
            <p>DBS is just a quick background check, <strong>free for volunteers</strong>.</p>
            <p>Email Tony with subject <strong>"DBS help"</strong> and he'll sort it:</p>
            <p>👉 <a href="mailto:hello@yopey.org?subject=DBS%20help">hello@yopey.org</a><br>
               or call <strong>01440 821654</strong></p>
        """,
    },
    (2, "yes"): {
        "title": "Everyone is, on day one. 💜",
        "html": """
            <p>Three things that genuinely help:</p>
            <ul>
              <li><strong>Approach slowly from the front</strong> — don't startle them</li>
              <li><strong>Sit at their eye level</strong> — pull up a chair, don't stand over them</li>
              <li><strong>Smile and speak slowly</strong> — not louder, slower</li>
            </ul>
            <p>You've got this. Silences are fine, by the way — you don't need to fill them.</p>
        """,
    },
    (2, "no"): {
        "title": "Brilliant! 😎",
        "html": """
            <p>Just remember the basics: <strong>smile, eye level, take your time</strong>.</p>
            <p>The rest comes naturally. Enjoy it!</p>
        """,
    },
    (3, "yes"): {
        "title": "Amazing! 🌟",
        "html": """
            <p>For next time, try one of these (especially good if they have dementia — long-term memory is usually preserved):</p>
            <ul>
              <li>"What's your first childhood memory?"</li>
              <li>"What was your first job?"</li>
              <li>"Do you have a favourite song?"</li>
              <li>"Where did you grow up?"</li>
            </ul>
            <p>Don't forget to <a href="https://www.yopeybefriender.org">log your visit</a>!</p>
        """,
    },
    (3, "no"): {
        "title": "Totally normal. 💜",
        "html": """
            <p>First visits often feel awkward. It gets easier — promise.</p>
            <p><strong>Next time, try:</strong></p>
            <ul>
              <li>Just sit and smile. Presence > words.</li>
              <li>Ask about their <strong>distant past</strong> — school, first job, family</li>
              <li>If they repeat themselves, answer warmly each time — that's the dementia, not them</li>
            </ul>
            <p>You showed up. That's the bit most people never do.</p>
        """,
    },
    (4, "yes"): {
        "title": "Two people to follow 🚀",
        "html": """
            <p><strong>Adria Thompson</strong> (YouTube) — search <em>"why we should talk about dementia"</em>. She'll change how you see it.</p>
            <p><strong>Bailey Greetham-Clark</strong> (Instagram: <a href="https://www.instagram.com/bailey_greetham">@bailey_greetham</a>) — watch how he chats to residents. Joyful and natural.</p>
            <p>Also: if your care home offers any training, take it — free CV material.</p>
        """,
    },
    (4, "no"): {
        "title": "Sweet! 🙂",
        "html": """
            <p>Just keep showing up. That's the whole job.</p>
            <p>And don't forget to <a href="https://www.yopeybefriender.org">log each visit</a> — Tony loves reading the reports.</p>
        """,
    },
    (5, "yes"): {
        "title": "Going strong! 💜",
        "html": """
            <p>Two quick things you could do next:</p>
            <ul>
              <li><strong>Bring a friend</strong> — forward <a href="https://www.yopeybefriender.org">yopeybefriender.org</a> to anyone 16+</li>
              <li><strong>Share a moment</strong> on social — tag <strong>@yopeybefriender</strong>. Even a couple of lines about a resident helps inspire other young people.</li>
            </ul>
            <p>Thank you for showing up. Really.</p>
        """,
    },
    (5, "no"): {
        "title": "No problem at all.",
        "html": """
            <p>Take the time you need. Volunteering should never feel like a job.</p>
            <p>Email <a href="mailto:hello@yopey.org">hello@yopey.org</a> when you're ready to come back — or just to chat.</p>
            <p>You've done more than most people ever do. 💜</p>
        """,
    },
}


# Wrapper for the response page shown when teens click Yes/No
RESPONSE_PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>YOPEY Befriender</title>
<style>
  body {{
    font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif;
    background: #fdf4ff;
    margin: 0;
    padding: 24px;
    color: #1f2937;
    -webkit-font-smoothing: antialiased;
  }}
  .card {{
    max-width: 520px;
    margin: 40px auto;
    background: white;
    border-radius: 24px;
    padding: 32px 28px;
    box-shadow: 0 8px 32px rgba(124,58,237,0.12);
    border: 1px solid #ede9fe;
  }}
  h1 {{
    color: #7c3aed;
    margin: 0 0 16px;
    font-size: 26px;
    line-height: 1.2;
  }}
  p, li {{ line-height: 1.6; margin: 0 0 12px; font-size: 16px; }}
  ul, ol {{ padding-left: 22px; margin: 0 0 16px; }}
  a {{ color: #7c3aed; }}
  .brand {{
    text-align: center;
    font-weight: 700;
    color: #6d28d9;
    margin: 0 0 24px;
    letter-spacing: 0.5px;
  }}
  .footer {{
    text-align: center;
    color: #9ca3af;
    font-size: 13px;
    margin-top: 32px;
    line-height: 1.6;
  }}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">YOPEY BEFRIENDER</div>
    <h1>{title}</h1>
    {body}
    <div class="footer">
      Questions? hello@yopey.org · 01440 821654<br>
      Registered charity 1145573
    </div>
  </div>
</body>
</html>
"""

RESPONSE_PAGE_INVALID = RESPONSE_PAGE_TEMPLATE.format(
    title="Hmm, that link's expired",
    body="<p>This response link is either invalid or has already been used. "
         "If you meant to reply, email <a href='mailto:hello@yopey.org'>hello@yopey.org</a> "
         "and Tony will sort it.</p>",
)


def build_response_links(user_id: str, stage: int) -> dict:
    yes_token = make_token({"k": "pm", "u": user_id, "s": stage, "a": "yes"})
    no_token = make_token({"k": "pm", "u": user_id, "s": stage, "a": "no"})
    return {
        "yes_url": f"{APP_BASE_URL}/r/{yes_token}",
        "no_url": f"{APP_BASE_URL}/r/{no_token}",
    }


def build_nudge_links(user_id: str, contact_id: str, stage: int) -> dict:
    """Three-button nudge: 'said yes', 'said no', 'still waiting'."""
    accepted = make_token({"k": "out", "u": user_id, "c": contact_id, "o": "accepted"})
    rejected = make_token({"k": "out", "u": user_id, "c": contact_id, "o": "rejected"})
    waiting = make_token({"k": "wait", "u": user_id, "c": contact_id, "stage": stage})
    return {
        "accepted_url": f"{APP_BASE_URL}/r/{accepted}",
        "rejected_url": f"{APP_BASE_URL}/r/{rejected}",
        "waiting_url": f"{APP_BASE_URL}/r/{waiting}",
    }


def render_post_match_email(stage_def: dict, user: dict, contact: dict) -> tuple[str, str, str]:
    """Returns (subject, text_body, html_body)."""
    links = build_response_links(user["id"], stage_def["stage"])
    fmt = {
        "name": user["first_name"],
        "care_home": contact["care_home_name"],
    }
    subject = stage_def["subject"].format(**fmt)
    intro = stage_def["intro"].format(**fmt)
    question = stage_def["question"].format(**fmt)

    text_body = (
        f"Hi {user['first_name']}!\n\n"
        f"{intro}\n\n"
        f"{question}\n\n"
        f"{stage_def['yes_label']}: {links['yes_url']}\n"
        f"{stage_def['no_label']}: {links['no_url']}\n\n"
        f"— YOPEY"
    )

    html_body = f"""<!DOCTYPE html>
<html><body style="font-family:-apple-system,system-ui,sans-serif;background:#fdf4ff;margin:0;padding:24px;color:#1f2937;">
  <div style="max-width:520px;margin:24px auto;background:white;border-radius:24px;padding:28px;box-shadow:0 4px 24px rgba(124,58,237,0.1);">
    <p style="margin:0 0 12px;font-size:16px;">Hi {user['first_name']}!</p>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">{intro.replace(chr(10)+chr(10), '</p><p style="margin:0 0 18px;font-size:16px;line-height:1.6;">')}</p>
    <p style="margin:0 0 18px;font-size:17px;font-weight:600;color:#1f2937;">{question}</p>
    <div style="text-align:center;margin:26px 0;">
      <a href="{links['yes_url']}" style="display:inline-block;padding:14px 26px;background:#7c3aed;color:white;text-decoration:none;border-radius:14px;font-weight:600;font-size:16px;margin:6px;">{stage_def['yes_label']}</a>
      <a href="{links['no_url']}" style="display:inline-block;padding:14px 26px;background:#f3f4f6;color:#374151;text-decoration:none;border-radius:14px;font-weight:600;font-size:16px;margin:6px;border:1px solid #e5e7eb;">{stage_def['no_label']}</a>
    </div>
    <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;text-align:center;">— YOPEY Befriender · hello@yopey.org</p>
  </div>
</body></html>"""

    return subject, text_body, html_body


def send_post_match_email(user: dict, contact: dict, stage_idx: int) -> bool:
    """Send one stage of the post-match drip. Returns True if sent."""
    stage_def = POST_MATCH_SCHEDULE[stage_idx]
    if not user.get("email"):
        print(f"[post-match] user {user['id']} has no email, skipping stage {stage_def['stage']}")
        return False
    subject, text_body, html_body = render_post_match_email(stage_def, user, contact)
    return send_email(user["email"], subject, text_body, html=html_body)


def send_post_match_welcome(user_id: str, contact: dict) -> None:
    """
    Fire the Day-0 welcome immediately when Tony marks a contact accepted.
    Sets matched_at and bumps post_match_stage to 1.
    """
    user = get_user(user_id)
    if not user:
        return
    if user.get("post_match_stage", 0) >= 1:
        return  # already welcomed (e.g. previous match)

    if send_post_match_email(user, contact, stage_idx=0):
        update_user(
            user_id,
            post_match_stage=1,
            matched_at=_now_iso(),
            status="matched",
        )
        print(f"[post-match] Welcome sent to {user['email']} for {contact['care_home_name']}")


def send_post_match_drip() -> int:
    """
    Daily cron: walks users with status='matched' whose next stage email is due
    based on matched_at. Sends at most one email per user per run.
    Returns count sent.
    """
    if not supabase:
        return 0
    now = datetime.now(timezone.utc)
    sent_count = 0

    res = (
        supabase.table("users")
        .select("*")
        .eq("status", "matched")
        .lt("post_match_stage", 5)
        .gte("post_match_stage", 1)
        .execute()
    )

    for user in res.data:
        if not user.get("matched_at") or not user.get("email"):
            continue
        try:
            matched_at = datetime.fromisoformat(user["matched_at"].replace("Z", "+00:00"))
        except Exception:
            continue
        if matched_at.tzinfo is None:
            matched_at = matched_at.replace(tzinfo=timezone.utc)
        days_since = (now - matched_at).days
        current_stage = user["post_match_stage"]

        # Find the accepted contact for this user — for the care home name
        c = (
            supabase.table("contacts")
            .select("*")
            .eq("user_id", user["id"])
            .eq("outcome", "accepted")
            .order("contacted_at", desc=True)
            .limit(1)
            .execute()
        )
        if not c.data:
            continue
        contact = c.data[0]

        # Find next due stage
        for stage_idx, nudge in enumerate(POST_MATCH_SCHEDULE):
            if nudge["stage"] == current_stage + 1 and days_since >= nudge["days"]:
                if send_post_match_email(user, contact, stage_idx):
                    update_user(user["id"], post_match_stage=nudge["stage"])
                    sent_count += 1
                    print(
                        f"[post-match] Stage {nudge['stage']} sent to {user['email']} "
                        f"({nudge['days']} days since match)"
                    )
                break

    return sent_count


def send_email(to_email: str, subject: str, body: str, html: Optional[str] = None) -> bool:
    """Send via Resend (text + optional HTML). Returns True on success."""
    if not RESEND_API_KEY:
        print(f"[email] No RESEND_API_KEY — would have sent to {to_email}: {subject}")
        return False
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        payload: dict[str, Any] = {
            "from": EMAIL_FROM,
            "to": [to_email],
            "subject": subject,
            "text": body,
        }
        if html:
            payload["html"] = html
        resend.Emails.send(payload)
        return True
    except Exception as e:
        print(f"[email] Failed to send to {to_email}: {e}")
        return False


def send_nudge_reminders() -> int:
    """Daily cron job. Returns number of nudges sent."""
    if not supabase:
        return 0
    now = datetime.now(timezone.utc)
    sent_count = 0

    # Include id explicitly so we can pass to the renderer
    result = (
        supabase.table("contacts")
        .select("*, users(id, first_name, email)")
        .eq("reply_received", False)
        .lt("nudge_stage", 4)
        .execute()
    )

    for contact in result.data:
        user = contact.get("users")
        if not user or not user.get("email"):
            continue

        contacted_at_str = contact["contacted_at"].replace("Z", "+00:00")
        contacted_at = datetime.fromisoformat(contacted_at_str)
        if contacted_at.tzinfo is None:
            contacted_at = contacted_at.replace(tzinfo=timezone.utc)
        days_waiting = (now - contacted_at).days
        current_stage = contact["nudge_stage"]

        for stage_def in NUDGE_SCHEDULE:
            if stage_def["stage"] == current_stage + 1 and days_waiting >= stage_def["days"]:
                subject, text_body, html_body = render_nudge_email(stage_def, user, contact)
                if send_email(user["email"], subject, text_body, html=html_body):
                    supabase.table("contacts").update(
                        {"nudge_stage": stage_def["stage"]}
                    ).eq("id", contact["id"]).execute()
                    sent_count += 1
                    print(
                        f"[nudge] Stage {stage_def['stage']} sent to {user['email']} "
                        f"re {contact['care_home_name']}"
                    )
                break

    return sent_count


# ============================================================
# PART 5: CHAT ENGINE
# ============================================================

def execute_tool(tool_name: str, args: dict, user_id: str) -> str:
    if tool_name == "search_care_homes":
        results = search_care_homes(
            postcode=args["postcode"],
            radius_miles=args.get("radius_miles", 10),
            max_results=args.get("max_results", 5),
        )
        return json.dumps(results)

    if tool_name == "save_user_details":
        clean = {k: v for k, v in args.items() if v}
        if clean:
            update_user(user_id, **clean)
        return json.dumps({"status": "saved", "fields": list(clean.keys())})

    if tool_name == "find_care_home_email":
        result = find_email_via_web_search(
            care_home_name=args["care_home_name"],
            town_or_postcode=args.get("town_or_postcode"),
            manager_name=args.get("manager_name"),
        )
        return json.dumps(result)

    if tool_name == "mark_care_home_replied":
        care_home_name = args["care_home_name"]
        outcome = args["outcome"]
        # Find the most-recent contact for this user + care home
        match = (
            supabase.table("contacts")
            .select("*")
            .eq("user_id", user_id)
            .ilike("care_home_name", care_home_name)
            .order("contacted_at", desc=True)
            .limit(1)
            .execute()
        )
        if not match.data:
            return json.dumps({
                "error": (
                    f"No existing contact found for '{care_home_name}'. "
                    "If they emailed a new care home directly, log it first with log_care_home_contact."
                )
            })
        contact = match.data[0]
        if contact.get("reply_received"):
            return json.dumps({
                "status": "already_recorded",
                "previous_outcome": contact.get("outcome"),
            })
        supabase.table("contacts").update(
            {"reply_received": True, "outcome": outcome}
        ).eq("id", contact["id"]).execute()
        if outcome == "accepted":
            send_post_match_welcome(user_id, contact)
            return json.dumps({
                "status": "accepted",
                "message": "Marked as accepted. Welcome email + first-visit tips sent.",
            })
        update_user(user_id, status="searching")
        return json.dumps({
            "status": "rejected",
            "message": "Marked as rejected. Reminders stopped. User back to 'searching'.",
        })

    if tool_name == "log_care_home_contact":
        log_contact(
            user_id=user_id,
            care_home_name=args["care_home_name"],
            phone=args.get("care_home_phone"),
            address=args.get("care_home_address"),
            method=args.get("method", "email"),
        )
        return json.dumps({"status": "logged", "message": "Contact recorded. Reminders activated."})

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


def _trim_history(history: list, max_messages: int = MAX_LLM_HISTORY) -> list:
    """Keep the most recent messages, but never split a tool_calls/tool pair."""
    if len(history) <= max_messages:
        return history
    trimmed = history[-max_messages:]
    # If the trimmed window starts with an orphan 'tool' message, drop it.
    while trimmed and trimmed[0].get("role") == "tool":
        trimmed = trimmed[1:]
    return trimmed


def _build_contacts_context(user_id: str) -> str:
    """Render this user's care home contacts as a short prompt block for the bot."""
    if not supabase:
        return ""
    try:
        res = (
            supabase.table("contacts")
            .select("care_home_name, care_home_phone, contacted_at, reply_received, outcome")
            .eq("user_id", user_id)
            .order("contacted_at", desc=True)
            .limit(10)
            .execute()
        )
    except Exception:
        return ""
    if not res.data:
        return ""

    now = datetime.now(timezone.utc)
    waiting_lines: list[str] = []
    settled_lines: list[str] = []
    for c in res.data:
        try:
            contacted_at = datetime.fromisoformat(c["contacted_at"].replace("Z", "+00:00"))
            if contacted_at.tzinfo is None:
                contacted_at = contacted_at.replace(tzinfo=timezone.utc)
            days_ago = (now - contacted_at).days
        except Exception:
            days_ago = 0

        if c.get("reply_received"):
            settled_lines.append(
                f" • {c['care_home_name']} — REPLIED ({c.get('outcome') or 'unknown'})"
            )
        else:
            phone = c.get("care_home_phone") or "no phone on file"
            waiting_lines.append(
                f" • {c['care_home_name']} — awaiting reply (day {days_ago}, {phone})"
            )

    parts = []
    if waiting_lines:
        parts.append(
            "Care homes AWAITING REPLY (use these when they say they heard back, "
            "and ask which one if there's more than one):\n" + "\n".join(waiting_lines)
        )
    if settled_lines:
        parts.append("Care homes ALREADY REPLIED:\n" + "\n".join(settled_lines))

    return "\n\n== CARE HOMES THEY'VE CONTACTED ==\n" + "\n\n".join(parts)


def chat(user_message: str, user_id: str) -> str:
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found. Please complete onboarding first.")

    history = load_conversation(user_id)
    history.append({"role": "user", "content": user_message})

    # Bot-personalised system prompt: inject user's known details + contacts
    sys_prompt = (
        SYSTEM_PROMPT
        + f"\n\n== KNOWN USER DETAILS ==\n"
        + f"First name: {user.get('first_name')}\n"
        + f"Age: {user.get('age')}\n"
        + (f"Surname: {user.get('surname')}\n" if user.get("surname") else "")
        + (f"Email: {user.get('email')}\n" if user.get("email") else "")
        + (f"Postcode: {user.get('postcode')}\n" if user.get("postcode") else "")
        + _build_contacts_context(user_id)
    )

    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": sys_prompt}, *_trim_history(history)],
        tools=TOOLS,
        tool_choice="auto",
        temperature=0.7,
        max_tokens=800,
    )

    message = response.choices[0].message

    if message.tool_calls:
        history.append({
            "role": "assistant",
            "content": message.content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in message.tool_calls
            ],
        })

        for tool_call in message.tool_calls:
            args = json.loads(tool_call.function.arguments)
            result = execute_tool(tool_call.function.name, args, user_id)
            history.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

        follow_up = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": sys_prompt}, *_trim_history(history)],
            temperature=0.7,
            max_tokens=800,
        )
        assistant_reply = follow_up.choices[0].message.content or ""
    else:
        assistant_reply = message.content or ""

    history.append({"role": "assistant", "content": assistant_reply})
    save_conversation(user_id, history)
    return assistant_reply


# ============================================================
# PART 6: WEB API
# ============================================================

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="YOPEY Befriender AI")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Pydantic schemas ----

class OnboardRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    age: int = Field(ge=16, le=120, description="Must be 16 or older")
    utm_source: Optional[str] = None


class OnboardResponse(BaseModel):
    user_id: str
    first_name: str


class ChatRequest(BaseModel):
    user_id: str
    message: str = Field(min_length=1, max_length=2000)


class ChatResponse(BaseModel):
    reply: str


class MarkReplyRequest(BaseModel):
    contact_id: str
    outcome: str  # 'accepted' or 'rejected'


# ---- Dashboard auth ----

def require_dashboard_auth(x_dashboard_password: str = Header(default="")) -> None:
    if x_dashboard_password != DASHBOARD_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password")


# ---- Public endpoints ----

@app.get("/health")
def health():
    return {"ok": True}


def _record_email_response(user_id: str, stage: int, answer: str) -> None:
    if not supabase:
        return
    try:
        existing = (
            supabase.table("email_responses")
            .select("id")
            .eq("user_id", user_id)
            .eq("stage", stage)
            .limit(1)
            .execute()
        )
        if not existing.data:
            supabase.table("email_responses").insert({
                "user_id": user_id,
                "stage": stage,
                "answer": answer,
            }).execute()
    except Exception as e:
        print(f"[email-response] record failed: {e}")


def _handle_post_match_click(data: dict) -> HTMLResponse:
    user_id = data["u"]
    stage = data["s"]
    answer = data["a"]
    _record_email_response(user_id, stage, answer)
    branch = POST_MATCH_RESPONSES.get((stage, answer))
    if not branch:
        return HTMLResponse(content=RESPONSE_PAGE_INVALID, status_code=404)
    html = RESPONSE_PAGE_TEMPLATE.format(title=branch["title"], body=branch["html"])
    return HTMLResponse(content=html)


def _handle_outcome_click(data: dict) -> HTMLResponse:
    """Teen clicked 'They said yes / no' on a nudge email."""
    user_id = data["u"]
    contact_id = data["c"]
    outcome = data["o"]
    if outcome not in ("accepted", "rejected") or not supabase:
        return HTMLResponse(content=RESPONSE_PAGE_INVALID, status_code=400)

    contact_res = (
        supabase.table("contacts")
        .select("*")
        .eq("id", contact_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not contact_res.data:
        return HTMLResponse(content=RESPONSE_PAGE_INVALID, status_code=404)
    contact = contact_res.data[0]

    # Idempotent: don't double-trigger if they click twice
    if not contact.get("reply_received"):
        supabase.table("contacts").update(
            {"reply_received": True, "outcome": outcome}
        ).eq("id", contact_id).execute()

        if outcome == "accepted":
            send_post_match_welcome(user_id, contact)
        else:
            update_user(user_id, status="searching")

    if outcome == "accepted":
        return HTMLResponse(content=RESPONSE_PAGE_TEMPLATE.format(
            title="Brilliant news! 🎉",
            body=(
                f"<p>Amazing — <strong>{contact['care_home_name']}</strong> said yes!</p>"
                f"<p>I've just sent you another email with everything you need before "
                f"your first visit (DBS check, training videos, conversation starters). "
                f"Keep an eye on your inbox.</p>"
            ),
        ))
    return HTMLResponse(content=RESPONSE_PAGE_TEMPLATE.format(
        title="That's so normal!",
        body=(
            f"<p>Lots of homes can't take new visitors right now — it doesn't mean "
            f"anything about you.</p>"
            f"<p>Let's try the next one. Come back to the chat and I'll find you another "
            f"home nearby:</p>"
            f"<p>👉 <a href='https://www.yopeybefriender.org'>yopeybefriender.org</a></p>"
            f"<p>Most successful befrienders tried 2 or 3 homes before finding the right "
            f"one. You're doing brilliantly. 💪</p>"
        ),
    ))


# 'Still waiting' tip per nudge stage, by stage number
NUDGE_WAITING_PAGES = {
    1: {
        "title": "OK — still early!",
        "html": (
            "<p>It's still totally normal at 3 days. Give it a few more.</p>"
            "<p>Quick thing to do while you wait: become a "
            "<a href='https://www.dementiafriends.org.uk/'>Dementia Friend</a> (15 min, free). "
            "Watch the video and you'll get a badge.</p>"
        ),
    },
    2: {
        "title": "Try a quick call?",
        "html": (
            "<p>Sometimes emails get lost — a phone call usually sorts it.</p>"
            "<p>Just say: <em>\"I sent an email about volunteering as a YOPEY Befriender — "
            "did the manager get it?\"</em></p>"
            "<p>Care home staff are usually really friendly. You've got this!</p>"
        ),
    },
    3: {
        "title": "Two options",
        "html": (
            "<p>1) <strong>Call them</strong> — emails get lost, calls don't</p>"
            "<p>2) <strong>Try the next care home</strong> — come back to the "
            "<a href='https://www.yopeybefriender.org'>chat</a> and I'll help draft another email.</p>"
            "<p>Most befrienders tried 2–3 homes before a match.</p>"
        ),
    },
    4: {
        "title": "Time to try another?",
        "html": (
            "<p>10 days is a fair time to wait. Come back to the chat and I'll find "
            "you another home nearby:</p>"
            "<p>👉 <a href='https://www.yopeybefriender.org'>yopeybefriender.org</a></p>"
            "<p>Most people give up after one home. You're still going. 💪</p>"
        ),
    },
}


def _handle_waiting_click(data: dict) -> HTMLResponse:
    user_id = data["u"]
    stage = data.get("stage", 0)
    _record_email_response(user_id, stage + 100, "waiting")  # +100 so it doesn't collide with post-match stages
    page = NUDGE_WAITING_PAGES.get(stage)
    if not page:
        return HTMLResponse(content=RESPONSE_PAGE_INVALID, status_code=404)
    return HTMLResponse(content=RESPONSE_PAGE_TEMPLATE.format(
        title=page["title"], body=page["html"]
    ))


@app.get("/r/{token}", response_class=HTMLResponse)
def email_response(token: str):
    """Dispatches clicks from email buttons to the right handler."""
    data = verify_token(token)
    if not data:
        return HTMLResponse(content=RESPONSE_PAGE_INVALID, status_code=400)

    kind = data.get("k")
    if kind == "pm":
        return _handle_post_match_click(data)
    if kind == "out":
        return _handle_outcome_click(data)
    if kind == "wait":
        return _handle_waiting_click(data)

    return HTMLResponse(content=RESPONSE_PAGE_INVALID, status_code=400)


@app.post("/api/onboard", response_model=OnboardResponse)
def onboard_endpoint(req: OnboardRequest):
    """Called by the pre-chat form. Creates user record."""
    _require_services()
    try:
        user = create_user(first_name=req.first_name, age=req.age, utm_source=req.utm_source)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create user: {e}")
    return OnboardResponse(user_id=user["id"], first_name=user["first_name"])


@app.post("/api/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
def chat_endpoint(req: ChatRequest, request: Request):
    """Main chat endpoint for the frontend widget."""
    _require_services()
    reply = chat(req.message, req.user_id)
    return ChatResponse(reply=reply)


# ---- Dashboard endpoints (password-protected) ----

@app.get("/api/dashboard/summary", dependencies=[Depends(require_dashboard_auth)])
def dashboard_summary():
    users = supabase.table("users").select("id, status, age, created_at").execute()
    contacts = supabase.table("contacts").select("id, outcome, reply_received").execute()

    by_status: dict[str, int] = {}
    for u in users.data:
        s = u.get("status") or "new"
        by_status[s] = by_status.get(s, 0) + 1

    outcomes = {"waiting": 0, "accepted": 0, "rejected": 0}
    for c in contacts.data:
        if c.get("reply_received"):
            o = c.get("outcome") or "rejected"
            outcomes[o] = outcomes.get(o, 0) + 1
        else:
            outcomes["waiting"] += 1

    # Signups last 30 days
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    recent = sum(1 for u in users.data if u.get("created_at", "") >= cutoff)

    return {
        "total_young_people": len(users.data),
        "signups_last_30_days": recent,
        "by_status": by_status,
        "contacts": {
            "total": len(contacts.data),
            "waiting_for_reply": outcomes["waiting"],
            "accepted": outcomes["accepted"],
            "rejected": outcomes["rejected"],
        },
    }


@app.get("/api/dashboard/users", dependencies=[Depends(require_dashboard_auth)])
def dashboard_users():
    res = supabase.table("dashboard_all_users").select("*").limit(500).execute()
    return res.data


@app.get("/api/dashboard/waiting", dependencies=[Depends(require_dashboard_auth)])
def dashboard_waiting():
    res = supabase.table("dashboard_waiting").select("*").limit(500).execute()
    return res.data


@app.get("/api/dashboard/stuck", dependencies=[Depends(require_dashboard_auth)])
def dashboard_stuck():
    res = supabase.table("dashboard_stuck").select("*").limit(500).execute()
    return res.data


@app.get("/api/dashboard/matched", dependencies=[Depends(require_dashboard_auth)])
def dashboard_matched():
    res = supabase.table("dashboard_matched").select("*").limit(500).execute()
    return res.data


@app.post("/api/dashboard/mark-reply", dependencies=[Depends(require_dashboard_auth)])
def mark_reply(req: MarkReplyRequest):
    if req.outcome not in ("accepted", "rejected"):
        raise HTTPException(status_code=400, detail="outcome must be 'accepted' or 'rejected'")

    contact_res = (
        supabase.table("contacts").select("*").eq("id", req.contact_id).execute()
    )
    if not contact_res.data:
        raise HTTPException(status_code=404, detail="Contact not found")
    contact = contact_res.data[0]
    user_id = contact["user_id"]

    supabase.table("contacts").update(
        {"reply_received": True, "outcome": req.outcome}
    ).eq("id", req.contact_id).execute()

    if req.outcome == "accepted":
        # Send Day-0 welcome email immediately and start the post-match drip.
        # Internally updates user.status='matched', sets matched_at, bumps stage.
        send_post_match_welcome(user_id, contact)
    else:
        update_user(user_id, status="searching")

    return {"status": "updated"}


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    if "--nudge" in sys.argv:
        print("Running pre-reply nudge reminders...")
        nudges = send_nudge_reminders()
        print(f"  → sent {nudges} pre-reply nudges")
        print("Running post-match drip...")
        drip = send_post_match_drip()
        print(f"  → sent {drip} post-match emails")
        print(f"Done. Total: {nudges + drip} emails sent.")
    else:
        import uvicorn
        port = int(os.environ.get("PORT", "8000"))
        uvicorn.run(app, host="0.0.0.0", port=port)
