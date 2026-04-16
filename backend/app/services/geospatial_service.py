import math
from typing import Any


CITY_CENTROIDS: dict[str, tuple[float, float]] = {
    "mumbai": (19.0760, 72.8777),
    "bengaluru": (12.9716, 77.5946),
    "bangalore": (12.9716, 77.5946),
    "kolkata": (22.5726, 88.3639),
    "delhi": (28.6139, 77.2090),
    "hyderabad": (17.3850, 78.4867),
    "chennai": (13.0827, 80.2707),
    "pune": (18.5204, 73.8567),
}


ZONE_CENTROIDS: dict[tuple[str, str], tuple[float, float]] = {
    ("mumbai", "andheri-west"): (19.1365, 72.8295),
    ("bengaluru", "koramangala"): (12.9352, 77.6245),
    ("kolkata", "salt-lake"): (22.5868, 88.4174),
    ("delhi", "rohini"): (28.7402, 77.1025),
    ("hyderabad", "gachibowli"): (17.4401, 78.3489),
}


def _normalize(value: str) -> str:
    return (value or "").strip().lower()


def geofence_radius_km(severity: float) -> float:
    raw_radius = 0.6 + (max(0.0, float(severity)) * 1.8)
    return round(max(0.8, min(raw_radius, 2.6)), 3)


def get_zone_center(city: str, zone: str) -> tuple[float, float]:
    key = (_normalize(city), _normalize(zone))
    if key in ZONE_CENTROIDS:
        return ZONE_CENTROIDS[key]

    city_key = _normalize(city)
    if city_key in CITY_CENTROIDS:
        return CITY_CENTROIDS[city_key]

    # India center fallback for unknown cities.
    return (20.5937, 78.9629)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    lat1_rad, lon1_rad = math.radians(lat1), math.radians(lon1)
    lat2_rad, lon2_rad = math.radians(lat2), math.radians(lon2)
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def point_in_radius(lat: float, lng: float, center_lat: float, center_lng: float, radius_km: float) -> bool:
    return haversine_km(lat, lng, center_lat, center_lng) <= radius_km


def offset_point(lat: float, lng: float, distance_km: float, bearing_deg: float) -> tuple[float, float]:
    bearing_rad = math.radians(bearing_deg)
    delta_lat = (distance_km / 111.0) * math.cos(bearing_rad)
    lon_scale = max(math.cos(math.radians(lat)), 0.1)
    delta_lng = (distance_km / (111.0 * lon_scale)) * math.sin(bearing_rad)
    return lat + delta_lat, lng + delta_lng


def build_disruption_geofence(city: str, zone: str, severity: float) -> dict[str, Any]:
    center_lat, center_lng = get_zone_center(city=city, zone=zone)
    return {
        "center_lat": round(center_lat, 6),
        "center_lng": round(center_lng, 6),
        "radius_km": geofence_radius_km(severity),
    }

