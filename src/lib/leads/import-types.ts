import type { AutoAssignOutcome } from "./auto-assign";
import type { ExistingLeadMatch } from "./import-existing";
import type { ImportRowNote } from "./import-template";

/**
 * Hợp đồng giữa route `POST /api/leads/import` và dialog Import. Preview gọi
 * route với `dry_run=true` và nhận `LeadImportPreview`; Import thật nhận
 * `LeadImportResult`. Cùng một đường chạy, nên preview nói gì thì import làm
 * đúng vậy.
 */

export type UnmatchedImportAgent = {
  /** Tên đúng như trong file. */
  name: string;
  status: "not-agent" | "not-found" | "ambiguous";
  /** Tài khoản khớp được nhưng không nằm trong danh sách Agent ở Config. */
  accountName: string | null;
  /** Khi `ambiguous`: các tài khoản cùng khớp. */
  candidates: string[];
  rows: number[];
};

export type LeadImportPreviewRow = {
  row: number;
  name: string | null;
  phone: string | null;
  insuranceNeeds: string | null;
  agent: {
    status: "matched" | "not-agent" | "not-found" | "ambiguous" | "none";
    label: string | null;
  };
  description: string | null;
};

export type LeadImportPreview = {
  dryRun: true;
  /** Sheet đã đọc (file nhiều sheet: sheet khớp mẫu nhất). */
  sheetName: string;
  /** Event lead: tên event đã chuẩn hoá; null = Personal lead. */
  eventName: string | null;
  /** Event lead với tên chưa có — Import thật sẽ tạo event này. */
  eventIsNew: boolean;
  /** Dòng có dữ liệu trong file (không tính dòng trống). */
  totalRows: number;
  /** Sẽ import nếu không tick bỏ dòng khách cũ nào. */
  importable: number;
  skipped: ImportRowNote[];
  warnings: ImportRowNote[];
  /** Cột của mẫu có trong file, theo nhãn của mẫu. */
  presentHeaders: string[];
  /** Cột chắc chắn có mà file thiếu. */
  missingHeaders: string[];
  /** Tiêu đề trong file không thuộc mẫu. */
  unknownHeaders: string[];
  /** Cột của mẫu chưa có trong Lead Table Configuration — dữ liệu cột đó sẽ không vào. */
  ignoredColumns: string[];
  existingClients: ExistingLeadMatch[];
  /** Có hơn 20.000 lead nên dò khách cũ chưa hết. */
  existingCheckTruncated: boolean;
  unmatchedAgents: UnmatchedImportAgent[];
  optionsToCreate: { column: string; label: string }[];
  rowsWithoutPhone: number;
  previewRows: LeadImportPreviewRow[];
};

export type LeadImportResult = {
  dryRun?: false;
  inserted: number;
  /** Trùng số trong cùng event — DB không cho ghi. */
  duplicates: number;
  /** Dòng khách cũ người dùng tick bỏ. */
  excluded: number;
  skipped: ImportRowNote[];
  warnings: ImportRowNote[];
  assignedFromFile: number;
  unmatchedAgents: UnmatchedImportAgent[];
  createdOptions: { column: string; label: string }[];
  ignoredColumns: string[];
  autoAssign: AutoAssignOutcome | null;
};
