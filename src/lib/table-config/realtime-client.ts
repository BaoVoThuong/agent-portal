"use client";

import { getBrowserSupabase } from "@/lib/supabase-browser";
import { CONFIG_CHANGED_EVENT, SLA_CONFIG_TOPIC } from "./realtime-topics";

/**
 * Notify already-open boards after a confirmed SLA mutation. This is
 * intentionally best-effort and never part of the mutation response path.
 * The payload stays empty so clients must re-read the authenticated policy.
 */
export async function broadcastSlaConfigChanged(): Promise<void> {
  const supabase = getBrowserSupabase();
  if (!supabase) return;

  const channel = supabase.channel(SLA_CONFIG_TOPIC);
  try {
    await channel.send({
      type: "broadcast",
      event: CONFIG_CHANGED_EVENT,
      payload: {},
    });
  } catch {
    // Realtime is an optimization; the board also refreshes on reconnect and focus.
  } finally {
    await supabase.removeChannel(channel);
  }
}
