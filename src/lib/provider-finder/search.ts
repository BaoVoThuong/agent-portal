// Lõi nghiệp vụ Provider Finder: lọc/scoring candidate, gọi maps service,
// dựng kết quả. Tách nguyên văn từ route handler (behavior + payload không đổi).
import { getSupabaseAdmin } from "@/lib/supabase";
import { PROVIDER_TABLE } from "@/lib/providers/types";
import { isProviderAddressUsable } from "@/lib/providers/address";
import { parseSpecialtyCell } from "@/lib/providers/specialties";
import {
  customerOriginFromZip,
  haversineMiles,
  providerPoint,
  type GeoPoint,
} from "./distance";
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
// Routing/geocoding more than the displayed result count fixes the old bug
// where a provider outside the score-based top 10 could never win by actual
// driving distance. Keep the cap finite so one search does not fan out to the
// whole directory or multiply Maps cost without a bound.
export const routeCandidateCap = 20;
/**
 * Số suất trong `routeCandidateCap` dành riêng cho nhà CHƯA có toạ độ.
 *
 * Không có hạn ngạch này thì nhóm có toạ độ lấp kín 20 suất trước khi chạm tới
 * dòng đầu tiên của nhóm kia — đo thật: Houston 77036 + UHC có 75 nhà khớp hợp
 * đồng, khoảng 70 nhà có toạ độ. Khoảng 29 dòng trong bảng không geocode được
 * (Census trượt và ZIP của chúng chỉ có đúng một nhà, nên không suy ra tâm), và
 * chúng sẽ biến mất khỏi mọi kết quả tìm kiếm — mất đúng vào lúc quan trọng
 * nhất, là khi khách ở cùng ZIP với chúng.
 *
 * Suất không dùng đến được trả lại cho nhóm khoảng cách, nên khi mọi dòng đã có
 * toạ độ thì hằng số này không lấy đi của ai cái gì.
 */
export const noCoordinateQuota = 3;
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

