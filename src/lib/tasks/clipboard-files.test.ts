import { describe, expect, it } from "vitest";
import { filesFromClipboard } from "./clipboard-files";

const png = (name: string, size = 1024) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

const clipboard = (files: File[]) => ({ files, items: null });

const NOW = new Date(2026, 8, 2, 14, 30, 5);

describe("filesFromClipboard", () => {
  it("đặt tên mới cho ảnh dán, kèm đuôi đúng", () => {
    // Bẫy chính: validateAttachmentFile phía server tra MIME theo ĐUÔI FILE,
    // không nhìn file.type. Ảnh không đuôi qua được cổng client rồi chết ở
    // server — người dùng thấy ảnh trong ô soạn, bấm gửi, rồi nhận lỗi upload.
    const out = filesFromClipboard(clipboard([png("image.png")]), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("image.png");
  });

  it("file KHÔNG CÓ TÊN vẫn ra được tên có đuôi", () => {
    const out = filesFromClipboard(clipboard([png("")]), NOW);
    expect(out[0].name).toMatch(/^pasted-image-\d{14}\.png$/);
    expect(out[0].type).toBe("image/png");
  });

  it("tên không có đuôi cũng được đặt lại", () => {
    const out = filesFromClipboard(clipboard([png("Screenshot")]), NOW);
    expect(out[0].name).toMatch(/\.png$/);
  });

  it("hai ảnh không tên dán cùng lượt có tên khác nhau", () => {
    // addFiles chống trùng bằng name+size+lastModified. Cùng tên và cùng kích
    // thước là cái thứ hai bị từ chối oan.
    const out = filesFromClipboard(clipboard([png(""), png("")]), NOW);
    expect(out).toHaveLength(2);
    expect(out[0].name).not.toBe(out[1].name);
  });

  it("giữ nguyên tên của file người dùng copy từ máy", () => {
    // Copy một file thật trong Finder rồi dán: tên đó có ý nghĩa với họ.
    const out = filesFromClipboard(
      clipboard([
        new File([new Uint8Array(10)], "hop-dong-2026.pdf", {
          type: "application/pdf",
        }),
      ]),
      NOW
    );
    expect(out[0].name).toBe("hop-dong-2026.pdf");
  });

  it("bỏ qua kiểu file không nằm trong danh sách cho phép", () => {
    const out = filesFromClipboard(
      clipboard([
        new File([new Uint8Array(10)], "script.exe", {
          type: "application/x-msdownload",
        }),
      ]),
      NOW
    );
    expect(out).toEqual([]);
  });

  it("dán CHỮ thuần thì không trả file nào", () => {
    // Quan trọng: dán chữ phải hoạt động như cũ. Trả mảng rỗng để nơi gọi biết
    // là KHÔNG được chặn sự kiện paste.
    expect(filesFromClipboard(clipboard([]), NOW)).toEqual([]);
    expect(filesFromClipboard(null, NOW)).toEqual([]);
  });

  it("đọc được qua items khi trình duyệt không cho files", () => {
    const file = png("");
    const out = filesFromClipboard(
      { files: null, items: [{ kind: "file", getAsFile: () => file }] },
      NOW
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toMatch(/\.png$/);
  });
});
