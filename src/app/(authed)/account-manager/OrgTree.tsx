"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { buildOrgTree, countReports, type OrgNode } from "@/lib/admin/org-tree";
import type { PositionOption } from "@/lib/admin/positions";
import type { RoleOption } from "@/lib/rbac/role-management";
import { Initials } from "../tasks/_components/board-ui";
import { POSITION_BADGE_STYLES, POSITION_LOZENGE } from "./PositionMenu";

export type OrgTreePerson = {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  roles: RoleOption[];
  position: PositionOption | null;
  config: { managerId: string | null; assistedAgentEmails: string[] };
};

/** A disabled leaf says nothing about the tree; a disabled manager does. */
function pruneDisabledLeaves(nodes: OrgNode[], isActive: (id: string) => boolean): OrgNode[] {
  return nodes.flatMap((node) => {
    const children = pruneDisabledLeaves(node.children, isActive);
    if (!isActive(node.id) && children.length === 0) return [];
    return [{ ...node, children }];
  });
}

/**
 * Who reports to whom, from the Manager column. Read-only: the tree grants
 * nothing. An Assistant sits under every Agent they support.
 */
export function OrgTree({ people }: { people: OrgTreePerson[] }) {
  const [showDisabled, setShowDisabled] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const nameOf = useMemo(
    () => (id: string) => byId.get(id)?.name?.trim() || byId.get(id)?.email || id,
    [byId],
  );

  const roots = useMemo(() => {
    const tree = buildOrgTree(
      people.map((person) => ({
        id: person.id,
        email: person.email,
        isActive: person.is_active,
        managerId: person.config.managerId,
        assistedAgentEmails: person.config.assistedAgentEmails,
      })),
      nameOf,
    );
    // People with reports first, then everyone without a manager.
    const ordered = [...tree].sort(
      (a, b) => Number(b.children.length > 0) - Number(a.children.length > 0),
    );
    return showDisabled
      ? ordered
      : pruneDisabledLeaves(ordered, (id) => byId.get(id)?.is_active ?? false);
  }, [byId, nameOf, people, showDisabled]);

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderNode(node: OrgNode, path: string) {
    const person = byId.get(node.id);
    if (!person) return null;
    const key = `${path}/${node.id}`;
    const isCollapsed = collapsed.has(key);
    const reports = countReports(node);
    const name = person.name?.trim() || person.email;

    return (
      <li key={key}>
        <div className="flex min-w-0 items-center gap-2 rounded px-1 py-1.5 hover:bg-[#f7f8f9]">
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${name}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#6b778c] hover:bg-[#ebecf0]"
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : (
            <span className="h-6 w-6 shrink-0" aria-hidden />
          )}
          <Initials email={person.email} label={name} />
          <span
            className={`truncate text-sm font-semibold ${person.is_active ? "text-[#172b4d]" : "text-[#8590a2] line-through"}`}
            title={person.email}
          >
            {name}
          </span>
          {person.roles[0] && (
            <span className={`${POSITION_LOZENGE} shrink-0 bg-[#f1f2f4] text-[#44546f]`}>{person.roles[0].name}</span>
          )}
          {person.position && (
            <span className={`${POSITION_LOZENGE} shrink-0 ${POSITION_BADGE_STYLES[person.position.kind]}`}>
              {person.position.name}
            </span>
          )}
          {!person.is_active && (
            <span className="shrink-0 rounded bg-[#f1f2f4] px-1.5 py-0.5 text-[11px] font-bold text-[#6b778c]">Disabled</span>
          )}
          {node.cycle && (
            <span className="shrink-0 text-[11px] font-semibold text-[#a54800]" title="This manager chain loops back here.">
              (loop)
            </span>
          )}
          {reports > 0 && (
            <span className="shrink-0 text-xs font-semibold text-[#6b778c]">
              {reports} {reports === 1 ? "person" : "people"}
            </span>
          )}
        </div>
        {node.children.length > 0 && !isCollapsed && (
          <ul className="ml-4 border-l border-[#dfe1e6] pl-3">
            {node.children.map((child) => renderNode(child, key))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#6b778c]">
          From the Manager column. An Assistant appears under every Agent they support. The tree grants no access.
        </p>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#44546f]">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[#b8c2d3]"
            checked={showDisabled}
            onChange={(event) => setShowDisabled(event.target.checked)}
          />
          Show disabled accounts
        </label>
      </div>
      <ul>{roots.map((node) => renderNode(node, ""))}</ul>
    </div>
  );
}
