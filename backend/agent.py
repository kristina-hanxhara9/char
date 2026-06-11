"""
YOPEY Befriender AI Agent
=========================
FastAPI backend with: Supabase database, Gemini chat with tool use,
live CQC care home search, escalating nudge reminders (3/5/7/10 days),
and dashboard endpoints.
"""

import base64
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import socket
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional, Union

import requests
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
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
    if not v or v.startswith(("xxxx", "sk-...", "AIza...", "AQ.xxxx", "re_...", "eyJ...", "https://xxxx")):
        return None
    return v


GEMINI_KEY = _real_env("GEMINI_API_KEY")
SUPABASE_URL = _real_env("SUPABASE_URL")
SUPABASE_KEY = _real_env("SUPABASE_KEY")
RESEND_API_KEY = _real_env("RESEND_API_KEY")
CRON_SECRET = _real_env("CRON_SECRET")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "YOPEY Befriender <hello@yopey.org>")
CQC_PARTNER_CODE = os.environ.get("CQC_PARTNER_CODE", "").strip()
# Subscription key from CQC API portal (apply at api-portal.service.cqc.org.uk).
# Without this, CQC returns 403 — we fall back to Gemini web search.
CQC_SUBSCRIPTION_KEY = os.environ.get("CQC_SUBSCRIPTION_KEY", "").strip()
DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "changeme")
EMAIL_TOKEN_SECRET = os.environ.get("EMAIL_TOKEN_SECRET") or DASHBOARD_PASSWORD
# Where safeguarding escalations are emailed. Should be YOPEY's named
# safeguarding lead. Falls back to EMAIL_FROM's inbox if unset (better than
# dropping the alert, but the lead should be set explicitly).
SAFEGUARDING_EMAIL = os.environ.get("SAFEGUARDING_EMAIL", "").strip()
# Teen-FACING safeguarding contact — a real person at YOPEY the bot points the
# young person to (distinct from SAFEGUARDING_EMAIL, which is the internal
# escalation inbox and is NOT shown to teens). Set to the named DSL.
YOPEY_SAFEGUARDING_CONTACT = os.environ.get(
    "YOPEY_SAFEGUARDING_CONTACT",
    "YOPEY — email hello@yopey.org or call 01440 821654 and ask for the safeguarding lead",
).strip()
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:8000").rstrip("/")
# Public URL of the FRONTEND — used to build magic-link return URLs in emails.
FRONTEND_BASE_URL = os.environ.get(
    "FRONTEND_BASE_URL", "https://yopey-befriender.vercel.app"
).rstrip("/")
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
]

if not (GEMINI_KEY and SUPABASE_URL and SUPABASE_KEY):
    print(
        "[warn] Missing real GEMINI_API_KEY / SUPABASE_URL / SUPABASE_KEY — "
        "server will start but /api/onboard and /api/chat will return 503."
    )

# Gemini can't combine google_search grounding with custom function
# declarations in one request, so the chat brain (custom tools only) and the
# web-search helpers (grounding only) stay on separate models and configs.
BRAIN_MODEL = "gemini-3.5-flash"        # agentic tool use + safeguarding judgement
SEARCH_MODEL = "gemini-3.1-flash-lite"  # cheap Google-Search-grounded lookups

# 60s cap: google-genai sets no default timeout, and /api/chat is synchronous
# — a hung call must not pin a worker.
_GEMINI_HTTP_OPTS = genai_types.HttpOptions(timeout=60_000)

# Which Google backend serves this key — surfaced in /health for remote diagnosis.
GEMINI_BACKEND = "unconfigured"


def _make_gemini_client() -> Optional[genai.Client]:
    """Resolve the AQ.-key ambiguity at boot: AI Studio auth keys authenticate
    against the Developer API, Vertex AI express-mode keys need vertexai=True,
    and the prefix doesn't say which. One free metadata GET tells them apart
    (the Developer API rejects foreign AQ. tokens with 401 UNAUTHENTICATED).
    Legacy AIza keys skip the probe; keyless boot stays offline-safe."""
    global GEMINI_BACKEND
    if not GEMINI_KEY:
        return None
    client = genai.Client(api_key=GEMINI_KEY, http_options=_GEMINI_HTTP_OPTS)
    GEMINI_BACKEND = "developer-api"
    if not GEMINI_KEY.startswith("AQ."):
        return client
    try:
        client.models.get(model=BRAIN_MODEL)
        print("[info] Gemini backend: Developer API (AI Studio auth key)")
        return client
    except genai_errors.APIError as e:
        if getattr(e, "code", None) in (401, 403):
            print("[info] Gemini backend: Vertex AI express mode")
            GEMINI_BACKEND = "vertex-express"
            return genai.Client(
                vertexai=True, api_key=GEMINI_KEY, http_options=_GEMINI_HTTP_OPTS
            )
        # Quota/5xx at boot: guess the Developer API rather than crash — a
        # failed boot flunks Render's health check, which silently keeps the
        # PREVIOUS build live. A wrong guess surfaces in chat logs instead.
        print(f"[warn] Gemini auth probe inconclusive ({e}); assuming Developer API")
        return client
    except Exception as e:
        print(f"[warn] Gemini auth probe failed ({e}); assuming Developer API")
        return client


gemini_client: Optional[genai.Client] = _make_gemini_client()
supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[warn] Could not init Supabase client: {e}")


def _require_services() -> None:
    if not (gemini_client and supabase):
        raise HTTPException(
            status_code=503,
            detail="Server not fully configured. Set GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY in backend/.env.",
        )

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
with open(_PROMPT_PATH, "r") as f:
    SYSTEM_PROMPT = f.read()


# Keep last N message pairs in the LLM context — bounds token cost
MAX_LLM_HISTORY = 40  # 20 user/assistant turns

GOOGLE_SEARCH_TOOL = genai_types.Tool(google_search=genai_types.GoogleSearch())


def _grounded_search(prompt: str, *, response_schema: Optional[dict] = None) -> str:
    """
    One Google-Search-grounded SEARCH_MODEL call → response text.
    `response_schema` switches on JSON mode (supported alongside grounding on
    Gemini 3 models). Raises on API errors — callers keep their own
    try/except shells and error envelopes.
    """
    config = genai_types.GenerateContentConfig(
        tools=[GOOGLE_SEARCH_TOOL],
        response_mime_type="application/json" if response_schema else None,
        response_schema=response_schema,
    )
    response = gemini_client.models.generate_content(
        model=SEARCH_MODEL, contents=prompt, config=config
    )
    return (response.text or "").strip()


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


UK_POSTCODE_PATTERN = re.compile(
    r"\b(GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b",
    re.IGNORECASE,
)


def _geocode_school_via_nominatim(school_name: str) -> Optional[dict]:
    """Stage 1: Nominatim (OSM) → lat/lng → postcodes.io reverse → postcode."""
    try:
        nom_resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": f"{school_name.strip()}, United Kingdom",
                "format": "json",
                "limit": 1,
                "countrycodes": "gb",
                "addressdetails": 0,
            },
            headers={
                "User-Agent": (
                    "YOPEY Befriender (https://www.yopeybefriender.org); "
                    "geocoding school name on behalf of a volunteer"
                )
            },
            timeout=10,
        )
        nom_data = nom_resp.json()
        if not nom_data:
            return None
        lat = float(nom_data[0]["lat"])
        lon = float(nom_data[0]["lon"])
    except Exception as e:
        print(f"[geocode] Nominatim failed: {e}")
        return None

    try:
        pc_resp = requests.get(
            "https://api.postcodes.io/postcodes",
            params={"lat": lat, "lon": lon, "limit": 1},
            timeout=10,
        )
        pc_data = pc_resp.json()
        if pc_data.get("status") != 200 or not pc_data.get("result"):
            return None
        result = pc_data["result"][0]
        return {
            "postcode": result["postcode"],
            "latitude": result["latitude"],
            "longitude": result["longitude"],
            "admin_district": result.get("admin_district"),
        }
    except Exception as e:
        print(f"[geocode] postcodes.io reverse failed: {e}")
        return None


def _geocode_school_via_web_search(school_name: str) -> Optional[dict]:
    """
    Stage 2: ask Google-Search-grounded Gemini for the school's postcode, then
    validate it via postcodes.io (so the model can't fabricate a fake postcode).
    """
    if not gemini_client:
        return None

    prompt = (
        f"What is the main UK postcode for the school, college, or university "
        f"named '{school_name.strip()}'? Search the web (their official website, "
        f"Wikipedia, gov.uk). Reply with ONLY the postcode in standard UK "
        f"format (e.g. 'L69 3BX' or 'SL4 6DW') — nothing else. If you cannot "
        f"find one with confidence, reply exactly 'UNKNOWN'. Never invent."
    )

    try:
        text = _grounded_search(prompt)
    except Exception as e:
        print(f"[geocode] Gemini web search failed: {e}")
        return None

    if "UNKNOWN" in text.upper():
        return None
    match = UK_POSTCODE_PATTERN.search(text)
    if not match:
        return None
    candidate = match.group(1).upper().strip()

    # Validate: postcodes.io confirms it's a real, currently-active postcode.
    # This catches model hallucination — a fake "AB1 2CD" will return status=404.
    validated = postcode_to_latlng(candidate)
    if "error" in validated:
        print(f"[geocode] Web search returned invalid postcode for {redact_school_name(school_name)}")
        return None
    return {
        "postcode": candidate,
        "latitude": validated["latitude"],
        "longitude": validated["longitude"],
        "admin_district": validated.get("admin_district"),
    }


def _name_key(school_name: str) -> str:
    """Cache key for school postcodes: lowercased + collapsed whitespace."""
    return re.sub(r"\s+", " ", school_name.strip().lower())


def _check_school_cache(school_name: str) -> Optional[str]:
    """Return a cached postcode for this school, or None."""
    if not supabase:
        return None
    try:
        res = (
            supabase.table("school_postcodes")
            .select("postcode")
            .eq("name_key", _name_key(school_name))
            .limit(1)
            .execute()
        )
        return res.data[0]["postcode"] if res.data else None
    except Exception:
        return None


def _save_school_cache(school_name: str, postcode: str, source: str) -> None:
    if not supabase:
        return
    try:
        supabase.table("school_postcodes").upsert({
            "name_key": _name_key(school_name),
            "postcode": postcode,
            "source": source,
        }).execute()
    except Exception as e:
        print(f"[school-cache] upsert failed: {e}")


