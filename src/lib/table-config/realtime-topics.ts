// Shared Config invalidation topic. Payloads are intentionally empty; clients
// refetch/reload through authenticated routes instead of receiving metadata on
// the public broadcast channel.
export const TABLE_CONFIG_TOPIC = "table-config-stream";

// SLA policy changes are an invalidation-only signal. Clients must refetch
// through their authenticated API route; no rule values are sent over the
// public Realtime payload.
export const SLA_CONFIG_TOPIC = "sla-config-stream";
export const CONFIG_CHANGED_EVENT = "changed";
