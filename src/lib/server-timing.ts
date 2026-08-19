export type TimingRecorder = {
  measure<T>(name: string, operation: () => Promise<T>): Promise<T>;
};

type RouteTimingOptions = {
  now?: () => number;
  logger?: (line: string) => void;
  logEnabled?: boolean;
};

const SERVER_TIMING_NAME = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function formatDuration(durationMs: number): string {
  return Math.max(0, durationMs).toFixed(1);
}

export function shouldLogRouteTiming(
  env: {
    NODE_ENV?: string;
    TASK_DETAIL_PERF_LOGS?: string;
  } = process.env,
): boolean {
  if (env.TASK_DETAIL_PERF_LOGS === "1") return true;
  if (env.TASK_DETAIL_PERF_LOGS === "0") return false;
  return env.NODE_ENV !== "production" && env.NODE_ENV !== "test";
}

/**
 * Per-request timing recorder for dynamic route handlers.
 *
 * Metric names are controlled by the application and values are durations
 * only: never put task ids, emails, filenames, or other customer data here.
 */
export class RouteTiming implements TimingRecorder {
  private readonly startedAt: number;
  private readonly metrics = new Map<string, number>();
  private readonly now: () => number;
  private readonly logger: (line: string) => void;
  private readonly logEnabled: boolean;
  private finished = false;

  constructor(
    private readonly label: string,
    options: RouteTimingOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.logger = options.logger ?? ((line) => console.info(line));
    this.logEnabled = options.logEnabled ?? shouldLogRouteTiming();
    this.startedAt = this.now();
  }

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = this.now();
    try {
      return await operation();
    } finally {
      this.record(name, this.now() - startedAt);
    }
  }

  record(name: string, durationMs: number): void {
    if (!SERVER_TIMING_NAME.test(name)) {
      throw new Error(`Invalid Server-Timing metric name: ${name}`);
    }
    this.metrics.set(name, Math.max(0, durationMs));
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    // This is route-handler time only. Next's own request log additionally
    // includes proxy/framework work; network and client paint are outside both.
    this.record("route_total", this.now() - this.startedAt);
  }

  headerValue(): string {
    this.finish();
    return [...this.metrics.entries()]
      .map(([name, duration]) => `${name};dur=${formatDuration(duration)}`)
      .join(", ");
  }

  log(status: number): void {
    this.finish();
    if (!this.logEnabled) return;
    const metrics = [...this.metrics.entries()]
      .map(([name, duration]) => `${name}=${formatDuration(duration)}ms`)
      .join(" ");
    this.logger(`[perf:${this.label}] status=${status} ${metrics}`);
  }
}
