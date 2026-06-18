// Types cho Provider Finder (tách từ route handler, giữ nguyên định nghĩa).
export type InsuranceType = "" | "obamacare" | "medicare" | "both";

export type SearchRequest = {
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

export type ProviderAddressRow = {
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

export type Coordinates = {
  lat: number;
  lng: number;
};

export type Candidate = {
  row: ProviderAddressRow;
  address: string;
  score: number;
};

export type RouteResult = {
  distanceMeters: number;
  endLocation: Coordinates | null;
  polyline: string | null;
};

export type MapsAddressInput = {
  id: string;
  address: string;
};

export type MapsRouteBatch = {
  originCoordinates: Coordinates | null;
  routesById: Map<string, RouteResult | null>;
};

export type MapsService = {
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

export type ProviderResult = {
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

export type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    geometry?: {
      location?: Coordinates;
    };
  }>;
};

export type GoogleDirectionsResponse = {
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

export type AppsScriptMapsConfig = {
  url: string;
  secret: string;
};

export type AppsScriptMapsResponse = {
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
