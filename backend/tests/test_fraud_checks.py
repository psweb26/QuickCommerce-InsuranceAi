from datetime import timedelta

import pytest

from app.services.fraud_checks import impossible_velocity_check, weather_cross_check
from app.utils.time import utc_now


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, length):
        return self._rows[:length]


class _Collection:
    def __init__(self, rows):
        self._rows = rows

    def find(self, *_args, **_kwargs):
        return _Cursor(self._rows)


class _FakeDB:
    def __init__(self, pings, weather):
        self.worker_pings = _Collection(pings)
        self.weather_history = _Collection(weather)


@pytest.mark.asyncio
async def test_impossible_velocity_check_flags_spoof():
    now = utc_now()
    db = _FakeDB(
        pings=[
            {"lat": 19.1365, "lng": 72.8295, "pinged_at": now},
            {"lat": 19.1765, "lng": 72.8895, "pinged_at": now - timedelta(minutes=1)},
        ],
        weather=[],
    )

    result = await impossible_velocity_check(db=db, worker_id="w1")
    assert result["flagged"] is True
    assert result["reason"] == "Fraud: GPS Spoofed"
    assert result["speed_kmph"] > 100


@pytest.mark.asyncio
async def test_weather_cross_check_flags_mismatch():
    now = utc_now()
    db = _FakeDB(
        pings=[],
        weather=[
            {
                "city": "Mumbai",
                "zone": "Andheri-West",
                "rain_mm": 2.0,
                "aqi": 120.0,
                "heat_index_c": 33.0,
                "traffic_delay_index": 0.32,
                "captured_at": now - timedelta(hours=1),
            }
        ],
    )

    disruption = {"type": "flood", "severity": 0.9, "city": "Mumbai", "affected_zones": ["Andheri-West"]}
    result = await weather_cross_check(db=db, disruption=disruption)
    assert result["mismatch"] is True
    assert result["high_risk"] is True
