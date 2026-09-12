/**
 * Biến một signed URL của Supabase Storage thành link TẢI THẲNG.
 *
 * Vì sao cần: thuộc tính `download` của thẻ <a> chỉ có tác dụng khi URL **cùng
 * origin** với trang (hoặc là blob:/data:). Đây là quy định của chuẩn HTML để
 * một trang không thể lặng lẽ ép tải file từ tên miền khác. File đính kèm của
 * task nằm trên `*.supabase.co`, tức khác origin, nên trình duyệt **bỏ qua
 * `download`** và chuyển sang điều hướng bình thường — người dùng thấy ảnh mở
 * ra ở tab mới và phải chuột phải "Save image as" mới tải được.
 *
 * Không có cảnh báo nào cho chuyện này: thẻ <a> trông hoàn toàn đúng, chỉ là
 * một nửa của nó bị làm ngơ.
 *
 * Cách sửa là để SERVER nói "đây là file để tải" thay vì nhờ trình duyệt đoán.
 * Supabase Storage nhận query param `download`, và trả về header
 * `Content-Disposition: attachment; filename="..."`. Header đó thì không phụ
 * thuộc origin, nên tải thẳng ở mọi trình duyệt.
 *
 * Cố ý KHÔNG nướng sẵn param này vào signed URL lúc ký ở server: cùng một URL
 * đó còn dùng để xem trước (thẻ <img>, iframe PDF). URL mang
 * `Content-Disposition: attachment` sẽ làm bản xem trước PDF biến thành hộp
 * thoại tải file. Chỉ nút Download mới cần, nên chỉ thêm ở đúng nút Download.
 */
export function toAttachmentDownloadUrl(url: string, fileName: string): string {
  try {
    // Dùng URL API chứ không nối chuỗi: signed URL đã có sẵn `?token=...`, nối
    // tay bằng "?" sẽ làm hỏng token và file trả về 400.
    const parsed = new URL(url);
    parsed.searchParams.set("download", fileName || "");
    return parsed.toString();
  } catch {
    // URL tương đối hoặc rỗng thì `new URL` ném lỗi. Trả nguyên bản còn hơn
    // làm vỡ cái link — trường hợp xấu nhất là quay về hành vi cũ.
    return url;
  }
}
