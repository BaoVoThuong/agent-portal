import { describe, expect, it } from "vitest";
import {
  clampPanOffset,
  rotatedScaledBounds,
  zoomAtPoint,
} from "@/lib/tasks/preview-pan";

describe("rotatedScaledBounds", () => {
  it("nhân theo mức phóng", () => {
    expect(rotatedScaledBounds({ width: 100, height: 50 }, 0, 2)).toEqual({
      width: 200,
      height: 100,
    });
  });

  // CSS transform không đổi ô chiếm chỗ của ảnh, nên muốn biết ảnh tràn ra bao
  // nhiêu thì phải tự tính hộp bao — không hỏi trình duyệt được.
  it("xoay 90 và 270 thì đổi chỗ hai cạnh", () => {
    expect(rotatedScaledBounds({ width: 100, height: 50 }, 90, 1)).toEqual({
      width: 50,
      height: 100,
    });
    expect(rotatedScaledBounds({ width: 100, height: 50 }, 270, 1)).toEqual({
      width: 50,
      height: 100,
    });
  });

  it("xoay 180 thì giữ nguyên", () => {
    expect(rotatedScaledBounds({ width: 100, height: 50 }, 180, 1)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("nhận góc âm và góc quá 360", () => {
    expect(rotatedScaledBounds({ width: 100, height: 50 }, 450, 1).width).toBe(50);
    expect(rotatedScaledBounds({ width: 100, height: 50 }, -90, 1).width).toBe(50);
  });
});

describe("clampPanOffset", () => {
  const viewport = { width: 400, height: 300 };

  // Ảnh còn nằm lọt trong khung thì không có gì để kéo. Cho kéo lúc này là để
  // người dùng lôi ảnh ra khỏi màn hình rồi không biết đường lấy lại.
  it("ảnh nhỏ hơn khung thì ghim về giữa", () => {
    expect(
      clampPanOffset({ x: 120, y: -80 }, { width: 200, height: 150 }, viewport)
    ).toEqual({ x: 0, y: 0 });
  });

  it("kéo trong phạm vi phần tràn thì giữ nguyên", () => {
    // tràn ngang = (800-400)/2 = 200
    expect(
      clampPanOffset({ x: 150, y: 0 }, { width: 800, height: 300 }, viewport)
    ).toEqual({ x: 150, y: 0 });
  });

  it("kéo quá phần tràn thì chặn lại đúng mép", () => {
    expect(
      clampPanOffset({ x: 999, y: 0 }, { width: 800, height: 300 }, viewport)
    ).toEqual({ x: 200, y: 0 });
    expect(
      clampPanOffset({ x: -999, y: 0 }, { width: 800, height: 300 }, viewport)
    ).toEqual({ x: -200, y: 0 });
  });

  it("hai trục chặn độc lập nhau", () => {
    // tràn ngang 200, dọc 0 -> kéo dọc bao nhiêu cũng về 0
    expect(
      clampPanOffset({ x: 50, y: 90 }, { width: 800, height: 200 }, viewport)
    ).toEqual({ x: 50, y: 0 });
  });

  it("khung chưa đo được thì không kéo", () => {
    expect(
      clampPanOffset({ x: 50, y: 50 }, { width: 800, height: 600 }, { width: 0, height: 0 })
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("zoomAtPoint", () => {
  // Phóng quanh tâm khung: điểm đang ở giữa vẫn ở giữa.
  it("con trỏ ở tâm thì offset nhân theo tỉ lệ phóng", () => {
    expect(zoomAtPoint({ x: 10, y: 20 }, { x: 0, y: 0 }, 1, 2)).toEqual({
      x: 20,
      y: 40,
    });
  });

  // Đây mới là thứ làm zoom "dính tay": chỗ đang trỏ phải đứng yên.
  it("giữ nguyên điểm dưới con trỏ", () => {
    const pointer = { x: 100, y: 0 };
    const next = zoomAtPoint({ x: 0, y: 0 }, pointer, 1, 2);
    // điểm ảnh dưới con trỏ trước khi phóng: (100 - 0) / 1 = 100
    // sau khi phóng phải vẫn nằm dưới con trỏ: 100 * 2 + next.x = 100
    expect(100 * 2 + next.x).toBe(pointer.x);
  });

  it("thu nhỏ cũng giữ đúng điểm đó", () => {
    const pointer = { x: -60, y: 40 };
    const next = zoomAtPoint({ x: 30, y: -10 }, pointer, 2, 1);
    const imageX = (pointer.x - 30) / 2;
    const imageY = (pointer.y - -10) / 2;
    expect(imageX * 1 + next.x).toBeCloseTo(pointer.x);
    expect(imageY * 1 + next.y).toBeCloseTo(pointer.y);
  });
});
