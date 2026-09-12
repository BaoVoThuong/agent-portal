"use client";

import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Move,
  Network,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  buildOrgForest,
  canAssignManager,
  countDirectReports,
  countReports,
  descendantIds,
  flattenForest,
  ORG_ASSIGN_MESSAGE,
  type OrgNode,
  type OrgPerson,
} from "@/lib/org-chart/tree";
import type { UserRole } from "@/lib/domain/account.types";

export type OrgChartPerson = OrgPerson & {
  agent_id: string | null;
  role: UserRole;
};

type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

const DEFAULT_VIEWPORT: Viewport = { x: 72, y: 56, zoom: 1 };
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.4;

function displayName(person: Pick<OrgPerson, "name" | "email">): string {
  return person.name?.trim() || person.email;
}

function initials(person: Pick<OrgPerson, "name" | "email">): string {
  const words = displayName(person)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function roleLabel(person: OrgChartPerson): string {
  if (person.role === "admin") return "Administrator";
  return person.agent_id ? `Agent · ${person.agent_id}` : "Team member";
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function pruneForest<T extends OrgPerson>(
  nodes: readonly OrgNode<T>[],
  keepIds: ReadonlySet<string>
): OrgNode<T>[] {
  return nodes.flatMap((node) => {
    const reports = pruneForest(node.reports, keepIds);
    if (!keepIds.has(node.person.id) && reports.length === 0) return [];
    return [{ ...node, reports }];
  });
}

function OrgCard({
  node,
  selected,
  isCurrentUser,
  collapsed,
  searchActive,
  onSelect,
  onToggle,
  registerCard,
}: {
  node: OrgNode<OrgChartPerson>;
  selected: boolean;
  isCurrentUser: boolean;
  collapsed: boolean;
  searchActive: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  registerCard: (id: string, element: HTMLButtonElement | null) => void;
}) {
  const { person } = node;
  const directReports = countDirectReports(node);
  const totalReports = countReports(node);
  const canCollapse = directReports > 0 && !searchActive;

  return (
    <article
      data-org-interactive="true"
      className={`relative w-60 rounded-xl border bg-white shadow-sm transition ${
        selected
          ? "border-[#1769e8] ring-4 ring-blue-100"
          : "border-slate-200 hover:border-blue-300 hover:shadow-md"
      } ${!person.is_active ? "opacity-75" : ""}`}
    >
      <button
        ref={(element) => registerCard(person.id, element)}
        type="button"
        data-org-interactive="true"
        onClick={() => onSelect(person.id)}
        className="block w-full rounded-xl p-3 text-left outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
        aria-pressed={selected}
        aria-label={`View ${displayName(person)}`}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              isCurrentUser
                ? "bg-[#1769e8] text-white"
                : "bg-[#eaf2ff] text-[#1769e8]"
            }`}
          >
            {initials(person)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold text-[#172e55]">
                {displayName(person)}
              </span>
              {isCurrentUser ? (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1769e8]">
                  You
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {roleLabel(person)}
            </span>
          </span>
        </div>

        <span className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <span className="truncate text-xs text-slate-500">{person.email}</span>
          {!person.is_active ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              Inactive
            </span>
          ) : null}
        </span>

        <span className="mt-2.5 flex gap-2 text-[11px] font-semibold text-slate-600">
          <span
            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-1"
            title={`${directReports} direct report${directReports === 1 ? "" : "s"}`}
          >
            <UserRound className="h-3 w-3" />
            {directReports}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-1"
            title={`${totalReports} person${totalReports === 1 ? "" : "s"} in this reporting line`}
          >
            <Users className="h-3 w-3" />
            {totalReports}
          </span>
        </span>
      </button>

      {canCollapse ? (
        <button
          type="button"
          data-org-interactive="true"
          onClick={() => onToggle(person.id)}
          className="absolute -bottom-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-blue-300 hover:text-[#1769e8]"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${displayName(person)}'s reports`}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
    </article>
  );
}

