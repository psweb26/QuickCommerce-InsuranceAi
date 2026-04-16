from datetime import timedelta
from statistics import mean
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.utils.time import utc_now


def _date_bucket_key(value) -> str:
    return value.strftime("%Y-%m-%d")


def _safe_pressure(row: dict[str, Any]) -> float:
    rain = min(max(float(row.get("rain_mm", 0.0)) / 35, 0.0), 1.0)
    aqi = min(max((float(row.get("aqi", 0.0)) - 100.0) / 200.0, 0.0), 1.0)
    heat = min(max((float(row.get("heat_index_c", 0.0)) - 32.0) / 16.0, 0.0), 1.0)
    traffic = min(max(float(row.get("traffic_delay_index", 0.0)), 0.0), 1.0)
    return round((rain + aqi + heat + traffic) / 4, 4)


def _moving_average(series: list[float], window: int = 7) -> float:
    if not series:
        return 0.0
    slice_size = min(len(series), window)
    return float(mean(series[-slice_size:]))


async def compute_predictive_risk(
    db: AsyncIOMotorDatabase,
    lookback_days: int = 21,
    horizon_days: int = 7,
) -> dict[str, Any]:
    lookback_days = max(7, min(lookback_days, 90))
    horizon_days = max(1, min(horizon_days, 30))

    today = utc_now().date()
    history_start = today - timedelta(days=lookback_days - 1)
    history_start_dt = utc_now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=lookback_days - 1)

    payout_rows = await db.payouts.find({"timestamp": {"$gte": history_start_dt}}).to_list(length=5000)
    weather_rows = await db.weather_history.find({"captured_at": {"$gte": history_start_dt}}).to_list(length=10000)

    payout_by_day: dict[str, float] = {}
    for row in payout_rows:
        key = _date_bucket_key(row["timestamp"].date())
        payout_by_day[key] = round(payout_by_day.get(key, 0.0) + float(row.get("amount", 0.0)), 4)

    pressure_by_day_samples: dict[str, list[float]] = {}
    for row in weather_rows:
        key = _date_bucket_key(row["captured_at"].date())
        pressure_by_day_samples.setdefault(key, []).append(_safe_pressure(row))

    pressure_by_day: dict[str, float] = {
        key: round(float(mean(values)), 4)
        for key, values in pressure_by_day_samples.items()
        if values
    }

    history: list[dict[str, Any]] = []
    payout_series: list[float] = []
    pressure_series: list[float] = []

    for i in range(lookback_days):
        day = history_start + timedelta(days=i)
        key = _date_bucket_key(day)
        payout = round(float(payout_by_day.get(key, 0.0)), 2)
        pressure = round(float(pressure_by_day.get(key, 0.0)), 4)
        history.append({"date": key, "payout": payout, "weather_pressure": pressure})
        payout_series.append(payout)
        pressure_series.append(pressure)

    forecast: list[dict[str, Any]] = []
    rolling_payouts = payout_series[:]
    rolling_pressures = pressure_series[:]

    for day_offset in range(1, horizon_days + 1):
        baseline = _moving_average(rolling_payouts, window=7)
        pressure_now = _moving_average(rolling_pressures, window=7)
        pressure_prev = _moving_average(rolling_pressures[:-7], window=7) if len(rolling_pressures) > 14 else pressure_now
        weather_delta = pressure_now - pressure_prev
        predicted = max(0.0, baseline * (1 + (0.15 * weather_delta)))
        predicted = round(predicted, 2)

        forecast_date = today + timedelta(days=day_offset)
        forecast.append(
            {
                "date": _date_bucket_key(forecast_date),
                "likely_payout": predicted,
                "weather_delta": round(weather_delta, 4),
            }
        )
        rolling_payouts.append(predicted)
        rolling_pressures.append(pressure_now)

    return {
        "model": "moving_average_weather_adjusted",
        "lookback_days": lookback_days,
        "horizon_days": horizon_days,
        "history": history,
        "forecast": forecast,
    }