function getContractText(row: ProviderAddressRow, insuranceType: InsuranceType) {
  if (insuranceType === "obamacare") return cleanText(row.obamacare);
  if (insuranceType === "medicare") return cleanText(row.medicare);
  if (insuranceType === "both") {
    return [row.obamacare, row.medicare].map(cleanText).filter(Boolean).join(" ");
  }

  return [row.obamacare, row.medicare]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function getDisplayInsurance(row: ProviderAddressRow, insuranceType: InsuranceType) {
  return {
    obamacare: insuranceType === "medicare" ? "" : cleanText(row.obamacare),
    medicare: insuranceType === "obamacare" ? "" : cleanText(row.medicare),
    otherPlans: "",
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
    // Cùng bảng với Provider List. Hai tab nằm trên CÙNG một màn hình: đọc hai
    // bảng khác nhau là người dùng thấy hai bộ dữ liệu vênh nhau ngay tại chỗ —
    // và bảng cũ còn 437 dòng rỗng cùng số điện thoại chưa chuẩn hoá.
    const { data, error } = await supabase
      .from(PROVIDER_TABLE)
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
          "latitude",
          "longitude",
        ].join(", ")
      )
      // Phân trang phải bám một cột KHÔNG rỗng và duy nhất. `source_row_number`
      // giờ để trống với dòng gõ tay trong portal, mà giá trị rỗng thì Postgres
      // xếp cuối và không phân định được thứ tự — các trang sẽ trùng/sót dòng.
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    rows.push(...((data ?? []) as unknown as ProviderAddressRow[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export function buildCandidates(
  rows: ProviderAddressRow[],
  input: SearchRequest,
  insuranceType: InsuranceType,
  hasAddress: boolean,
  logs: string[],
  /**
   * Vị trí ước lượng của khách. `null` = không định vị được, khi đó hàm này rơi
   * về nguyên cách chấm điểm chuỗi cũ.
   */
  origin: GeoPoint | null = null
) {
  const specialty = normalize(input.specialty);
  const contract = normalize(input.contract ?? input.carrier);
  const inputAddressLower = normalize(buildInputAddress(input));

  // Cùng một luật với cột cảnh báo trên bảng Provider List: địa chỉ không có số
  // nhà thì dịch vụ bản đồ không tìm ra chỗ. Trước đây chỉ cần chuỗi địa chỉ
  // không rỗng, nên dòng kiểu "Baptist's Locations, Houston, TX" vẫn chiếm một
  // suất trong 20 rồi trả về ô Distance trống.
  const withUsableAddress = rows.filter((row) => isProviderAddressUsable(row));
  const specialtyMatched = withUsableAddress.filter((row) => {
    if (!specialty) return true;
    return parseSpecialtyCell(row.practices_as).some(
      (value) => normalize(value) === specialty
    );
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

  if (!hasAddress) return candidates.slice(0, routeCandidateCap);

  // Thứ tự dự phòng, dùng khi không có toạ độ để so: điểm chuỗi rồi tới số dòng
  // cho ổn định giữa các lần chạy.
  const byScore = (a: Candidate, b: Candidate) =>
    b.score - a.score ||
    (a.row.source_row_number ?? Number.MAX_SAFE_INTEGER) -
      (b.row.source_row_number ?? Number.MAX_SAFE_INTEGER);

  if (!origin) {
    candidates.sort(byScore);
    logs.push("candidate ranking: string score (customer location unknown)");
    return candidates.slice(0, routeCandidateCap);
  }

  const located: Candidate[] = [];
  const unlocated: Candidate[] = [];
  const milesByRow = new Map<ProviderAddressRow, number>();
  for (const candidate of candidates) {
    const point = providerPoint(candidate.row);
    if (point) {
      milesByRow.set(candidate.row, haversineMiles(origin, point));
      located.push(candidate);
    } else {
      unlocated.push(candidate);
    }
  }

  located.sort(
    (a, b) =>
      // Tối đa 13 nhà cùng một ZIP dùng chung toạ độ tâm ZIP nên hoà tuyệt đối
      // là chuyện thường. Phá hoà bằng điểm chuỗi chứ không bằng số dòng: số
      // dòng cố định thì luôn đúng mấy nhà cuối thua, mọi lần tìm.
      (milesByRow.get(a.row) ?? Infinity) - (milesByRow.get(b.row) ?? Infinity) ||
      byScore(a, b)
  );
  unlocated.sort(byScore);

  // Hạn ngạch chỉ giữ chỗ cho số nhà thật sự thiếu toạ độ; phần thừa trả lại
  // cho nhóm khoảng cách.
  const reserved = Math.min(noCoordinateQuota, unlocated.length);
  const picked = located.slice(0, Math.max(0, routeCandidateCap - reserved));
  const rest = unlocated.slice(0, routeCandidateCap - picked.length);
  const selected = [...picked, ...rest];
  // Nhóm thiếu toạ độ không lấp hết phần còn lại (ví dụ chỉ có 1 nhà mà còn 3
  // suất) thì lấy tiếp nhà gần nhất chưa dùng.
  if (selected.length < routeCandidateCap) {
    selected.push(
      ...located.slice(picked.length, picked.length + (routeCandidateCap - selected.length))
    );
  }

  logs.push(
    `candidate ranking: distance (located ${located.length}, unlocated ${unlocated.length}, reserved ${reserved})`
  );
  return selected;
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
  const startedAt = Date.now();

  try {
    const address = buildInputAddress(input);
    const hasAddress = getAddressParts(input).length > 0;
    const contract = cleanText(input.contract ?? input.carrier);
    const insuranceType = normalizeInsuranceType(input.insuranceType);

    logs.push(
      `input parsed: address=${hasAddress ? "yes" : "no"}, contract=${
        contract ? "yes" : "no"
      }, insurance=${insuranceType}`
    );

    if (!hasAddress && !contract) {
      return {
        status: 400,
        body: { error: "Address or contract is required", logs },
      };
    }

    const dbStartedAt = Date.now();
    const rows = await fetchProviderRows();
    const dbTotal = Date.now() - dbStartedAt;
    logs.push(`db query: ${dbTotal}ms; rows loaded: ${rows.length}`);

    const candidateStartedAt = Date.now();
    // Vị trí khách suy từ ZIP, KHÔNG gửi địa chỉ khách đi đâu để geocode. Bước
    // này chỉ chọn 20 ứng viên; quãng đường thật vẫn do Maps tính, và Maps vốn
    // đã nhận địa chỉ đó rồi.
    const customerOrigin = customerOriginFromZip(rows, input.zipcode ?? "");
    logs.push(`customer origin: ${customerOrigin ? "zip centroid" : "unknown"}`);
    const candidates = buildCandidates(
      rows,
      input,
      insuranceType,
      hasAddress,
      logs,
      customerOrigin
    );
    const candidateTotal = Date.now() - candidateStartedAt;
    logs.push(`candidate filter: ${candidateTotal}ms`);
    logs.push(`route candidates selected: ${candidates.length}`);

    if (candidates.length === 0) {
      logs.push(
        `search breakdown: db=${dbTotal}ms candidates=${candidateTotal}ms maps=0ms total=${
          Date.now() - startedAt
        }ms`,
      );
      return {
        status: 200,
        body: {
          results: [],
          error: "No provider found matching the criteria",
          logs,
        },
      };
    }

    const mapCandidates = toMapCandidates(candidates);
    let results: ProviderResult[] = [];
    let origin: { address: string; lat: number | null; lng: number | null } | undefined;
    let mapsTotal = 0;

    if (hasAddress) {
      const mapsService = getMapsService(logs);
      const mapsStartedAt = Date.now();
      const { originCoordinates, routesById } =
        await mapsService.routeCandidates(address, mapCandidates, logs);
      mapsTotal = Date.now() - mapsStartedAt;
      logs.push(`maps route total: ${mapsTotal}ms`);

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

      results = results.slice(0, maxResults);
      logs.push(`top 10 returned: ${results.length}`);

      origin = {
        address,
        lat: originCoordinates?.lat ?? null,
        lng: originCoordinates?.lng ?? null,
      };
    } else {
      // Contract-only searches do not have an origin to map against. Geocoding
      // every provider here only spent Apps Script quota and made a non-map
      // search wait for up to 20 sequential Maps calls.
      logs.push("maps skipped: no customer address");
      results = candidates.map((candidate) =>
        toProviderResult(
          candidate,
          insuranceType,
          null,
          null
        )
      );
      results = results.slice(0, maxResults);
      logs.push(`top 10 returned: ${results.length}`);

      origin = undefined;
    }

    logs.push(
      `search breakdown: db=${dbTotal}ms candidates=${candidateTotal}ms maps=${mapsTotal}ms total=${
        Date.now() - startedAt
      }ms`,
    );

    return {
      status: 200,
      body: {
        origin,
        results,
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
