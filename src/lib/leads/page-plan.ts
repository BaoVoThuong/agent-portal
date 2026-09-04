import type { LeadRow } from "./types";

/**
 * Trần số DÒNG một lượt nạp danh sách được phép kéo về.
 *
 * Cố ý tính theo DÒNG chứ không theo TRANG. Trần "12 trang" thực chất là trần
 * "12 × trần của server", mà chính lý do `planLeadPageOffsets` tồn tại là server
 * có thể trả trang nhỏ hơn ta xin: `db-max-rows` = 1000 thì đó là 13.000 dòng,
 * nhưng = 200 thì chỉ còn 2.600 — thấp hơn cả quy mô module này đang nhắm tới.
 * Theo dòng thì trần là một con số xác định, không phụ thuộc cấu hình server.
 *
 * Khớp `SUMMARY_MAX_ROWS` của `src/app/api/leads/overview/route.ts`.
 */
export const LEAD_MAX_ROWS = 20_000;

/**
 * Số trang được phép bay song song cùng lúc.
 *
 * Không thả hết một lượt: `tasks/leads/page.tsx` đã gọi `fetchAllLeads` bên
 * trong một `Promise.all` cùng bốn truy vấn khác, và mỗi trang lead còn kéo
 * theo một join `lead_interactions`. Thả 12 truy vấn nặng cùng lúc vào một
 * `db-pool` mặc định 10 kết nối là tự dựng hàng đợi cho chính mình.
 */
export const LEAD_PAGE_FETCH_CONCURRENCY = 4;

/**
 * Những offset còn phải lấy SAU trang đầu, để gọi song song.
 *
 * Bước nhảy là `firstPageRowCount` — số dòng trang đầu THỰC SỰ trả về — chứ
 * không phải kích thước trang ta yêu cầu. PostgREST có trần `db-max-rows` của
 * riêng nó: nếu ta xin 1000 mà nó chỉ trả 500, thì vòng lặp tuần tự vẫn đúng
 * (nó tiến theo số dòng nhận được), nhưng một kế hoạch song song dựng theo con
 * số ta YÊU CẦU sẽ xin offset 1000, 2000, 3000… và bỏ lọt im lặng các dòng
 * 500–999, 1500–1999. Bước theo thực tế thì kế hoạch tự đúng với mọi trần.
 *
 * `maxRows` chặn trên. Chạm trần nghĩa là danh sách bị cắt cụt, và người gọi
 * PHẢI nói ra điều đó — xem `fetchAllLeads` trả `truncated`.
 */
export function planLeadPageOffsets(
  firstPageRowCount: number,
  total: number,
  maxRows: number,
): number[] {
  if (firstPageRowCount <= 0) return [];
  const ceiling = Math.min(total, maxRows);
  const offsets: number[] = [];
  for (
    let offset = firstPageRowCount;
    offset < ceiling;
    offset += firstPageRowCount
  ) {
    offsets.push(offset);
  }
  return offsets;
}

/**
 * Bỏ dòng trùng id, giữ lần xuất hiện đầu và giữ nguyên thứ tự.
 *
 * Phân trang theo offset trên một bảng đang được ghi có thể trả về cùng một
 * dòng hai lần: chỉ cần ai đó chèn một lead giữa hai lượt xin trang là mọi
 * offset sau đó lệch đi một. Lấy song song thu hẹp cửa sổ đó chứ không đóng
 * được nó.
 *
 * Đánh đổi: sau khi khử trùng, `rows.length` có thể NHỎ HƠN `total` — vòng lặp
 * tuần tự cũ thì chạy tới khi `>= total`. Đó là cùng một dạng "hai con số trên
 * màn hình không khớp nhau" mà cờ `truncated` sinh ra để nói, chỉ lệch đúng
 * bằng số dòng bị chèn giữa chừng, và lượt realtime kế tiếp vá lại.
 */
export function dedupeLeadsById(rows: readonly LeadRow[]): LeadRow[] {
  const seen = new Set<string>();
  const result: LeadRow[] = [];
  for (const lead of rows) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    result.push(lead);
  }
  return result;
}

/**
 * Chia danh sách offset thành từng chùm để chạy song song có giới hạn.
 * Tách ra để test được ranh giới chùm mà không cần đụng tới mạng.
 */
export function chunkPageOffsets(
  offsets: readonly number[],
  size: number,
): number[][] {
  if (size <= 0) return offsets.length > 0 ? [[...offsets]] : [];
  const chunks: number[][] = [];
  for (let index = 0; index < offsets.length; index += size) {
    chunks.push(offsets.slice(index, index + size));
  }
  return chunks;
}
