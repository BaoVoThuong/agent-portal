"use client";

import { useEffect, useState } from "react";
import { createHoverIntent, HOVER_PREFETCH_DELAY_MS } from "./hover-intent";

export function useHoverIntent(
  onIntent: () => void,
  delayMs: number = HOVER_PREFETCH_DELAY_MS,
): { onMouseEnter: () => void; onMouseLeave: () => void } {
  const [intent] = useState(() => createHoverIntent(delayMs));
  useEffect(() => () => intent.cancel(), [intent]);
  return {
    onMouseEnter: () => intent.enter(onIntent),
    onMouseLeave: () => intent.cancel(),
  };
}