def _geocode_school(school_name: str) -> Optional[dict]:
    """
    Resolve a UK school name to a postcode. Checks cache first, then Nominatim,
    then Gemini web search (validated against postcodes.io to prevent
    hallucination). Cached results persist across the wizard's two calls
    (geocode-school + onboard) so we don't re-pay.
    """
    if not school_name or not school_name.strip():
        return None

    # Cache: same school typed by the same teen (or a school we've seen
    # for any teen) returns its prior resolution instantly.
    cached_postcode = _check_school_cache(school_name)
    if cached_postcode:
        validated = postcode_to_latlng(cached_postcode)
        if "error" not in validated:
            return {
                "postcode": cached_postcode,
                "latitude": validated["latitude"],
                "longitude": validated["longitude"],
                "admin_district": validated.get("admin_district"),
            }

    nominatim = _geocode_school_via_nominatim(school_name)
    if nominatim:
        _save_school_cache(school_name, nominatim["postcode"], "nominatim")
        return nominatim

    print(f"[geocode] Nominatim found nothing for '{redact_school_name(school_name)}', trying web search")
    web = _geocode_school_via_web_search(school_name)
    if web:
        _save_school_cache(school_name, web["postcode"], "web_search")
        return web

    print(f"[geocode] Both stages failed for '{redact_school_name(school_name)}'")
    return None


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 3959
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def _fetch_cqc_care_homes(location: dict) -> list | dict:
    """All registered care homes in the postcode's local authority, each with
    a computed distance_miles, sorted nearest-first. Fetched ONCE so the
    dispatcher's radius widening is an in-memory filter instead of repeated
    API sweeps (serial details for a dense borough took minutes). Returns an
    {"error": ...} dict on auth/transport failure so the caller can fall back
    to web search — with a loud log if the subscription key is rejected."""
    user_lat = location["latitude"]
    user_lng = location["longitude"]
    local_authority = location["admin_district"]

    headers = {"Ocp-Apim-Subscription-Key": CQC_SUBSCRIPTION_KEY}
    common_params: dict[str, Any] = (
        {"partnerCode": CQC_PARTNER_CODE} if CQC_PARTNER_CODE else {}
    )

    # Filter by localAuthority first — drastically reduces the result set vs
    # paginating through all of England. List pages are cheap (ids only here);
    # the expensive per-home details are fetched in parallel below.
    loc_ids: list[str] = []
    seen_ids: set[str] = set()
    page = 1
    while page <= 6:
        try:
            resp = requests.get(
                "https://api.service.cqc.org.uk/public/v1/locations",
                params={
                    **common_params,
                    "careHome": "Y",
                    "page": page,
                    "perPage": 50,
                    "localAuthority": local_authority,
                },
                headers=headers,
                timeout=20,
            )
            if resp.status_code in (401, 403):
                print(
                    f"[cqc] subscription key rejected ({resp.status_code}) — "
                    "check CQC_SUBSCRIPTION_KEY in Render"
                )
                return {"error": f"CQC auth failed ({resp.status_code})", "results": []}
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            return {"error": f"CQC API error: {e}", "results": []}

        locations = data.get("locations", [])
        if not locations:
            break
        for loc in locations:
            loc_id = loc.get("locationId")
            if loc_id and loc_id not in seen_ids:
                seen_ids.add(loc_id)
                loc_ids.append(loc_id)
        page += 1

    def _detail(loc_id: str) -> Optional[dict]:
        try:
            r = requests.get(
                f"https://api.service.cqc.org.uk/public/v1/locations/{loc_id}",
                params=common_params or None,
                headers=headers,
                timeout=10,
            )
            return r.json() if r.status_code == 200 else None
        except Exception:
            return None

    care_homes: list[dict] = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        for detail in executor.map(_detail, loc_ids[:150]):
            if not detail:
                continue
            lat = detail.get("onspdLatitude")
            lng = detail.get("onspdLongitude")
            if not (lat and lng):
                continue

            distance = haversine_miles(user_lat, user_lng, lat, lng)

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
                "cqc_url": f"https://www.cqc.org.uk/location/{detail.get('locationId', '')}",
                "carehome_co_uk_url": _carehome_directory_url(
                    detail.get("name", ""), detail.get("postalCode", "")
                ),
            })

    care_homes.sort(key=lambda x: x["distance_miles"])
    return care_homes


def _extract_json_object(text: str) -> Optional[dict]:
    """
    Walk the string looking for the first balanced {...} block that parses as JSON.
    Tracks brace depth (ignoring braces inside strings) so it handles markdown
    fences, prose containing braces, and multiple JSON objects in one response.
    """
    depth = 0
    start = -1
    in_string = False
    escape = False
    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if in_string:
            if ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start != -1:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        start = -1
                        # Keep walking — there might be another candidate object
                        continue
    return None


def _parse_json_response(text: str) -> Optional[dict]:
    """
    Parse a JSON-mode model response. Should be a bare object, but fall back to
    the brace-walker for fenced or prose-wrapped output.
    """
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return _extract_json_object(text)


# Forces JSON-mode output from the grounded care-home search. Only `name` is
# required — the setdefault normalisation below fills the rest, matching how
# gaps were handled before.
def _carehome_directory_url(name: str, postcode: str = "") -> str:
    """Google search restricted to carehome.co.uk for this home's profile.
    Includes the postcode: same-named homes exist in different towns, and
    name-only queries surface the wrong one (live-testing feedback)."""
    query = f'site:carehome.co.uk "{name}" {postcode}'.strip()
    return "https://www.google.com/search?q=" + requests.utils.quote(query)


def _validated_url(url: str) -> Optional[str]:
    """Return the URL if its domain actually responds, else None. Web-search
    JSON routinely invents care-home domains, and a dead link is worse than no
    link. Any HTTP response except 404/410 counts as alive — many care-home
    sites answer bots with 403/405."""
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    try:
        resp = requests.head(
            url,
            timeout=4,
            allow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (YOPEY link check)"},
        )
        return None if resp.status_code in (404, 410) else url
    except requests.RequestException:
        return None


CARE_HOMES_SCHEMA = {
    "type": "object",
    "properties": {
        "care_homes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "address": {"type": "string"},
                    "postcode": {"type": "string"},
                    "phone": {"type": "string"},
                    "manager": {"type": "string"},
                    "cqc_rating": {"type": "string"},
                    "distance_miles": {"type": "number"},
                    "website": {"type": "string", "nullable": True},
                    "service_types": {"type": "array", "items": {"type": "string"}},
                    "specialisms": {"type": "array", "items": {"type": "string"}},
                    "number_of_beds": {"type": "integer", "nullable": True},
                    "last_inspection_date": {"type": "string", "nullable": True},
                },
                "required": ["name"],
            },
        },
    },
    "required": ["care_homes"],
}


def _search_care_homes_via_web(
    postcode: str,
    max_results: int = 5,
    radius_miles: int = 10,
    prefetched_location: Optional[dict] = None,
) -> dict:
    """
    Fallback when CQC API isn't authorised. Uses Google-Search-grounded Gemini
    to find currently-operating UK care homes near the postcode via public web
    sources (carehome.co.uk, CQC's public listings, etc.). Less structured than
    CQC API but reliably available.

    `prefetched_location` lets the dispatcher resolve the postcode once and
    share the result with both CQC and web paths instead of re-calling
    postcodes.io.
    """
    if not gemini_client:
        return {"error": "Gemini not configured", "results": []}

    location = prefetched_location if prefetched_location is not None else postcode_to_latlng(postcode)
    # Bail early on a known-bad postcode — don't burn a grounded search call
    # only to have the model guess at an area that doesn't exist.
    if "error" in location:
        return {
            "search_area": postcode,
            "source": "web_search",
            "error": location["error"],
            "results": [],
        }

    area = location.get("admin_district") or postcode

    prompt = (
        f"Find up to {max_results} real, currently-operating UK care homes within "
        f"about {radius_miles} miles of postcode {postcode} (in {area}). Use "
        f"carehome.co.uk, cqc.org.uk public listings, and the care homes' own "
        f"websites. Return STRICT JSON only (no markdown, no commentary) in this "
        f"exact shape:\n\n"
        '{"care_homes": [\n'
        '  {\n'
        '    "name": "...",\n'
        '    "address": "...",\n'
        '    "postcode": "...",\n'
        '    "phone": "...",\n'
        '    "manager": "the Manager (not listed)",\n'
        '    "cqc_rating": "Good|Outstanding|Requires improvement|Inadequate|Not yet rated|Unknown",\n'
        '    "distance_miles": 0.5,\n'
        '    "website": "https://..." or null,\n'
        '    "service_types": ["Care home with nursing"] or [],\n'
        '    "specialisms": ["Dementia", "Older people"] or [],\n'
        '    "number_of_beds": 42 or null,\n'
        '    "last_inspection_date": "2023-05-10" or null\n'
        '  }\n'
        "]}\n\n"
        "Rules:\n"
        "- ONLY include real, currently-listed care homes. Never invent.\n"
        "- If you cannot find a phone number, use 'Not listed' (not a fake one).\n"
        f"- Prefer the homes closest to {postcode}. distance_miles is your best\n"
        f"  estimate of miles from {postcode}; if you can't estimate it, use null —\n"
        "  do NOT drop an otherwise-good nearby home over distance uncertainty.\n"
        "- If the manager's name is unknown, leave it as 'the Manager (not listed)'.\n"
        "- service_types are CQC categories (e.g. 'Care home with nursing', 'Care home without nursing').\n"
        "- specialisms are the populations they serve (e.g. 'Dementia', 'Older people', 'Learning disability').\n"
        "- last_inspection_date in ISO format YYYY-MM-DD if known, otherwise null.\n"
        "- Use null (not empty string) for unknown numeric/date fields.\n"
        "- website is the care home's OWN domain (not a directory listing), and only\n"
        "  if it appeared in your search results — null if unsure, never guess.\n"
        "- Sort by ascending distance.\n"
        "- If you cannot find any nearby, return {\"care_homes\": []}."
    )

    try:
        text = _grounded_search(prompt, response_schema=CARE_HOMES_SCHEMA)
    except Exception as e:
        return {"error": f"Web search error: {e}", "results": []}

    data = _parse_json_response(text)
    if data is None:
        return {"error": "Web search returned no parseable JSON", "results": [], "raw": text[:300]}

    homes = data.get("care_homes") or []
    # Normalise missing fields so the shape matches CQC results (the bot's
    # STEP-2 template assumes these keys exist). Use "the Manager (not listed)"
    # so the bot doesn't write "Dear the Manager," — the (not listed) qualifier
    # signals unknown.
    for h in homes:
        h.setdefault("manager", "the Manager (not listed)")
        h.setdefault("phone", "Not listed")
        h.setdefault("cqc_rating", "Unknown")
        h.setdefault("service_types", [])
        h.setdefault("specialisms", [])
        h.setdefault("number_of_beds", None)
        h.setdefault("last_inspection_date", None)
        h.setdefault("website", None)
        # Model-guessed CQC location URLs were nearly all 404s in live testing
        # — only the CQC API path (real locationIds) gets a profile link. The
        # bot's template omits the line when cqc_url is null.
        h["cqc_url"] = None
        h["source"] = "web_search"

    # Belt-and-braces: drop any model results that exceed the requested radius
    homes = [h for h in homes if (h.get("distance_miles") or 0) <= radius_miles]

    return {
        "search_area": area,
        "source": "web_search",
        "note": "Sourced from public web listings — phone or address may be slightly out of date. Always double-check before sending an email.",
        "results": homes[:max_results],
    }


