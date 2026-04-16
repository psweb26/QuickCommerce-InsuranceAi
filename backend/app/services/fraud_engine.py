from datetime import timedelta
import hashlib
import random
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.fraud_checks import impossible_velocity_check, weather_cross_check
from app.utils.time import utc_now


def _bounded(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def _rnd(worker_id: str, disruption_id: str) -> random.Random:
    digest = hashlib.sha256(f"{worker_id}:{disruption_id}".encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


async def calculate_fraud_risk(
    db: AsyncIOMotorDatabase,
    worker: dict[str, Any],
    disruption: dict[str, Any],
    expected_orders: float,
    actual_orders: float,
) -> dict[str, Any]:
    worker_id = str(worker["_id"])
    disruption_id = str(disruption["_id"])
    rnd = _rnd(worker_id, disruption_id)

    base_fraud = float(worker.get("fraud_flags", 0.03))
    impossible_velocity = await impossible_velocity_check(db=db, worker_id=worker_id)
    weather_check = await weather_cross_check(db=db, disruption=disruption)

    # Deterministic synthetic signals + rule-based checks.
    gps_spoofed = bool(impossible_velocity["flagged"])
    speed_kmph = float(impossible_velocity.get("speed_kmph", 0.0))
    speed_validation = _bounded(1 - max(0.0, speed_kmph - 80.0) / 140.0)
    location_consistency = _bounded((0.25 if gps_spoofed else 0.88) - (base_fraud * 0.18) - rnd.uniform(0.0, 0.08))
    ip_gps_mismatch = _bounded((base_fraud * 0.75) + rnd.uniform(0.03, 0.42))

    if expected_orders <= 0:
        activity_mismatch = 0.0
    else:
        activity_mismatch = _bounded(abs(expected_orders - actual_orders) / expected_orders)

    two_weeks_ago = utc_now() - timedelta(days=14)
    historical_claim_spike = await db.claims.count_documents(
        {
            "worker_id": worker_id,
            "created_at": {"$gte": two_weeks_ago},
            "status": {"$in": ["approved", "under_review", "blocked"]},
        }
    )
    historical_anomaly = _bounded(historical_claim_spike / 10)

    location_risk = 1 - location_consistency
    device_risk = 1 - speed_validation
    impossible_velocity_risk = 1.0 if gps_spoofed else 0.0
    weather_penalty = 0.15 if bool(weather_check.get("mismatch")) else 0.0
    weather_mismatch_high = bool(weather_check.get("high_risk"))

    fraud_risk_score = _bounded(
        (0.21 * location_risk)
        + (0.14 * device_risk)
        + (0.16 * ip_gps_mismatch)
        + (0.16 * activity_mismatch)
        + (0.1 * historical_anomaly)
        + (0.13 * impossible_velocity_risk)
        + weather_penalty
    )

    if gps_spoofed and fraud_risk_score < 0.72:
        fraud_risk_score = 0.72

    signals = {
        "LocationConsistency": round(location_consistency, 4),
        "SpeedValidation": round(speed_validation, 4),
        "IPvsGPSMismatch": round(ip_gps_mismatch, 4),
        "ActivityMismatch": round(activity_mismatch, 4),
        "HistoricalAnomaly": round(historical_anomaly, 4),
        "LocationJumpKm": round(float(impossible_velocity.get("distance_km", 0.0)), 4),
        "SpeedKmph": round(speed_kmph, 3),
        "ImpossibleVelocityFlag": gps_spoofed,
        "ImpossibleVelocityKmph": round(speed_kmph, 3),
        "GpsSpoofed": gps_spoofed,
        "WeatherMismatch": bool(weather_check.get("mismatch")),
        "WeatherCheckConfidence": float(weather_check.get("confidence", 0.0)),
        "WeatherObservedValue": float(weather_check.get("observed_value", 0.0)),
        "WeatherRequiredValue": float(weather_check.get("required_value", 0.0)),
    }

    return {
        "fraud_risk_score": round(fraud_risk_score, 4),
        "signals": signals,
        "impossible_velocity_flag": gps_spoofed,
        "gps_spoofed": gps_spoofed,
        "weather_mismatch_high": weather_mismatch_high,
        "weather_mismatch": bool(weather_check.get("mismatch")),
    }

