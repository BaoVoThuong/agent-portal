import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

type InsuranceType = "obamacare" | "medicare" | "both";

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
};

type Coordinates = {
  lat: number;
  lng: number;
};

type RankedProvider = {
  row: ProviderAddressRow;
  address: string;
  score: number;
  coordinates: Coordinates;
  routeDistanceMeters: number | null;
  distanceMiles: number;
  polyline: string | null;
};

type GeocodedProvider = {
  row: ProviderAddressRow;
  address: string;
  score: number;
  coordinates: Coordinates;
};

const maxResults = 10;
const maxCandidatePool = 80;
const maxRouteCandidates = 30;
const milesPerMeter = 0.000621371;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown) {
  return cleanText(value).toLowerCase();
}

function firstLine(value: string | null) {
  return cleanText(value).split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
}

function buildAddress(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
}) {
  const street = firstLine(parts.street ?? "");
  const city = firstLine(parts.city ?? "");
  const state = firstLine(parts.state ?? "");
  const zipcode = firstLine(parts.zipcode ?? "");
  const cityStateZip = [city, state, zipcode].filter(Boolean).join(" ");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

function buildInputAddress(input: SearchRequest) {
  const cityStateZip = [
    cleanText(input.city),
    cleanText(input.state).toUpperCase(),
    cleanText(input.zipcode),
  ]
    .filter(Boolean)
    .join(" ");

  return [cleanText(input.street), cityStateZip].filter(Boolean).join(", ");
}

function getContractText(row: ProviderAddressRow, insuranceType: InsuranceType) {
  if (insuranceType === "obamacare") return cleanText(row.obamacare);
  if (insuranceType === "medicare") return cleanText(row.medicare);
  return [row.obamacare, row.medicare].map(cleanText).filter(Boolean).join(" ");
}

function getDisplayInsurance(
  row: ProviderAddressRow,
  insuranceType: InsuranceType
) {
  return {
    obamacare:
      insuranceType === "medicare" ? "" : cleanText(row.obamacare),
    medicare:
      insuranceType === "obamacare" ? "" : cleanText(row.medicare),
  };
}

function haversineMiles(origin: Coordinates, destination: Coordinates) {
  const earthRadiusMiles = 3958.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(destination.lat - origin.lat);
  const dLng = toRadians(destination.lng - origin.lng);
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
}

function centerCoordinates(items: Coordinates[]) {
  if (items.length === 0) return null;
  const totals = items.reduce(
    (sum, item) => ({
      lat: sum.lat + item.lat,
      lng: sum.lng + item.lng,
    }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: totals.lat / items.length,
    lng: totals.lng / items.length,
  };
}

function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Coordinates;
  return Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng);
}

async function geocodeAddress(
  address: string,
  cache: Map<string, Coordinates | null>
) {
  const key = normalize(address);
  if (cache.has(key)) return cache.get(key) ?? null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", address);

  const response = await fetch(url, {
    headers: {
      "Accept-Language": "en",
      "User-Agent": "agent-portal-provider-finder/1.0",
    },
  });

  if (!response.ok) {
    cache.set(key, null);
    return null;
  }

  const data = (await response.json()) as Array<{ lat?: string; lon?: string }>;
  const first = data[0];
  const coordinates =
    first?.lat && first?.lon
      ? { lat: Number(first.lat), lng: Number(first.lon) }
      : null;

  cache.set(key, isCoordinates(coordinates) ? coordinates : null);
  return cache.get(key) ?? null;
}

async function fetchRoute(origin: Coordinates, destination: Coordinates) {
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "polyline");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("steps", "false");

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as {
    routes?: Array<{ distance?: number; geometry?: string }>;
  };
  const route = data.routes?.[0];
  if (!route || !Number.isFinite(route.distance)) return null;

  return {
    distanceMeters: route.distance ?? 0,
    polyline: route.geometry ?? null,
  };
}