SEARCH_CACHE_TTL_DAYS = 7


def _normalize_postcode(postcode: str) -> str:
    return postcode.strip().upper().replace(" ", "")


# Bump when the cached payload shape/links change — old-format rows are
# skipped and refreshed on next search. v2: postcoded directory URLs.
# v3: CQC-primary cutover (forces web-era caches to refresh via CQC).
SEARCH_CACHE_VERSION = 3


def _check_search_cache(postcode: str, radius_miles: int, max_results: int) -> Optional[dict]:
    """
    Return a recent cached search result if any cached row's actual_radius_miles
    is at least the requested radius_miles AND its max_results is ≥ requested.
    A wider-area cached search is a valid superset for a narrower request.
    """
    if not supabase:
        return None
    cutoff = (datetime.now(timezone.utc) - timedelta(days=SEARCH_CACHE_TTL_DAYS)).isoformat()
    try:
        res = (
            supabase.table("care_home_searches")
            .select("payload, radius_miles, max_results, cached_at")
            .eq("postcode", _normalize_postcode(postcode))
            .gte("cached_at", cutoff)
            .order("cached_at", desc=True)
            .limit(10)
            .execute()
        )
    except Exception as e:
        print(f"[search-cache] lookup failed: {e}")
        return None
    if not res.data:
        return None

    for row in res.data:
        payload = row["payload"]
        if payload.get("cache_version") != SEARCH_CACHE_VERSION:
            continue
        cached_actual = payload.get("actual_radius_miles") or row.get("radius_miles") or 0
        cached_max = row.get("max_results") or len(payload.get("results", []))
        if cached_actual >= radius_miles and cached_max >= max_results:
            payload = dict(payload)  # shallow copy so we don't mutate the cache row
            payload["cached"] = True
            return payload
    return None


def _save_search_to_cache(
    postcode: str, radius_miles: int, max_results: int, result: dict
) -> None:
    if not supabase or not result.get("results"):
        return
    try:
        supabase.table("care_home_searches").insert({
            "postcode": _normalize_postcode(postcode),
            "radius_miles": radius_miles,
            "max_results": max_results,
            "source": result.get("source"),
            "payload": {**result, "cache_version": SEARCH_CACHE_VERSION},
        }).execute()
    except Exception as e:
        print(f"[search-cache] insert failed: {e}")


def _enrich_with_emails(homes: list[dict], fallback_postcode: str) -> None:
    """
    Look up an email for every care home in parallel and mutate each dict
    to include the email, plus metadata about its confidence.

    Cache hits (verified Tony-seeded contacts + prior lookups) cost nothing.
    Uncached lookups go to Gemini grounded web search (free under the monthly
    grounding quota, then paid). Parallel so the user doesn't wait 15s for 5
    sequential lookups.

    Defined as a closure-free helper so search_care_homes can call it on every
    fresh result, baking emails directly into the cached payload — the LLM
    then never has to invoke find_care_home_email separately just to list.
    """
    if not homes:
        return

    def lookup(home: dict) -> dict:
        name = home.get("name")
        if not name:
            return {"found": False, "reason": "Home missing name"}
        manager = home.get("manager") or ""
        # If the manager string is the "(not listed)" sentinel, don't pass it
        # to the email search — the model would treat it as a real name.
        clean_manager = (
            manager if manager and "not listed" not in manager.lower() else None
        )
        # Web-search websites are model-claimed; CQC-path ones come from the
        # regulator's records. Validate the former here so the dead-domain
        # check rides the existing per-home worker fan-out.
        if home.get("source") == "web_search" and home.get("website"):
            home["website"] = _validated_url(home["website"])
        return find_email_via_web_search(
            care_home_name=name,
            town_or_postcode=home.get("postcode") or fallback_postcode,
            manager_name=clean_manager,
            website=home.get("website"),
        )

    # max_workers=5 matches our typical max_results — caps concurrent Gemini calls.
    # Use submit + as_completed with per-future try/except so a single failed
    # lookup never nukes the whole batch's successful results.
    email_results: list[dict] = [{"found": False} for _ in homes]
    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_index = {executor.submit(lookup, home): i for i, home in enumerate(homes)}
        for fut in as_completed(future_to_index):
            idx = future_to_index[fut]
            try:
                email_results[idx] = fut.result()
            except Exception as e:
                print(f"[search] email enrichment failed for home #{idx}: {e}")
                # Other homes' results stay intact.

    for home, er in zip(homes, email_results):
        if er.get("found"):
            home["email"] = er.get("email")
            home["email_verified"] = bool(er.get("verified"))
            home["email_is_generic"] = bool(er.get("is_generic_inbox"))
            home["email_source"] = er.get("source")
        else:
            home["email"] = None
            home["email_reason"] = er.get("reason") or "Not found"

        # Google site:carehome.co.uk search — far more reliable than
        # carehome.co.uk's own search URL, which often returns empty / 404-style
        # pages. Google always returns useful results; the top hit is almost
        # always the home's profile on carehome.co.uk. One click from the chat.
        if not home.get("carehome_co_uk_url") and home.get("name"):
            home["carehome_co_uk_url"] = _carehome_directory_url(
                home["name"], home.get("postcode") or ""
            )

    # The email finder occasionally returns the SAME address for two different
    # homes (cross-contamination from chain sites / directory pages). It's
    # almost never right for both — keep it on the closest home (lists arrive
    # sorted) and null the rest so they fall back to the directory link.
    # Manually-verified entries are exempt: a chain sharing one real inbox is
    # legitimate.
    seen_emails: set[str] = set()
    for home in homes:
        em = (home.get("email") or "").strip().lower()
        if not em:
            continue
        if em in seen_emails and not home.get("email_verified"):
            home["email"] = None
            home["email_is_generic"] = False
            home["email_reason"] = "duplicate of another home's address"
        else:
            seen_emails.add(em)


def search_care_homes(postcode: str, radius_miles: int = 1, max_results: int = 5) -> dict:
    """
    Find care homes near a UK postcode. Default radius is 1 mile (Tony's spec:
    'within a mile of where they are in education and/or live').

    The CQC API (cheap calls, accurate distances) widens 1→2→3→5→10 miles
    until homes appear. The web fallback makes ONE wide grounded call instead:
    grounded Gemini can't honour fine-grained distance cutoffs (live failure:
    dense London postcode came back empty at every step), and each extra call
    costs ~10s plus a flake chance. Results are sorted nearest-first.

    Result envelope includes `actual_radius_miles` so the bot can mention if it
    had to look further out than the teen's immediate area.
    """
    # Cache check uses the requested (starting) radius — most teens search the
    # same postcode again next session, so a hit returns instantly.
    cached = _check_search_cache(postcode, radius_miles, max_results)
    if cached:
        return cached

    # Coalesce concurrent searches for the same postcode: the wizard's
    # precompute usually starts ~30-60s before the chat auto-search arrives.
    # The late caller waits for the in-flight search and reuses its cached
    # result instead of paying for (and waiting on) a full duplicate.
    key = _normalize_postcode(postcode)
    with _INFLIGHT_LOCK:
        evt = _INFLIGHT_SEARCHES.get(key)
        is_owner = evt is None
        if is_owner:
            evt = threading.Event()
            _INFLIGHT_SEARCHES[key] = evt
    if not is_owner:
        evt.wait(timeout=120)
        cached = _check_search_cache(postcode, radius_miles, max_results)
        if cached:
            return cached
        # Owner failed or found nothing cacheable — fall through and search.

    try:
        return _search_care_homes_uncached(postcode, radius_miles, max_results)
    finally:
        if is_owner:
            with _INFLIGHT_LOCK:
                _INFLIGHT_SEARCHES.pop(key, None)
            evt.set()


_INFLIGHT_SEARCHES: dict[str, threading.Event] = {}
_INFLIGHT_LOCK = threading.Lock()


def _search_care_homes_uncached(postcode: str, radius_miles: int, max_results: int) -> dict:
    location = postcode_to_latlng(postcode)
    if "error" in location:
        return {
            "search_area": postcode,
            "source": "postcode_invalid",
            "error": location["error"],
            "results": [],
        }

    # Auto-expand from the requested starting radius
    # If radius_miles=1, sequence is [1, 2, 3, 5, 10]
    # If caller passes radius_miles=5, sequence is [5, 10]
    base_steps = [1, 2, 3, 5, 10]
    steps = [r for r in base_steps if r >= radius_miles]
    if not steps:
        steps = [radius_miles]
    max_radius = steps[-1]

    if CQC_SUBSCRIPTION_KEY:
        cqc_homes = _fetch_cqc_care_homes(location)
        if isinstance(cqc_homes, dict):
            print(f"[search] CQC failed, using web fallback: {str(cqc_homes.get('error', ''))[:80]}")
        else:
            # One authority-wide fetch; radius widening is a pure in-memory
            # filter (homes arrive sorted nearest-first).
            for step in steps:
                within = [h for h in cqc_homes if h["distance_miles"] <= step]
                if within:
                    attempt = {
                        "search_area": location.get("admin_district") or postcode,
                        "source": "cqc",
                        "results": within[:max_results],
                        "actual_radius_miles": step,
                        "requested_radius_miles": radius_miles,
                    }
                    if step > radius_miles:
                        print(f"[search] auto-expanded {redact_postcode(postcode)} from {radius_miles}mi → {step}mi to find results")
                    _enrich_with_emails(attempt["results"], postcode)
                    _save_search_to_cache(postcode, radius_miles, max_results, attempt)
                    return attempt
            # No homes within 10 miles in this authority → fall through to the web.

    attempt = _search_care_homes_via_web(
        postcode, max_results, radius_miles=max_radius, prefetched_location=location
    )
    attempt["requested_radius_miles"] = radius_miles
    if attempt.get("error") and not attempt.get("results"):
        attempt["actual_radius_miles"] = max_radius
        print(f"[search] web error envelope: {str(attempt.get('error', ''))[:80]}")
        return attempt

    results = attempt.get("results") or []
    results.sort(key=lambda h: h.get("distance_miles") or 99)
    if results:
        furthest = max((h.get("distance_miles") or 0) for h in results)
        attempt["actual_radius_miles"] = (
            max(radius_miles, math.ceil(furthest)) if furthest else max_radius
        )
        _enrich_with_emails(results, postcode)
    else:
        attempt["actual_radius_miles"] = max_radius
    _save_search_to_cache(postcode, radius_miles, max_results, attempt)
    return attempt


