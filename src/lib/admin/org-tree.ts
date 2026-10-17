/**
 * The management tree shown in Account Manager. Read-only and display-only:
 * nothing about access is decided from it.
 *
 * A person's parents are the Agents they assist when they are an Assistant
 * (agent_members), otherwise their manager (portal_account.manager_id). An
 * Assistant who supports several Agents appears under each of them.
 */
export type OrgPerson = {
  id: string;
  email: string;
  isActive: boolean;
  managerId: string | null;
  /** Lower-cased Agent emails this person assists. */
  assistedAgentEmails: readonly string[];
};

export type OrgNode = {
  id: string;
  children: OrgNode[];
  /** This branch would loop back to an ancestor; its children are not shown again. */
  cycle: boolean;
};

export function orgParentIds(person: OrgPerson, idByEmail: ReadonlyMap<string, string>): string[] {
  if (person.assistedAgentEmails.length > 0) {
    return [
      ...new Set(
        person.assistedAgentEmails
          .map((email) => idByEmail.get(email.trim().toLowerCase()))
          .filter((id): id is string => Boolean(id) && id !== person.id),
      ),
    ];
  }
  return person.managerId && person.managerId !== person.id ? [person.managerId] : [];
}

/**
 * Roots are people without a known parent. Someone whose parents all sit in a
 * loop of managers with no root above them is lifted to the top level as well,
 * so nobody disappears from the tree.
 */
export function buildOrgTree(
  people: readonly OrgPerson[],
  nameOf: (id: string) => string,
): OrgNode[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const idByEmail = new Map(people.map((person) => [person.email.trim().toLowerCase(), person.id]));
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();

  for (const person of people) {
    const parents = orgParentIds(person, idByEmail).filter((id) => byId.has(id));
    parentsOf.set(person.id, parents);
    for (const parent of parents) {
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), person.id]);
    }
  }

  const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b));
  const placed = new Set<string>();

  function build(id: string, ancestors: ReadonlySet<string>): OrgNode {
    placed.add(id);
    if (ancestors.has(id)) return { id, children: [], cycle: true };
    const next = new Set(ancestors).add(id);
    return {
      id,
      cycle: false,
      children: [...(childrenOf.get(id) ?? [])].sort(byName).map((child) => build(child, next)),
    };
  }

  const roots = people
    .filter((person) => (parentsOf.get(person.id) ?? []).length === 0)
    .map((person) => person.id)
    .sort(byName)
    .map((id) => build(id, new Set()));

  // Loops of managers with nobody above them: show each loop from one member.
  for (const person of [...people].sort((a, b) => byName(a.id, b.id))) {
    if (!placed.has(person.id)) roots.push(build(person.id, new Set()));
  }
  return roots;
}

/** How many people sit under this node, each person counted once. */
export function countReports(node: OrgNode): number {
  const seen = new Set<string>();
  const walk = (current: OrgNode) => {
    for (const child of current.children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      walk(child);
    }
  };
  walk(node);
  return seen.size;
}
