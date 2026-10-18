"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  LocateFixed,
  Maximize,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { buildOrgTree, countReports, orgParentIds, type OrgNode } from "@/lib/admin/org-tree";
import type { PositionOption } from "@/lib/admin/positions";
import type { RoleOption } from "@/lib/rbac/role-management";
import { Initials } from "../tasks/_components/board-ui";
import { useAnchoredMenu } from "../tasks/_components/use-anchored-menu";
import { POSITION_BADGE_STYLES, POSITION_LOZENGE } from "./PositionMenu";
import styles from "./OrgChart.module.css";

export type OrgChartPerson = {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  roles: RoleOption[];
  position: PositionOption | null;
  config: { managerId: string | null; assistedAgentEmails: string[] };
};

export type OrgChartEditing = {
  /** Accounts that can be someone's manager (active ones). */
  managerIds: ReadonlySet<string>;
  /** Saves a new manager (null: none). Resolves false when the save failed. */
  onChangeManager: (personId: string, managerId: string | null) => Promise<boolean>;
  onEditAccount: (personId: string) => void;
  onAddReport: (managerId: string) => void;
};

/** Drop target that clears the manager. */
const NO_MANAGER = "__no_manager__";
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.5;

type View = { x: number; y: number; scale: number };
/** Why a drop is refused; "same" changes nothing and is not highlighted. */
type MoveProblem = "same" | "loop" | "inactive" | null;

