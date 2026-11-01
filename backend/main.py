"""BHOOMI AI backend (FastAPI + Gemini).

Run from the backend folder:   uvicorn main:app --reload
Needs backend/.env with at least:  GEMINI_API_KEY=...   (GOOGLE_API_KEY also works)
"""
import asyncio
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import dotenv_values, load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field

# ---------------------------------------------------------------- 1. settings
ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)   # override: the .env file wins over stale shell variables

API_KEY = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "").strip()          # tried if the main model is overloaded
THINKING = os.getenv("GEMINI_THINKING", "low").strip().lower()   # low = fast; high = slow but deeper
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
AUTH_ENABLED = bool(SUPABASE_URL and SUPABASE_ANON_KEY and "YOUR-" not in SUPABASE_URL)

if not API_KEY:
    # Do not crash the server: start up, and answer /api/ai/chat with a clear 503 instead.
    found = list(dotenv_values(ENV_PATH).keys()) if ENV_PATH.exists() else []
    print(f"WARNING: no Gemini key found. Looked in: {ENV_PATH} (exists: {ENV_PATH.exists()})")
    print(f"         variable names in that file: {found}")
    print("         add a line like  GEMINI_API_KEY=your-key  (no spaces, no quotes needed) and save the file.")
if not AUTH_ENABLED:
    print("WARNING: SUPABASE_URL / SUPABASE_ANON_KEY not set, so /api/ai/chat is NOT protected by login.")

client = genai.Client(api_key=API_KEY, http_options=types.HttpOptions(timeout=20_000)) if API_KEY else None


def thinking_config(model: str):
    """Gemini 3 models 'think' for a long time by default. Chat does not need that."""
    if model.startswith("gemini-3"):
        return types.ThinkingConfig(thinking_level=THINKING)      # 3.7 / 3.8 Flash reject "minimal", so default is "low"
    if model.startswith("gemini-2.5-flash"):
        return types.ThinkingConfig(thinking_budget=0)
    return None


RETRYABLE = {429, 500, 503, 504}      # "busy" type errors: worth trying again


async def generate_with_retry(contents, system_prompt: str):
    """Try the main model twice, then the fallback model (if set) twice. Overload spikes usually pass in seconds."""
    models = [MODEL] + ([FALLBACK_MODEL] if FALLBACK_MODEL and FALLBACK_MODEL != MODEL else [])
    last_error = None
    for model in models:
        for attempt in range(2):
            try:
                return await client.aio.models.generate_content(
                    model=model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=0.4,
                        max_output_tokens=2048,
                        thinking_config=thinking_config(model),
                    ),
                )
            except genai_errors.APIError as e:
                last_error = e
                print(f"Gemini API error {e.code} on {model} (try {attempt + 1}): {e.message}")
                if e.code in RETRYABLE and attempt == 0:
                    await asyncio.sleep(2)           # short pause, then one more try on the same model
                    continue
                if e.code in RETRYABLE or e.code == 404:
                    break                            # give up on this model, go to the fallback
                raise                                # 400 / 401 / 403: retrying will not help
    raise last_error