function OrgTreeNode({
  node,
  depth,
  selectedId,
  currentUserId,
  collapsedIds,
  searchActive,
  onSelect,
  onToggle,
  registerCard,
}: {
  node: OrgNode<OrgChartPerson>;
  depth: number;
  selectedId: string | null;
  currentUserId: string | null;
  collapsedIds: ReadonlySet<string>;
  searchActive: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  registerCard: (id: string, element: HTMLButtonElement | null) => void;
}) {
  const collapsed = collapsedIds.has(node.person.id);
  const reports = collapsed && !searchActive ? [] : node.reports;

  return (
    <li className={`relative flex flex-col items-center px-3 ${depth > 0 ? "pt-7" : ""}`}>
      {depth > 0 ? (
        <span aria-hidden className="absolute top-0 h-7 w-px bg-[#cbd5e1]" />
      ) : null}
      <OrgCard
        node={node}
        selected={selectedId === node.person.id}
        isCurrentUser={currentUserId === node.person.id}
        collapsed={collapsed}
        searchActive={searchActive}
        onSelect={onSelect}
        onToggle={onToggle}
        registerCard={registerCard}
      />

      {reports.length > 0 ? (
        <div className="relative mt-7 flex flex-col items-center">
          <span aria-hidden className="absolute -top-7 h-7 w-px bg-[#cbd5e1]" />
          <ul className="relative flex min-w-max items-start justify-center gap-3 pt-7">
            {reports.length > 1 ? (
              <li
                aria-hidden
                className="absolute left-[10%] right-[10%] top-0 h-px bg-[#cbd5e1]"
              />
            ) : null}
            {reports.map((report) => (
              <OrgTreeNode
                key={report.person.id}
                node={report}
                depth={depth + 1}
                selectedId={selectedId}
                currentUserId={currentUserId}
                collapsedIds={collapsedIds}
                searchActive={searchActive}
                onSelect={onSelect}
                onToggle={onToggle}
                registerCard={registerCard}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export default function OrgChartClient({
  initialPeople,
  currentUserId,
  canManage,
}: {
  initialPeople: OrgChartPerson[];
  currentUserId: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [optimisticPeople, setOptimisticPeople] = useState<{
    source: OrgChartPerson[];
    people: OrgChartPerson[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(currentUserId);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [isPanning, setIsPanning] = useState(false);
  const [managerDraft, setManagerDraft] = useState<{
    personId: string;
    managerId: string;
  } | null>(null);
  const [saveFailure, setSaveFailure] = useState<{
    personId: string;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const panStart = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);

  // `router.refresh()` giữ state client của Next. Chỉ dùng bản optimistic khi
  // nó còn thuộc đúng payload server hiện tại; khi server trả payload mới thì
  // tự động quay về prop mới, không cần effect setState gây cascade render.
  const people =
    optimisticPeople?.source === initialPeople
      ? optimisticPeople.people
      : initialPeople;

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people]
  );
  const visiblePeople = useMemo(
    () => people.filter((person) => showInactive || person.is_active),
    [people, showInactive]
  );
  const visibleById = useMemo(
    () => new Map(visiblePeople.map((person) => [person.id, person])),
    [visiblePeople]
  );
  const fullForest = useMemo(() => buildOrgForest(people), [people]);
  const visibleForest = useMemo(
    () => buildOrgForest(visiblePeople),
    [visiblePeople]
  );
  const fullNodesById = useMemo(
    () =>
      new Map(
        flattenForest(fullForest.roots).map((node) => [node.person.id, node])
      ),
    [fullForest.roots]
  );

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingIds = useMemo(() => {
    if (!normalizedQuery) return new Set(visiblePeople.map((person) => person.id));

    const matches = visiblePeople.filter((person) =>
      [displayName(person), person.email, person.agent_id ?? "", roleLabel(person)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    );
    const keep = new Set(matches.map((person) => person.id));

    for (const person of matches) {
      const seen = new Set<string>();
      let managerId = person.manager_id;
      while (managerId && !seen.has(managerId)) {
        seen.add(managerId);
        const manager = visibleById.get(managerId);
        if (!manager) break;
        keep.add(manager.id);
        managerId = manager.manager_id;
      }
    }
    return keep;
  }, [normalizedQuery, visibleById, visiblePeople]);

  const displayRoots = useMemo(
    () =>
      normalizedQuery
        ? pruneForest(visibleForest.roots, matchingIds)
        : visibleForest.roots,
    [matchingIds, normalizedQuery, visibleForest.roots]
  );
  const effectiveSelectedId =
    selectedId && visibleById.has(selectedId) ? selectedId : null;
  const selectedPerson = effectiveSelectedId
    ? visibleById.get(effectiveSelectedId) ?? null
    : null;
  const selectedNode = selectedPerson
    ? fullNodesById.get(selectedPerson.id) ?? null
    : null;
  const selectedManager = selectedPerson?.manager_id
    ? peopleById.get(selectedPerson.manager_id) ?? null
    : null;
  const inactiveManagerCount = useMemo(
    () =>
      people.filter(
        (person) =>
          person.is_active &&
          person.manager_id &&
          peopleById.get(person.manager_id)?.is_active === false
      ).length,
    [people, peopleById]
  );

  const matchingManagerDraft =
    managerDraft && managerDraft.personId === selectedPerson?.id
      ? managerDraft
      : null;
  const managerDraftId = matchingManagerDraft
    ? matchingManagerDraft.managerId
    : selectedPerson?.manager_id ?? "";
  const matchingSaveFailure =
    saveFailure && saveFailure.personId === selectedPerson?.id ? saveFailure : null;
  const saveError = matchingSaveFailure?.message ?? null;

  const eligibleManagers = useMemo(() => {
    if (!selectedPerson) return [];
    const blocked = descendantIds(people, selectedPerson.id);
    return people
      .filter(
        (person) =>
          person.is_active &&
          person.id !== selectedPerson.id &&
          !blocked.has(person.id)
      )
      .sort((first, second) => displayName(first).localeCompare(displayName(second)));
  }, [people, selectedPerson]);

  function registerCard(id: string, element: HTMLButtonElement | null) {
    cardRefs.current[id] = element;
  }

  function selectPerson(id: string | null) {
    setSelectedId(id);
    setManagerDraft(null);
    setSaveFailure(null);
  }

  function expandPathTo(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      const seen = new Set<string>();
      let cursor = visibleById.get(id);
      while (cursor?.manager_id && !seen.has(cursor.manager_id)) {
        seen.add(cursor.manager_id);
        next.delete(cursor.manager_id);
        cursor = visibleById.get(cursor.manager_id);
      }
      return next;
    });
  }

  function centerOn(id: string) {
    expandPathTo(id);
    selectPerson(id);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const viewportElement = viewportRef.current;
        const card = cardRefs.current[id];
        if (!viewportElement || !card) return;
        const viewportBox = viewportElement.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        setViewport((current) => ({
          ...current,
          x:
            current.x +
            viewportBox.left +
            viewportBox.width / 2 -
            (cardBox.left + cardBox.width / 2),
          y:
            current.y +
            viewportBox.top +
            viewportBox.height / 2 -
            (cardBox.top + cardBox.height / 2),
        }));
      });
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-org-interactive='true']")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewport.x,
      y: viewport.y,
    };
    setIsPanning(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = panStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setViewport((current) => ({
      ...current,
      x: start.x + event.clientX - start.clientX,
      y: start.y + event.clientY - start.clientY,
    }));
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (panStart.current?.pointerId !== event.pointerId) return;
    panStart.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.08 : -0.08;
    setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom + delta) }));
  }

  function toggleNode(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function collapseAll() {
    setCollapsedIds(
      new Set(
        flattenForest(visibleForest.roots)
          .filter((node) => node.reports.length > 0)
          .map((node) => node.person.id)
      )
    );
  }

  function exportCsv() {
    const nodeById = fullNodesById;
    const lines = [
      [
        "Name",
        "Email",
        "Role",
        "Agent ID",
        "Status",
        "Reports to",
        "Direct reports",
        "Total reports",
      ].join(","),
      ...[...people]
        .sort((first, second) => displayName(first).localeCompare(displayName(second)))
        .map((person) => {
          const node = nodeById.get(person.id);
          const manager = person.manager_id
            ? peopleById.get(person.manager_id)
            : null;
          return [
            displayName(person),
            person.email,
            roleLabel(person),
            person.agent_id,
            person.is_active ? "Active" : "Inactive",
            manager ? displayName(manager) : "",
            node ? countDirectReports(node) : 0,
            node ? countReports(node) : 0,
          ]
            .map(csvCell)
            .join(",");
        }),
    ];
    const blob = new Blob([`\ufeff${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `organization-chart-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function saveManager() {
    if (!selectedPerson || !selectedPerson.is_active) return;
    const nextManagerId = managerDraftId || null;
    if (nextManagerId === selectedPerson.manager_id) return;

    const verdict = canAssignManager(people, selectedPerson.id, nextManagerId);
    if (!verdict.ok) {
      setSaveFailure({
        personId: selectedPerson.id,
        message: ORG_ASSIGN_MESSAGE[verdict.reason],
      });
      return;
    }

    setSaving(true);
    setSaveFailure(null);
    try {
      const response = await fetch(`/api/admin/users/${selectedPerson.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerId: nextManagerId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to save reporting line.");
      }
      setOptimisticPeople({
        source: initialPeople,
        people: people.map((person) =>
          person.id === selectedPerson.id
            ? { ...person, manager_id: nextManagerId }
            : person
        ),
      });
      setManagerDraft(null);
      router.refresh();
    } catch (caught) {
      setSaveFailure({
        personId: selectedPerson.id,
        message:
          caught instanceof Error
            ? caught.message
            : "Unable to save reporting line.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="px-5 py-6 sm:px-8 sm:py-8">
      <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1769e8]">
            <Network className="h-4 w-4" />
            People
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#172e55]">
            Organization chart
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-500">
            Explore reporting lines, team size, and ownership across the company.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInactive((current) => !current)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              showInactive
                ? "border-blue-200 bg-blue-50 text-[#1769e8]"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
            aria-pressed={showInactive}
          >
            {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {showInactive ? "Showing inactive" : "Show inactive"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-[#eaf2ff] px-2.5 py-1.5 text-xs font-bold text-[#1769e8]">
              {visiblePeople.length} people
            </span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-600">
              {visibleForest.roots.length} top-level team{visibleForest.roots.length === 1 ? "" : "s"}
            </span>
            {canManage ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                Can manage reporting lines
              </span>
            ) : null}
          </div>

          <label className="relative block w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, or agent ID"
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm text-[#172e55] outline-none transition placeholder:text-slate-400 focus:border-[#1769e8] focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
        </div>

        {fullForest.orphanedByCycle.length > 0 ? (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            Reporting data has a cycle involving {fullForest.orphanedByCycle
              .map(displayName)
              .join(", ")}
            . The affected branch is shown at the top so it can be repaired.
          </div>
        ) : null}
        {inactiveManagerCount > 0 ? (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            {inactiveManagerCount} active team member{inactiveManagerCount === 1 ? "" : "s"} report to an inactive account. Select them and reassign a manager.
          </div>
        ) : null}

        <div className="grid min-h-[650px] xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative min-w-0 border-b border-slate-200 xl:border-b-0 xl:border-r">
            <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom + 0.1) }))}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-[#1769e8]"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewport((current) => ({ ...current, zoom: clampZoom(current.zoom - 0.1) }))}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-[#1769e8]"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="mx-0.5 h-5 w-px bg-slate-200" />
              <button
                type="button"
                onClick={() => setViewport(DEFAULT_VIEWPORT)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-[#1769e8]"
                aria-label="Reset chart view"
                title="Reset chart view"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              {currentUserId && visibleById.has(currentUserId) ? (
                <button
                  type="button"
                  onClick={() => centerOn(currentUserId)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-[#1769e8]"
                >
                  My position
                </button>
              ) : null}
            </div>

            <div className="absolute right-4 top-4 z-10 hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur sm:flex">
              <button
                type="button"
                onClick={() => setCollapsedIds(new Set())}
                className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-[#1769e8]"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-[#1769e8]"
              >
                Collapse all
              </button>
            </div>

            <div
              ref={viewportRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onWheel={handleWheel}
              className={`relative h-[650px] overflow-hidden ${
                isPanning ? "cursor-grabbing" : "cursor-grab"
              }`}
              style={{
                touchAction: "none",
                backgroundColor: "#f8fafc",
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.28) 1px, transparent 0)",
                backgroundSize: "18px 18px",
              }}
              aria-label="Organization chart canvas"
            >
              <div
                className="absolute left-0 top-0 origin-top-left px-12 py-10"
                style={{
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                }}
              >
                {displayRoots.length === 0 ? (
                  <div className="w-72 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
                    <Search className="mx-auto h-6 w-6 text-slate-400" />
                    <p className="mt-3 text-sm font-semibold text-slate-600">No people found</p>
                    <p className="mt-1 text-xs text-slate-400">Try another name, email, or agent ID.</p>
                  </div>
                ) : (
                  <ul className="flex min-w-max items-start justify-center gap-8">
                    {displayRoots.map((root) => (
                      <OrgTreeNode
                        key={root.person.id}
                        node={root}
                        depth={0}
                        selectedId={effectiveSelectedId}
                        currentUserId={currentUserId}
                        collapsedIds={collapsedIds}
                        searchActive={Boolean(normalizedQuery)}
                        onSelect={selectPerson}
                        onToggle={toggleNode}
                        registerCard={registerCard}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <p className="pointer-events-none absolute bottom-3 left-4 z-10 hidden items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm sm:flex">
              <Move className="h-3.5 w-3.5" />
              Drag the background to move · Scroll to zoom
            </p>
          </div>

          <aside className="bg-slate-50/70 p-4 sm:p-5">
            {selectedPerson && selectedNode ? (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1769e8] text-sm font-bold text-white">
                      {initials(selectedPerson)}
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-bold text-[#172e55]">
                        {displayName(selectedPerson)}
                      </h2>
                      <p className="truncate text-xs text-slate-500">{selectedPerson.email}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectPerson(null)}
                    className="rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
                    aria-label="Close details"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Direct</p>
                    <p className="mt-1 text-xl font-bold text-[#172e55]">
                      {countDirectReports(selectedNode)}
                    </p>
                    <p className="text-xs text-slate-500">reports</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total team</p>
                    <p className="mt-1 text-xl font-bold text-[#172e55]">
                      {countReports(selectedNode)}
                    </p>
                    <p className="text-xs text-slate-500">all levels</p>
                  </div>
                </div>

                <dl className="mt-5 space-y-3 border-y border-slate-200 py-4 text-sm">
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Role</dt>
                    <dd className="mt-1 font-semibold text-[#172e55]">{roleLabel(selectedPerson)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Reports to</dt>
                    <dd className="mt-1 font-semibold text-[#172e55]">
                      {selectedManager ? displayName(selectedManager) : "No manager — top-level"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Status</dt>
                    <dd className="mt-1 font-semibold text-[#172e55]">
                      {selectedPerson.is_active ? "Active" : "Inactive"}
                    </dd>
                  </div>
                </dl>

                {canManage ? (
                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-bold text-[#172e55]">Reporting line</h3>
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                        Editor
                      </span>
                    </div>
                    {selectedPerson.is_active ? (
                      <>
                        <label className="mt-3 block text-xs font-semibold text-slate-600">
                          Direct manager
                          <select
                            value={managerDraftId}
                            onChange={(event) =>
                              setManagerDraft({
                                personId: selectedPerson.id,
                                managerId: event.target.value,
                              })
                            }
                            disabled={saving}
                            className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-[#172e55] outline-none transition focus:border-[#1769e8] focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="">No manager (top-level)</option>
                            {eligibleManagers.map((person) => (
                              <option key={person.id} value={person.id}>
                                {displayName(person)} · {person.email}
                              </option>
                            ))}
                          </select>
                        </label>
                        {saveError ? (
                          <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                            {saveError}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={saveManager}
                          disabled={saving || managerDraftId === (selectedPerson.manager_id ?? "")}
                          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1769e8] px-3 text-sm font-bold text-white transition hover:bg-[#115bca] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Save reporting line
                        </button>
                      </>
                    ) : (
                      <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-500">
                        Inactive accounts cannot be assigned a manager. Reactivate the account first if its reporting line needs to change.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-500">
                    Reporting lines are maintained by people with the Manage Org Chart permission.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center">
                <Network className="h-7 w-7 text-[#1769e8]" />
                <h2 className="mt-3 text-sm font-bold text-[#172e55]">Explore the organization</h2>
                <p className="mt-1.5 text-xs leading-5 text-slate-500">
                  Select a person to see their manager, direct reports, and total team size.
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