const PROBLEM_TEXT: Record<"loop" | "inactive", string> = {
  loop: "Reports to them",
  inactive: "Inactive account",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Zooms by `factor` keeping the point (cx, cy) of the viewport still. */
function zoomView(view: View, cx: number, cy: number, factor: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return { scale, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

function displayName(person: OrgChartPerson) {
  return person.name?.trim() || person.email;
}

function accessLabel(person: OrgChartPerson) {
  const names = person.roles.map((role) => role.name);
  if (names.length === 0) return "No accessibility";
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

/** A disabled leaf says nothing about the chart; a disabled manager does. */
function pruneDisabledLeaves(nodes: OrgNode[], isActive: (id: string) => boolean): OrgNode[] {
  return nodes.flatMap((node) => {
    const children = pruneDisabledLeaves(node.children, isActive);
    if (!isActive(node.id) && children.length === 0) return [];
    return [{ ...node, children }];
  });
}

/**
 * Every card key of each person, in chart order. A key is the chain of ids
 * from the top, because an Assistant can sit under several Agents.
 */
function collectKeys(nodes: OrgNode[], path: string, into: Map<string, string[]>) {
  for (const node of nodes) {
    const key = `${path}/${node.id}`;
    into.set(node.id, [...(into.get(node.id) ?? []), key]);
    collectKeys(node.children, key, into);
  }
}

function findNode(nodes: OrgNode[], id: string): OrgNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function CardMenu({
  person,
  editing,
  onRemoveManager,
}: {
  person: OrgChartPerson;
  editing: OrgChartEditing;
  onRemoveManager: () => void;
}) {
  const { isOpen, toggle, triggerRef, menuRef, menuStyle, closeMenu } = useAnchoredMenu({
    estimatedHeight: 140,
  });
  const isAssistant = person.config.assistedAgentEmails.length > 0;
  const actions = [
    ...(person.is_active
      ? [{ label: "Add direct report", onSelect: () => editing.onAddReport(person.id) }]
      : []),
    { label: "Edit account", onSelect: () => editing.onEditAccount(person.id) },
    ...(person.config.managerId && !isAssistant
      ? [{ label: "Remove manager", onSelect: onRemoveManager }]
      : []),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={`Actions for ${displayName(person)}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#6b778c] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={menuStyle}
              className="z-[100] w-44 overflow-hidden rounded border border-[#dfe1e6] bg-white p-1 text-left shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
            >
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    action.onSelect();
                  }}
                  className="flex w-full items-center rounded px-2.5 py-1.5 text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7]"
                >
                  {action.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function OrgCard({
  person,
  node,
  nodeKey,
  collapsed,
  onToggle,
  highlighted,
  editing,
  problemFor,
  onRemoveManager,
}: {
  person: OrgChartPerson;
  node: OrgNode;
  nodeKey: string;
  collapsed: boolean;
  onToggle: () => void;
  highlighted: boolean;
  editing: OrgChartEditing | null;
  problemFor: (personId: string, targetId: string) => MoveProblem;
  onRemoveManager: (personId: string) => void;
}) {
  // An Assistant sits under the Agents they support, and changing those changes
  // access: that goes through Edit account, not a drag.
  const canDrag = Boolean(editing) && person.config.assistedAgentEmails.length === 0;
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag:${nodeKey}`,
    data: { personId: person.id },
    disabled: !canDrag,
  });
  const { setNodeRef: setDropRef, isOver, active } = useDroppable({
    id: `drop:${nodeKey}`,
    data: { targetId: person.id },
    disabled: !editing,
  });
  const draggedId = active?.data.current?.personId as string | undefined;
  const problem = isOver && draggedId ? problemFor(draggedId, person.id) : "same";
  const name = displayName(person);
  const direct = node.children.length;
  const total = countReports(node);

  const stateClass =
    problem === null
      ? "border-[#0c66e4] bg-[#e9f2ff] ring-2 ring-[#0c66e4]"
      : problem !== "same"
        ? "border-[#de350b] ring-2 ring-[#de350b]"
        : highlighted
          ? "border-[#0c66e4] ring-2 ring-[#0c66e4] ring-offset-2"
          : person.is_active
            ? "border-[#dfe1e6] bg-white"
            : "border-[#dfe1e6] bg-[#fafbfc]";

  return (
    <article
      ref={(element) => {
        setDragRef(element);
        setDropRef(element);
      }}
      data-org-key={nodeKey}
      data-org-interactive
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      title={person.email}
      className={`${styles.card} w-[208px] rounded-lg border p-3 text-left shadow-[0_1px_2px_rgba(9,30,66,0.12)] transition ${
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      } ${isDragging ? "opacity-40" : ""} ${person.is_active ? "" : "text-[#6b778c]"} ${stateClass}`}
    >
      <div className="flex items-start gap-2.5">
        <Initials email={person.email} label={name} size="md" />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-bold ${person.is_active ? "text-[#172b4d]" : "text-[#6b778c]"}`}>
            {name}
          </p>
          <p className="truncate text-[11px] font-semibold text-[#6b778c]">{accessLabel(person)}</p>
        </div>
        {editing && (
          <CardMenu
            person={person}
            editing={editing}
            onRemoveManager={() => onRemoveManager(person.id)}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {person.position ? (
          <span className={`${POSITION_LOZENGE} ${POSITION_BADGE_STYLES[person.position.kind]}`}>
            {person.position.name}
          </span>
        ) : (
          <span className="text-[11px] text-[#8590a2]">No position</span>
        )}
        {!person.is_active && (
          <span className="rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#626f86]">
            Inactive
          </span>
        )}
      </div>
      {(node.cycle || total > 0) && (
        <div className="mt-2.5 border-t border-[#f1f2f4] pt-2">
          {node.cycle ? (
            <span className="text-[11px] font-semibold text-[#a54800]" title="This manager chain loops back here.">
              Reporting loop
            </span>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              onPointerDown={(event) => event.stopPropagation()}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Show" : "Hide"} reports of ${name}`}
              className="-mx-1.5 inline-flex items-center gap-2.5 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#44546f] transition hover:bg-[#f1f2f4]"
            >
              <span className="inline-flex items-center gap-1" title="Everyone under them">
                <UsersRound className="h-3.5 w-3.5" />
                {total}
              </span>
              <span className="inline-flex items-center gap-1" title="Direct reports">
                <UserRound className="h-3.5 w-3.5" />
                {direct}
              </span>
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      )}
      {problem === "loop" || problem === "inactive" ? (
        <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#de350b] px-1.5 py-0.5 text-[10px] font-bold text-white">
          {PROBLEM_TEXT[problem]}
        </span>
      ) : null}
    </article>
  );
}

/** A person with no manager and no reports, waiting in the side tray. */
function TrayRow({
  person,
  highlighted,
  editing,
  problemFor,
}: {
  person: OrgChartPerson;
  highlighted: boolean;
  editing: OrgChartEditing | null;
  problemFor: (personId: string, targetId: string) => MoveProblem;
}) {
  const canDrag = Boolean(editing) && person.config.assistedAgentEmails.length === 0;
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag:tray:${person.id}`,
    data: { personId: person.id },
    disabled: !canDrag,
  });
  const { setNodeRef: setDropRef, isOver, active } = useDroppable({
    id: `drop:tray:${person.id}`,
    data: { targetId: person.id },
    disabled: !editing,
  });
  const draggedId = active?.data.current?.personId as string | undefined;
  const problem = isOver && draggedId ? problemFor(draggedId, person.id) : "same";
  const name = displayName(person);

  return (
    <li
      ref={(element) => {
        setDragRef(element);
        setDropRef(element);
      }}
      data-org-tray-id={person.id}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      title={person.email}
      className={`flex items-center gap-2.5 rounded-md border bg-white px-2.5 py-2 transition ${
        canDrag ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        problem === null
          ? "border-[#0c66e4] bg-[#e9f2ff] ring-2 ring-[#0c66e4]"
          : problem !== "same"
            ? "border-[#de350b] ring-2 ring-[#de350b]"
            : highlighted
              ? "border-[#0c66e4] ring-2 ring-[#0c66e4]"
              : "border-[#dfe1e6] hover:border-[#c1c7d0]"
      }`}
    >
      <Initials email={person.email} label={name} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${person.is_active ? "text-[#172b4d]" : "text-[#8590a2]"}`}>
          {name}
        </p>
        <p className="truncate text-[11px] text-[#6b778c]">{person.position?.name ?? "No position"}</p>
      </div>
      {!person.is_active && (
        <span className="shrink-0 rounded bg-[#f4f5f7] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#626f86]">
          Inactive
        </span>
      )}
    </li>
  );
}

