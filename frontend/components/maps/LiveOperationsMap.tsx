"use client";

import { useMemo } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

import { percent, titleCase } from "@/lib/format";
import { LiveOperationsDisruption, WorkerPing } from "@/types";

const INDIA_CENTER: [number, number] = [20.5937, 78.9629];

function markerIcon(eligible: boolean) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:12px;
      height:12px;
      border-radius:999px;
      background:${eligible ? "#16a34a" : "#475569"};
      border:2px solid white;
      box-shadow:0 0 0 1px rgba(15,23,42,0.22);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export function LiveOperationsMap({
  disruptions,
  workerPings,
}: {
  disruptions: LiveOperationsDisruption[];
  workerPings: WorkerPing[];
}) {
  const mapCenter = useMemo<[number, number]>(() => {
    const firstGeofence = disruptions.find((d) => d.geofence)?.geofence;
    if (firstGeofence) {
      return [firstGeofence.center_lat, firstGeofence.center_lng];
    }
    if (workerPings.length) {
      return [workerPings[0].lat, workerPings[0].lng];
    }
    return INDIA_CENTER;
  }, [disruptions, workerPings]);

  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <MapContainer center={mapCenter} zoom={11} className="h-[430px] w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {disruptions.map((event) =>
            event.geofence ? (
              <Circle
                key={event._id || event.id}
                center={[event.geofence.center_lat, event.geofence.center_lng]}
                radius={event.geofence.radius_km * 1000}
                pathOptions={{
                  color: "#dc2626",
                  fillColor: "#ef4444",
                  fillOpacity: 0.2,
                  weight: 2,
                }}
              >
                <Popup>
                  <p className="font-semibold">{titleCase(event.type)}</p>
                  <p>Severity: {percent(event.severity)}</p>
                  <p>Radius: {event.geofence.radius_km.toFixed(2)} km</p>
                  <p>Zone(s): {event.affected_zones.join(", ")}</p>
                </Popup>
              </Circle>
            ) : null,
          )}

          {workerPings.map((worker) => (
            <Marker key={`${worker.worker_id}-${worker.pinged_at}`} position={[worker.lat, worker.lng]} icon={markerIcon(worker.eligible)}>
              <Popup>
                <p className="font-semibold">{worker.worker_code || worker.worker_id}</p>
                <p>{worker.city} | {worker.zone}</p>
                <p>Speed: {worker.speed_kmph.toFixed(1)} km/h</p>
                <p>Status: {worker.eligible ? "Eligible" : "Not Eligible"}</p>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <aside className="soft-scroll max-h-[430px] space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-3">
        <h3 className="text-sm font-bold text-slate-900">Live Worker Eligibility</h3>
        {workerPings.length ? (
          workerPings.map((worker) => (
            <article key={`${worker.worker_id}-${worker.pinged_at}-card`} className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-xs">
              <p className="font-semibold text-slate-900">{worker.worker_code || worker.worker_id}</p>
              <p className="mt-0.5 text-slate-600">{worker.city} | {worker.zone}</p>
              <p className="mt-0.5 text-slate-600">Speed {worker.speed_kmph.toFixed(1)} km/h</p>
              <p className={`mt-1 inline-block rounded-md px-2 py-0.5 font-semibold ${worker.eligible ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                {worker.eligible ? "Eligibility Status: Green" : "Eligibility Status: Not Eligible"}
              </p>
            </article>
          ))
        ) : (
          <p className="text-xs text-slate-500">No worker pings available yet.</p>
        )}
      </aside>
    </div>
  );
}

