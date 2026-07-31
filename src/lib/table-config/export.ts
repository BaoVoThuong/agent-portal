import type { TableColumn } from "./types";

export function buildExportMatrix<T>(
  records: T[],
  columns: TableColumn[],
  accessor: (row: T, key: string) => unknown,
  formatValue: (column: TableColumn, raw: unknown) => string
): { header: string[]; rows: string[][] } {
  return {
    header: columns.map((column) => column.label),
    rows: records.map((record) =>
      columns.map((column) => formatValue(column, accessor(record, column.key)))
    ),
  };
}
