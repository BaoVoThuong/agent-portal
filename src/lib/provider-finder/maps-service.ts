// Maps service cho Provider Finder: chọn provider (Apps Script proxy ưu tiên,
// fallback Google REST), geocode + directions. Tách nguyên văn từ route handler.
import type {
  AppsScriptMapsConfig,
  AppsScriptMapsResponse,
  Coordinates,
  GoogleDirectionsResponse,
  GoogleGeocodeResponse,
  MapsService,
  RouteResult,
} from "./types";

function getGoogleMapsApiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  }

  return key;
}

function getAppsScriptMapsConfig() {
  const url = process.env.APPS_SCRIPT_MAPS_WEBAPP_URL?.trim();
  if (!url) return null;

  const secret = process.env.APPS_SCRIPT_MAPS_SECRET?.trim();
  if (!secret) {
    throw new Error("APPS_SCRIPT_MAPS_SECRET is not configured");
  }

  return { url, secret } satisfies AppsScriptMapsConfig;
}

export function getMapsService(logs: string[]): MapsService {
  const appsScriptConfig = getAppsScriptMapsConfig();

  if (appsScriptConfig) {
    logs.push("maps provider: apps script");
    return createAppsScriptMapsService(appsScriptConfig);
  }

  logs.push("maps provider: google rest");
  return createGoogleMapsService(getGoogleMapsApiKey());
}

function shouldThrowGoogleStatus(status: string | undefined) {
  return status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT";
}

function isGoogleConfigError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("REQUEST_DENIED") ||
    err.message.includes("OVER_QUERY_LIMIT") ||
    err.message.includes("GOOGLE_MAPS_API_KEY")
  );
}

export function isMapsProviderConfigError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return (
    isGoogleConfigError(err) ||
    err.message.includes("APPS_SCRIPT_MAPS") ||
    err.message.includes("Apps Script maps")
  );
}

function isCoordinates(value: Coordinates | null | undefined): value is Coordinates {
  return Boolean(
    value &&
      Number.isFinite(value.lat) &&
      Number.isFinite(value.lng)
  );
}

async function postAppsScriptMaps(
  config: AppsScriptMapsConfig,
  action: string,
  payload: Record<string, unknown>,
  logs: string[]
) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: config.secret,
      action,
      ...payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`Apps Script maps request failed: ${response.status}`);
  }

  const data = (await response.json()) as AppsScriptMapsResponse;
  if (Array.isArray(data.logs)) {
    logs.push(...data.logs.map((entry) => `apps script: ${entry}`));
  }

  if (data.ok === false) {
    throw new Error(`Apps Script maps ${data.error ?? "request failed"}`);
  }

  return data;
}

function createAppsScriptMapsService(
  config: AppsScriptMapsConfig
): MapsService {
  return {
    async routeCandidates(origin, candidates, logs) {
      const routesById = new Map<string, RouteResult | null>(
        candidates.map((candidate) => [candidate.id, null])
      );

      if (candidates.length === 0) {
        return { originCoordinates: null, routesById };
      }

      const data = await postAppsScriptMaps(
        config,
        "directions",
        {
          origin,
          destinations: candidates,
        },
        logs
      );
      let successCount = 0;

      for (const result of data.results ?? []) {
        if (!result.id || !routesById.has(result.id)) continue;

        if (
          Number.isFinite(result.distanceMeters) &&
          isCoordinates(result.endLocation)
        ) {
          successCount += 1;
          routesById.set(result.id, {
            distanceMeters: result.distanceMeters ?? 0,
            endLocation: result.endLocation,
            polyline: result.polyline ?? null,
          });
        } else {
          routesById.set(result.id, null);
          if (result.error || result.status) {
            logs.push(
              `apps script directions ${result.id}: ${
                result.error ?? result.status
              }`
            );
          }
        }
      }

      logs.push(`directions success count: ${successCount}`);

      return {
        originCoordinates: isCoordinates(data.origin) ? data.origin : null,
        routesById,
      };
    },
    async geocodeCandidates(candidates, logs) {
      const coordinatesById = new Map<string, Coordinates | null>(
        candidates.map((candidate) => [candidate.id, null])
      );

      if (candidates.length === 0) {
        return coordinatesById;
      }

      const data = await postAppsScriptMaps(
        config,
        "geocode",
        {
          addresses: candidates,
        },
        logs
      );
      let successCount = 0;

      for (const result of data.results ?? []) {
        if (!result.id || !coordinatesById.has(result.id)) continue;

        if (isCoordinates(result.location)) {
          successCount += 1;
          coordinatesById.set(result.id, result.location);
        } else if (result.error || result.status) {
          logs.push(
            `apps script geocode ${result.id}: ${
              result.error ?? result.status
            }`
          );
        }
      }

      logs.push(`provider geocode success count: ${successCount}`);
      return coordinatesById;
    },
  };
}

