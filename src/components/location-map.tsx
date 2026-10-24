"use client";

import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { LatLngExpression } from "leaflet";
import type { LocationRecord } from "@/lib/types";

function FitLocations({ locations }: { locations: LocationRecord[] }) {
  const map = useMap();
  useEffect(() => {
    if (locations.length === 1) {
      map.setView([locations[0].latitude, locations[0].longitude], 13);
    } else if (locations.length > 1) {
      const bounds = locations.map(
        (location) => [location.latitude, location.longitude] as [number, number],
      );
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
    }
  }, [locations, map]);
  return null;
}

export default function LocationMap({
  locations,
}: {
  locations: LocationRecord[];
}) {
  const center: LatLngExpression =
    locations.length > 0
      ? [locations[0].latitude, locations[0].longitude]
      : [-2.5, 118];

  return (
    <MapContainer
      center={center}
      zoom={locations.length ? 12 : 4}
      scrollWheelZoom
      className="location-map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitLocations locations={locations} />
      {locations.map((location) => (
        <CircleMarker
          key={location.user_id}
          center={[location.latitude, location.longitude]}
          radius={9}
          pathOptions={{
            color: "#ffffff",
            weight: 3,
            fillColor: "#6c5ce7",
            fillOpacity: 1,
          }}
        >
          <Tooltip>
            {location.profiles?.display_name || "Pengguna"} · pembaruan{" "}
            {new Date(location.updated_at).toLocaleTimeString("id-ID")}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
