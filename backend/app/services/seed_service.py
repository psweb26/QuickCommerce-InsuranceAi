from datetime import timedelta
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.monitoring_service import create_manual_disruption
from app.services.policy_service import create_policy_for_worker
from app.utils.time import utc_now


SAMPLE_WORKERS: list[dict[str, Any]] = [
    {
        "name": "Aarav Singh",
        "age": 27,
        "phone": "9000000001",
        "delivery_platform": "Blinkit",
        "worker_id": "BLK-MUM-001",
        "city": "Mumbai",
        "state": "Maharashtra",
        "zone": "Andheri-West",
        "weekly_income": 7800,
        "experience_months": 18,
        "avg_orders_per_hour": 3.3,
        "working_hours_per_day": 9,
        "gps_permission": True,
        "upi_id": "aarav@upi",
    },
    {
        "name": "Isha Mehta",
        "age": 31,
        "phone": "9000000002",
        "delivery_platform": "Zepto",
        "worker_id": "ZPT-BLR-004",
        "city": "Bengaluru",
        "state": "Karnataka",
        "zone": "Koramangala",
        "weekly_income": 9100,
        "experience_months": 28,
        "avg_orders_per_hour": 3.8,
        "working_hours_per_day": 8.5,
        "gps_permission": True,
        "upi_id": "isha@oksbi",
    },
    {
        "name": "Rohan Das",
        "age": 24,
        "phone": "9000000003",
        "delivery_platform": "Instamart",
        "worker_id": "INS-KOL-003",
        "city": "Kolkata",
        "state": "West Bengal",
        "zone": "Salt-Lake",
        "weekly_income": 6900,
        "experience_months": 9,
        "avg_orders_per_hour": 2.9,
        "working_hours_per_day": 10,
        "gps_permission": True,
        "upi_id": "rohan@okicici",
    },
    {
        "name": "Sneha Nair",
        "age": 29,
        "phone": "9000000004",
        "delivery_platform": "Blinkit",
        "worker_id": "BLK-DEL-009",
        "city": "Delhi",
        "state": "Delhi",
        "zone": "Rohini",
        "weekly_income": 8400,
        "experience_months": 14,
        "avg_orders_per_hour": 3.1,
        "working_hours_per_day": 9,
        "gps_permission": True,
        "upi_id": "sneha@okhdfc",
    },
    {
        "name": "Kabir Khan",
        "age": 33,
        "phone": "9000000005",
        "delivery_platform": "Zepto",
        "worker_id": "ZPT-HYD-002",
        "city": "Hyderabad",
        "state": "Telangana",
        "zone": "Gachibowli",
        "weekly_income": 9600,
        "experience_months": 34,
        "avg_orders_per_hour": 4.1,
        "working_hours_per_day": 8,
        "gps_permission": True,
        "upi_id": "kabir@okaxis",
    },
]


async def _compute_financials(db: AsyncIOMotorDatabase) -> dict[str, float]:
    premium_result = await db.policies.aggregate([{"$group": {"_id": None, "total": {"$sum": "$premium_amount"}}}]).to_list(1)
    payout_ledger = await db.payouts.aggregate([{"$group": {"_id": None, "total": {"$sum": "$amount"}}}]).to_list(1)
    payout_claims = (
        await db.claims.aggregate(
            [
                {"$match": {"status": "approved"}},
                {"$group": {"_id": None, "total": {"$sum": "$payout_amount"}}},
            ]
        ).to_list(1)
    )

    total_premium = float(premium_result[0]["total"]) if premium_result else 0.0
    total_payout_ledger = float(payout_ledger[0]["total"]) if payout_ledger else 0.0
    total_payout_claims = float(payout_claims[0]["total"]) if payout_claims else 0.0
    total_payout = max(total_payout_ledger, total_payout_claims)
    loss_ratio = (total_payout / total_premium) if total_premium else 0.0

    return {
        "total_premium": round(total_premium, 2),
        "total_payout": round(total_payout, 2),
        "loss_ratio": round(loss_ratio, 4),
    }


async def _reset_demo_collections(db: AsyncIOMotorDatabase) -> None:
    await db.claims.delete_many({})
    await db.policies.delete_many({})
    await db.disruptions.delete_many({})
    await db.payouts.delete_many({})
    await db.payout_notifications.delete_many({})
    await db.fraud_logs.delete_many({})
    await db.worker_pings.delete_many({})
    await db.weather_history.delete_many({})
    await db.otp_sessions.delete_many({})
    await db.workers.delete_many({})


async def _build_workers_and_policies(db: AsyncIOMotorDatabase) -> list[dict[str, Any]]:
    workers: list[dict[str, Any]] = []
    now = utc_now()

    for worker_template in SAMPLE_WORKERS:
        worker_doc = {
            **worker_template,
            "completed_orders": 132,
            "assigned_orders": 144,
            "weekly_working_hours": worker_template["working_hours_per_day"] * 6,
            "fraud_flags": 0.02,
            "created_at": now,
            "updated_at": now,
        }
        result = await db.workers.insert_one(worker_doc)
        worker_doc["_id"] = result.inserted_id
        await create_policy_for_worker(db, worker_doc)
        workers.append(worker_doc)

    return workers


async def _build_premium_history(db: AsyncIOMotorDatabase, workers: list[dict[str, Any]], target_premium: float = 7000) -> int:
    cycles = 0
    financials = await _compute_financials(db)

    while financials["total_premium"] < target_premium and cycles < 25:
        for worker in workers:
            current_worker = await db.workers.find_one({"_id": worker["_id"]})
            if current_worker:
                await create_policy_for_worker(db, current_worker)
        cycles += 1
        financials = await _compute_financials(db)

    return cycles


