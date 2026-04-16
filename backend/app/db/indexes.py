from pymongo import ASCENDING, DESCENDING
from motor.motor_asyncio import AsyncIOMotorDatabase


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db.workers.create_index([("phone", ASCENDING)], unique=True)
    await db.workers.create_index([("worker_id", ASCENDING)], unique=True)
    await db.workers.create_index([("zone", ASCENDING), ("city", ASCENDING)])

    await db.otp_sessions.create_index([("phone", ASCENDING), ("created_at", DESCENDING)])
    await db.otp_sessions.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)

    await db.policies.create_index([("worker_id", ASCENDING), ("status", ASCENDING)])
    await db.policies.create_index([("end_date", ASCENDING)])

    await db.disruptions.create_index([("start_time", DESCENDING)])
    await db.disruptions.create_index([("type", ASCENDING), ("affected_zones", ASCENDING)])

    await db.claims.create_index([("worker_id", ASCENDING), ("created_at", DESCENDING)])
    await db.claims.create_index([("disruption_id", ASCENDING), ("worker_id", ASCENDING)], unique=True)

    await db.payouts.create_index([("worker_id", ASCENDING), ("timestamp", DESCENDING)])
    await db.payouts.create_index([("transaction_id", ASCENDING)], unique=True)

    await db.fraud_logs.create_index([("created_at", DESCENDING)])
    await db.worker_pings.create_index([("worker_id", ASCENDING), ("pinged_at", DESCENDING)])
    await db.worker_pings.create_index([("city", ASCENDING), ("zone", ASCENDING), ("pinged_at", DESCENDING)])
    await db.weather_history.create_index([("city", ASCENDING), ("zone", ASCENDING), ("captured_at", DESCENDING)])

