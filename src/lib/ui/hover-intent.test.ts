import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHoverIntent, HOVER_PREFETCH_DELAY_MS } from "./hover-intent";

describe("createHoverIntent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("prefetches after the pointer rests on a row", () => {
    const fn = vi.fn();
    createHoverIntent().enter(fn);
    vi.advanceTimersByTime(HOVER_PREFETCH_DELAY_MS - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("cancels when the pointer leaves", () => {
    const fn = vi.fn();
    const intent = createHoverIntent();
    intent.enter(fn);
    intent.cancel();
    vi.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not restart a pending timer", () => {
    const fn = vi.fn();
    const intent = createHoverIntent();
    intent.enter(fn);
    vi.advanceTimersByTime(100);
    intent.enter(fn);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("supports another hover after cancellation", () => {
    const fn = vi.fn();
    const intent = createHoverIntent(10);
    intent.enter(fn);
    intent.cancel();
    intent.enter(fn);
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("can prefetch again on a later hover", () => {
    const fn = vi.fn();
    const intent = createHoverIntent(10);
    intent.enter(fn);
    vi.advanceTimersByTime(10);
    intent.cancel();
    intent.enter(fn);
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("allows cancel before any hover", () => {
    expect(() => createHoverIntent().cancel()).not.toThrow();
  });
});