# ============================================================
# PART 1b: EMAIL LOOKUP TOOL (Gemini grounded web search)
# ============================================================
# Uses Google-Search-grounded Gemini to search the web for a care home's
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


def _outward_code(postcode: Optional[str]) -> Optional[str]:
    """Return the outward part of a UK postcode ('W13 8RB' -> 'W13'), or None."""
    if not postcode:
        return None
    cleaned = postcode.strip().upper()
    # Outward code = everything before the space, or the first 2-4 chars if no space
    if " " in cleaned:
        return cleaned.split()[0]
    # Inward code is always 3 chars at the end (digit + 2 letters)
    return cleaned[:-3] if len(cleaned) > 3 else cleaned


def _check_email_cache(care_home_name: str, postcode: Optional[str] = None) -> Optional[dict]:
    """
    Look up a cached care home email. To avoid cross-region collisions when two
    distinct homes share a name (e.g. 'Rose Court' in Cambridge vs Manchester),
    we filter by outward postcode (W13, IP33, etc.) when one is provided. If no
    postcode is given, we only return a hit if exactly ONE row matches the name.
    """
    if not supabase:
        return None
    try:
        res = (
            supabase.table("care_home_emails")
            .select("*")
            .ilike("care_home_name", care_home_name)
            .limit(10)
            .execute()
        )
    except Exception as e:
        print(f"[email-cache] lookup failed: {e}")
        return None
    if not res.data:
        return None

    user_outward = _outward_code(postcode)
    row: Optional[dict] = None

    if user_outward:
        # Prefer rows whose stored postcode matches the user's outward area
        for r in res.data:
            if _outward_code(r.get("postcode")) == user_outward:
                row = r
                break
        # If nothing matched the area, prefer Tony-verified rows (curated, less risky)
        if row is None:
            verified = [r for r in res.data if r.get("verified")]
            if len(verified) == 1:
                row = verified[0]
        # Still nothing safe — bail rather than risk a wrong-city email
        if row is None:
            return None
    else:
        # No postcode hint: only safe if exactly one row matches by name
        if len(res.data) == 1:
            row = res.data[0]
        else:
            return None

    try:
        supabase.table("care_home_emails").update(
            {"last_used_at": _now_iso()}
        ).eq("id", row["id"]).execute()
    except Exception:
        pass

    email = row["email"]
    return {
        "found": True,
        "email": email,
        "source": row.get("source") or "cached",
        "verified": bool(row.get("verified")),
        # Re-derive from email rather than relying on cache row's flag —
        # cheap and means we don't need to migrate the column.
        "is_generic_inbox": _looks_like_generic(email),
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


# Domains that show up in scraped HTML but aren't the care home's contact email
# (third-party analytics, page builders, etc.). Filtered out by the scraper.
SCRAPE_NOISE_DOMAINS = {
    "sentry.io",
    "googletagmanager.com",
    "google-analytics.com",
    "wixpress.com",
    "squarespace.com",
    "wordpress.com",
    "godaddy.com",
    "domain.com",
    "example.com",
    "yourdomain.com",
}


# Cloud-metadata + internal-services hostnames that scraper must NEVER touch.
SSRF_HOSTNAME_BLOCKLIST = {
    "localhost",
    "metadata.google.internal",
    "metadata.azure.com",
}


def _is_safe_external_url(url: str) -> bool:
    """
    SSRF guard for _scrape_email_from_website. Rejects:
      - non-http(s) schemes
      - private/loopback/link-local IP literals
      - obvious internal hostnames (localhost, *.local, cloud metadata names)
      - hostnames that DNS-resolve to a private/loopback/link-local IP
    NOTE: DNS-rebind attacks still possible (between resolve here and the
    underlying requests.get). For our threat model that's acceptable —
    attacker would need an attacker-controlled domain returning rotating IPs.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host or host in SSRF_HOSTNAME_BLOCKLIST or host.endswith(".local"):
        return False

    # IP literal in private range?
    try:
        ip = ipaddress.ip_address(host)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
        return True
    except ValueError:
        pass  # not an IP literal — resolve and check

    try:
        addrs = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for family, _, _, _, sockaddr in addrs:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    return True


def _scrape_email_from_website(website: Optional[str]) -> Optional[str]:
    """
    Fetch a care home's own website + common contact pages, regex-extract the
    first plausible email. Free and deterministic — no LLM involved, so no
    hallucination risk and no per-call cost. Catches the many small care home
    sites that display 'info@<home>.co.uk' directly on their homepage or
    /contact page.
    """
    if not website:
        return None

    url = website.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    # SSRF guard: refuse to scrape anything pointing at internal infra.
    if not _is_safe_external_url(url):
        print(f"[scrape] refused unsafe URL: {urlparse(url).hostname}")
        return None

    paths_to_try = ["", "/contact", "/contact-us", "/about/contact", "/about-us", "/about"]
    candidates: list[str] = []

    for path in paths_to_try:
        try:
            full_url = url.rstrip("/") + path
            # Disable redirects — an attacker page could redirect to internal IPs
            # after we've passed the SSRF check. If a site needs http→https
            # we'd want to validate the redirect target first.
            resp = requests.get(
                full_url,
                timeout=8,
                headers={
                    "User-Agent": (
                        "YOPEY Befriender Bot (+https://www.yopeybefriender.org); "
                        "looking for contact email on behalf of a young volunteer"
                    )
                },
                allow_redirects=False,
            )
            # Follow ONE redirect if it's still safe
            if 300 <= resp.status_code < 400:
                redirect = resp.headers.get("Location")
                if redirect and _is_safe_external_url(redirect):
                    resp = requests.get(redirect, timeout=8, allow_redirects=False)
                else:
                    continue
        except Exception:
            continue
        if resp.status_code >= 400:
            continue

        html = resp.text

        # Prefer mailto: links (semantic, intentional)
        for m in re.finditer(r'mailto:([\w.+-]+@[\w-]+\.[\w.-]+)', html, re.IGNORECASE):
            candidates.append(m.group(1))

        # Plus any bare email patterns in the HTML
        for m in EMAIL_RE.finditer(html):
            candidates.append(m.group(0))

        if candidates:
            # No need to keep fetching other paths once we have hits
            break

    # Filter noise domains + de-dupe while preserving order
    seen: set[str] = set()
    filtered: list[str] = []
    for c in candidates:
        c_lower = c.lower()
        domain = c_lower.split("@", 1)[-1]
        if any(noise in domain for noise in SCRAPE_NOISE_DOMAINS):
            continue
        if c_lower in seen:
            continue
        seen.add(c_lower)
        filtered.append(c)

    if not filtered:
        return None

    # Prefer non-generic addresses (s.smith@home.co.uk over info@home.co.uk)
    personal = [e for e in filtered if not _looks_like_generic(e)]
    return personal[0] if personal else filtered[0]


def find_email_via_web_search(
    care_home_name: str,
    town_or_postcode: Optional[str] = None,
    manager_name: Optional[str] = None,
    website: Optional[str] = None,
) -> dict:
    """
    1. Check the care_home_emails cache (instant, free, trusted).
    2. If miss, ask Google-Search-grounded Gemini to search the web.
    3. Pull the email from its response with regex; cache it.

    Returns: {found: bool, email?: str, source: str, verified: bool, confidence: str}

    Lookup order: cache → scrape care home website → Gemini web search.
    """
    cached = _check_email_cache(care_home_name, postcode=town_or_postcode)
    if cached:
        cached["confidence"] = "verified" if cached["verified"] else "cached"
        return cached

    # Free deterministic step: scrape the care home's own website. Often finds
    # the info@/contact@ email displayed on the homepage. No LLM, no cost.
    if website:
        scraped = _scrape_email_from_website(website)
        if scraped:
            is_generic = _looks_like_generic(scraped)
            _save_email_to_cache(
                care_home_name=care_home_name,
                email=scraped,
                postcode=town_or_postcode,
                source="website_scrape",
                notes="generic inbox" if is_generic else None,
            )
            return {
                "found": True,
                "email": scraped,
                "source": "website_scrape",
                "verified": False,
                "confidence": "high" if not is_generic else "medium",
                "is_generic_inbox": is_generic,
            }

    if not gemini_client:
        return {"found": False, "reason": "Gemini not configured"}

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
        text = _grounded_search(query)
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

TOOL_DECLARATIONS: list[dict] = [
    {
        "name": "search_care_homes",
        "description": (
            "Search for care homes near a UK postcode. Default radius is 1 mile "
            "(per YOPEY: 'within a mile of where they study or live'). If no homes "
            "are found at 1 mile, the search auto-expands to 2, 3, 5, then 10 miles "
            "and returns results from whichever step found them — check the "
            "`actual_radius_miles` field in the result and tell the teen if it had "
            "to expand. Returns the closest care homes with name, address, phone, "
            "manager name, CQC rating, email, and distance."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "postcode": {"type": "string", "description": "A valid UK postcode, e.g. 'CB8 8YN'"},
                "radius_miles": {
                    "type": "integer",
                    "description": "Starting search radius in miles. Default 1 (will auto-expand if no results).",
                },
                "max_results": {"type": "integer", "description": "Max care homes. Default 5."},
            },
            "required": ["postcode"],
        },
    },
    {
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
    {
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
    {
        "name": "find_dementia_training",
        "description": (
            "Search the web for fresh free dementia training resources (videos, "
            "online courses, apps, podcasts). Use when the teen asks for more "
            "training beyond the curated 5 listed in your prompt, asks 'what's new?', "
            "or finishes the curated ones. Returns a list of {name, url, description, "
            "estimated_minutes, is_free}. Always check is_free=true before recommending."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "Optional kind of resource, e.g. 'short videos', 'in-person course', 'app', 'podcast'",
                },
            },
        },
    },
    {
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
    {
        "name": "raise_safeguarding_concern",
        "description": (
            "Call this IMMEDIATELY and SILENTLY in either situation:\n"
            "(1) THE YOUNG PERSON may be at risk — self-harm or suicidal "
            "thoughts, being abused or unsafe, an eating disorder, substance "
            "abuse, severe distress or hopelessness, being a victim of crime, "
            "or anyone in danger.\n"
            "(2) THE YOUNG PERSON REPORTS A CONCERN ABOUT A CARE HOME — e.g. a "
            "resident being mistreated, neglected, spoken to harshly, left "
            "unsafe, or anything at the home that worried them "
            "(category 'care_home_concern').\n"
            "This alerts a human safeguarding lead at YOPEY. Call it BEFORE "
            "you reply. Do not mention the tool or the alert to the young "
            "person. When unsure, err on the side of raising it."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": [
                        "self_harm",
                        "abuse",
                        "danger",
                        "distress",
                        "care_home_concern",
                        "other",
                    ],
                    "description": (
                        "Best-fit category. Use 'care_home_concern' when the "
                        "young person is reporting something wrong at a care "
                        "home (about a resident or the home), NOT their own "
                        "welfare."
                    ),
                },
                "summary": {
                    "type": "string",
                    "description": (
                        "A brief, factual, NON-graphic summary (1-2 sentences) of "
                        "what the young person disclosed or reported, so the "
                        "safeguarding lead knows what to look into. Do not editorialise."
                    ),
                },
            },
            "required": ["category", "summary"],
        },
    },
    {
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
]

# The chat brain's toolset, built once at import. Kept separate from
# GOOGLE_SEARCH_TOOL — Gemini rejects grounding + custom declarations together.
GEMINI_TOOLS = [genai_types.Tool(function_declarations=TOOL_DECLARATIONS)]


# ============================================================
# PART 3: SUPABASE HELPERS
# ============================================================

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================================================
# LOG REDACTION (UK GDPR Art 5.1.f — integrity + confidentiality)
# Render captures stdout indefinitely, so we never log raw PII.
# Use these helpers in print statements anywhere a value could
# identify a user or third party.
# ============================================================

def redact_email(email: Optional[str]) -> str:
    """'sarah@example.com' -> 'sa***@example.com'. None -> '<no-email>'."""
    if not email or "@" not in email:
        return "<no-email>"
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return f"***@{domain}"
    return f"{local[:2]}***@{domain}"


def redact_postcode(postcode: Optional[str]) -> str:
    """'W13 8RB' -> 'W13 ***'. Outward code is OK to log (regional, not personal)."""
    if not postcode:
        return "<no-postcode>"
    cleaned = postcode.strip().upper()
    if " " in cleaned:
        return f"{cleaned.split()[0]} ***"
    return f"{cleaned[:-3]} ***" if len(cleaned) > 3 else "***"


def redact_id(value: Optional[str]) -> str:
    """UUID -> first 8 chars, enough to grep server-side without exposing the full token."""
    if not value:
        return "<no-id>"
    return value[:8]


def redact_school_name(name: Optional[str]) -> str:
    """
    'Westminster School' -> 'W*** S***' — keeps a hint for grepping a
    single user's path through the logs but doesn't reveal the school.
    School name + age + outward-code postcode can re-identify under UK GDPR.
    """
    if not name or not name.strip():
        return "<no-school>"
    words = name.strip().split()[:4]  # cap word count for log noise
    return " ".join(w[0].upper() + "***" if len(w) > 1 else w for w in words)


# ============================================================
# Per-user HMAC token. Issued at /api/onboard, stored in browser localStorage,
# sent as X-User-Token on /api/user/{id} GET+DELETE and /api/survey.
# Treats user_id as identifier (path) and token as credential (header) so an
# attacker who scrapes a UUID alone can't impersonate the user.
# ============================================================

def make_user_token(user_id: str) -> str:
    """HMAC-SHA256 of user_id with EMAIL_TOKEN_SECRET → 24-byte b64url string."""
    sig = hmac.new(EMAIL_TOKEN_SECRET.encode(), user_id.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(sig[:24]).rstrip(b"=").decode()


def verify_user_token(user_id: str, token: str) -> bool:
    if not token or not user_id:
        return False
    expected = make_user_token(user_id)
    return hmac.compare_digest(expected, token)


def create_user(
    first_name: str,
    age: int,
    *,
    surname: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    home_postcode: Optional[str] = None,
    school_name: Optional[str] = None,
    school_postcode: Optional[str] = None,
    is_student: Optional[bool] = None,
    search_preference: Optional[str] = None,
    utm_source: Optional[str] = None,
) -> dict:
    """
    Create or update a user from the onboard wizard. Returns the row.

    Resolves the search `postcode` from `search_preference` so the rest of the
    system (search_care_homes, _build_contacts_context, chat() prompt-injection)
    can just read `users.postcode` as before.

    If `email` already exists, updates the existing row instead of failing on
    the UNIQUE constraint — re-onboarding with the same email is legitimate
    (teen wiped localStorage, clicked "New chat", etc.).

    All optional params are keyword-only to prevent positional-arg drift.
    """
    resolved_postcode = (
        school_postcode if search_preference == "school" and school_postcode else home_postcode
    )

    # Look up by email first; on hit, update the existing row.
    if email:
        existing = supabase.table("users").select("*").eq("email", email).limit(1).execute()
        if existing.data:
            user_id = existing.data[0]["id"]
            updates: dict[str, Any] = {"first_name": first_name, "age": age}
            if surname:
                updates["surname"] = surname
            if phone:
                updates["phone"] = phone
            if home_postcode:
                updates["home_postcode"] = home_postcode
            if school_name:
                updates["school_name"] = school_name
            if school_postcode:
                updates["school_postcode"] = school_postcode
            if is_student is not None:
                updates["is_student"] = is_student
            if search_preference:
                updates["search_preference"] = search_preference
            if resolved_postcode:
                updates["postcode"] = resolved_postcode
            if utm_source:
                updates["utm_source"] = utm_source
            update_user(user_id, **updates)
            refreshed = get_user(user_id)
            return refreshed if refreshed else existing.data[0]

    payload: dict[str, Any] = {"first_name": first_name, "age": age, "status": "new"}
    if surname:
        payload["surname"] = surname
    if email:
        payload["email"] = email
    if phone:
        payload["phone"] = phone
    if home_postcode:
        payload["home_postcode"] = home_postcode
    if school_name:
        payload["school_name"] = school_name
    if school_postcode:
        payload["school_postcode"] = school_postcode
    if is_student is not None:
        payload["is_student"] = is_student
    if search_preference:
        payload["search_preference"] = search_preference
    if resolved_postcode:
        payload["postcode"] = resolved_postcode
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

# ============================================================
# DEMENTIA TRAINING DISCOVERY
# ============================================================
# Web-search for fresh free training resources beyond the curated 5 in
# training_resources. Tony reviews + seeds the keepers manually for now;
# v1.1 will run this on a cron and present new finds to Tony for approval.

TRAINING_SCHEMA = {
    "type": "object",
    "properties": {
        "resources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "url": {"type": "string"},
                    "description": {"type": "string"},
                    "estimated_minutes": {"type": "integer"},
                    "is_free": {"type": "boolean"},
                    "provider": {"type": "string"},
                },
                "required": ["name", "url", "is_free"],
            },
        },
    },
    "required": ["resources"],
}


def find_dementia_training_resources(focus: Optional[str] = None) -> dict:
    """
    Use Google-Search-grounded Gemini to find currently-free dementia training
    resources online. Returns structured JSON the bot can render directly.
    """
    if not gemini_client:
        return {"error": "Gemini not configured", "results": []}

    focus_hint = f" Focus: {focus}." if focus else ""
    prompt = (
        f"Find 4-6 FREE dementia training resources for UK volunteers"
        f"{focus_hint} Prefer resources from reputable organisations "
        f"(Alzheimer's Society, Dementia UK, NHS, Skills for Care, "
        f"university extension courses). Verify each is currently free — "
        f"some used to be free and now charge. Return STRICT JSON only:\n\n"
        '{"resources": [\n'
        '  {\n'
        '    "name": "...",\n'
        '    "url": "https://...",\n'
        '    "description": "1-2 sentences",\n'
        '    "estimated_minutes": 15,\n'
        '    "is_free": true,\n'
        '    "provider": "organisation name"\n'
        '  }\n'
        "]}\n\n"
        "Rules:\n"
        " - ONLY include resources you can confirm are currently free.\n"
        " - Prefer 2024-2025 content over older resources.\n"
        " - estimated_minutes is the typical completion time; 0 if ongoing.\n"
        " - Never invent — only include what you actually found."
    )

    try:
        text = _grounded_search(prompt, response_schema=TRAINING_SCHEMA)
    except Exception as e:
        return {"error": f"Web search error: {e}", "results": []}

    data = _parse_json_response(text)
    if data is None:
        return {"error": "Search returned no parseable JSON", "results": []}
    resources = data.get("resources") or []
    # Filter out anything missing url or marked not free
    cleaned = [
        r for r in resources
        if r.get("url") and r.get("is_free", True)
    ]
    return {"results": cleaned[:6]}


def list_curated_training() -> list[dict]:
    """Active rows from training_resources, sorted by added_at desc."""
    if not supabase:
        return []
    try:
        res = (
            supabase.table("training_resources")
            .select("name, url, description, estimated_minutes, is_free")
            .eq("active", True)
            .order("added_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[training] curated lookup failed: {e}")
        return []


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
        print(f"[post-match] user {redact_id(user['id'])} has no email, skipping stage {stage_def['stage']}")
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
        print(f"[post-match] Welcome sent to user {redact_id(user_id)} ({redact_email(user['email'])})")


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
                        f"[post-match] Stage {nudge['stage']} sent to {redact_email(user['email'])} "
                        f"({nudge['days']} days since match)"
                    )
                break

    return sent_count


def send_email(to_email: str, subject: str, body: str, html: Optional[str] = None) -> bool:
    """Send via Resend (text + optional HTML). Returns True on success."""
    if not RESEND_API_KEY:
        print(f"[email] No RESEND_API_KEY — would have sent to {redact_email(to_email)}: {subject}")
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
        print(f"[email] Failed to send to {redact_email(to_email)}: {e}")
        return False


# ============================================================
# SAFEGUARDING ESCALATION
# When the bot detects a sensitive disclosure it calls raise_safeguarding_concern.
# We record the alert AND email the named safeguarding lead immediately. The
# teen still receives the helpline signposting (handled in the prompt). This is
# the human-escalation layer the UK Children's Code expects for a service
# likely to be used by under-18s.
# ============================================================

# Teen-welfare categories + the adult-safeguarding 'care_home_concern' (a teen
# reporting that something is wrong at a care home — resident mistreatment,
# neglect, unsafe conditions). All except 'distress'/'other' are high severity.
SAFEGUARDING_CATEGORIES = {
    "self_harm",
    "abuse",
    "danger",
    "distress",
    "care_home_concern",
    "other",
}
HIGH_SEVERITY_CATEGORIES = {"self_harm", "abuse", "danger", "care_home_concern"}


def raise_safeguarding_alert(
    user_id: str,
    category: str,
    summary: str,
    trigger_message: Optional[str] = None,
) -> dict:
    """Record a safeguarding alert and email the safeguarding lead immediately."""
    if not supabase:
        return {"recorded": False, "reason": "db unavailable"}

    category = category if category in SAFEGUARDING_CATEGORIES else "other"
    severity = "high" if category in HIGH_SEVERITY_CATEGORIES else "medium"
    is_care_home = category == "care_home_concern"

    user = get_user(user_id) or {}
    alert_row = {
        "user_id": user_id,
        "category": category,
        "severity": severity,
        "summary": (summary or "")[:1000],
        "trigger_message": (trigger_message or "")[:2000],
    }
    try:
        inserted = supabase.table("safeguarding_alerts").insert(alert_row).execute()
        alert_id = inserted.data[0]["id"] if inserted.data else None
    except Exception as e:
        print(f"[safeguarding] insert failed: {e}")
        return {"recorded": False, "reason": str(e)}

    # Email the safeguarding lead immediately (best-effort).
    lead = SAFEGUARDING_EMAIL or _extract_from_address(EMAIL_FROM)
    emailed = False
    if lead:
        name = (user.get("first_name") or "") + " " + (user.get("surname") or "")
        kind = "CARE-HOME CONCERN" if is_care_home else "YOPEY SAFEGUARDING"
        subject = f"[{kind} — {severity.upper()}] {category.replace('_', ' ')}"
        if is_care_home:
            footer = (
                "This is a concern about a CARE HOME raised by a young person — "
                "i.e. adult safeguarding of a resident, not the young person's own "
                "welfare. Follow YOPEY's procedure: this likely needs reporting to "
                "the CQC (cqc.org.uk/give-feedback-on-care or 03000 616161) and/or "
                "the local council's adult safeguarding team. Call 999 if a resident "
                "is in immediate danger. The young person was advised to report it "
                "to YOPEY and was given the CQC route."
            )
        else:
            footer = (
                "This is about the young person's own welfare. The young person was "
                "shown a real YOPEY contact plus helplines (The Mix, Samaritans, "
                "Childline, 999) in the chat."
            )
        body = (
            "A YOPEY Befriender chatbot conversation has triggered a safeguarding "
            "alert. Please review and follow YOPEY's safeguarding procedure.\n\n"
            f"Young person: {name.strip() or 'unknown'}\n"
            f"Email: {user.get('email') or 'not on file'}\n"
            f"Age: {user.get('age') or 'unknown'}\n"
            f"Category: {category}\n"
            f"Severity: {severity}\n\n"
            f"What the bot summarised:\n{summary}\n\n"
            "Open the dashboard → Safeguarding tab to read the full conversation "
            "and mark this as actioned.\n\n"
            f"{footer}"
        )
        emailed = send_email(lead, subject, body)
        if emailed and alert_id:
            try:
                supabase.table("safeguarding_alerts").update(
                    {"notified_email": True}
                ).eq("id", alert_id).execute()
            except Exception:
                pass

    print(
        f"[safeguarding] {severity} alert recorded for user {redact_id(user_id)} "
        f"({category}); lead emailed: {emailed}"
    )
    return {"recorded": True, "alert_id": alert_id, "emailed": emailed}


def _extract_from_address(from_header: str) -> Optional[str]:
    """'YOPEY <hello@yopey.org>' -> 'hello@yopey.org'."""
    m = re.search(r"<([^>]+)>", from_header or "")
    if m:
        return m.group(1).strip()
    return from_header.strip() if "@" in (from_header or "") else None


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
                        f"[nudge] Stage {stage_def['stage']} sent to "
                        f"{redact_email(user['email'])} (user {redact_id(user['id'])})"
                    )
                break

    return sent_count


# ============================================================
# PART 5: CHAT ENGINE
# ============================================================

def execute_tool(tool_name: str, args: dict, user_id: str, trigger_message: Optional[str] = None) -> str:
    if tool_name == "raise_safeguarding_concern":
        result = raise_safeguarding_alert(
            user_id=user_id,
            category=args.get("category", "other"),
            summary=args.get("summary", ""),
            trigger_message=trigger_message,
        )
        # The tool result is internal; the LLM never surfaces it to the teen.
        return json.dumps({"status": "recorded", "internal": result})

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

    if tool_name == "find_dementia_training":
        result = find_dementia_training_resources(focus=args.get("focus"))
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


def _tool_result_to_response_dict(result_str: str) -> dict:
    """Gemini function_response payloads must be JSON objects, but execute_tool
    returns JSON strings (occasionally bare arrays/strings)."""
    try:
        parsed = json.loads(result_str)
    except (json.JSONDecodeError, TypeError):
        return {"result": result_str}
    return parsed if isinstance(parsed, dict) else {"result": parsed}


# Documented Gemini escape hatch: function_call parts replayed from stored
# history need *a* thought signature; this placeholder marks them as
# reconstructed rather than produced in the live turn.
_PAST_TURN_THOUGHT_SIGNATURE = b"context_engineering_is_the_way_to_go"


def _history_to_gemini_contents(history: list) -> list:
    """
    Convert stored OpenAI-shaped history (role/content/tool_calls/tool) into
    Gemini contents. The stored shape predates this migration and the dashboard
    transcript viewer reads it, so it stays canonical in Supabase — we convert
    on every call instead of migrating the data.
    """
    contents: list = []
    id_to_name: dict[str, str] = {}
    pending_tool_parts: list = []

    def flush_tool_parts() -> None:
        # All function responses for one model turn travel in a single
        # user-role content (Gemini's parallel-call convention).
        if pending_tool_parts:
            contents.append(genai_types.Content(role="user", parts=pending_tool_parts[:]))
            pending_tool_parts.clear()

    for msg in history:
        role = msg.get("role")
        if role == "user":
            flush_tool_parts()
            if msg.get("content"):
                contents.append(
                    genai_types.Content(role="user", parts=[genai_types.Part(text=msg["content"])])
                )
        elif role == "assistant":
            flush_tool_parts()
            parts: list = []
            if msg.get("content"):
                parts.append(genai_types.Part(text=msg["content"]))
            for tc in msg.get("tool_calls") or []:
                name = tc["function"]["name"]
                id_to_name[tc["id"]] = name
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                parts.append(
                    genai_types.Part(
                        function_call=genai_types.FunctionCall(name=name, args=args),
                        thought_signature=_PAST_TURN_THOUGHT_SIGNATURE,
                    )
                )
            if parts:
                contents.append(genai_types.Content(role="model", parts=parts))
        elif role == "tool":
            name = id_to_name.get(msg.get("tool_call_id") or "")
            if not name:
                continue  # orphaned result (pair split before trimming guard existed)
            pending_tool_parts.append(
                genai_types.Part.from_function_response(
                    name=name, response=_tool_result_to_response_dict(msg.get("content") or "")
                )
            )
    flush_tool_parts()
    return contents


def _visible_text(response) -> str:
    """Joined non-thought text parts, '' when blocked or function-call-only
    (response.text logs a warning on mixed parts)."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates or not candidates[0].content:
        return ""
    parts = candidates[0].content.parts or []
    return "".join(p.text for p in parts if p.text and not p.thought).strip()


# Teens disclose self-harm/abuse here BY DESIGN — the brain must respond
# supportively and fire raise_safeguarding_concern, not have its reply
# filtered at exactly that moment. BLOCK_ONLY_HIGH keeps a guardrail on
# output without silencing those turns.
BRAIN_SAFETY_SETTINGS = [
    genai_types.SafetySetting(category=category, threshold="BLOCK_ONLY_HIGH")
    for category in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]

# Shown when Gemini returns no usable text (safety block / truncation) — never
# leave a young person staring at an empty bubble.
FALLBACK_REPLY = (
    "Sorry — I couldn't write a reply just then. Could you say that again "
    "another way? If you need a real person, contact " + YOPEY_SAFEGUARDING_CONTACT
)


def _diagnose_empty_reply(response, where: str) -> None:
    """One log line explaining WHY a reply had no visible text — finish_reason
    MAX_TOKENS means thinking ate the output budget, SAFETY means filtered.
    Remote debugging on Render depends on this line."""
    try:
        cand = (getattr(response, "candidates", None) or [None])[0]
        usage = getattr(response, "usage_metadata", None)
        print(
            f"[chat] empty reply at {where}: "
            f"finish_reason={getattr(cand, 'finish_reason', None)} "
            f"thoughts_tokens={getattr(usage, 'thoughts_token_count', None)} "
            f"output_tokens={getattr(usage, 'candidates_token_count', None)} "
            f"prompt_feedback={getattr(response, 'prompt_feedback', None)}"
        )
    except Exception as e:
        print(f"[chat] empty reply at {where} (diagnostics failed: {e})")


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

    # Bot-personalised system prompt: inject user's known details + contacts +
    # the teen-facing YOPEY safeguarding contact (used in the safeguarding flows).
    sys_prompt = (
        SYSTEM_PROMPT
        + f"\n\n== YOPEY SAFEGUARDING CONTACT (a real person — use this when "
        + f"signposting) ==\n{YOPEY_SAFEGUARDING_CONTACT}\n"
        + f"\n== KNOWN USER DETAILS ==\n"
        + f"First name: {user.get('first_name')}\n"
        + f"Age: {user.get('age')}\n"
        + (f"Surname: {user.get('surname')}\n" if user.get("surname") else "")
        + (f"Email: {user.get('email')}\n" if user.get("email") else "")
        + (f"Postcode: {user.get('postcode')}\n" if user.get("postcode") else "")
        + _build_contacts_context(user_id)
    )

    def _brain_config(allow_tools: bool) -> genai_types.GenerateContentConfig:
        return genai_types.GenerateContentConfig(
            system_instruction=sys_prompt,
            tools=GEMINI_TOOLS,
            # mode=NONE on the follow-up mirrors the old no-tools second call
            # while keeping declarations consistent with the function_call
            # parts already in context.
            tool_config=genai_types.ToolConfig(
                function_calling_config=genai_types.FunctionCallingConfig(
                    mode="AUTO" if allow_tools else "NONE"
                )
            ),
            # Thinking tokens count toward max_output_tokens — a tight cap
            # truncates mid-thought into an empty visible reply (seen live:
            # 2048 wasn't enough for thinking + a 5-home listing). Cap, not
            # cost: typical replies are far smaller.
            max_output_tokens=8192,
            thinking_config=genai_types.ThinkingConfig(thinking_level="LOW"),
            safety_settings=BRAIN_SAFETY_SETTINGS,
            # temperature deliberately unset: Gemini 3 guidance is to keep the
            # default 1.0 — lowering it degrades reasoning.
        )

    contents = _history_to_gemini_contents(_trim_history(history))

    response = gemini_client.models.generate_content(
        model=BRAIN_MODEL, contents=contents, config=_brain_config(allow_tools=True)
    )

    function_calls = response.function_calls or []
    if function_calls:
        # Reused verbatim in the follow-up — carries the thought signatures
        # Gemini 3 validates on the live turn.
        model_content = response.candidates[0].content

        # Gemini doesn't return call ids; synthesize them so the stored
        # history keeps the OpenAI shape the dashboard and converter expect.
        call_ids = [fc.id or f"call_{os.urandom(12).hex()}" for fc in function_calls]
        history.append({
            "role": "assistant",
            "content": _visible_text(response) or None,
            "tool_calls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {"name": fc.name, "arguments": json.dumps(dict(fc.args or {}))},
                }
                for call_id, fc in zip(call_ids, function_calls)
            ],
        })

        response_parts = []
        for call_id, fc in zip(call_ids, function_calls):
            result = execute_tool(
                fc.name, dict(fc.args or {}), user_id, trigger_message=user_message
            )
            history.append({
                "role": "tool",
                "tool_call_id": call_id,
                "content": result,
            })
            response_parts.append(
                genai_types.Part.from_function_response(
                    name=fc.name, response=_tool_result_to_response_dict(result)
                )
            )

        follow_up = gemini_client.models.generate_content(
            model=BRAIN_MODEL,
            contents=contents
            + [model_content, genai_types.Content(role="user", parts=response_parts)],
            config=_brain_config(allow_tools=False),
        )
        assistant_reply = _visible_text(follow_up)
        if not assistant_reply:
            _diagnose_empty_reply(follow_up, "follow-up")
            assistant_reply = FALLBACK_REPLY
    else:
        assistant_reply = _visible_text(response)
        if not assistant_reply:
            _diagnose_empty_reply(response, "first-call")
            assistant_reply = FALLBACK_REPLY

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
    """
    Frontend collects everything on the wizard before /chat starts.
    All required fields are enforced here so direct API callers (or stale
    clients) can't create half-built users.
    """
    first_name: str = Field(min_length=1, max_length=50)
    surname: str = Field(min_length=1, max_length=50)
    age: int = Field(ge=16, le=120, description="Must be 16 or older")
    email: EmailStr
    phone: str = Field(min_length=5, max_length=20)
    home_postcode: str = Field(min_length=3, max_length=10)
    is_student: bool
    school_name: Optional[str] = Field(default=None, max_length=120)
    school_postcode: Optional[str] = Field(default=None, max_length=10)
    search_preference: Literal["home", "school"]
    utm_source: Optional[str] = None


