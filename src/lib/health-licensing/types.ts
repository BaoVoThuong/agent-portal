export const LICENSING_STATUSES = ["active", "pending", "terminated"] as const;
export type LicensingStatus = (typeof LICENSING_STATUSES)[number];

/** Một sản phẩm = một cột multiselect của bảng "licensing" trong Table Configuration. */
export type LicensingProduct = {
  columnId: string;
  key: string;
  label: string;
  position: number;
};

/** Một hãng = một giá trị (có màu) của cột sản phẩm. Mỗi sản phẩm một danh sách riêng. */
export type LicensingCarrierOption = {
  id: string;
  columnId: string;
  label: string;
  color: string | null;
  position: number;
};

export type LicensingAgentLink = {
  accountId: string;
  name: string;
  appointedOn: string | null;
};

export type LicensingAppointment = {
  id: string;
  stateCode: string;
  optionId: string;
  columnId: string;
  /** Nhãn của option (đổi tên ở Table Configuration là đổi ở mọi bang). */
  carrier: string;
  color: string | null;
  optionPosition: number;
  status: LicensingStatus;
  appointedOn: string | null;
  note: string | null;
  agents: LicensingAgentLink[];
  createdAt: string;
  /** null = nạp từ file lúc khởi tạo. */
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
};

export type LicensingAgentOption = { accountId: string; name: string };

export type LicensingLastUpdate = { at: string; actorName: string | null } | null;

export type LicensingBoard = {
  products: LicensingProduct[];
  options: LicensingCarrierOption[];
  appointments: LicensingAppointment[];
  lastUpdate: LicensingLastUpdate;
};

/** One history line, already worded for display. */
export type LicensingHistoryEntry = {
  id: number;
  at: string;
  actorName: string | null;
  stateCode: string | null;
  /** Sentence after the actor's name, e.g. "added Ambetter · Obamacare · TX". */
  summary: string;
  /** Carrier name to set in bold inside `summary`, when there is one. */
  carrier: string | null;
  changes: string[];
};
