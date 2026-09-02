import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  inferAttachmentMimeType,
} from "./attachments";

/** Đủ dùng cho `ClipboardEvent.clipboardData` lẫn `DragEvent.dataTransfer`. */
export type DataTransferLike = {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; getAsFile: () => File | null }> | null;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function hasUsableExtension(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return extension.length > 0 && extension !== name.toLowerCase();
}

/**
 * Đọc clipboard ra danh sách file đính kèm được.
 *
 * **Vì sao phải đặt tên lại:** `validateAttachmentFile` phía server tra MIME
 * theo ĐUÔI FILE chứ không nhìn `file.type`. Ảnh chụp màn hình dán vào, tuỳ
 * trình duyệt, có tên là `"image.png"`, `""`, hoặc một chuỗi không đuôi —
 * trường hợp không đuôi thì qua được cổng client rồi chết ở cổng server, và
 * người dùng chỉ biết sau khi đã bấm gửi.
 *
 * **Vì sao tên phải khác nhau:** `addFiles` chống trùng bằng
 * `name + size + lastModified`. Mọi ảnh dán đều tên `"image.png"`, nên hai ảnh
 * chụp cùng kích thước sẽ bị coi là trùng và cái thứ hai bị từ chối oan.
 *
 * **File người dùng copy từ máy thì GIỮ NGUYÊN tên** — tên đó có ý nghĩa với
 * họ. Chỉ đặt tên hộ khi trình duyệt không cho cái tên nào dùng được.
 */
export function filesFromClipboard(
  data: DataTransferLike | null | undefined,
  now: Date = new Date()
): File[] {
  if (!data) return [];

  // `files` là đường chính và được mọi trình duyệt hiện đại hỗ trợ. `items` là
  // đường lùi cho bản cũ hơn, nơi ảnh chỉ xuất hiện dưới dạng item kind="file".
  const raw: File[] = data.files?.length
    ? Array.from(data.files)
    : Array.from(data.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  const out: File[] = [];
  raw.forEach((file, index) => {
    const mime = inferAttachmentMimeType(file.name, file.type || undefined);
    // Cùng danh sách cho phép với nút kẹp giấy. Dán một file lạ thì im lặng bỏ
    // qua chứ không báo lỗi: người dùng thường chỉ định dán chữ, và một hộp lỗi
    // đỏ cho thao tác họ không cố ý làm là phiền vô cớ.
    if (!ATTACHMENT_ALLOWED_MIME_TYPES.includes(mime)) return;

    if (hasUsableExtension(file.name)) {
      out.push(file);
      return;
    }

    const extension = EXTENSION_BY_MIME[mime];
    if (!extension) return;
    // Thêm chỉ số khi dán nhiều ảnh cùng lúc: cùng một giây thì mốc thời gian
    // không đủ để phân biệt.
    const suffix = raw.length > 1 ? `-${index + 1}` : "";
    out.push(
      new File([file], `pasted-image-${stamp}${suffix}.${extension}`, {
        type: mime,
        lastModified: file.lastModified,
      })
    );
  });
  return out;
}
