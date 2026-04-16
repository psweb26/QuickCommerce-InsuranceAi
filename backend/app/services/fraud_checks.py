from datetime import timedelta
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.live_ops_service import latest_two_pings, velocity_between_pings
from app.utils.time import utc_now


async def impossible_velocity_check(db: AsyncIOMotorDatabase, worker_id: str) -> dict[str, Any]:
    pings = await latest_two_pings(db=db, worker_id=worker_id)
    if len(pings) < 2:
        return {
            "flagged": False,
            "reason": "Insufficient pings",
            "speed_kmph": 0.0,
            "distance_km": 0.0,
            "hours": 0.0,
        }

    velocity = velocity_between_pings(pings[0], pings[1])
    flagged = float(velocity["speed_kmph"]) > 100.0
    return {
        "flagged": flagged,
        "reason": "Fraud: GPS Spoofed" if flagged else "Velocity normal",
        "speed_kmph": float(velocity["speed_kmph"]),
        "distance_km": float(velocity["distance_km"]),
        "hours": float(velocity["delta_hours"]),
    }


def _bound(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(value, upper))


def _required_signal(disruption_type: str, severity: float) -> dict[str, float]:
    if disruption_type == "rain":
        return {"metric": "rain_mm", "required": 8 + (severity * 20)}
    if disruption_type == "flood":
        return {"metric": "rain_mm", "required": 20 + (severity * 25)}
    if disruption_type == "heat":
        return {"metric": "heat_index_c", "required": 37 + (severity * 8)}
    if disruption_type == "pollution":
        return {"metric": "aqi", "required": 180 + (severity * 120)}
    if disruption_type == "traffic":
        return {"metric": "traffic_delay_index", "required": 0.55 + (severity * 0.25)}
    return {"metric": "", "required": 0.0}


async def weather_cross_check(db: AsyncIOMotorDatabase, disruption: dict[str, Any]) -> dict[str, Any]:
    disruption_type = str(disruption.get("type", ""))
    severity = float(disruption.get("severity", 0.5))
    city = str(disruption.get("city", ""))
    zones = disruption.get("affected_zones", [])
    zone = str(zones[0]) if zones else ""

    required = _required_signal(disruption_type=disruption_type, severity=severity)
    if not required["metric"]:
        return {
            "mismatch": False,
            "confidence": 0.0,
            "reason": "No weather cross-check required",
            "metric": required["metric"],
            "required_value": required["required"],
            "observed_value": 0.0,
            "high_risk": False,
        }

    since = utc_now() - timedelta(hours=24)
    rows = await db.weather_history.find(
        {
            "city": city,
            "zone": zone,
            "captured_at": {"$gte": since},
        }
    ).to_list(length=300)

    metric_name = required["metric"]
    if not rows:
        return {
            "mismatch": False,
            "confidence": 0.0,
            "reason": "No historical weather data",
            "metric": metric_name,
            "required_value": required["required"],
            "observed_value": 0.0,
            "high_risk": False,
        }

    observed = max(float(item.get(metric_name, 0.0)) for item in rows)
    required_value = float(required["required"])
    mismatch = observed < required_value
    confidence = _bound((required_value - observed) / max(required_value, 1e-6)) if mismatch else 0.0

    return {
        "mismatch": mismatch,
        "confidence": round(confidence, 4),
        "reason": "Weather signal mismatch" if mismatch else "Weather signal validated",
        "metric": metric_name,
        "required_value": round(required_value, 4),
        "observed_value": round(observed, 4),
        "high_risk": bool(mismatch and confidence >= 0.45),
    }

