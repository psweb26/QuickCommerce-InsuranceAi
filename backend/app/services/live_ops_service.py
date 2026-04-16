from datetime import datetime, timedelta, timezone
import hashlib
import random
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.geospatial_service import (
    build_disruption_geofence,
    get_zone_center,
    haversine_km,
    offset_point,
    point_in_radius,
)
from app.utils.ids import serialize_document
from app.utils.time import utc_now


def _seeded_random(worker_id: str, bucket: int) -> random.Random:
    digest = hashlib.sha256(f"{worker_id}:{bucket}".encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def _as_utc(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        parsed = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(parsed)
    else:
        dt = utc_now()

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _bucket_key() -> int:
    return int(utc_now().timestamp() // 15)


def _worker_filters(city: str | None = None, zone: str | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if city:
        query["city"] = city
    if zone:
        query["zone"] = zone
    return query


async def record_worker_ping(db: AsyncIOMotorDatabase, worker: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    worker_id = str(worker["_id"])
    bucket = _bucket_key()
    rnd = _seeded_random(worker_id, bucket)

    previous = await db.worker_pings.find_one({"worker_id": worker_id}, sort=[("pinged_at", -1)])
    if previous:
        base_lat = float(previous["lat"])
        base_lng = float(previous["lng"])
        previous_pinged_at = _as_utc(previous["pinged_at"])
        elapsed_minutes = max((now - previous_pinged_at).total_seconds() / 60, 0.25)
    else:
        base_lat, base_lng = get_zone_center(city=worker.get("city", ""), zone=worker.get("zone", ""))
        elapsed_minutes = 0.25

    fraud_bias = max(0.0, min(float(worker.get("fraud_flags", 0.03)), 1.0))
    jump_km = rnd.uniform(0.05, 0.65)
    if previous and rnd.random() < max(0.05, min(0.04 + (fraud_bias * 1.7), 0.28)):
        jump_km = rnd.uniform(2.2, 5.4)

    bearing = rnd.uniform(0, 360)
    lat, lng = offset_point(base_lat, base_lng, jump_km, bearing)
    speed_kmph = jump_km / (elapsed_minutes / 60)

    ping_doc = {
        "worker_id": worker_id,
        "worker_code": worker.get("worker_id", worker_id),
        "city": worker.get("city"),
        "zone": worker.get("zone"),
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "speed_kmph": round(speed_kmph, 3),
        "jump_km": round(jump_km, 4),
        "bucket": bucket,
        "pinged_at": now,
    }

    await db.worker_pings.insert_one(ping_doc)
    return ping_doc


async def generate_worker_pings(
    db: AsyncIOMotorDatabase,
    city: str | None = None,
    zone: str | None = None,
) -> list[dict[str, Any]]:
    workers = await db.workers.find(_worker_filters(city=city, zone=zone)).to_list(length=500)
    generated: list[dict[str, Any]] = []
    for worker in workers:
        generated.append(await record_worker_ping(db, worker))

    # Keep worker ping history bounded to reduce growth.
    await db.worker_pings.delete_many({"pinged_at": {"$lt": utc_now() - timedelta(hours=48)}})
    return generated


async def _fetch_latest_worker_pings(
    db: AsyncIOMotorDatabase,
    city: str | None = None,
    zone: str | None = None,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if city:
        query["city"] = city
    if zone:
        query["zone"] = zone

    rows = await db.worker_pings.find(query).sort("pinged_at", -1).to_list(length=3000)
    latest: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        wid = str(row["worker_id"])
        if wid in seen:
            continue
        seen.add(wid)
        latest.append(row)
    return latest


async def _active_disruptions(
    db: AsyncIOMotorDatabase,
    city: str | None = None,
    zone: str | None = None,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"end_time": {"$gte": utc_now()}}
    if city:
        query["city"] = city
    if zone:
        query["affected_zones"] = zone

    disruptions = await db.disruptions.find(query).sort("severity", -1).to_list(length=200)
    for disruption in disruptions:
        if disruption.get("geofence"):
            continue
        fallback_zone = disruption.get("affected_zones", [disruption.get("city", "")])[0]
        geofence = build_disruption_geofence(
            city=str(disruption.get("city", "")),
            zone=str(fallback_zone),
            severity=float(disruption.get("severity", 0.5)),
        )
        disruption["geofence"] = geofence
        await db.disruptions.update_one({"_id": disruption["_id"]}, {"$set": {"geofence": geofence}})

    return disruptions


def _ping_enrichment(ping: dict[str, Any], disruptions: list[dict[str, Any]]) -> dict[str, Any]:
    lat = float(ping["lat"])
    lng = float(ping["lng"])
    matched_disruptions: list[str] = []

    for disruption in disruptions:
        geofence = disruption.get("geofence", {})
        center_lat = float(geofence.get("center_lat", 0.0))
        center_lng = float(geofence.get("center_lng", 0.0))
        radius_km = float(geofence.get("radius_km", 0.0))
        if not radius_km:
            continue
        if point_in_radius(lat, lng, center_lat, center_lng, radius_km):
            matched_disruptions.append(str(disruption.get("type", "")))

    enriched = serialize_document(ping) or {}
    enriched["eligible"] = bool(matched_disruptions)
    enriched["matching_disruptions"] = matched_disruptions
    return enriched


async def compute_live_operations_snapshot(
    db: AsyncIOMotorDatabase,
    city: str | None = None,
    zone: str | None = None,
) -> dict[str, Any]:
    disruptions = await _active_disruptions(db=db, city=city, zone=zone)
    await generate_worker_pings(db=db, city=city, zone=zone)
    latest_pings = await _fetch_latest_worker_pings(db=db, city=city, zone=zone)

    serialized_disruptions = [serialize_document(item) for item in disruptions]
    enriched_pings = [_ping_enrichment(ping=item, disruptions=disruptions) for item in latest_pings]

    eligible_workers = sum(1 for ping in enriched_pings if ping.get("eligible"))
    avg_speed = (
        sum(float(ping.get("speed_kmph", 0)) for ping in enriched_pings) / len(enriched_pings)
        if enriched_pings
        else 0.0
    )

    return {
        "city_filter": city,
        "zone_filter": zone,
        "disruptions": serialized_disruptions,
        "worker_pings": enriched_pings,
        "summary": {
            "active_disruptions": len(serialized_disruptions),
            "workers_tracked": len(enriched_pings),
            "eligible_workers": eligible_workers,
            "avg_worker_speed_kmph": round(avg_speed, 2),
        },
    }


async def latest_two_pings(db: AsyncIOMotorDatabase, worker_id: str) -> list[dict[str, Any]]:
    return await db.worker_pings.find({"worker_id": worker_id}).sort("pinged_at", -1).to_list(length=2)


def velocity_between_pings(ping1: dict[str, Any], ping2: dict[str, Any]) -> dict[str, float]:
    dist_km = haversine_km(
        float(ping1["lat"]),
        float(ping1["lng"]),
        float(ping2["lat"]),
        float(ping2["lng"]),
    )
    ping1_time = _as_utc(ping1.get("pinged_at"))
    ping2_time = _as_utc(ping2.get("pinged_at"))
    delta_hours = max(abs((ping1_time - ping2_time).total_seconds()) / 3600, 0.001)
    speed_kmph = dist_km / delta_hours
    return {"distance_km": round(dist_km, 4), "delta_hours": round(delta_hours, 4), "speed_kmph": round(speed_kmph, 3)}
