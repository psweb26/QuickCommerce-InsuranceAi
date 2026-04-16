from datetime import timedelta
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.claim_engine import process_disruption_event
from app.services.disruption_provider import collect_zone_signal, detect_disruptions_from_signal
from app.services.geospatial_service import build_disruption_geofence
from app.services.policy_service import renew_expired_policies
from app.utils.ids import serialize_document
from app.utils.time import utc_now


async def run_monitoring_cycle(db: AsyncIOMotorDatabase) -> dict[str, int]:
    await renew_expired_policies(db)

    workers = await db.workers.find({}).to_list(length=None)
    zones = {(worker["city"], worker["zone"]) for worker in workers}

    summary = {
        "zones_checked": len(zones),
        "disruptions_detected": 0,
        "claims_generated": 0,
        "approved_claims": 0,
        "blocked_claims": 0,
        "review_claims": 0,
    }

    now = utc_now()

    for city, zone in zones:
        signal = await collect_zone_signal(city=city, zone=zone, db=db)
        disruptions = detect_disruptions_from_signal(city=city, zone=zone, signal=signal)

        for disruption in disruptions:
            existing = await db.disruptions.find_one(
                {
                    "type": disruption["type"],
                    "city": city,
                    "affected_zones": zone,
                    "end_time": {"$gte": now - timedelta(minutes=30)},
                }
            )

            if existing:
                continue

            disruption["geofence"] = build_disruption_geofence(
                city=city,
                zone=zone,
                severity=float(disruption.get("severity", 0.5)),
            )
            result = await db.disruptions.insert_one(disruption)
            disruption["_id"] = result.inserted_id

            summary["disruptions_detected"] += 1

            claim_summary = await process_disruption_event(db, disruption)
            summary["claims_generated"] += claim_summary["claims_generated"]
            summary["approved_claims"] += claim_summary["approved_claims"]
            summary["blocked_claims"] += claim_summary["blocked_claims"]
            summary["review_claims"] += claim_summary["review_claims"]

    return summary


async def create_manual_disruption(db: AsyncIOMotorDatabase, event: dict[str, Any]) -> dict[str, Any]:
    if not event.get("geofence"):
        zone = (event.get("affected_zones") or [event.get("city", "")])[0]
        event["geofence"] = build_disruption_geofence(
            city=str(event.get("city", "")),
            zone=str(zone),
            severity=float(event.get("severity", 0.5)),
        )
    result = await db.disruptions.insert_one(event)
    event["_id"] = result.inserted_id

    await process_disruption_event(db, event)
    return serialize_document(event)

