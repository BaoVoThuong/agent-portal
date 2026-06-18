// Lõi nghiệp vụ Provider Finder: lọc/scoring candidate, gọi maps service,
// dựng kết quả. Tách nguyên văn từ route handler (behavior + payload không đổi).
import { getSupabaseAdmin } from "@/lib/supabase";
import { getMapsService, isMapsProviderConfigError } from "./maps-service";
import type {
  Candidate,
  Coordinates,
  InsuranceType,
  ProviderAddressRow,
  ProviderResult,
  RouteResult,
  SearchRequest,
} from "./types";

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

function toMapCandidates(candidates: Candidate[]) {
  return candidates.map((candidate, index) => ({
    id: String(index),
    address: candidate.address,
  }));
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

// Kết quả chuẩn hoá để route map sang NextResponse với đúng status code.
export type ProviderSearchOutcome = {
  status: number;
  body: Record<string, unknown>;
};

export async function runProviderSearch(
  input: SearchRequest
): Promise<ProviderSearchOutcome> {
  const logs: string[] = [];

  try {
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
      return {
        status: 400,
        body: { error: "Address or contract is required", logs },
      };
    }

    if (radiusError) {
      return { status: 400, body: { error: radiusError, logs } };
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
      return {
        status: 200,
        body: {
          results: [],
          error: "No provider found matching the criteria",
          logs,
        },
      };
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

    return {
      status: 200,
      body: {
        origin,
        results,
        error:
          results.length === 0 && radiusMiles != null
            ? `No provider found within ${radiusMiles} miles`
            : undefined,
        logs,
      },
    };
  } catch (err) {
    const status = isMapsProviderConfigError(err) ? 502 : 500;

    return {
      status,
      body: {
        error: err instanceof Error ? err.message : "Provider search failed",
        logs,
      },
    };
  }
}