class SurveyRequest(BaseModel):
    """
    Dementia Attitudes Scale, 10 Likert questions (1=Strongly Disagree, 7=Strongly Agree).
    """
    user_id: str
    survey_type: Literal["pre", "post"] = "pre"
    q1_afraid: int = Field(ge=1, le=7)
    q2_confident: int = Field(ge=1, le=7)
    q3_comfortable_touching: int = Field(ge=1, le=7)
    q4_uncomfortable: int = Field(ge=1, le=7)
    q5_different_needs: int = Field(ge=1, le=7)
    q6_past_history: int = Field(ge=1, le=7)
    q7_relaxed: int = Field(ge=1, le=7)
    q8_feel_kindness: int = Field(ge=1, le=7)
    q9_frustrated: int = Field(ge=1, le=7)
    q10_difficult_behaviour: int = Field(ge=1, le=7)


# The 10 question fields, exported for response shape symmetry
SURVEY_QUESTION_FIELDS = [
    "q1_afraid", "q2_confident", "q3_comfortable_touching", "q4_uncomfortable",
    "q5_different_needs", "q6_past_history", "q7_relaxed", "q8_feel_kindness",
    "q9_frustrated", "q10_difficult_behaviour",
]


class OnboardResponse(BaseModel):
    user_id: str
    user_token: str  # HMAC token — frontend stores in localStorage + sends on subsequent requests
    first_name: str
    postcode: Optional[str] = None


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


