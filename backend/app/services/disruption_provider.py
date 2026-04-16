from datetime import timedelta
import hashlib
import random
from typing import Any

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.utils.time import utc_now


def _build_seed(city: str, zone: str) -> str:
    cycle = int(utc_now().timestamp() // 900)
    return f"{city}:{zone}:{cycle}"


def _seeded_random(city: str, zone: str) -> random.Random:
    seed = _build_seed(city, zone)
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


async def _fetch_weather(city: str) -> dict[str, float] | None:
    if not settings.openweather_api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                settings.openweather_base_url,
                params={"q": city, "appid": settings.openweather_api_key, "units": "metric"},
            )
            response.raise_for_status()
            data = response.json()

        rain = 0.0
        rain_block = data.get("rain", {})
        if isinstance(rain_block, dict):
            rain = float(rain_block.get("1h", 0.0))

        return {
            "rain_mm": rain,
            "temperature_c": float(data.get("main", {}).get("temp", 30)),
            "humidity": float(data.get("main", {}).get("humidity", 70)),
        }
    except Exception:
        return None


async def _fetch_aqi(city: str) -> dict[str, float] | None:
    if not settings.aqi_api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{settings.aqi_base_url}/{city}/", params={"token": settings.aqi_api_key})
            response.raise_for_status()
            data = response.json()

        return {
            "aqi": float(data.get("data", {}).get("aqi", 120)),
        }
    except Exception:
        return None


def _simulate_zone_signal(city: str, zone: str) -> dict[str, float | bool]:
    rnd = _seeded_random(city, zone)

    rain_mm = max(0.0, rnd.gauss(18, 12))
    aqi = max(40.0, rnd.gauss(190, 70))
    heat_index_c = max(28.0, rnd.gauss(40, 6))

    traffic_delay_index = min(max(rnd.uniform(0.2, 0.95), 0), 1)

    flood_alert = rain_mm > 30 and rnd.random() < 0.65
    curfew_active = rnd.random() < 0.07
    strike_active = rnd.random() < 0.12
    store_offline = rnd.random() < 0.16
    server_outage = rnd.random() < 0.14
    power_outage = rnd.random() < 0.2

    return {
        "rain_mm": round(rain_mm, 2),
        "aqi": round(aqi, 2),
        "heat_index_c": round(heat_index_c, 2),
        "traffic_delay_index": round(traffic_delay_index, 3),
        "flood_alert": flood_alert,
        "curfew_active": curfew_active,
        "strike_active": strike_active,
        "store_offline": store_offline,
        "server_outage": server_outage,
        "power_outage": power_outage,
    }


async def collect_zone_signal(
    city: str,
    zone: str,
    db: AsyncIOMotorDatabase | None = None,
) -> dict[str, float | bool]:
    base = _simulate_zone_signal(city, zone)
    weather = await _fetch_weather(city)
    aqi = await _fetch_aqi(city)

    if weather:
        base["rain_mm"] = round(float(weather["rain_mm"]), 2)
        base["heat_index_c"] = round(float(weather["temperature_c"]) + 4.0, 2)

    if aqi:
        base["aqi"] = round(float(aqi["aqi"]), 2)

    if db is not None:
        await db.weather_history.insert_one(
            {
                "city": city,
                "zone": zone,
                "rain_mm": float(base["rain_mm"]),
                "aqi": float(base["aqi"]),
                "heat_index_c": float(base["heat_index_c"]),
                "traffic_delay_index": float(base["traffic_delay_index"]),
                "captured_at": utc_now(),
            }
        )

    return base


def detect_disruptions_from_signal(
    city: str,
    zone: str,
    signal: dict[str, float | bool],
) -> list[dict[str, Any]]:
    now = utc_now()
    disruptions: list[dict[str, Any]] = []

    def build_event(disruption_type: str, severity: float, hours: float) -> dict[str, Any]:
        return {
            "type": disruption_type,
            "severity": round(max(0.1, min(severity, 1.0)), 3),
            "city": city,
            "affected_zones": [zone],
            "start_time": now,
            "end_time": now + timedelta(hours=max(0.5, hours)),
            "source": "simulated+api",
            "trigger_metrics": signal,
            "created_at": now,
        }

    rain = float(signal["rain_mm"])
    aqi = float(signal["aqi"])
    heat = float(signal["heat_index_c"])
    traffic = float(signal["traffic_delay_index"])

    if rain > 15:
        disruptions.append(build_event("rain", rain / 65, 2 + rain / 35))

    if bool(signal["flood_alert"]):
        disruptions.append(build_event("flood", min(1.0, 0.65 + rain / 90), 4 + rain / 40))

    if heat > 42:
        disruptions.append(build_event("heat", (heat - 34) / 18, 3 + (heat - 35) / 10))

    if aqi > 220:
        disruptions.append(build_event("pollution", (aqi - 180) / 280, 3 + (aqi - 180) / 150))

    if traffic > 0.65:
        disruptions.append(build_event("traffic", (traffic - 0.5) / 0.5, 1 + traffic * 4))

    if bool(signal["curfew_active"]):
        disruptions.append(build_event("curfew", 0.83, 6))

    if bool(signal["strike_active"]):
        disruptions.append(build_event("strike", 0.74, 5))

    if bool(signal["store_offline"]):
        disruptions.append(build_event("store_outage", 0.78, 4.5))

    if bool(signal["server_outage"]):
        disruptions.append(build_event("server_outage", 0.72, 3.5))

    if bool(signal["power_outage"]):
        disruptions.append(build_event("power_outage", 0.66, 2.5))

    return disruptions

