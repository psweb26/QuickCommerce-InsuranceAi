from datetime import datetime
from pydantic import BaseModel


class DisruptionGeofence(BaseModel):
    center_lat: float
    center_lng: float
    radius_km: float


class DisruptionEventCreate(BaseModel):
    type: str
    severity: float
    affected_zones: list[str]
    city: str
    duration_hours: float = 1.0


class DisruptionResponse(BaseModel):
    id: str
    type: str
    severity: float
    city: str
    affected_zones: list[str]
    start_time: datetime
    end_time: datetime
    source: str
    trigger_metrics: dict[str, float | bool]
    geofence: DisruptionGeofence | None = None

