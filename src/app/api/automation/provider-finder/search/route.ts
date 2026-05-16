import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";

type InsuranceType = "" | "obamacare" | "medicare" | "both";

type SearchRequest = {
  street?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  contract?: string;
  carrier?: string;
  specialty?: string;
  radius?: string;
  insuranceType?: InsuranceType;
};

type ProviderAddressRow = {
  source_row_number: number;
  facility: string | null;
  doctors: string | null;
  npi: string | null;
  practices_as: string | null;
  accepting_new_patients: string | null;
  business_hours: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  obamacare: string | null;
  medicare: string | null;
  other_plans: string | null;
};

type Coordinates = {
  lat: number;
  lng: number;
};

type Candidate = {
  row: ProviderAddressRow;
  address: string;
  score: number;
};

type RouteResult = {
  distanceMeters: number;
  endLocation: Coordinates | null;
  polyline: string | null;
};

type MapsAddressInput = {
  id: string;
  address: string;
};

type MapsRouteBatch = {
  originCoordinates: Coordinates | null;
  routesById: Map<string, RouteResult | null>;
};

type MapsService = {
  geocodeCandidates: (
    candidates: MapsAddressInput[],
    logs: string[]
  ) => Promise<Map<string, Coordinates | null>>;
  routeCandidates: (
    origin: string,
    candidates: MapsAddressInput[],
    logs: string[]
  ) => Promise<MapsRouteBatch>;
};

type ProviderResult = {
  name: string;
  facility: string;
  specialty: string;
  npi: string;
  street: string;
  city: string;
  state: string;
  zipcode: string;
  phone: string;
  obamacare: string;
  medicare: string;
  otherPlans: string;
  distanceMeters: number | null;
  distanceKm: number | null;
  distanceMiles: number | null;
  lat: number | null;
  lng: number | null;
  address: string;
  polyline: string | null;
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    geometry?: {
      location?: Coordinates;
    };
  }>;
};

type GoogleDirectionsResponse = {
  status?: string;
  error_message?: string;
  routes?: Array<{
    overview_polyline?: {
      points?: string;
    };
    legs?: Array<{
      distance?: {
        value?: number;
      };
      end_location?: Coordinates;
    }>;
  }>;
};

type AppsScriptMapsConfig = {
  url: string;
  secret: string;
};

type AppsScriptMapsResponse = {
  ok?: boolean;
  error?: string;
  logs?: string[];
  origin?: Coordinates | null;
  results?: Array<{
    id?: string;
    status?: string;
    error?: string | null;
    location?: Coordinates | null;
    endLocation?: Coordinates | null;
    distanceMeters?: number | null;
    polyline?: string | null;
  }>;
};

const maxResults = 10;
const pageSize = 1000;
const milesPerMeter = 0.000621371;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown) {
  return cleanText(value).toLowerCase();
}

function firstLine(value: string | null) {
  return (
    cleanText(value)
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? ""
  );
}

function normalizeInsuranceType(value: unknown): InsuranceType {
  const normalized = normalize(value);
  if (
    normalized === "obamacare" ||
    normalized === "medicare" ||
    normalized === "both"
  ) {
    return normalized;
  }

  return "both";
}

function getAddressParts(input: SearchRequest) {
  return [
    cleanText(input.street),
    cleanText(input.city),
    cleanText(input.state).toUpperCase(),
    cleanText(input.zipcode),
  ].filter(Boolean);
}

function buildInputAddress(input: SearchRequest) {
  return getAddressParts(input).join(", ");
}

function buildProviderAddress(row: ProviderAddressRow) {
  const street = firstLine(row.street);
  const city = firstLine(row.city);
  const state = firstLine(row.state).toUpperCase();
  const zipcode = firstLine(row.zip_code);
  const stateZip = [state, zipcode].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
}

function parseRadiusMiles(value: unknown) {
  const text = cleanText(value);
  if (!text) return { radiusMiles: null, error: null };

  const radiusMiles = Number(text);
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    return { radiusMiles: null, error: "Radius must be a positive number" };
  }

  return { radiusMiles, error: null };
}

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