function createGoogleMapsService(key: string): MapsService {
  return {
    async routeCandidates(origin, candidates, logs) {
      const routesById = new Map<string, RouteResult | null>(
        candidates.map((candidate) => [candidate.id, null])
      );
      let successCount = 0;

      for (const candidate of candidates) {
        try {
          const route = await fetchDirections(origin, candidate.address, key, logs);
          if (route) {
            successCount += 1;
            routesById.set(candidate.id, route);
          }
        } catch (err) {
          if (isGoogleConfigError(err)) throw err;
          logs.push(
            `directions error ${candidate.address}: ${
              err instanceof Error ? err.message : "unknown"
            }`
          );
        }
      }

      logs.push(`directions success count: ${successCount}`);

      const originCoordinates = await geocodeAddress(origin, key, logs);
      logs.push(
        `customer geocode status: ${originCoordinates ? "ok" : "empty"}`
      );

      return {
        originCoordinates,
        routesById,
      };
    },
    async geocodeCandidates(candidates, logs) {
      const coordinatesById = new Map<string, Coordinates | null>(
        candidates.map((candidate) => [candidate.id, null])
      );
      let successCount = 0;

      for (const candidate of candidates) {
        try {
          const coordinates = await geocodeAddress(candidate.address, key, logs);
          if (coordinates) {
            successCount += 1;
            coordinatesById.set(candidate.id, coordinates);
          }
        } catch (err) {
          if (isGoogleConfigError(err)) throw err;
          logs.push(
            `provider geocode error ${candidate.address}: ${
              err instanceof Error ? err.message : "unknown"
            }`
          );
        }
      }

      logs.push(`provider geocode success count: ${successCount}`);
      return coordinatesById;
    },
  };
}

async function geocodeAddress(address: string, key: string, logs: string[]) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", key);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Geocoding API request failed: ${response.status}`);
  }

  const data = (await response.json()) as GoogleGeocodeResponse;
  if (data.status !== "OK") {
    logs.push(`geocode ${address}: ${data.status ?? "UNKNOWN"}`);
    if (shouldThrowGoogleStatus(data.status)) {
      throw new Error(
        `Google Geocoding API ${data.status}: ${
          data.error_message ?? "request failed"
        }`
      );
    }
    return null;
  }

  const location = data.results?.[0]?.geometry?.location;
  if (
    location &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng)
  ) {
    return location;
  }

  logs.push(`geocode ${address}: no usable location`);
  return null;
}

async function fetchDirections(
  origin: string,
  destination: string,
  key: string,
  logs: string[]
) {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("key", key);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Directions API request failed: ${response.status}`);
  }

  const data = (await response.json()) as GoogleDirectionsResponse;
  if (data.status !== "OK") {
    logs.push(`directions ${destination}: ${data.status ?? "UNKNOWN"}`);
    if (shouldThrowGoogleStatus(data.status)) {
      throw new Error(
        `Google Directions API ${data.status}: ${
          data.error_message ?? "request failed"
        }`
      );
    }
    return null;
  }

  const route = data.routes?.[0];
  const leg = route?.legs?.[0];
  const distanceMeters = leg?.distance?.value;

  if (!Number.isFinite(distanceMeters)) {
    logs.push(`directions ${destination}: no usable distance`);
    return null;
  }

  return {
    distanceMeters: distanceMeters ?? 0,
    endLocation: leg?.end_location ?? null,
    polyline: route?.overview_polyline?.points ?? null,
  };
}