function NoManagerTray({
  people,
  highlightedId,
  editing,
  draggedHasManager,
  problemFor,
}: {
  people: OrgChartPerson[];
  highlightedId: string | null;
  editing: OrgChartEditing | null;
  draggedHasManager: boolean;
  problemFor: (personId: string, targetId: string) => MoveProblem;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "zone:no-manager",
    data: { targetId: NO_MANAGER },
    disabled: !editing,
  });
  const dropping = isOver && draggedHasManager;

  return (
    <aside
      ref={setNodeRef}
      className={`flex max-h-80 min-h-0 flex-col border-t border-[#dfe1e6] transition lg:max-h-none lg:w-64 lg:shrink-0 lg:border-l lg:border-t-0 ${
        dropping ? "bg-[#e9f2ff] ring-2 ring-inset ring-[#0c66e4]" : "bg-[#fafbfc]"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#dfe1e6] px-3 py-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
          {dropping ? "Drop to remove manager" : "No manager"}
        </h3>
        <span className="rounded-full bg-[#f1f2f4] px-1.5 text-[11px] font-bold tabular-nums text-[#44546f]">
          {people.length}
        </span>
      </div>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {people.map((person) => (
          <TrayRow
            key={person.id}
            person={person}
            highlighted={highlightedId === person.id}
            editing={editing}
            problemFor={problemFor}
          />
        ))}
        {people.length === 0 && (
          <li className="px-2 py-6 text-center text-xs font-semibold text-[#8590a2]">Everyone has a place.</li>
        )}
      </ul>
    </aside>
  );
}

/**
 * Reporting lines from Manager (Assistants under the Agents they support) on
 * one pan-and-zoom canvas. Dragging a card onto another changes its Manager
 * after a confirmation; the chart never grants access by itself.
 */
export function OrgChart({
  people,
  currentUserEmail,
  editing,
}: {
  people: OrgChartPerson[];
  currentUserEmail: string;
  /** Null shows the chart read-only. */
  editing: OrgChartEditing | null;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(
    null,
  );
  const fittedRef = useRef(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [panning, setPanning] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState<{ key: string | null; id: string } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ personId: string; managerId: string | null } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const idByEmail = useMemo(
    () => new Map(people.map((person) => [person.email.trim().toLowerCase(), person.id])),
    [people],
  );

  const roots = useMemo(() => {
    const nameOf = (id: string) => {
      const person = byId.get(id);
      return person ? displayName(person) : id;
    };
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
    return showInactive ? tree : pruneDisabledLeaves(tree, (id) => byId.get(id)?.is_active ?? false);
  }, [byId, people, showInactive]);

  const chartRoots = useMemo(() => roots.filter((node) => node.children.length > 0), [roots]);
  const unplaced = useMemo(
    () =>
      roots
        .filter((node) => node.children.length === 0)
        .map((node) => byId.get(node.id))
        .filter((person): person is OrgChartPerson => Boolean(person)),
    [byId, roots],
  );
  const keysById = useMemo(() => {
    const keys = new Map<string, string[]>();
    collectKeys(chartRoots, "", keys);
    return keys;
  }, [chartRoots]);

  /** True when `targetId` already reports, directly or not, to `personId`. */
  function reportsTo(targetId: string, personId: string) {
    const seen = new Set<string>();
    const queue = [targetId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === personId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const person = byId.get(id);
      if (!person) continue;
      queue.push(
        ...orgParentIds(
          {
            id: person.id,
            email: person.email,
            isActive: person.is_active,
            managerId: person.config.managerId,
            assistedAgentEmails: person.config.assistedAgentEmails,
          },
          idByEmail,
        ),
      );
    }
    return false;
  }

  function moveProblem(personId: string, targetId: string): MoveProblem {
    const person = byId.get(personId);
    if (!person) return "same";
    if (targetId === NO_MANAGER) return person.config.managerId ? null : "same";
    if (targetId === personId || targetId === person.config.managerId) return "same";
    if (!editing?.managerIds.has(targetId)) return "inactive";
    if (reportsTo(targetId, personId)) return "loop";
    return null;
  }

  // Start with everything in view, once the chart has a size.
  useLayoutEffect(() => {
    if (fittedRef.current || chartRoots.length === 0) return;
    fittedRef.current = true;
    fitView();
  });

  // Wheel pans; Ctrl/⌘ + wheel (and trackpad pinch) zooms under the pointer.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport!.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * 0.01);
        setView((current) =>
          zoomView(current, event.clientX - rect.left, event.clientY - rect.top, factor),
        );
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    }
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (!pendingMove || saving) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPendingMove(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pendingMove, saving]);

  function fitView() {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    if (!width || !height) return;
    const scale = clamp(
      Math.min(viewport.clientWidth / width, viewport.clientHeight / height),
      MIN_SCALE,
      1,
    );
    setView({
      scale,
      x: (viewport.clientWidth - width * scale) / 2,
      y: Math.max(0, (viewport.clientHeight - height * scale) / 2),
    });
  }

  function zoomBy(factor: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setView((current) => zoomView(current, viewport.clientWidth / 2, viewport.clientHeight / 2, factor));
  }

  function centerOn(key: string) {
    const viewport = viewportRef.current;
    const card = viewport?.querySelector<HTMLElement>(`[data-org-key="${CSS.escape(key)}"]`);
    if (!viewport || !card) return;
    const box = viewport.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    const dx = box.left + box.width / 2 - (rect.left + rect.width / 2);
    const dy = box.top + box.height / 3 - (rect.top + rect.height / 2);
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  /** Opens every collapsed branch above the person, then brings their card into view. */
  function reveal(personId: string) {
    const key = keysById.get(personId)?.[0] ?? null;
    setHighlight({ key, id: personId });
    if (!key) {
      document
        .querySelector(`[data-org-tray-id="${CSS.escape(personId)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    setCollapsed((current) => new Set([...current].filter((collapsedKey) => !key.startsWith(`${collapsedKey}/`))));
    // Wait for the opened branches to render before measuring the card.
    requestAnimationFrame(() => requestAnimationFrame(() => centerOn(key)));
  }

  function toggleBranch(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-org-interactive]")) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: view.x,
      y: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
    setSearchOpen(false);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: pan.x + event.clientX - pan.startX,
      y: pan.y + event.clientY - pan.startY,
    }));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // A person under the pointer wins over the No manager tray around them.
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const person = hits.find((hit) => String(hit.id).startsWith("drop:"));
    return person ? [person] : hits;
  };

  function handleDragStart(event: DragStartEvent) {
    setDraggedId((event.active.data.current?.personId as string | undefined) ?? null);
    setSearchOpen(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedId(null);
    const personId = event.active.data.current?.personId as string | undefined;
    const targetId = event.over?.data.current?.targetId as string | undefined;
    if (!personId || !targetId || moveProblem(personId, targetId) !== null) return;
    setPendingMove({ personId, managerId: targetId === NO_MANAGER ? null : targetId });
  }

  async function confirmMove() {
    if (!pendingMove || !editing) return;
    setSaving(true);
    await editing.onChangeManager(pendingMove.personId, pendingMove.managerId);
    setSaving(false);
    setPendingMove(null);
  }

  const visibleIds = useMemo(
    () => new Set([...keysById.keys(), ...unplaced.map((person) => person.id)]),
    [keysById, unplaced],
  );
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    return people
      .filter(
        (person) =>
          visibleIds.has(person.id) &&
          [person.name, person.email].some((value) => value?.toLowerCase().includes(text)),
      )
      .slice(0, 8);
  }, [people, query, visibleIds]);

  const currentUserId = idByEmail.get(currentUserEmail.trim().toLowerCase()) ?? null;
  const dragged = draggedId ? byId.get(draggedId) ?? null : null;

  function renderNode(node: OrgNode, path: string) {
    const person = byId.get(node.id);
    if (!person) return null;
    const key = `${path}/${node.id}`;
    const isCollapsed = collapsed.has(key);
    return (
      <li className={styles.node} key={key}>
        <OrgCard
          person={person}
          node={node}
          nodeKey={key}
          collapsed={isCollapsed}
          onToggle={() => toggleBranch(key)}
          highlighted={highlight?.key === key}
          editing={editing}
          problemFor={moveProblem}
          onRemoveManager={(personId) => setPendingMove({ personId, managerId: null })}
        />
        {node.children.length > 0 && !isCollapsed && (
          <ul className={styles.children}>{node.children.map((child) => renderNode(child, key))}</ul>
        )}
      </li>
    );
  }

  const pendingPerson = pendingMove ? byId.get(pendingMove.personId) ?? null : null;
  const pendingManager = pendingMove?.managerId ? byId.get(pendingMove.managerId) ?? null : null;
  const pendingNode = pendingMove ? findNode(roots, pendingMove.personId) : null;
  const pendingReports = pendingNode ? countReports(pendingNode) : 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggedId(null)}
    >
      <div className="flex h-full min-h-[520px] flex-col lg:flex-row">
        <div
          ref={viewportRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`relative min-h-[420px] min-w-0 flex-1 touch-none overflow-hidden bg-[#f7f8f9] ${
            panning ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{
            backgroundImage: "radial-gradient(#dcdfe4 1px, transparent 1px)",
            backgroundSize: `${16 * view.scale}px ${16 * view.scale}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        >
          <div
            ref={contentRef}
            className="absolute left-0 top-0 select-none"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0" }}
          >
            <div className={styles.forest}>
              {chartRoots.map((root) => (
                <ul className={styles.root} key={root.id}>
                  {renderNode(root, "")}
                </ul>
              ))}
            </div>
          </div>

          {chartRoots.length === 0 && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-[#6b778c]">
              No reporting lines yet.
            </p>
          )}

          <div data-org-interactive className="absolute left-3 top-3 w-64">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b778c]" />
              <input
                type="search"
                aria-label="Find a person"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && matches[0]) {
                    reveal(matches[0].id);
                    setSearchOpen(false);
                  }
                  if (event.key === "Escape") setSearchOpen(false);
                }}
                placeholder="Find a person"
                className="h-9 w-full rounded-lg border border-[#dfe1e6] bg-white pl-8 pr-3 text-sm text-[#172b4d] shadow-sm outline-none transition placeholder:text-[#8590a2] hover:border-[#c1c7d0] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#0c66e4]/20"
              />
            </label>
            {searchOpen && matches.length > 0 && (
              <ul className="mt-1 overflow-hidden rounded-lg border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]">
                {matches.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => {
                        reveal(person.id);
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition hover:bg-[#f4f5f7]"
                    >
                      <Initials email={person.email} label={displayName(person)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#172b4d]">
                          {displayName(person)}
                        </span>
                        <span className="block truncate text-[11px] text-[#6b778c]">
                          {person.position?.name ?? person.email}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label
            data-org-interactive
            className="absolute right-3 top-3 flex cursor-pointer items-center gap-2 rounded-lg border border-[#dfe1e6] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#44546f] shadow-sm"
          >
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
              className="h-4 w-4 accent-[#0c66e4]"
            />
            Show inactive
          </label>

          <div
            data-org-interactive
            className="absolute bottom-3 right-3 flex items-center rounded-lg border border-[#dfe1e6] bg-white p-0.5 shadow-sm"
          >
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.2)}
              aria-label="Zoom out"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1 / view.scale)}
              title="Reset to 100%"
              className="h-8 min-w-12 rounded px-1 text-xs font-bold tabular-nums text-[#44546f] transition hover:bg-[#f4f5f7]"
            >
              {Math.round(view.scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1.2)}
              aria-label="Zoom in"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            >
              <Plus className="h-4 w-4" />
            </button>
            <span className="mx-0.5 h-5 w-px bg-[#dfe1e6]" aria-hidden />
            <button
              type="button"
              onClick={fitView}
              aria-label="Fit chart"
              title="Fit chart"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            >
              <Maximize className="h-4 w-4" />
            </button>
            {currentUserId && visibleIds.has(currentUserId) && (
              <button
                type="button"
                onClick={() => reveal(currentUserId)}
                aria-label="Find me"
                title="Find me"
                className="inline-flex h-8 w-8 items-center justify-center rounded text-[#44546f] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
              >
                <LocateFixed className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <NoManagerTray
          people={unplaced}
          highlightedId={highlight && !highlight.key ? highlight.id : null}
          editing={editing}
          draggedHasManager={Boolean(dragged?.config.managerId)}
          problemFor={moveProblem}
        />
      </div>

      {typeof document !== "undefined"
        ? createPortal(
            <DragOverlay dropAnimation={null}>
              {dragged ? (
                <div className="flex w-[208px] cursor-grabbing items-center gap-2.5 rounded-lg border border-[#0c66e4] bg-white p-3 shadow-[0_8px_24px_rgba(9,30,66,0.25)]">
                  <Initials email={dragged.email} label={displayName(dragged)} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#172b4d]">{displayName(dragged)}</p>
                    <p className="truncate text-[11px] text-[#6b778c]">{dragged.position?.name ?? "No position"}</p>
                  </div>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}

      {pendingMove && pendingPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="org-move-title"
            className="w-full max-w-[420px] rounded-lg border border-[#dfe1e6] bg-white p-5 shadow-xl"
          >
            <h2 id="org-move-title" className="text-lg font-bold text-[#172b4d]">
              Change manager?
            </h2>
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-[#dfe1e6] bg-[#fafbfc] px-3 py-2.5">
              <Initials email={pendingPerson.email} label={displayName(pendingPerson)} size="md" />
              <p className="min-w-0 text-sm text-[#44546f]">
                <span className="font-bold text-[#172b4d]">{displayName(pendingPerson)}</span>
                {pendingManager ? (
                  <>
                    {" "}will report to{" "}
                    <span className="font-bold text-[#172b4d]">{displayName(pendingManager)}</span>.
                  </>
                ) : (
                  " will have no manager."
                )}
              </p>
            </div>
            {pendingReports > 0 && (
              <p className="mt-2 text-xs text-[#6b778c]">
                Their {pendingReports} {pendingReports === 1 ? "report moves" : "reports move"} with them.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setPendingMove(null)}
                className="inline-flex h-9 items-center rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                disabled={saving}
                onClick={() => void confirmMove()}
                className="inline-flex h-9 items-center rounded-lg bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