async def _build_target_payouts(
    db: AsyncIOMotorDatabase,
    workers: list[dict[str, Any]],
    target_payout: float = 4500,
) -> tuple[int, int]:
    events_created = 0
    approved_claims = 0
    city_zone_pairs = list({(worker["city"], worker["zone"]) for worker in workers})
    all_zones = sorted({worker["zone"] for worker in workers})
    sequence = [
        ("store_outage", 0.94, 9.0),
        ("server_outage", 0.91, 8.0),
        ("traffic", 0.9, 7.0),
        ("rain", 0.88, 8.0),
    ]

    financials = await _compute_financials(db)
    cursor = 0
    guard = 0

    while financials["total_payout"] < target_payout and guard < 32:
        now = utc_now()
        disruption_type, severity, hours = sequence[cursor % len(sequence)]
        city, zone = city_zone_pairs[cursor % len(city_zone_pairs)]
        affected_zones = all_zones if (cursor % 2 == 0) else [zone]
        event_city = "India-Urban-Grid" if len(affected_zones) > 1 else city

        event = {
            "type": disruption_type,
            "severity": severity,
            "city": event_city,
            "affected_zones": affected_zones,
            "start_time": now,
            "end_time": now + timedelta(hours=hours),
            "source": "seed-target-payout",
            "trigger_metrics": {"manual": True, "seed_payout_target": True},
            "created_at": now,
        }
        created = await create_manual_disruption(db, event)
        events_created += 1

        claims_count = await db.claims.count_documents({"disruption_id": created["_id"], "status": "approved"})
        approved_claims += claims_count

        cursor += 1
        guard += 1
        financials = await _compute_financials(db)

    return events_created, approved_claims


async def _rebalance_to_sustainable_ratio(
    db: AsyncIOMotorDatabase,
    workers: list[dict[str, Any]],
    min_ratio: float = 0.6,
    max_ratio: float = 0.75,
) -> dict[str, float | int]:
    premium_cycles = 0
    payout_events = 0

    financials = await _compute_financials(db)

    while financials["loss_ratio"] > max_ratio and premium_cycles < 18:
        for worker in workers:
            current_worker = await db.workers.find_one({"_id": worker["_id"]})
            if current_worker:
                await create_policy_for_worker(db, current_worker)
        premium_cycles += 1
        financials = await _compute_financials(db)

    all_zones = sorted({worker["zone"] for worker in workers})
    while financials["loss_ratio"] < min_ratio and payout_events < 16:
        now = utc_now()
        city, zone = workers[payout_events % len(workers)]["city"], workers[payout_events % len(workers)]["zone"]
        affected_zones = all_zones if payout_events % 2 == 0 else [zone]
        event_city = "India-Urban-Grid" if len(affected_zones) > 1 else city
        event = {
            "type": "store_outage",
            "severity": 0.95,
            "city": event_city,
            "affected_zones": affected_zones,
            "start_time": now,
            "end_time": now + timedelta(hours=8),
            "source": "seed-ratio-rebalance",
            "trigger_metrics": {"manual": True, "seed_ratio_rebalance": True},
            "created_at": now,
        }
        await create_manual_disruption(db, event)
        payout_events += 1
        financials = await _compute_financials(db)

    return {
        "premium_cycles": premium_cycles,
        "payout_events": payout_events,
        "total_premium": financials["total_premium"],
        "total_payout": financials["total_payout"],
        "loss_ratio": financials["loss_ratio"],
    }


async def _seed_demo_fraud_logs(db: AsyncIOMotorDatabase) -> int:
    workers = await db.workers.find({}).to_list(length=3)
    now = utc_now()
    created = 0

    template_entries = [
        ("under_review", 0.74, 121.3, 2.12),
        ("blocked", 0.91, 138.7, 2.56),
        ("under_review", 0.79, 129.8, 2.21),
    ]

    for index, worker in enumerate(workers):
        action, frs, speed, jump = template_entries[index % len(template_entries)]
        await db.fraud_logs.insert_one(
            {
                "worker_id": str(worker["_id"]),
                "worker_code": worker.get("worker_id", str(worker["_id"])),
                "claim_id": None,
                "fraud_risk_score": frs,
                "action": action,
                "signals": {
                    "ImpossibleVelocityFlag": True,
                    "SpeedKmph": speed,
                    "LocationJumpKm": jump,
                    "LocationConsistency": 0.24,
                    "SpeedValidation": 0.11,
                },
                "created_at": now - timedelta(minutes=(index * 7)),
            }
        )
        created += 1

    return created


async def seed_demo_data(db: AsyncIOMotorDatabase) -> dict[str, int]:
    await _reset_demo_collections(db)
    workers = await _build_workers_and_policies(db)
    premium_cycles = await _build_premium_history(db, workers, target_premium=7000)
    disruptions_detected, claims_generated = await _build_target_payouts(db, workers, target_payout=4500)
    ratio_adjustment = await _rebalance_to_sustainable_ratio(db, workers, min_ratio=0.6, max_ratio=0.75)
    fraud_logs_created = await _seed_demo_fraud_logs(db)

    return {
        "workers_created": len(workers),
        "zones_checked": len({(worker["city"], worker["zone"]) for worker in workers}),
        "disruptions_detected": disruptions_detected,
        "claims_generated": claims_generated,
        "premium_cycles": premium_cycles,
        "loss_ratio": int(round(float(ratio_adjustment["loss_ratio"]) * 100)),
        "total_premium": int(round(float(ratio_adjustment["total_premium"]))),
        "total_payout": int(round(float(ratio_adjustment["total_payout"]))),
        "fraud_logs_created": fraud_logs_created,
    }

