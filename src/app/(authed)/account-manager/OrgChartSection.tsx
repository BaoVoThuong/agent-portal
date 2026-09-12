"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { AlertTriangle, GripVertical, Loader2, Users } from "lucide-react";
import {
  buildOrgForest,
  canAssignManager,
  countReports,
  descendantIds,
  flattenForest,
  ORG_ASSIGN_MESSAGE,
  type OrgNode,
  type OrgPerson,
} from "@/lib/org-chart/tree";

/**
 * Sơ đồ tổ chức, dựng bằng kéo thả.
 *
 * Cây được SUY RA từ `portal_account.manager_id` chứ không viết cứng ở đâu cả:
 * kéo một người thả vào người khác là đổi đúng một cột trong database, và cây
 * tự vẽ lại. Thả vào ô "Không có quản lý" ở trên cùng để gỡ ai đó lên làm gốc.
 *
 * Hợp lệ hay không do `canAssignManager` quyết — đúng hàm mà API dùng, nên
 * giao diện không thể cho phép một thao tác mà server sẽ từ chối. Database còn
 * một trigger chặn vòng nữa; đó mới là lớp cuối, vì gọi thẳng API thì qua mặt
 * được giao diện.
 */

const ROOT_ZONE = "org-root";

function label(person: OrgPerson): string {
  return person.name?.trim() || person.email;
}

function PersonCard({
  node,
  disabled,
  isInvalidTarget,
  busy,
}: {
  node: OrgNode;
  disabled: boolean;
  isInvalidTarget: boolean;
  busy: boolean;
}) {
  const { person, depth } = node;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: person.id, disabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: person.id,
    disabled: disabled || isInvalidTarget,
  });

  const reportCount = countReports(node);

  return (
    <div style={{ marginLeft: depth * 28 }} className="relative">
      {depth > 0 ? (
        <span
          aria-hidden
          className="absolute -left-4 top-0 h-full border-l border-[#dfe4ec]"
        />
      ) : null}
      <div
        ref={setDropRef}
        className={`mb-1.5 flex items-center gap-2 rounded-md border px-3 py-2 transition ${
          isOver
            ? "border-[#0c66e4] bg-[#e9f2ff] ring-2 ring-[#0c66e4]"
            : isInvalidTarget
              ? "border-dashed border-[#e4e9f2] bg-[#fafbfc] opacity-50"
              : "border-[#d8dee7] bg-white"
        } ${isDragging ? "opacity-40" : ""}`}
      >
        <button
          ref={setDragRef}
          type="button"
          className={`shrink-0 rounded p-1 text-[#98a2b3] ${
            disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover:bg-[#f1f4f9]"
          }`}
          aria-label={`Kéo ${label(person)}`}
          disabled={disabled}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[#16233a]">
              {label(person)}
            </span>
            {!person.is_active ? (
              <span className="shrink-0 rounded bg-[#f1f4f9] px-1.5 py-0.5 text-[11px] font-bold text-[#667085]">
                Ngưng hoạt động
              </span>
            ) : null}
          </div>
          <span className="block truncate text-xs text-[#667085]">{person.email}</span>
        </div>

        {reportCount > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 rounded bg-[#f1f4f9] px-1.5 py-0.5 text-[11px] font-semibold text-[#475467]"
            title={`Quản lý ${reportCount} người (mọi cấp)`}
          >
            <Users className="h-3 w-3" />
            {reportCount}
          </span>
        ) : null}
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" /> : null}
      </div>
    </div>
  );
}

function RootZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_ZONE });
  return (
    <div
      ref={setNodeRef}
      className={`mb-3 rounded-md border-2 border-dashed px-3 py-2.5 text-center text-xs font-semibold transition ${
        isOver
          ? "border-[#0c66e4] bg-[#e9f2ff] text-[#0c66e4]"
          : active
            ? "border-[#b8c2d1] text-[#667085]"
            : "border-[#e4e9f2] text-[#98a2b3]"
      }`}
    >
      Thả vào đây để gỡ quản lý — người đó thành cấp cao nhất
    </div>
  );
}

export function OrgChartSection({
  people,
  canEdit,
  onAssign,
}: {
  people: OrgPerson[];
  canEdit: boolean;
  /** Ghi thật xuống database. Ném lỗi thì cây tự quay về trạng thái cũ. */
  onAssign: (personId: string, managerId: string | null) => Promise<void>;
}) {
  // Bản nháp cục bộ để cây nhảy ngay khi thả, không đợi server. Hỏng thì
  // `catch` trả nó về `people`.
  const [draft, setDraft] = useState<OrgPerson[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = draft ?? people;
  const { roots, orphanedByCycle } = useMemo(
    () => buildOrgForest(current),
    [current],
  );
  const rows = useMemo(() => flattenForest(roots), [roots]);

  // Trong lúc kéo, mọi ô mà thả vào sẽ tạo vòng đều bị làm mờ và vô hiệu hoá.
  // Người dùng thấy được luật thay vì thả xong mới ăn thông báo lỗi.
  const blockedTargets = useMemo(() => {
    if (!draggingId) return new Set<string>();
    return new Set([draggingId, ...descendantIds(current, draggingId)]);
  }, [current, draggingId]);

  const sensors = useSensors(
    // 6px trước khi tính là kéo: không có ngưỡng này thì mỗi cú bấm vào nút
    // cũng thành một thao tác kéo lỡ tay.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const personId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;

    const nextManagerId = overId === ROOT_ZONE ? null : overId;
    const person = current.find((candidate) => candidate.id === personId);
    if (!person || person.manager_id === nextManagerId) return;

    const verdict = canAssignManager(current, personId, nextManagerId);
    if (!verdict.ok) {
      setError(ORG_ASSIGN_MESSAGE[verdict.reason]);
      return;
    }

    setError(null);
    setBusyId(personId);
    setDraft(
      current.map((candidate) =>
        candidate.id === personId
          ? { ...candidate, manager_id: nextManagerId }
          : candidate,
      ),
    );
    try {
      await onAssign(personId, nextManagerId);
    } catch (caught) {
      setDraft(null);
      setError(
        caught instanceof Error ? caught.message : "Không lưu được thay đổi.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-sm text-[#667085]">
        Kéo một người thả vào người khác để đặt quản lý trực tiếp. Sơ đồ được
        dựng từ dữ liệu tài khoản, không viết cứng ở đâu cả.
      </p>

      {error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {orphanedByCycle.length > 0 ? (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {orphanedByCycle.length} tài khoản đang nằm trong một vòng lặp quản
            lý nên không vẽ được:{" "}
            {orphanedByCycle.map((person) => label(person)).join(", ")}. Gỡ quản
            lý của một trong số họ để mở vòng.
          </span>
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(event) => setDraggingId(String(event.active.id))}
        onDragCancel={() => setDraggingId(null)}
        onDragEnd={handleDragEnd}
      >
        <RootZone active={Boolean(draggingId)} />
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#e4e9f2] px-3 py-6 text-center text-sm text-[#98a2b3]">
            Chưa có tài khoản nào.
          </p>
        ) : (
          rows.map((node) => (
            <PersonCard
              key={node.person.id}
              node={node}
              disabled={!canEdit}
              isInvalidTarget={blockedTargets.has(node.person.id)}
              busy={busyId === node.person.id}
            />
          ))
        )}
      </DndContext>
    </div>
  );
}