# ---------------------------------------------------------------- 2. app + CORS
app = FastAPI(title="BHOOMI AI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # tighten to your real frontend URL before deploying
    allow_credentials=False,        # we use a Bearer header, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------- 3. login check (Supabase token)
async def current_user(authorization: Optional[str] = Header(default=None)):
    if not AUTH_ENABLED:
        return None
    token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in to use the AI.")
    try:
        async with httpx.AsyncClient(timeout=8) as http:
            r = await http.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Sign-in service unreachable. Try again.")
    if r.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Your session expired. Please sign in again.")
    if r.status_code != 200:
        raise HTTPException(status_code=503, detail="Sign-in service error. Try again.")
    return r.json()

# ---------------------------------------------------------------- 4. data shapes
class Message(BaseModel):
    role: str
    content: str = Field(max_length=4000)

class ChatRequest(BaseModel):
    messages: List[Message] = Field(min_length=1, max_length=40)
    context: Optional[Dict[str, Any]] = None

# ---------------------------------------------------------------- 5. helpers
def val(weather: Dict[str, Any], key: str, unit: str) -> str:
    v = weather.get(key)
    return f"{v} {unit}".strip() if isinstance(v, (int, float)) else "not available"

def build_system_prompt(weather: Dict[str, Any]) -> str:
    has_weather = any(isinstance(weather.get(k), (int, float)) for k in ("temperature_c", "humidity_pct"))
    data = f"""LIVE WEATHER (source: Open-Meteo, observed at {weather.get('observed_at', 'unknown time')}):
- Temperature: {val(weather, 'temperature_c', '°C')}
- Feels like: {val(weather, 'feels_like_c', '°C')}
- Humidity: {val(weather, 'humidity_pct', '%')}
- Rain in the last hour: {val(weather, 'precipitation_mm', 'mm')}
- Wind speed: {val(weather, 'wind_kmh', 'km/h')}""" if has_weather else "LIVE WEATHER: not available right now."
    return f"""You are BHOOMI AI, a practical farming advisor for farmers in India.
Answer in short, plain sentences. Use plain text only: no markdown, no asterisks, no headings.
Base weather-related advice ONLY on the data below. Never invent numbers, forecasts or prices.
If something you need is not in the data, say so and tell the farmer what to check.
If live weather is not available, say that and give general guidance only.

{data}"""

def to_contents(messages: List[Message]) -> List[types.Content]:
    """Gemini wants roles 'user' / 'model'. Merge neighbours with the same role."""
    merged: List[Dict[str, str]] = []
    for m in messages:
        role = "user" if m.role == "user" else "model"
        text = m.content.strip()
        if not text:
            continue
        if merged and merged[-1]["role"] == role:
            merged[-1]["text"] += "\n" + text
        else:
            merged.append({"role": role, "text": text})
    return [types.Content(role=m["role"], parts=[types.Part.from_text(text=m["text"])]) for m in merged]

# ---------------------------------------------------------------- 6. routes
@app.get("/api/health")
async def health():
    return {"ok": True, "gemini_key_loaded": bool(API_KEY), "model": MODEL, "login_required": AUTH_ENABLED}

@app.post("/api/ai/chat")
async def chat(request: ChatRequest, user=Depends(current_user)):
    if client is None:
        raise HTTPException(status_code=503, detail="The AI is not configured: GEMINI_API_KEY is missing in backend/.env.")

    contents = to_contents(request.messages)
    if not contents or contents[-1].role != "user":
        raise HTTPException(status_code=400, detail="The last message must be a question from the user.")

    weather = (request.context or {}).get("weather")
    weather = weather if isinstance(weather, dict) else {}

    try:
        response = await generate_with_retry(contents, build_system_prompt(weather))
    except genai_errors.APIError as e:
        if e.code == 404:
            raise HTTPException(status_code=502, detail=f"Model '{MODEL}' was not found. Set GEMINI_MODEL in backend/.env to a model your key can use.")
        if e.code == 429:
            raise HTTPException(status_code=429, detail="The free quota is used up or you are asking too fast. Try again in a minute.")
        if e.code in (500, 503, 504):
            raise HTTPException(status_code=503, detail="Gemini is very busy right now. Please try again in a few seconds.")
        if e.code in (400, 401, 403):
            raise HTTPException(status_code=502, detail="Gemini rejected the request. Check that GEMINI_API_KEY is valid.")
        raise HTTPException(status_code=502, detail="The AI service had a problem. Please try again.")
    except Exception as e:                                   # network, timeouts, anything unexpected
        print(f"Unexpected AI error: {e!r}")
        raise HTTPException(status_code=502, detail="Could not reach the AI service. Please try again.")

    reply = (response.text or "").strip()
    if not reply:
        raise HTTPException(status_code=502, detail="The AI sent an empty answer. Try rephrasing your question.")

    used_weather = any(isinstance(weather.get(k), (int, float)) for k in ("temperature_c", "humidity_pct"))
    sources = [{"name": "Open-Meteo (live weather)", "url": "https://open-meteo.com/"}] if used_weather else []
    return {"reply": reply, "sources": sources}
