/**
 * Chạy `run` SAU khi response đã trả, qua `after()` của Next.
 *
 * Trên Vercel, `after()` giữ function sống tới khi `run` xong. Nhưng nó chỉ là
 * chạy nền, không phải hàng đợi bền: function hỏng giữa chừng thì việc trong đó
 * mất. Vì vậy chỉ đưa vào đây những việc "phát đi" (realtime, push); dữ liệu
 * nghiệp vụ phải ghi xong trong request.
 *
 * Trả `false` khi đang ngoài request scope (script, cron chạy tay, test): lúc đó
 * `after()` ném lỗi, và nơi gọi tự chạy `run` luôn.
 */
export async function runAfterResponse(run: () => Promise<void>): Promise<boolean> {
  try {
    const { after } = await import("next/server");
    after(run);
    return true;
  } catch {
    return false;
  }
}
