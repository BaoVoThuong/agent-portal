// Normalize an agent name for matching across registration tables
// (health_entries.selected_agent, pc_entries.selected_agent, session name):
// trim, collapse spaces, uppercase.
export function normalizeAgentName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

// PostgREST `.or()` filter so a non-admin user sees entries they submitted
// (agent_email) OR entries entered on their behalf (selected_agent matches
// their normalized name). Values are wrapped in double quotes because email
// and names can contain "." or "," which are reserved in the or() grammar.
export function buildVisibleEntriesFilter(
  email: string,
  name: string | null | undefined
) {
  const conditions = [`agent_email.eq.${quoteOrValue(email)}`];
  const agentName = normalizeAgentName(name);

  if (agentName) {
    conditions.push(`selected_agent.eq.${quoteOrValue(agentName)}`);
  }

  return conditions.join(",");
}

function quoteOrValue(value: string) {
  // Escape backslashes and double quotes, then wrap in double quotes.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
