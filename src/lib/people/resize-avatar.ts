/**
 * Thu ảnh về một ô vuông nhỏ TRƯỚC khi tải lên.
 *
 * Đây là điều kiện để tính năng dùng được, không phải phần tối ưu thêm. Ảnh chụp
 * điện thoại thường 3-5MB. Lưu nguyên cỡ nghĩa là mỗi dòng trong bảng task tải
 * về một tệp 4MB — bảng 200 dòng với 40 người là khoảng 160MB cho một lần mở
 * trang, trên chính màn hình mà mọi người ngồi cả ngày.
 *
 * 256×256 webp chất lượng 0.85 ra khoảng 15-25KB.
 *
 * Cắt theo tâm chứ không bóp méo: ảnh chân dung thường là dọc, kéo cho vừa ô
 * vuông sẽ làm mặt người bị dẹt.
 */

export const AVATAR_EDGE_PX = 256;
const AVATAR_QUALITY = 0.85;

export type ResizeResult =
  | { ok: true; file: File }
  | { ok: false; error: string };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      // Gỡ ngay sau khi vẽ xong: giữ lại là rò bộ nhớ, và người dùng thử vài ảnh
      // liên tiếp thì tab phình lên từng chút một.
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh."));
    };
    image.src = url;
  });
}

export async function resizeImageToSquare(file: File): Promise<ResizeResult> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Chỉ nhận tệp ảnh." };
  }

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : "Không đọc được ảnh.",
    };
  }

  const source = Math.min(image.naturalWidth, image.naturalHeight);
  if (source === 0) return { ok: false, error: "Ảnh không hợp lệ." };

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE_PX;
  canvas.height = AVATAR_EDGE_PX;
  const context = canvas.getContext("2d");
  if (!context) return { ok: false, error: "Trình duyệt không dựng được ảnh." };

  context.drawImage(
    image,
    // Ô vuông lấy từ giữa ảnh gốc.
    (image.naturalWidth - source) / 2,
    (image.naturalHeight - source) / 2,
    source,
    source,
    0,
    0,
    AVATAR_EDGE_PX,
    AVATAR_EDGE_PX
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", AVATAR_QUALITY)
  );
  if (!blob) return { ok: false, error: "Không nén được ảnh." };

  return {
    ok: true,
    // Tên tệp phải có đuôi .webp: server kiểm kiểu bằng chữ ký byte nhưng suy
    // kiểu mong đợi từ phần mở rộng, nên hai vế phải khớp nhau.
    file: new File([blob], "avatar.webp", { type: "image/webp" }),
  };
}