def require_user_token(
    user_id: str,
    x_user_token: str = Header(default=""),
    x_dashboard_password: str = Header(default=""),
) -> None:
    """
    Accepts either:
      • X-User-Token: valid HMAC token for the path user_id (self-service), OR
      • X-Dashboard-Password: dashboard admin password (Tony's admin actions)
    """
    if x_dashboard_password and x_dashboard_password == DASHBOARD_PASSWORD:
        return
    if verify_user_token(user_id, x_user_token):
        return
    raise HTTPException(status_code=401, detail="Missing or invalid credentials")


# ---- Public endpoints ----

@app.get("/health")
def health():
    # `llm` doubles as a deploy marker — confirms which build/backend is live.
    return {"ok": True, "llm": f"gemini/{GEMINI_BACKEND} ({BRAIN_MODEL})"}


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


class UserMeResponse(BaseModel):
    user_id: str
    first_name: str
    surname: Optional[str] = None
    email: Optional[str] = None
    postcode: Optional[str] = None
    status: Optional[str] = None


@app.get(
    "/api/user/{user_id}",
    response_model=UserMeResponse,
    dependencies=[Depends(require_user_token)],
)
def user_me_endpoint(user_id: str):
    """
    Returns the canonical user record. The frontend calls this on chat-open
    to sync localStorage with any server-side changes (e.g. the bot called
    save_user_details to update the postcode mid-chat). Safe-fields only,
    no PII the user didn't already supply themselves.
    """
    _require_services()
    user = get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserMeResponse(
        user_id=user["id"],
        first_name=user["first_name"],
        surname=user.get("surname"),
        email=user.get("email"),
        postcode=user.get("postcode"),
        status=user.get("status"),
    )


