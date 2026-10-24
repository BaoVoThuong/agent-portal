"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { APP_VERSION, isNewerDeployment } from "@/lib/app-version";

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Tells a tab built by an older deployment to reload. Without it a CS agent
 * who keeps the board open for hours keeps running the old code against the
 * new API: after the 2026-10-22 rollback such tabs failed every upload with
 * a bare "Attachment upload failed" until someone said "refresh".
 *
 * Checks when the tab comes back into view and every five minutes while it is
 * visible. It never reloads on its own, so a half-written comment survives.
 */
export function NewVersionBanner() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (!APP_VERSION || outdated) return;
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/app-version", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { version?: string | null };
        if (!cancelled && isNewerDeployment(APP_VERSION, data.version)) setOutdated(true);
      } catch {
        // Offline or signed out: try again on the next tick.
      }
    };

    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [outdated]);

  if (!outdated) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[300] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg bg-[#172b4d] px-4 py-3 text-sm text-white shadow-[0_8px_24px_rgba(9,30,66,0.35)]"
    >
      <span className="min-w-0 flex-1">
        A new version of the portal is out. Reload so comments and uploads keep working.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded bg-white px-3 py-1.5 text-sm font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]"
      >
        <RefreshCw size={14} aria-hidden="true" />
        Reload
      </button>
    </div>
  );
}
