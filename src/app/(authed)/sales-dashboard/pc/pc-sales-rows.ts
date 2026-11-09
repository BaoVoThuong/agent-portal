// Company P&C đọc pc_mart một lần rồi tự chia các tập cần dùng, thay vì 3 query
// chồng lên nhau và gửi trùng dữ liệu xuống trình duyệt.

type EffectiveDated = { effective_date: string | null };
type ExpiryDated = { expired_date: string | null };

export type PcMonthRange = {
  start: string | null;
  end: string | null;
};

export type PcDateWindow = {
  startDate: string;
  endDate: string;
};

// Không lấy tháng tương lai: tháng cuối luôn bị chặn ở maxMonthKey.
export function selectPcRowsInRange<T extends EffectiveDated>(
  rows: T[],
  range: PcMonthRange,
  maxMonthKey: string
) {
  const startMonth = range.start?.slice(0, 7) ?? "";
  const requestedEndMonth = range.end?.slice(0, 7) ?? "";
  const endMonth =
    requestedEndMonth && requestedEndMonth < maxMonthKey
      ? requestedEndMonth
      : maxMonthKey;

  return rows.filter((row) => {
    const month = row.effective_date?.slice(0, 7);

    return Boolean(month) && month! >= startMonth && month! <= endMonth;
  });
}

export function selectPcExpiredRows<T extends ExpiryDated>(
  rows: T[],
  window: PcDateWindow
) {
  return rows.filter(
    (row) =>
      row.expired_date !== null &&
      row.expired_date >= window.startDate &&
      row.expired_date <= window.endDate
  );
}