class DeleteAccountResponse(BaseModel):
    status: str
    deleted_rows: dict


@app.delete(
    "/api/user/{user_id}",
    response_model=DeleteAccountResponse,
    dependencies=[Depends(require_user_token)],
)
def delete_user_endpoint(user_id: str):
    """
    UK GDPR Art 17 (Right to Erasure). Cascades to all related rows.

    Auth model: knowing the user_id is the only credential — same as for
    /api/chat. Because user_id is a UUIDv4 (~122 bits of entropy), it acts
    as a session token and is only known to the device that completed
    onboarding. If a teen wants to delete from a different device, they can
    contact hello@yopey.org for a manual delete.
    """
    _require_services()
    if not get_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")

    counts: dict[str, int] = {}
    # ON DELETE CASCADE on the foreign keys handles contacts, conversations,
    # training_progress, email_responses, survey_responses. We still tally what's
    # about to go for the response body so the user has a receipt.
    for table in (
        "contacts",
        "conversations",
        "training_progress",
        "email_responses",
        "survey_responses",
    ):
        try:
            res = supabase.table(table).select("id", count="exact").eq("user_id", user_id).execute()
            counts[table] = res.count or 0
        except Exception:
            counts[table] = 0

    try:
        supabase.table("users").delete().eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")

    counts["users"] = 1
    print(f"[gdpr] Account deleted for user {redact_id(user_id)}")
    return DeleteAccountResponse(status="deleted", deleted_rows=counts)


class GeocodeSchoolResponse(BaseModel):
    postcode: str


@app.get("/api/geocode-school", response_model=GeocodeSchoolResponse)
@limiter.limit("30/minute")
def geocode_school_endpoint(request: Request, name: str):
    """
    Called by Step 1 of the wizard before advancing — pre-validates that we
    can find a postcode for the school the teen typed in. Strict input
    sanitisation: strip control chars + cap length so a long name can't be
    used to inject prompt instructions into the downstream LLM call.
    """
    # Strip control chars + newlines, collapse whitespace, cap length
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", name or "").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)[:120]
    if len(cleaned) < 2:
        raise HTTPException(status_code=400, detail="Please type a school name first.")
    geocoded = _geocode_school(cleaned)
    if not geocoded:
        raise HTTPException(
            status_code=404,
            detail=(
                "We couldn't find that school. Please check the spelling — try "
                "the full official name (e.g. 'University of Liverpool', not 'UoL')."
            ),
        )
    return GeocodeSchoolResponse(postcode=geocoded["postcode"])


class PrecomputeSearchRequest(BaseModel):
    postcode: str = Field(min_length=3, max_length=10)


def _run_precompute(postcode: str) -> None:
    try:
        result = search_care_homes(postcode, radius_miles=1, max_results=5)
        print(
            f"[precompute] {redact_postcode(postcode)}: "
            f"{len(result.get('results', []))} homes cached"
        )
    except Exception as e:
        # Don't fail the wizard for a precompute miss — chat will retry
        print(f"[precompute] failed for {redact_postcode(postcode)}: {e}")


@app.post("/api/precompute-search", status_code=202)
@limiter.limit("20/minute")
def precompute_search_endpoint(
    req: PrecomputeSearchRequest, request: Request, background_tasks: BackgroundTasks
):
    """
    Warm the care_home_searches cache for a postcode while the teen is still
    filling out the survey + consent steps. The frontend fires this after the
    Step-1 "Continue" press so the /chat auto-search hits a warm cache.

    Responds 202 immediately; the search runs as a background task after the
    response, so the wizard's fire-and-forget fetch never waits on (or gets
    cut off by) a long search. Idempotent: a cached hit short-circuits inside
    search_care_homes anyway.
    """
    _require_services()
    pc = req.postcode.strip().upper()
    if not UK_POSTCODE_PATTERN.search(pc):
        raise HTTPException(status_code=422, detail="Not a valid UK postcode.")
    background_tasks.add_task(_run_precompute, pc)
    return {"status": "warming"}