async function fetchProviderRows() {
  const supabase = getSupabaseAdmin();
  const rows: ProviderAddressRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("provider_address")
      .select(
        "facility, doctors, npi, practices_as, accepting_new_patients, business_hours, phone, street, city, state, zip_code, obamacare, medicare"
      )
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as ProviderAddressRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function scoreProvider(row: ProviderAddressRow, input: SearchRequest) {
  let score = 0;
  const inputCity = normalize(input.city);
  const inputState = normalize(input.state);
  const inputZipcode = normalize(input.zipcode);

  if (inputZipcode && normalize(row.zip_code).includes(inputZipcode)) score += 50;
  if (inputCity && normalize(row.city).includes(inputCity)) score += 20;
  if (inputState && normalize(row.state).includes(inputState)) score += 10;
  if (normalize(row.accepting_new_patients).includes("yes")) score += 5;

  return score;
}

function filterProviders(rows: ProviderAddressRow[], input: SearchRequest) {
  const contract = normalize(input.contract ?? input.carrier);
  const specialty = normalize(input.specialty);
  const insuranceType = input.insuranceType ?? "obamacare";

  return rows
    .filter((row) => {
      const providerAddress = buildAddress({
        street: row.street,
        city: row.city,
        state: row.state,
        zipcode: row.zip_code,
      });
      if (!providerAddress) return false;

      const contractText = normalize(getContractText(row, insuranceType));
      const specialtyText = normalize(row.practices_as);
      const contractMatches = !contract || contractText.includes(contract);
      const specialtyMatches = !specialty || specialtyText.includes(specialty);
      return contractMatches && specialtyMatches;
    })
    .map((row) => ({
      row,
      address: buildAddress({
        street: row.street,
        city: row.city,
        state: row.state,
        zipcode: row.zip_code,
      }),
      score: scoreProvider(row, input),
    }))
    .sort((a, b) => b.score - a.score);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = (await request.json()) as SearchRequest;
  const address = buildInputAddress(input);
  const contract = cleanText(input.contract ?? input.carrier);
  const radiusMiles = Number(input.radius);
  const insuranceType = input.insuranceType ?? "obamacare";

  if (!address && !contract) {
    return NextResponse.json(
      { error: "Address or contract is required" },
      { status: 400 }
    );
  }

  if (address && !Number.isFinite(radiusMiles)) {
    return NextResponse.json(
      { error: "Radius is required" },
      { status: 400 }
    );
  }

  try {
    const geocodeCache = new Map<string, Coordinates | null>();
    const customerOrigin = address
      ? await geocodeAddress(address, geocodeCache)
      : null;

    const rows = await fetchProviderRows();
    const candidates = filterProviders(rows, { ...input, insuranceType }).slice(
      0,
      maxCandidatePool
    );

    const geocodedProviders: GeocodedProvider[] = [];
    for (const candidate of candidates) {
      const coordinates = await geocodeAddress(candidate.address, geocodeCache);
      if (!coordinates) continue;
      geocodedProviders.push({ ...candidate, coordinates });
    }

    if (address && !customerOrigin) {
      return NextResponse.json(
        { error: "Could not find the customer address location" },
        { status: 422 }
      );
    }

    if (geocodedProviders.length === 0) {
      return NextResponse.json(
        { error: "Could not find provider locations for this search" },
        { status: 422 }
      );
    }

    const fallbackOrigin = centerCoordinates(
      geocodedProviders.map((provider) => provider.coordinates)
    );
    const origin = customerOrigin ?? fallbackOrigin;

    if (!origin) {
      return NextResponse.json(
        { error: "Could not find provider locations for this search" },
        { status: 422 }
      );
    }

    const providersToRank = customerOrigin
      ? geocodedProviders
          .map((provider) => ({
            ...provider,
            directDistanceMiles: haversineMiles(origin, provider.coordinates),
          }))
          .filter(
            (provider) =>
              provider.directDistanceMiles <=
              Math.max(radiusMiles * 1.5, radiusMiles + 10)
          )
          .sort((a, b) => a.directDistanceMiles - b.directDistanceMiles)
          .slice(0, maxRouteCandidates)
      : geocodedProviders.map((provider) => ({
          ...provider,
          directDistanceMiles: 0,
        }));

    const ranked: RankedProvider[] = [];
    for (const provider of providersToRank) {
      const route = customerOrigin
        ? await fetchRoute(origin, provider.coordinates)
        : null;
      const distanceMiles = route
        ? route.distanceMeters * milesPerMeter
        : provider.directDistanceMiles;

      if (customerOrigin && distanceMiles > radiusMiles) continue;

      ranked.push({
        ...provider,
        routeDistanceMeters: route?.distanceMeters ?? null,
        distanceMiles: customerOrigin ? distanceMiles : 0,
        polyline: route?.polyline ?? null,
      });
    }

    const results = ranked
      .sort((a, b) =>
        customerOrigin ? a.distanceMiles - b.distanceMiles : b.score - a.score
      )
      .slice(0, maxResults)
      .map((provider) => {
        const insurance = getDisplayInsurance(provider.row, insuranceType);
        return {
          name: cleanText(provider.row.doctors) || cleanText(provider.row.facility),
          facility: cleanText(provider.row.facility),
          specialty: cleanText(provider.row.practices_as),
          npi: cleanText(provider.row.npi),
          street: firstLine(provider.row.street),
          city: firstLine(provider.row.city),
          state: firstLine(provider.row.state),
          zipcode: firstLine(provider.row.zip_code),
          phone: firstLine(provider.row.phone),
          obamacare: insurance.obamacare,
          medicare: insurance.medicare,
          distanceMiles: customerOrigin
            ? Number(provider.distanceMiles.toFixed(2))
            : null,
          lat: provider.coordinates.lat,
          lng: provider.coordinates.lng,
          address: provider.address,
          polyline: provider.polyline,
        };
      });

    return NextResponse.json({
      origin: {
        address: customerOrigin ? address : "Center of matching providers",
        lat: origin.lat,
        lng: origin.lng,
      },
      results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Provider search failed",
      },
      { status: 500 }
    );
  }
}
