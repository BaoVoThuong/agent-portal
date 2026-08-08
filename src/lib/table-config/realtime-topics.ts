// Shared Config invalidation topic. Payloads are intentionally empty; clients
// refetch/reload through authenticated routes instead of receiving metadata on
// the public broadcast channel.
export const TABLE_CONFIG_TOPIC = "table-config-stream";