@app.post("/api/cron/daily")
def cron_daily(x_cron_secret: str = Header(default="")):
    """
    Fires the due reminder emails: contact nudges (3/5/7/10 days) and the
    post-match drip. The walkers exist but nothing in-process schedules them
    — a GitHub Actions workflow (.github/workflows/daily-reminders.yml) hits
    this endpoint once a day with the shared secret.
    """
    if not CRON_SECRET or not hmac.compare_digest(x_cron_secret, CRON_SECRET):
        raise HTTPException(status_code=401, detail="Bad or missing x-cron-secret")
    nudges = send_nudge_reminders()
    drips = send_post_match_drip()
    print(f"[cron] daily run: {nudges} nudges, {drips} post-match emails sent")
    return {"nudges_sent": nudges, "post_match_sent": drips}


class ReturnLinkRequest(BaseModel):
    email: EmailStr


class ReturnExchangeRequest(BaseModel):
    token: str


class ReturnExchangeResponse(BaseModel):
    user_id: str
    user_token: str
    first_name: str
    postcode: Optional[str] = None
    is_student: Optional[bool] = None
    search_preference: Optional[str] = None


# Magic-link login token lifetime
RETURN_TOKEN_TTL_MINUTES = 30


@app.post("/api/request-return-link")
@limiter.limit("5/minute")
def request_return_link(req: ReturnLinkRequest, request: Request):
    """
    Email an already-onboarded user a one-click link back into their session.
    Always returns the same generic response so an attacker can't use this to
    learn which emails are registered (no enumeration).
    """
    _require_services()
    email = str(req.email).strip().lower()
    try:
        found = supabase.table("users").select("id, first_name").eq("email", email).limit(1).execute()
    except Exception:
        found = None

    if found and found.data:
        user_id = found.data[0]["id"]
        exp = (datetime.now(timezone.utc) + timedelta(minutes=RETURN_TOKEN_TTL_MINUTES)).isoformat()
        token = make_token({"k": "login", "u": user_id, "exp": exp})
        link = f"{FRONTEND_BASE_URL}/return?token={token}"
        subject = "Your link back into YOPEY Befriender"
        body = (
            f"Hi {found.data[0].get('first_name') or 'there'},\n\n"
            "Here's your secure link to pick up where you left off — find another "
            "care home, ask for advice, or get help polishing a visit report:\n\n"
            f"{link}\n\n"
            f"This link works for {RETURN_TOKEN_TTL_MINUTES} minutes and only on "
            "this account. If you didn't ask for it, you can ignore this email.\n\n"
            "— YOPEY"
        )
        if send_email(email, subject, body):
            print(f"[return] link emailed to {redact_email(email)}")
        else:
            # Resend not configured — log the link so dev/testing still works.
            print(f"[return] (email not sent) link for {redact_email(email)}: {link}")

    return {"sent": True}


@app.post("/api/return/exchange", response_model=ReturnExchangeResponse)
@limiter.limit("10/minute")
def return_exchange(req: ReturnExchangeRequest, request: Request):
    """Validate a magic-link token and hand back the session credentials."""
    _require_services()
    data = verify_token(req.token)
    if not data or data.get("k") != "login":
        raise HTTPException(status_code=400, detail="This link is invalid.")

    # Expiry check
    exp = data.get("exp")
    try:
        exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00")) if exp else None
        if exp_dt and exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
    except Exception:
        exp_dt = None
    if not exp_dt or exp_dt < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This link has expired. Please request a new one.")

    user = get_user(data["u"])
    if not user:
        raise HTTPException(status_code=404, detail="Account not found.")

    return ReturnExchangeResponse(
        user_id=user["id"],
        user_token=make_user_token(user["id"]),
        first_name=user["first_name"],
        postcode=user.get("postcode"),
        is_student=user.get("is_student"),
        search_preference=user.get("search_preference"),
    )


@app.post("/api/onboard", response_model=OnboardResponse)
@limiter.limit("10/minute")
def onboard_endpoint(req: OnboardRequest, request: Request):
    """Called by the pre-chat wizard. Creates or upserts user record."""
    _require_services()

    # If they're a student and want to search near school, derive the school
    # postcode from the school name. (The wizard no longer asks for school
    # postcode — most teens don't know it offhand.)
    resolved_school_postcode = req.school_postcode
    if req.is_student and req.school_name and not resolved_school_postcode:
        geocoded = _geocode_school(req.school_name)
        if geocoded:
            resolved_school_postcode = geocoded["postcode"]
            print(
                f"[onboard] Geocoded school '{redact_school_name(req.school_name)}' → "
                f"{redact_postcode(resolved_school_postcode)}"
            )
        elif req.search_preference == "school":
            # They explicitly chose school-based search and we can't find it.
            # Don't silently switch to home — let them know so they can fix it.
            raise HTTPException(
                status_code=400,
                detail=(
                    "We couldn't find a postcode for that school. Please check "
                    "the spelling and try again, or switch to 'Near home' search."
                ),
            )

    try:
        user = create_user(
            first_name=req.first_name,
            age=req.age,
            surname=req.surname,
            email=str(req.email),
            phone=req.phone,
            home_postcode=req.home_postcode,
            school_name=req.school_name,
            school_postcode=resolved_school_postcode,
            is_student=req.is_student,
            search_preference=req.search_preference,
            utm_source=req.utm_source,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create user: {e}")
    return OnboardResponse(
        user_id=user["id"],
        user_token=make_user_token(user["id"]),
        first_name=user["first_name"],
        postcode=user.get("postcode"),
    )


@app.post("/api/survey")
@limiter.limit("20/minute")
def survey_endpoint(req: SurveyRequest, request: Request, x_user_token: str = Header(default="")):
    """User-token gated. Anyone with the user_id alone can't poison the slot."""
    if not verify_user_token(req.user_id, x_user_token):
        raise HTTPException(status_code=401, detail="Missing or invalid user token")
    """
    Store a Dementia Attitudes Scale response. Called from the onboard wizard
    AFTER /api/onboard, and (later, v1.1) at the end of a YB's journey for the
    'post' survey.
    """
    _require_services()
    # User must exist (the wizard will have just created them)
    if not get_user(req.user_id):
        raise HTTPException(status_code=404, detail="User not found")

    payload: dict[str, Any] = {
        "user_id": req.user_id,
        "survey_type": req.survey_type,
        **{q: getattr(req, q) for q in SURVEY_QUESTION_FIELDS},
    }
    try:
        # Idempotent: re-submitting the same (user, type) silently no-ops
        existing = (
            supabase.table("survey_responses")
            .select("id")
            .eq("user_id", req.user_id)
            .eq("survey_type", req.survey_type)
            .limit(1)
            .execute()
        )
        if existing.data:
            return {"status": "already_submitted"}
        supabase.table("survey_responses").insert(payload).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save survey: {e}")

    print(f"[survey] {req.survey_type}-survey stored for user {redact_id(req.user_id)}")
    return {"status": "saved"}


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


@app.get("/api/dashboard/survey-stats", dependencies=[Depends(require_dashboard_auth)])
def dashboard_survey_stats():
    """Per-question average across all pre-volunteering surveys."""
    res = supabase.table("survey_responses").select("*").eq("survey_type", "pre").execute()
    rows = res.data or []
    averages: dict[str, Optional[float]] = {}
    for q in SURVEY_QUESTION_FIELDS:
        vals = [r[q] for r in rows if r.get(q) is not None]
        averages[q] = round(sum(vals) / len(vals), 2) if vals else None
    return {"count": len(rows), "averages": averages}


@app.get("/api/dashboard/surveys", dependencies=[Depends(require_dashboard_auth)])
def dashboard_surveys():
    """Individual survey responses joined with user name/email for Tony's review."""
    res = supabase.table("dashboard_survey_pre").select("*").limit(500).execute()
    return res.data or []


@app.get("/api/dashboard/safeguarding", dependencies=[Depends(require_dashboard_auth)])
def dashboard_safeguarding():
    """Safeguarding alerts, newest first, joined with the young person's details."""
    res = (
        supabase.table("safeguarding_alerts")
        .select("*, users(first_name, surname, email, age)")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
    )
    rows = res.data or []
    out = []
    for r in rows:
        u = r.get("users") or {}
        out.append({
            "id": r["id"],
            "user_id": r["user_id"],
            "full_name": ((u.get("first_name") or "") + " " + (u.get("surname") or "")).strip(),
            "email": u.get("email"),
            "age": u.get("age"),
            "category": r["category"],
            "severity": r["severity"],
            "summary": r.get("summary"),
            "notified_email": r.get("notified_email"),
            "resolved": r.get("resolved"),
            "resolved_by": r.get("resolved_by"),
            "resolved_at": r.get("resolved_at"),
            "created_at": r["created_at"],
        })
    return out


@app.get("/api/dashboard/conversation/{user_id}", dependencies=[Depends(require_dashboard_auth)])
def dashboard_conversation(user_id: str):
    """
    Returns a user's chat transcript — but ONLY if there is at least one
    safeguarding alert for them. This enforces the data-minimisation choice:
    the safeguarding lead can read transcripts for flagged conversations only,
    not browse everyone's chats.
    """
    flag = (
        supabase.table("safeguarding_alerts")
        .select("id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not flag.data:
        raise HTTPException(
            status_code=403,
            detail="Transcripts are viewable only for conversations with a safeguarding flag.",
        )
    raw = load_conversation(user_id)
    # Strip tool plumbing — show only the human-readable turns.
    transcript = [
        {"role": m["role"], "content": m.get("content") or ""}
        for m in raw
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    return {"user_id": user_id, "messages": transcript}


class ResolveAlertRequest(BaseModel):
    resolved_by: str = Field(min_length=1, max_length=80)
    notes: Optional[str] = None


@app.post(
    "/api/dashboard/safeguarding/{alert_id}/resolve",
    dependencies=[Depends(require_dashboard_auth)],
)
def resolve_safeguarding(alert_id: str, req: ResolveAlertRequest):
    """Mark a safeguarding alert as actioned by a named person."""
    try:
        supabase.table("safeguarding_alerts").update({
            "resolved": True,
            "resolved_by": req.resolved_by,
            "resolved_at": _now_iso(),
            "notes": req.notes,
        }).eq("id", alert_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not resolve: {e}")
    return {"status": "resolved"}


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
