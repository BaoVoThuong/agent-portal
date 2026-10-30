/** Agent name in the data → portal account id. Unlinked names keep their name only. */
export type AgentLinks = Record<string, string>;

const squash = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Until links are saved, an agent name links to the one account with the same name. */
export function defaultAgentLinks(agentNames: Iterable<string>, accounts: ReadonlyArray<{ id: string; name: string }>): AgentLinks {
  const byName = new Map<string, string[]>();
  for (const account of accounts) {
    const key = squash(account.name);
    byName.set(key, [...(byName.get(key) ?? []), account.id]);
  }
  const links: AgentLinks = {};
  for (const name of agentNames) {
    const matches = byName.get(squash(name));
    if (matches?.length === 1) links[name] = matches[0];
  }
  return links;
}
