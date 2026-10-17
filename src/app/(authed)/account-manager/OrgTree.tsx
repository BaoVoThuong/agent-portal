"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import { buildOrgTree, countReports, type OrgNode } from "@/lib/admin/org-tree";
import type { PositionOption } from "@/lib/admin/positions";
import type { RoleOption } from "@/lib/rbac/role-management";
import { Initials } from "../tasks/_components/board-ui";
import styles from "./OrgTree.module.css";

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

/** The chart uses existing reporting lines only; it never grants access. */
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
    return showDisabled
      ? tree
      : pruneDisabledLeaves(tree, (id) => byId.get(id)?.is_active ?? false);
  }, [byId, nameOf, people, showDisabled]);

  const reportingGroups = roots.filter((node) => node.children.length > 0);
  const withoutVisibleManager = roots.filter((node) => node.children.length === 0);

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
    const roleNames = person.roles.map((role) => role.name);

    return (
      <li className={styles.node} key={key}>
        <article
          className={`relative flex h-[170px] w-[176px] flex-col items-center rounded-xl border px-2.5 py-3 text-center shadow-[0_2px_8px_rgba(23,43,77,0.06)] ${
            person.is_active
              ? "border-[#b8c4d7] bg-white"
              : "border-[#dfe1e6] bg-[#f8f9fb]"
          }`}
          title={person.email}
        >
          {!person.is_active && (
            <span className="absolute right-2 top-2 rounded bg-[#ebecf0] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#6b778c]">
              Inactive
            </span>
          )}
          <div className="rounded-full bg-[#e9f2ff] p-1 ring-1 ring-[#cce0ff]">
            <Initials email={person.email} label={name} size="md" />
          </div>
          <span
            className={`mt-2 w-full truncate text-xs font-bold ${person.is_active ? "text-[#172b4d]" : "text-[#6b778c]"}`}
            title={name}
          >
            {name}
          </span>
          <span
            className={`mt-1 max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-bold ${
              roleNames.length > 0
                ? "bg-[#e9f2ff] text-[#0c66e4]"
                : "bg-[#f1f2f4] text-[#6b778c]"
            }`}
            title={roleNames.join(", ") || "No accessibility"}
          >
            {roleNames.length > 1 ? `${roleNames[0]} +${roleNames.length - 1}` : roleNames[0] ?? "No accessibility"}
          </span>
          <span className="mt-1 w-full truncate text-[11px] text-[#6b778c]" title={person.position?.name ?? "No position"}>
            {person.position?.name ?? "No position"}
          </span>
          <div className="mt-auto flex h-5 items-center justify-center">
            {node.cycle ? (
              <span className="text-[10px] font-semibold text-[#a54800]" title="This manager chain loops back here.">
                Reporting loop
              </span>
            ) : reports > 0 ? (
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} reports for ${name}`}
                className="inline-flex items-center gap-1 rounded-full bg-[#e9f2ff] px-2 py-0.5 text-[10px] font-bold text-[#0c66e4] transition hover:bg-[#d4e8ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c66e4]"
              >
                {reports} {reports === 1 ? "report" : "reports"}
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            ) : null}
          </div>
        </article>
        {node.children.length > 0 && !isCollapsed && (
          <ul className={styles.children}>
            {node.children.map((child) => renderNode(child, key))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="min-w-0 px-4 py-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#172b4d]">
            <Network className="h-4 w-4 text-[#6554c0]" aria-hidden />
            Organization chart
          </h3>
          <p className="mt-1 text-xs text-[#6b778c]">
            Reporting lines follow Manager; Assistants appear under their Agent. Scroll sideways to see wide groups.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#44546f]">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[#b8c2d3]"
            checked={showDisabled}
            onChange={(event) => setShowDisabled(event.target.checked)}
          />
          Show inactive accounts
        </label>
      </div>

      {roots.length === 0 && (
        <p className="rounded-lg border border-dashed border-[#dfe1e6] px-4 py-10 text-center text-sm text-[#6b778c]">
          No accounts to show.
        </p>
      )}

      <div className="space-y-5">
        {reportingGroups.map((root) => (
          <section className="min-w-0 overflow-hidden rounded-xl border border-[#dfe1e6] bg-[#fafbff]" key={root.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e6dded] bg-[#f4e8f7] px-4 py-2.5">
              <h4 className="text-xs font-bold text-[#604b7b]">{nameOf(root.id)}’s reporting line</h4>
              <span className="text-[11px] font-semibold text-[#765f8f]">
                {countReports(root) + 1} accounts
              </span>
            </div>
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <div className={styles.chart}>
                <ul className={styles.root}>{renderNode(root, "")}</ul>
              </div>
            </div>
          </section>
        ))}

        {withoutVisibleManager.length > 0 && (
          <section className="rounded-xl border border-[#dfe1e6] bg-[#fafbff]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e6dded] bg-[#f4e8f7] px-4 py-2.5">
              <div>
                <h4 className="text-xs font-bold text-[#604b7b]">No reporting line shown</h4>
                <p className="mt-0.5 text-[11px] text-[#765f8f]">Accounts without a visible manager or direct reports.</p>
              </div>
              <span className="text-[11px] font-semibold text-[#765f8f]">{withoutVisibleManager.length} accounts</span>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] justify-items-center gap-4 p-4">
              {withoutVisibleManager.map((node) => renderNode(node, ""))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
