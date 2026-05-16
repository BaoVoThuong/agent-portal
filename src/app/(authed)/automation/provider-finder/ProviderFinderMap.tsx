"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  LayerGroup as LeafletLayerGroup,
  Map as LeafletMap,
  TileLayer as LeafletTileLayer,
} from "leaflet";

type Origin = {
  address: string;
  lat: number | null;
  lng: number | null;
};

type ProviderResult = {
  name: string;
  facility: string;
  specialty: string;
  npi: string;
  distanceMiles: number | null;
  lat: number | null;
  lng: number | null;
  address: string;
  polyline: string | null;
};

type ProviderFinderMapProps = {
  origin?: Origin;
  results: ProviderResult[];
  selection: "all" | number;
};

type Coordinate = [number, number];

export function ProviderFinderMap({
  origin,
  results,
  selection,
}: ProviderFinderMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LeafletLayerGroup | null>(null);
  const tileRef = useRef<LeafletTileLayer | null>(null);
  const selectedResults = useMemo(
    () =>
      selection === "all" ? results : results[selection] ? [results[selection]] : [],
    [results, selection]
  );
  const hasOriginCoordinate = Boolean(toCoordinate(origin?.lat, origin?.lng));
  const hasMapCoordinates =
    hasOriginCoordinate ||
    selectedResults.some((result) => Boolean(toCoordinate(result.lat, result.lng)));

  useEffect(() => {
    let isCancelled = false;

    async function renderMap() {
      if (!containerRef.current || !hasMapCoordinates) return;

      const L = await import("leaflet");
      if (isCancelled || !containerRef.current) return;

      const map =
        mapRef.current ??
        L.map(containerRef.current, {
          scrollWheelZoom: false,
          zoomControl: true,
        });
      mapRef.current = map;

      if (!tileRef.current) {
        tileRef.current = L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
          }
        ).addTo(map);
      }

      if (!layerRef.current) {
        layerRef.current = L.layerGroup().addTo(map);
      }
      const activeLayer = layerRef.current;
      activeLayer.clearLayers();

      const bounds = L.latLngBounds([]);
      const originCoordinate = toCoordinate(origin?.lat, origin?.lng);

      if (originCoordinate) {
        bounds.extend(originCoordinate);
        L.marker(originCoordinate, {
          icon: createPinIcon(L, "origin"),
        })
          .bindPopup(createOriginPopup(origin))
          .addTo(activeLayer);
      }

      selectedResults.forEach((provider, index) => {
        const coordinate = toCoordinate(provider.lat, provider.lng);
        if (!coordinate) return;

        bounds.extend(coordinate);
        L.marker(coordinate, {
          icon: createPinIcon(L, "provider"),
        })
          .bindPopup(createProviderPopup(provider, index + 1))
          .addTo(activeLayer);

        const routeCoordinates = decodePolyline(provider.polyline);
        if (routeCoordinates.length > 0) {
          routeCoordinates.forEach((routeCoordinate) => bounds.extend(routeCoordinate));
          L.polyline(routeCoordinates, {
            color: "#245a94",
            weight: selection === "all" ? 3 : 4,
            opacity: selection === "all" ? 0.42 : 0.82,
          }).addTo(activeLayer);
        } else if (originCoordinate) {
          L.polyline([originCoordinate, coordinate], {
            color: "#245a94",
            dashArray: "6 7",
            weight: 2.5,
            opacity: 0.55,
          }).addTo(activeLayer);
        }
      });

      const zoomToBounds = () => {
        if (isCancelled) return;
        map.invalidateSize();
        if (!bounds.isValid()) return;

        if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
          map.setView(bounds.getCenter(), 16);
        } else {
          map.fitBounds(bounds.pad(selection === "all" ? 0.1 : 0.025), {
            maxZoom: selection === "all" ? 14 : 17,
            padding: selection === "all" ? [34, 34] : [18, 18],
          });
        }
      };

      window.setTimeout(zoomToBounds, 0);
      window.setTimeout(zoomToBounds, 180);
    }

    void renderMap();

    return () => {
      isCancelled = true;
    };
  }, [hasMapCoordinates, origin, selectedResults, selection]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileRef.current = null;
    };
  }, []);

  if (!hasMapCoordinates) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#667085]">
        No map coordinates are available for this search.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute right-3 top-3 z-[1000] rounded-md bg-white/95 px-3 py-2 text-sm font-semibold text-[#16233a] shadow-md ring-1 ring-[#d8dee7]">
        {hasOriginCoordinate && (
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#d92d20]" />
            <span>You</span>
          </div>
        )}
        <div className={`${hasOriginCoordinate ? "mt-1" : ""} flex items-center gap-2`}>
          <span className="h-3 w-3 rounded-full bg-[#2b7bbb]" />
          <span>Medical Offices</span>
        </div>
      </div>
    </div>
  );
}

function createPinIcon(L: typeof import("leaflet"), type: "origin" | "provider") {
  const color = type === "origin" ? "#d92d20" : "#2b7bbb";
  const width = 34;
  const height = 44;

  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;
      width:${width}px;
      height:${height}px;
      filter:drop-shadow(0 2px 6px rgba(22,35,58,.35));
    ">
      <svg viewBox="0 0 34 44" width="${width}" height="${height}" aria-hidden="true" focusable="false">
        <path d="M17 42C17 42 31 25.3 31 14.9C31 7.2 24.7 1 17 1S3 7.2 3 14.9C3 25.3 17 42 17 42Z" fill="${color}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" />
        <circle cx="17" cy="15" r="5.2" fill="#ffffff" opacity=".96" />
      </svg>
    </span>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height - 2],
    popupAnchor: [0, -height + 8],
  });
}

function createOriginPopup(origin?: Origin) {
  const content = document.createElement("div");
  content.className = "space-y-1 text-sm";

  const title = document.createElement("div");
  title.className = "font-semibold text-[#16233a]";
  title.textContent = "You";
  content.appendChild(title);

  const address = document.createElement("div");
  address.textContent = origin?.address ?? "";
  content.appendChild(address);

  return content;
}

function createProviderPopup(provider: ProviderResult, index: number) {
  const content = document.createElement("div");
  content.className = "space-y-1 text-sm";

  const title = document.createElement("div");
  title.className = "font-semibold text-[#16233a]";
  title.textContent = provider.name || provider.facility || `Provider ${index}`;
  content.appendChild(title);

  appendPopupLine(content, provider.specialty);
  appendPopupLine(content, provider.address);

  if (provider.distanceMiles != null) {
    appendPopupLine(content, `${provider.distanceMiles.toFixed(2)} miles`);
  }

  return content;
}

function appendPopupLine(content: HTMLDivElement, text: string) {
  if (!text) return;

  const row = document.createElement("div");
  row.textContent = text;
  content.appendChild(row);
}

function decodePolyline(encoded: string | null): Coordinate[] {
  if (!encoded) return [];

  const coordinates: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const latitude = decodePolylineValue(encoded, index);
    index = latitude.nextIndex;
    lat += latitude.value;

    const longitude = decodePolylineValue(encoded, index);
    index = longitude.nextIndex;
    lng += longitude.value;

    coordinates.push([lat / 1e5, lng / 1e5]);
  }

  return coordinates;
}

function decodePolylineValue(encoded: string, startIndex: number) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = 0;

  do {
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20 && index < encoded.length);

  return {
    value: result & 1 ? ~(result >> 1) : result >> 1,
    nextIndex: index,
  };
}

function toCoordinate(
  lat: number | null | undefined,
  lng: number | null | undefined
) {
  if (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  ) {
    return [lat, lng] satisfies Coordinate;
  }

  return null;
}
