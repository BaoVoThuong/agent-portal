import { getSupabaseAdmin } from "@/lib/supabase";
import { validateAttachmentFile } from "@/lib/tasks/attachments";

/**
 * Kho ảnh đại diện.
 *
 * Bucket này CÔNG KHAI, ngược với `task-attachments`. Lý do: avatar xuất hiện ở
 * mọi dòng của mọi danh sách. Một bảng task 200 dòng với 40 người khác nhau,
 * nếu dùng signed URL nghĩa là 40 chữ ký mỗi lần mở trang, ký lại mỗi giờ, nhân
 * với mọi người đang mở bảng — chi phí và độ trễ thật, đổi lại gần như không
 * được gì, vì đây là ảnh chân dung công việc trong công cụ nội bộ.
 *
 * Đường dẫn chứa UUID nên không đoán được: biết email của ai đó không suy ra
 * được URL ảnh của họ.
 */

export const AVATAR_BUCKET = "avatars";

/**
 * Trần phía SERVER. Trình duyệt đã thu ảnh về 256×256 trước khi gửi (xem
 * `resizeImageToSquare`), nên ảnh thật chỉ khoảng 15-25KB — 512KB là rất rộng.
 *
 * Vẫn phải kiểm ở đây: trình duyệt là phía không tin được, và gọi thẳng API thì
 * bỏ qua được bước thu nhỏ.
 */
export const AVATAR_MAX_BYTES = 512 * 1024;

/** Chỉ nhận ảnh. `validateAttachmentFile` còn cho cả PDF/CSV nên phải lọc lại. */
export const AVATAR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

let bucketSetupPromise: Promise<void> | null = null;

function isAlreadyExistsError(error: { message?: string; statusCode?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.statusCode === "409" ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
}

// Cùng khuôn với configureTaskBucket() trong lib/tasks/storage.ts: tạo bucket
// bằng mã chứ không bấm tay trên giao diện Supabase, để môi trường mới dựng lại
// được mà không cần ai nhớ các bước.
async function configureAvatarBucket(): Promise<void> {
  const supabase = getSupabaseAdmin();
  const options = {
    public: true,
    fileSizeLimit: AVATAR_MAX_BYTES,
    allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
  };

  const { error: getError } = await supabase.storage.getBucket(AVATAR_BUCKET);
  if (getError) {
    const { error: createError } = await supabase.storage.createBucket(
      AVATAR_BUCKET,
      options
    );
    if (createError && !isAlreadyExistsError(createError)) {
      throw new Error(createError.message);
    }
  }

  const { error: updateError } = await supabase.storage.updateBucket(
    AVATAR_BUCKET,
    options
  );
  if (updateError) throw new Error(updateError.message);
}

async function ensureAvatarBucket(): Promise<void> {
  bucketSetupPromise ??= configureAvatarBucket().catch((error: unknown) => {
    bucketSetupPromise = null;
    throw error;
  });
  await bucketSetupPromise;
}

export type AvatarValidation =
  | { ok: true; contentType: string; extension: string }
  | { ok: false; error: string };

/**
 * Tệp gửi lên có đúng là ảnh không.
 *
 * Kiểm bằng CHỮ KÝ BYTE chứ không tin phần mở rộng: đổi tên `virus.pdf` thành
 * `me.jpg` là chuyện dễ nhất trên đời. `validateAttachmentFile` đã làm đúng việc
 * đó cho phần đính kèm task nên dùng lại, rồi lọc thêm một lớp vì nó còn cho cả
 * PDF, CSV, Excel — những thứ không có chỗ trong ô avatar.
 */
export function validateAvatarFile(
  fileName: string,
  data: ArrayBuffer
): AvatarValidation {
  if (data.byteLength === 0) return { ok: false, error: "This file is empty." };
  if (data.byteLength > AVATAR_MAX_BYTES) {
    return { ok: false, error: "This photo is too large (max 512 KB after resizing)." };
  }

  const validated = validateAttachmentFile(fileName, data);
  if (!validated.ok) return { ok: false, error: validated.error };
  if (!AVATAR_ALLOWED_MIME_TYPES.includes(validated.contentType)) {
    return { ok: false, error: "Only JPG, PNG or WEBP photos are supported." };
  }

  const extension = validated.contentType === "image/png"
    ? "png"
    : validated.contentType === "image/webp"
      ? "webp"
      : "jpg";
  return { ok: true, contentType: validated.contentType, extension };
}

/**
 * Tải ảnh lên và trả về URL công khai.
 *
 * Mỗi lần gọi ghi vào một UUID MỚI, không ghi đè đường dẫn cũ. Bucket công khai
 * được cache rất mạnh: ghi đè lên đường dẫn cũ thì người vừa đổi ảnh vẫn thấy
 * ảnh cũ, có khi hàng tuần, và không có cách nào tự sửa.
 */
export async function uploadAvatar(
  data: ArrayBuffer,
  contentType: string,
  extension: string
): Promise<{ path: string; publicUrl: string }> {
  await ensureAvatarBucket();
  const supabase = getSupabaseAdmin();
  const path = `${globalThis.crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, data, { contentType, upsert: false });
  if (error) throw new Error(error.message);

  const { data: urlData } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(path);
  return { path, publicUrl: urlData.publicUrl };
}

/**
 * Xoá một ảnh cũ. Nuốt mọi lỗi và chỉ ghi log.
 *
 * Hàm này luôn chạy SAU khi cột `avatar_url` đã cập nhật xong. Tới lúc đó thao
 * tác của người dùng đã thành công rồi; một tệp mồ côi vài chục KB không đáng
 * để họ nhận một thông báo lỗi về việc mình vừa làm đúng.
 */
export async function deleteAvatarByUrl(url: string | null | undefined): Promise<void> {
  const path = avatarPathFromUrl(url);
  if (!path) return;
  try {
    const { error } = await getSupabaseAdmin()
      .storage.from(AVATAR_BUCKET)
      .remove([path]);
    if (error) throw new Error(error.message);
  } catch (caught) {
    console.error("Avatar cleanup failed", { path, error: caught });
  }
}

/**
 * Lấy lại đường dẫn trong bucket từ một URL công khai.
 *
 * Trả null cho URL không thuộc bucket này — cột có thể chứa thứ gì đó do người
 * khác ghi vào, và không được phép để một chuỗi lạ điều khiển việc xoá tệp.
 */
export function avatarPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length).split("?")[0];
  return path || null;
}
