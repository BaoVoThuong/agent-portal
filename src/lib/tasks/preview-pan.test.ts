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

  // Ảnh còn lọt trọn trong khung thì không có gì bị che. Cho kéo lúc này chỉ
  // làm ảnh lệch vô cớ.
  it("ảnh nhỏ hơn khung ở cả hai chiều thì ghim về giữa", () => {
    expect(
      clampPanOffset({ x: 120, y: -80 }, { width: 200, height: 150 }, viewport)
    ).toEqual({ x: 0, y: 0 });
  });

  // Đây là thứ bản đầu làm sai: chỉ cho kéo bằng nửa phần tràn, tức ở 150% mỗi
  // bên nhúc nhích được hơn trăm pixel rồi đứng. Người dùng báo "kéo được
  // nhưng ít lắm, gần như không được".
  it("cho kéo XA HƠN nhiều so với phần bị tràn", () => {
    const bounds = { width: 800, height: 300 };
    const overflowOnly = (800 - 400) / 2; // 200 — giới hạn của bản đầu
    const moved = clampPanOffset({ x: 400, y: 0 }, bounds, viewport);
    expect(moved.x).toBeGreaterThan(overflowOnly);
  });

  // Chừa lại 80px: đủ để ảnh không biến mất hẳn khỏi khung.
  it("kéo hết cỡ vẫn còn 80px ảnh nằm trong khung", () => {
    const bounds = { width: 800, height: 300 };
    const moved = clampPanOffset({ x: 99999, y: 0 }, bounds, viewport);
    // mép trái ảnh so với tâm khung
    const imageLeft = moved.x - bounds.width / 2;
    const frameRight = viewport.width / 2;
    expect(frameRight - imageLeft).toBeCloseTo(80);
  });

  it("chặn đối xứng hai phía", () => {
    const bounds = { width: 800, height: 300 };
    const right = clampPanOffset({ x: 99999, y: 0 }, bounds, viewport).x;
    const left = clampPanOffset({ x: -99999, y: 0 }, bounds, viewport).x;
    expect(left).toBe(-right);
  });

  // Ảnh rộng tràn ngang nhưng vừa khít chiều dọc: vẫn phải nhích dọc được, vì
  // người dùng cần đưa góc ảnh vào giữa để nhìn.
  it("tràn một chiều thì chiều kia cũng kéo được", () => {
    const moved = clampPanOffset({ x: 0, y: 90 }, { width: 800, height: 200 }, viewport);
    expect(moved.y).toBe(90);
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