function getMapsService(logs: string[]): MapsService {
  const appsScriptConfig = getAppsScriptMapsConfig();

  if (appsScriptConfig) {
    logs.push("maps provider: apps script");
    return createAppsScriptMapsService(appsScriptConfig);
  }

  logs.push("maps provider: google rest");
  return createGoogleMapsService(getGoogleMapsApiKey());
}

function getContractText(row: ProviderAddressRow, insuranceType: InsuranceType) {
  if (insuranceType === "obamacare") return cleanText(row.obamacare);
  if (insuranceType === "medicare") return cleanText(row.medicare);
  if (insuranceType === "both") {
    return [row.obamacare, row.medicare].map(cleanText).filter(Boolean).join(" ");
  }

  return [row.obamacare, row.medicare, row.other_plans]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function getDisplayInsurance(row: ProviderAddressRow, insuranceType: InsuranceType) {
  return {
    obamacare: insuranceType === "medicare" ? "" : cleanText(row.obamacare),
    medicare: insuranceType === "obamacare" ? "" : cleanText(row.medicare),
    otherPlans: insuranceType === "" ? cleanText(row.other_plans) : "",
  };
}

function scoreProvider(row: ProviderAddressRow, inputAddressLower: string) {
  if (!inputAddressLower) return 0;

  let score = 0;
  const zipcode = normalize(row.zip_code);
  const city = normalize(row.city);
  const state = normalize(row.state);

  if (zipcode && inputAddressLower.includes(zipcode)) score += 50;
  if (city && inputAddressLower.includes(city)) score += 20;
  if (state && inputAddressLower.includes(state)) score += 10;

  return score;
}

async function fetchProviderRows() {
  const supabase = getSupabaseAdmin();
  const rows: ProviderAddressRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("provider_address")
      .select(
        [
          "source_row_number",
          "facility",
          "doctors",
          "npi",
          "practices_as",
          "accepting_new_patients",
          "business_hours",
          "phone",
          "street",
          "city",
          "state",
          "zip_code",
          "obamacare",
          "medicare",
          "other_plans",
        ].join(", ")
      )
      .order("source_row_number", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    rows.push(...((data ?? []) as unknown as ProviderAddressRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function buildCandidates(
  rows: ProviderAddressRow[],
  input: SearchRequest,
  insuranceType: InsuranceType,
  hasAddress: boolean,
  logs: string[]
) {
  const specialty = normalize(input.specialty);
  const contract = normalize(input.contract ?? input.carrier);
  const inputAddressLower = normalize(buildInputAddress(input));

  const withAddress = rows.filter((row) => buildProviderAddress(row));
  const specialtyMatched = withAddress.filter((row) => {
    if (!specialty) return true;
    return normalize(row.practices_as).includes(specialty);
  });
  logs.push(`specialty matched count: ${specialtyMatched.length}`);

  const contractMatched = specialtyMatched.filter((row) => {
    if (!contract) return true;
    return normalize(getContractText(row, insuranceType)).includes(contract);
  });
  logs.push(`contract matched count: ${contractMatched.length}`);

  const candidates = contractMatched.map((row) => ({
    row,
    address: buildProviderAddress(row),
    score: scoreProvider(row, inputAddressLower),
  }));

  if (hasAddress) {
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        a.row.source_row_number - b.row.source_row_number
    );
  }

  return candidates.slice(0, maxResults);
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

function isMapsProviderConfigError(err: unknown) {
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

function toMapCandidates(candidates: Candidate[]) {
  return candidates.map((candidate, index) => ({
    id: String(index),
    address: candidate.address,
  }));
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

function toProviderResult(
  candidate: Candidate,
  insuranceType: InsuranceType,
  route: RouteResult | null,
  coordinates: Coordinates | null
): ProviderResult {
  const insurance = getDisplayInsurance(candidate.row, insuranceType);
  const distanceMeters = route?.distanceMeters ?? null;
  const distanceMiles =
    distanceMeters == null
      ? null
      : Number((distanceMeters * milesPerMeter).toFixed(2));

  return {
    name: cleanText(candidate.row.doctors) || cleanText(candidate.row.facility),
    facility: cleanText(candidate.row.facility),
    specialty: cleanText(candidate.row.practices_as),
    npi: cleanText(candidate.row.npi),
    street: firstLine(candidate.row.street),
    city: firstLine(candidate.row.city),
    state: firstLine(candidate.row.state),
    zipcode: firstLine(candidate.row.zip_code),
    phone: firstLine(candidate.row.phone),
    obamacare: insurance.obamacare,
    medicare: insurance.medicare,
    otherPlans: insurance.otherPlans,
    distanceMeters,
    distanceKm: distanceMeters == null ? null : Number((distanceMeters / 1000).toFixed(2)),
    distanceMiles,
    lat: coordinates?.lat ?? route?.endLocation?.lat ?? null,
    lng: coordinates?.lng ?? route?.endLocation?.lng ?? null,
    address: candidate.address,
    polyline: route?.polyline ?? null,
  };
}

export async function POST(request: Request) {
  const session = await auth();
  if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs: string[] = [];

  try {
    const input = (await request.json()) as SearchRequest;
    const address = buildInputAddress(input);
    const hasAddress = getAddressParts(input).length > 0;
    const contract = cleanText(input.contract ?? input.carrier);
    const insuranceType = normalizeInsuranceType(input.insuranceType);
    const { radiusMiles, error: radiusError } = parseRadiusMiles(input.radius);

    logs.push(
      `input parsed: address=${hasAddress ? "yes" : "no"}, contract=${
        contract ? "yes" : "no"
      }, insurance=${insuranceType}, radius=${
        radiusMiles ?? "none"
      }`
    );

    if (!hasAddress && !contract) {
      return NextResponse.json(
        { error: "Address or contract is required", logs },
        { status: 400 }
      );
    }

    if (radiusError) {
      return NextResponse.json({ error: radiusError, logs }, { status: 400 });
    }

    const rows = await fetchProviderRows();
    logs.push(`db rows loaded: ${rows.length}`);

    const candidates = buildCandidates(
      rows,
      input,
      insuranceType,
      hasAddress,
      logs
    );
    logs.push(`top 10 selected: ${candidates.length}`);

    if (candidates.length === 0) {
      return NextResponse.json({
        results: [],
        error: "No provider found matching the criteria",
        logs,
      });
    }

    const mapsService = getMapsService(logs);
    const mapCandidates = toMapCandidates(candidates);
    let results: ProviderResult[] = [];
    let origin: { address: string; lat: number | null; lng: number | null } | undefined;

    if (hasAddress) {
      const { originCoordinates, routesById } =
        await mapsService.routeCandidates(address, mapCandidates, logs);

      results = candidates.map((candidate, index) =>
        toProviderResult(
          candidate,
          insuranceType,
          routesById.get(String(index)) ?? null,
          null
        )
      );

      results.sort(
        (a, b) =>
          (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
          (b.distanceMeters ?? Number.POSITIVE_INFINITY)
      );

      if (radiusMiles != null) {
        results = results.filter(
          (result) =>
            typeof result.distanceMiles === "number" &&
            result.distanceMiles <= radiusMiles
        );
        logs.push(`radius kept count: ${results.length}`);
      }

      origin = {
        address,
        lat: originCoordinates?.lat ?? null,
        lng: originCoordinates?.lng ?? null,
      };
    } else {
      const coordinatesById = await mapsService.geocodeCandidates(
        mapCandidates,
        logs
      );

      results = candidates.map((candidate, index) =>
        toProviderResult(
          candidate,
          insuranceType,
          null,
          coordinatesById.get(String(index)) ?? null
        )
      );

      origin = undefined;
    }

    return NextResponse.json({
      origin,
      results,
      error:
        results.length === 0 && radiusMiles != null
          ? `No provider found within ${radiusMiles} miles`
          : undefined,
      logs,
    });
  } catch (err) {
    const status = isMapsProviderConfigError(err) ? 502 : 500;

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Provider search failed",
        logs,
      },
      { status }
    );
  }
}
