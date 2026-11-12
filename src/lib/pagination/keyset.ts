export type KeysetPageError = {
  code?: string;
  message?: string;
  /** HTTP status của phản hồi. 429 và 5xx là tạm thời, phải giữ lại để biết. */
  status?: number;
};

export type KeysetPage<T> = {
  rows: T[] | null;
  error: KeysetPageError | null;
  /** Chỉ trang đầu mới xin `count: exact`; các trang sau bỏ trống. */
  count?: number | null;
};

export type KeysetResult<T> = {
  rows: T[];
  total: number;
  /** Danh sách bị cắt ở `maxRows`, hoặc thiếu so với `total`. Phải nói ra. */
  truncated: boolean;
};

export type KeysetOptions = {
  maxRows: number;
  /** Lỗi nào đáng thử lại. Xem `isTransientPostgrestError`. */
  isTransient: (error: KeysetPageError) => boolean;
};

/**
 * Nạp hết một bảng bằng KEYSET (`id > lastSeenId`), TUẦN TỰ.
 *
 * KHÔNG dùng OFFSET song song, kể cả khi đã sắp theo một cột bất biến. Sắp theo
 * `id` bất biến chỉ bỏ được race do kéo-thả (đổi `position`); nó KHÔNG bỏ được
 * race do insert/delete:
 *
 *   - một UUID chèn vào TRƯỚC biên trang đẩy mọi dòng sau sang trang kế → có
 *     dòng bị đọc hai lần;
 *   - một dòng bị xoá trước biên kéo mọi dòng sau lùi lại → có dòng bị BỎ SÓT;
 *   - một cặp insert+delete bù nhau còn để `rows.length === total`, nên đếm
 *     cộng khử trùng KHÔNG phát hiện được ảnh chụp sai.
 *
 * Khử trùng chỉ bỏ được bản trùng, không khôi phục được dòng đã mất. Với keyset
 * thì con trỏ là một DÒNG cụ thể, nên chèn/xoá ở chỗ khác không dịch được nó.
 *
 * Đổi lại là các trang phải đi tuần tự. Ở 5.000 dòng, 1.000 dòng/trang là 5 lượt
 * đi-về nối nhau — cái giá đúng để đổi lấy một ảnh chụp không sai.
 *
 * `fetchPage(afterId)` phải: lọc `id > afterId` khi `afterId` khác null, sắp
 * `id` tăng dần, và CHỈ xin `count: exact` khi `afterId === null`.
 */
export async function fetchAllByKeyset<T extends { id: string }>(
  fetchPage: (afterId: string | null) => Promise<KeysetPage<T>>,
  opts: KeysetOptions,
): Promise<KeysetResult<T>> {
  const rows: T[] = [];
  let afterId: string | null = null;
  /**
   * `null` = server KHÔNG trả `count`. Phải phân biệt với 0, và tuyệt đối không
   * được suy `total` từ số dòng đã nhận: nếu PostgREST cắt phản hồi ở trần của
   * nó mà header count lại thiếu, thì `total = rows.length` khiến vòng lặp dừng
   * ngay và `truncated` thành false — đúng cái lỗi cắt-cụt-im-lặng mà lớp này
   * sinh ra để diệt.
   */
  let exactCount: number | null = null;
  let sawFirstPage = false;
  let firstBatchSize = 0;

  while (rows.length < opts.maxRows) {
    let page = await fetchPage(afterId);
    // Thử lại đúng MỘT lần, và chỉ với lỗi tạm thời. Lỗi quyền, lỗi schema hay
    // truy vấn sai là vĩnh viễn — thử lại chỉ nhân đôi tải và độ trễ.
    if (page.error && opts.isTransient(page.error)) {
      page = await fetchPage(afterId);
    }
    if (page.error) {
      throw new Error(page.error.message ?? "Keyset page request failed.");
    }

    const batch = page.rows ?? [];
    if (!sawFirstPage) {
      sawFirstPage = true;
      firstBatchSize = batch.length;
      exactCount = typeof page.count === "number" ? page.count : null;
    }

    // Trang rỗng luôn là điểm kết thúc. Không dừng chỉ vì trang ngắn: trần của
    // server có thể nhỏ hơn kích thước ta xin.
    if (batch.length === 0) break;

    rows.push(...batch);
    afterId = batch[batch.length - 1].id;

    // Dùng COUNT để bỏ lượt thăm dò cuối chỉ khi trang hiện tại thực sự là
    // trang cuối. Một trang đầy tại mốc COUNT cũ có thể đã chứa dòng mới,
    // đẩy một dòng cũ sang trang sau.
    // A full page at the old count may have displaced an original row after
    // an insert between requests. A shorter later page proves exhaustion only
    // when the server's page cap stayed at least as large as the first batch.
    if (
      exactCount !== null && rows.length >= exactCount &&
      (rows.length === batch.length || batch.length < firstBatchSize)
    ) break;
  }

  const hitCap = rows.length >= opts.maxRows;
  const capped = rows.length > opts.maxRows ? rows.slice(0, opts.maxRows) : rows;
  return {
    rows: capped,
    total: exactCount ?? capped.length,
    // Chạm trần thì chắc chắn thiếu. Ngoài ra chỉ dám khẳng định thiếu khi biết
    // tổng thật; không biết tổng mà đã đi tới trang rỗng thì là đã lấy hết.
    truncated: hitCap || (exactCount !== null && capped.length < exactCount),
  };
}

/**
 * Lỗi đáng thử lại: mất mạng, timeout, hoặc server tạm thời không phục vụ được.
 * Mọi thứ khác (42501 quyền, 42703 thiếu cột, PGRST* cú pháp) là vĩnh viễn.
 */
export function isTransientPostgrestError(error: KeysetPageError): boolean {
  // Status đứng TRƯỚC code: 502/503/504 từ gateway và 429 rate-limit thường
  // không mang mã Postgres nào, và message của chúng cũng chẳng chứa từ nào
  // khớp regex bên dưới — nên nếu chỉ nhìn code/message thì đúng những lỗi
  // đáng thử lại nhất lại là những lỗi bị bỏ qua.
  const status = error.status;
  if (typeof status === "number") {
    if (status === 429 || status >= 500) return true;
    if (status >= 400) return false; // 4xx còn lại là lỗi của phía gọi
  }
  const code = error.code ?? "";
  if (code === "PGRST504" || code === "57014") return true;
  // Lớp 08 của Postgres = connection exception.
  if (code.startsWith("08")) return true;
  if (code) return false;
  return /timeout|fetch failed|network|ECONN|socket|EAI_AGAIN/i.test(
    error.message ?? "",
  );
}
