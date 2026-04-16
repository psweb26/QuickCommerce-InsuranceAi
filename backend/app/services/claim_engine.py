from datetime import datetime
import hashlib
import random
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.fraud_engine import calculate_fraud_risk
from app.services.live_ops_service import record_worker_ping
from app.utils.time import utc_now


def _bounded(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def _duration_hours(start_time: datetime, end_time: datetime) -> float:
    return max((end_time - start_time).total_seconds() / 3600, 0.5)


def _simulate_actual_orders(
    worker_id: str,
    disruption_id: str,
    expected_orders: float,
    severity: float,
    reliability_score: float,
) -> float:
    digest = hashlib.sha256(f"{worker_id}:{disruption_id}".encode("utf-8")).hexdigest()
    rnd = random.Random(int(digest[:16], 16))

    disruption_impact = severity * rnd.uniform(0.72, 1.0)
    resilience = (reliability_score - 0.5) * 0.25
    noise = rnd.uniform(-0.08, 0.12)
    order_ratio = _bounded(1 - disruption_impact + resilience + noise)

    return round(max(0, expected_orders * order_ratio), 3)


def _make_txn_id(worker_id: str, disruption_id: str) -> str:
    digest = hashlib.sha256(f"{worker_id}:{disruption_id}:{utc_now().isoformat()}".encode("utf-8")).hexdigest()
    return f"UPI{digest[:10].upper()}"


async def process_disruption_event(db: AsyncIOMotorDatabase, disruption: dict[str, Any]) -> dict[str, int]:
    summary = {
        "claims_generated": 0,
        "approved_claims": 0,
        "blocked_claims": 0,
        "review_claims": 0,
    }

    zone_filter = {"zone": {"$in": disruption["affected_zones"]}}
    workers = db.workers.find(zone_filter)

    async for worker in workers:
        worker_id = str(worker["_id"])
        disruption_id = str(disruption["_id"])

        existing = await db.claims.find_one(
            {
                "worker_id": worker_id,
                "disruption_id": disruption_id,
            }
        )
        if existing:
            continue

        policy = await db.policies.find_one(
            {
                "worker_id": worker_id,
                "status": "active",
                "end_date": {"$gte": utc_now()},
                "remaining_coverage": {"$gt": 0},
            }
        )
        if not policy:
            continue

        if int(policy.get("claims_used", 0)) >= int(policy.get("max_claims_per_week", 8)):
            continue

        duration_hours = _duration_hours(disruption["start_time"], disruption["end_time"])
        expected_orders = round(float(worker["avg_orders_per_hour"]) * duration_hours, 3)

        reliability_score = float(policy.get("reliability_score", worker.get("current_reliability_score", 0.7)))
        policy_risk_score = float(policy.get("risk_score", worker.get("current_risk_score", 0.5)))
        severity = float(disruption.get("severity", 0.4))

        actual_orders = _simulate_actual_orders(
            worker_id=worker_id,
            disruption_id=disruption_id,
            expected_orders=expected_orders,
            severity=severity,
            reliability_score=reliability_score,
        )

        if expected_orders <= 0:
            work_loss_ratio = 0.0
        else:
            work_loss_ratio = _bounded((expected_orders - actual_orders) / expected_orders)

        # For critical disruptions, enforce a minimum loss floor so the demo flow
        # consistently reflects severe real-world income impact.
        if severity >= 0.9 and expected_orders > 0 and work_loss_ratio < 0.55:
            work_loss_ratio = 0.55
            actual_orders = round(expected_orders * (1 - work_loss_ratio), 3)

        claim_doc: dict[str, Any] = {
            "worker_id": worker_id,
            "policy_id": str(policy["_id"]),
            "disruption_id": disruption_id,
            "disruption_type": disruption["type"],
            "duration_hours": round(duration_hours, 3),
            "severity": round(severity, 3),
            "expected_orders": expected_orders,
            "actual_orders": actual_orders,
            "work_loss_ratio": round(work_loss_ratio, 4),
            "fraud_risk_score": 0.0,
            "payout_amount": 0.0,
            "payout_txn_id": None,
            "payout_ledger_id": None,
            "payout_message": None,
            "status": "rejected",
            "reason": "Work loss ratio below threshold",
            "impossible_velocity_flag": False,
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }

        eligibility_threshold = 0.4 if policy_risk_score < 0.3 else 0.5
        is_eligible = work_loss_ratio >= eligibility_threshold

        if is_eligible:
            await record_worker_ping(db=db, worker=worker)
            fraud_result = await calculate_fraud_risk(
                db=db,
                worker=worker,
                disruption=disruption,
                expected_orders=expected_orders,
                actual_orders=actual_orders,
            )
            frs = float(fraud_result["fraud_risk_score"])
            if policy_risk_score < 0.3:
                frs = max(0.0, frs - 0.12)
            gps_spoofed = bool(fraud_result.get("gps_spoofed", False))
            weather_mismatch_high = bool(fraud_result.get("weather_mismatch_high", False))
            if bool(fraud_result.get("impossible_velocity_flag", False)) and frs < 0.72:
                frs = 0.72
            claim_doc["fraud_risk_score"] = round(frs, 4)
            claim_doc["impossible_velocity_flag"] = bool(fraud_result.get("impossible_velocity_flag", False))

            if gps_spoofed:
                claim_doc["status"] = "blocked"
                claim_doc["reason"] = "Fraud: GPS Spoofed"
                summary["blocked_claims"] += 1
            elif frs >= 0.6:
                claim_doc["status"] = "blocked"
                claim_doc["reason"] = "Blocked by fraud engine (FRS too high)"
                summary["blocked_claims"] += 1
            elif weather_mismatch_high:
                claim_doc["status"] = "under_review"
                claim_doc["reason"] = "Flagged by weather cross-check"
                summary["review_claims"] += 1
            elif frs >= 0.45:
                claim_doc["status"] = "under_review"
                claim_doc["reason"] = "Flagged for review by fraud engine"
                summary["review_claims"] += 1
            else:
                weekly_income = float(worker["weekly_income"])
                daily_income = weekly_income / 7
                exposure_score = float(policy.get("exposure_score", worker.get("current_exposure_score", 0.4)))

                personalization_factor = 0.8 + (0.2 * reliability_score) + (0.1 * exposure_score)
                payout_percent = min(severity * personalization_factor, 1.25)
                duration_factor = min(duration_hours / 24, 1)

                payout_amount = round(daily_income * payout_percent * duration_factor, 2)
                payout_amount = min(payout_amount, float(policy["remaining_coverage"]))

                if payout_amount > 0:
                    txn_id = _make_txn_id(worker_id, disruption_id)
                    claim_doc["status"] = "approved"
                    claim_doc["reason"] = "Auto-approved by parametric trigger"
                    claim_doc["payout_amount"] = payout_amount
                    claim_doc["payout_txn_id"] = txn_id
                    claim_doc["payout_message"] = (
                        f"INSTANT PAYOUT: Rs {payout_amount} credited to UPI {worker['upi_id']} (Txn: {txn_id})"
                    )

                    await db.policies.update_one(
                        {"_id": policy["_id"]},
                        {
                            "$inc": {"claims_used": 1},
                            "$set": {
                                "remaining_coverage": round(float(policy["remaining_coverage"]) - payout_amount, 2),
                                "updated_at": utc_now(),
                            },
                        },
                    )

                    await db.payout_notifications.insert_one(
                        {
                            "worker_id": worker_id,
                            "claim_id": None,
                            "message": claim_doc["payout_message"],
                            "transaction_id": txn_id,
                            "trigger_event": disruption["type"],
                            "upi_id": worker["upi_id"],
                            "amount": payout_amount,
                            "created_at": utc_now(),
                        }
                    )

                    payout_ledger_result = await db.payouts.insert_one(
                        {
                            "worker_id": worker_id,
                            "amount": payout_amount,
                            "trigger_event": disruption["type"],
                            "timestamp": utc_now(),
                            "transaction_id": txn_id,
                            "claim_id": None,
                            "created_at": utc_now(),
                        }
                    )
                    claim_doc["payout_ledger_id"] = str(payout_ledger_result.inserted_id)

                    summary["approved_claims"] += 1
                else:
                    claim_doc["status"] = "rejected"
                    claim_doc["reason"] = "Coverage exhausted"

            if claim_doc["fraud_risk_score"] >= 0.35:
                await db.fraud_logs.insert_one(
                    {
                        "worker_id": worker_id,
                        "worker_code": worker.get("worker_id", worker_id),
                        "claim_id": None,
                        "fraud_risk_score": claim_doc["fraud_risk_score"],
                        "action": claim_doc["status"],
                        "signals": fraud_result["signals"],
                        "created_at": utc_now(),
                    }
                )

        insert_result = await db.claims.insert_one(claim_doc)
        summary["claims_generated"] += 1

        if claim_doc["status"] == "approved":
            await db.payout_notifications.update_many(
                {
                    "worker_id": worker_id,
                    "claim_id": None,
                    "message": claim_doc["payout_message"],
                },
                {"$set": {"claim_id": str(insert_result.inserted_id)}},
            )

            await db.payouts.update_one(
                {"transaction_id": claim_doc["payout_txn_id"]},
                {"$set": {"claim_id": str(insert_result.inserted_id)}},
            )

        if claim_doc["fraud_risk_score"] >= 0.35:
            await db.fraud_logs.update_many(
                {
                    "worker_id": worker_id,
                    "claim_id": None,
                    "fraud_risk_score": claim_doc["fraud_risk_score"],
                    "action": claim_doc["status"],
                },
                {"$set": {"claim_id": str(insert_result.inserted_id)}},
            )

    return summary

