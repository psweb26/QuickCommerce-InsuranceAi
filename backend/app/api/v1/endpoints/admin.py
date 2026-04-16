from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_db
from app.models.disruption import DisruptionEventCreate
from app.services.analytics_service import disruption_analytics, fetch_admin_metrics
from app.services.live_ops_service import compute_live_operations_snapshot
from app.services.monitoring_service import create_manual_disruption, run_monitoring_cycle
from app.services.predictive_analytics_service import compute_predictive_risk
from app.utils.ids import serialize_document
from app.utils.time import utc_now

router = APIRouter()


@router.get("/metrics")
async def admin_metrics(db: AsyncIOMotorDatabase = Depends(get_db)):
    metrics = await fetch_admin_metrics(db)
    return {"success": True, "metrics": metrics}


@router.get("/disruption-analytics")
async def admin_disruption_analytics(db: AsyncIOMotorDatabase = Depends(get_db)):
    analytics = await disruption_analytics(db)
    return {"success": True, "items": analytics}


@router.get("/fraud-alerts")
async def admin_fraud_alerts(db: AsyncIOMotorDatabase = Depends(get_db)):
    rows = await db.fraud_logs.find({}).sort("created_at", -1).to_list(length=100)
    return {"success": True, "items": [serialize_document(item) for item in rows]}


@router.get("/claims")
async def admin_recent_claims(db: AsyncIOMotorDatabase = Depends(get_db)):
    rows = await db.claims.find({}).sort("created_at", -1).to_list(length=200)
    return {"success": True, "items": [serialize_document(item) for item in rows]}


@router.get("/workers")
async def admin_workers(db: AsyncIOMotorDatabase = Depends(get_db)):
    rows = await db.workers.find({}).sort("created_at", -1).to_list(length=200)
    return {"success": True, "items": [serialize_document(item) for item in rows]}


@router.get("/live-operations")
async def admin_live_operations(
    city: str | None = Query(default=None),
    zone: str | None = Query(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    payload = await compute_live_operations_snapshot(db=db, city=city, zone=zone)
    return {"success": True, **payload}


@router.get("/predictive-risk")
async def admin_predictive_risk(
    lookback_days: int = Query(default=21, ge=7, le=90),
    horizon_days: int = Query(default=7, ge=1, le=30),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    payload = await compute_predictive_risk(
        db=db,
        lookback_days=lookback_days,
        horizon_days=horizon_days,
    )
    return {"success": True, **payload}


@router.post("/run-monitoring")
async def run_monitoring(db: AsyncIOMotorDatabase = Depends(get_db)):
    summary = await run_monitoring_cycle(db)
    return {
        "success": True,
        "message": "Monitoring cycle completed",
        "summary": summary,
    }


@router.post("/trigger-disruption")
async def admin_trigger_disruption(
    event: DisruptionEventCreate | None = None,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    payload = event or DisruptionEventCreate(
        type="rain",
        severity=0.95,
        affected_zones=["Andheri-West"],
        city="Mumbai",
        duration_hours=6,
    )
    now = utc_now()

    disruption_doc = {
        "type": payload.type,
        "severity": max(0.1, min(payload.severity, 1.0)),
        "city": payload.city,
        "affected_zones": payload.affected_zones,
        "start_time": now,
        "end_time": now + timedelta(hours=max(0.5, payload.duration_hours)),
        "source": "admin-god-mode",
        "trigger_metrics": {
            "manual": True,
            "admin_trigger": True,
            "severity": payload.severity,
        },
        "created_at": now,
    }

    created_event = await create_manual_disruption(db, disruption_doc)
    return {
        "success": True,
        "message": "God Mode disruption triggered and claims auto-processed",
        "event": created_event,
    }

