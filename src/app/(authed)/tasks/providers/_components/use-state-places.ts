"use client";

import { useEffect, useState } from "react";
import type { StatePlaces } from "@/lib/providers/us-places";

// Mỗi bang tải một lần cho cả phiên: mở lại form hay đổi qua lại hai bang không
// gọi lại mạng. Tệp nằm ở public/us-places (scripts/build-us-places.mjs).
const loaded = new Map<string, Promise<StatePlaces>>();

function loadStatePlaces(code: string): Promise<StatePlaces> {
  let pending = loaded.get(code);
  if (!pending) {
    pending = fetch(`/us-places/${code}.json`).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load cities for ${code}.`);
      return (await response.json()) as StatePlaces;
    });
    // Mạng lỗi thì lần sau thử lại, đừng giữ một lần tải đã hỏng.
    pending.catch(() => loaded.delete(code));
    loaded.set(code, pending);
  }
  return pending;
}

/**
 * City / ZIP của bang đang chọn. `places` là null khi chưa chọn bang hoặc đang
 * tải; `failed` khi tải hỏng — form khi đó quay về ô gõ tay để không chặn người
 * nhập chỉ vì mạng chập chờn.
 */
export function useStatePlaces(code: string | null): {
  places: StatePlaces | null;
  failed: boolean;
} {
  const [result, setResult] = useState<{
    code: string;
    places: StatePlaces | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    loadStatePlaces(code).then(
      (places) => {
        if (alive) setResult({ code, places, failed: false });
      },
      () => {
        if (alive) setResult({ code, places: null, failed: true });
      }
    );
    return () => {
      alive = false;
    };
  }, [code]);

  return result && result.code === code ? result : { places: null, failed: false };
}
