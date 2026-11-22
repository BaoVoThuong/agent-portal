export const HOVER_PREFETCH_DELAY_MS = 150;

export type HoverIntent = {
  enter(onIntent: () => void): void;
  cancel(): void;
};

export function createHoverIntent(delayMs: number = HOVER_PREFETCH_DELAY_MS): HoverIntent {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    enter(onIntent) {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        onIntent();
      }, delayMs);
    },
    cancel() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}
