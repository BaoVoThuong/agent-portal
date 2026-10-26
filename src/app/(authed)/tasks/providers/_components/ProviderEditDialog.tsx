"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import type { ProviderRow } from "@/lib/providers/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";
import {
  isReadOnlyProviderColumn,
  providerFormPayload,
  providerFormValues,
  PROVIDER_STAMP_TIME_ZONE,
  todayForColumn,
  verifiedStampValues,
} from "@/lib/providers/form";
import { providerMergeChanges } from "@/lib/providers/backlog";
import { buildProviderPatch } from "@/lib/providers/patch";
import { formatProviderActivityValue, providerActivityFieldLabel } from "@/lib/providers/activity";
import { ProviderFormBody } from "./ProviderFormFields";
import { ProviderCollabPanel } from "./ProviderCollabPanel";

// Cùng nút với dialog New enrollment (EnrollmentClient): cao 36px, chữ 14px —
// user 26/10: các dialog trong app phải cùng một kiểu.
const GHOST_BUTTON_CLASS =
  "inline-flex h-9 items-center rounded px-4 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY_BUTTON_CLASS =
  "inline-flex h-9 items-center rounded border-2 border-[#dfe1e6] bg-white px-4 text-sm font-semibold text-[#42526e] transition hover:border-[#c1c7d0] hover:bg-[#f7f8fa] disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY_BUTTON_CLASS =
  "inline-flex h-9 items-center rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40";
const DANGER_BUTTON_CLASS =
  "inline-flex h-9 items-center rounded bg-[#c9372c] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#ae2e24] disabled:cursor-not-allowed disabled:opacity-40";
const ICON_BUTTON_CLASS =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d] disabled:cursor-not-allowed disabled:opacity-40";
const BADGE_CLASS = "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold";

export type ProviderReviewAction = "approve" | "merge" | "reject";
type BusyAction = "save" | "delete" | ProviderReviewAction;

/**
 * Dialog sửa provider, bố cục A1 (user chốt 26/10/2026): form gọn bên trái,
 * Comments | Activity bên phải — cùng khung 6:4 với drawer Task/Enrollment.
 * "Archive" nằm thẳng ở góc trái footer, như "Archive task" bên Task.
 *
 * Dòng Backlog (`pending`) dùng chung dialog này: người duyệt có Verify — hoặc
 * Update existing / Add as new khi dòng bị tag Duplicate — và Reject; người gửi
 * sửa hoặc rút lại được; người khác chỉ xem.
 */
export function ProviderEditDialog({
  provider,
  columns,
  columnOptions,
  viewerName,
  currentEmail,
  people,
  canReview = false,
  duplicateOf = null,
  onClose,
  onSave,
  onArchive,
  onReview,
  onOpenProvider,
}: {
  provider: ProviderRow | null;
  columns: readonly TableColumn[];
  columnOptions: readonly TableColumnOption[];
  /** Tên người đang đăng nhập — điền vào Verified by khi bật ô Reviewed. */
  viewerName: string;
  /** Email người đang đăng nhập (chữ thường) — CommentThread nhận ra comment của chính mình. */
  currentEmail: string;
  /** Người xem được Provider List — tên + avatar cho Opened by / Verified by. */
  people: readonly TaskAssignee[];
  /** Duyệt Backlog — tầng Provider List - Manage. */
  canReview?: boolean;
  /** Dòng đang trong danh sách mà dòng Backlog này trùng với (nếu còn). */
  duplicateOf?: ProviderRow | null;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<ProviderRow>;
  /** Xoá address (Manage), hoặc rút lại dòng Backlog (người gửi). Không truyền thì không có. */
  onArchive?: () => Promise<void>;
  onReview?: (action: ProviderReviewAction, reason?: string) => Promise<void>;
  /** Mở dòng khác trong dialog này — dòng cũ mà dòng Backlog trùng với. */
  onOpenProvider?: (provider: ProviderRow) => void;
}) {
  const open = provider !== null;
  // Giữ bản lúc mở form: bỏ tick Reviewed thì Verified by/date trở về đúng giá
  // trị đang lưu (hai ô không gõ lại được).
  const [initialValues] = useState<Record<string, unknown>>(() =>
    provider ? providerFormValues(provider, columns) : {}
  );
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [confirming, setConfirming] = useState<"delete" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  if (!provider) return null;
  const currentProvider = provider;
  const saving = busy !== null;
  const title = provider.doctors || provider.facility || "Provider";
  const subtitle = provider.doctors ? provider.facility : null;
  const pending = provider.pending === true;
  const isSubmitter = provider.created_by_email?.trim().toLowerCase() === currentEmail;
  // Dòng Backlog là đề xuất của một người: người khác chỉ xem, trừ người duyệt.
  const readOnly = pending && !canReview && !isSubmitter;
  // Ô Reviewed trên form (đã đảo nghĩa từ needs_review) — đổi theo ô tick ngay.
  const reviewed = !pending && values.needs_review === true;
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const duplicate = pending && Boolean(provider.duplicate_of);
  const editableColumns = columns.filter(
    (column) => !column.archived_at && !isReadOnlyProviderColumn(column)
  );
  const payload = () =>
    providerFormPayload(values, editableColumns, currentProvider.custom_values ?? {});
  // Tính preview từ những gì người dùng đang thấy, kể cả các ô vừa sửa nhưng
  // chưa bấm Save. Server dùng cùng bộ chuẩn hoá trước khi gộp.
  const previewPatch = duplicate && duplicateOf ? buildProviderPatch(payload()) : null;
  const copiedChanges =
    duplicate && duplicateOf && previewPatch?.ok
      ? providerMergeChanges(
          {
            ...provider,
            ...previewPatch.patch,
            custom_values: {
              ...(provider.custom_values ?? {}),
              ...(previewPatch.customValues ?? {}),
            },
          },
          duplicateOf
        )
      : [];
  const stampPreview = {
    verified_by: viewerName,
    date: todayForColumn(
      columns.find((column) => column.key === "date"),
      new Date(),
      PROVIDER_STAMP_TIME_ZONE
    ),
  };
  const mergeChanges = duplicateOf
    ? [
        ...copiedChanges,
        ...(["verified_by", "date"] as const).flatMap((key) =>
          duplicateOf[key] === stampPreview[key]
            ? []
            : [{ key, from: duplicateOf[key], to: stampPreview[key] }]
        ),
      ]
    : [];

  async function run(action: BusyAction, work: () => Promise<void>) {
    if (saving) return;
    setBusy(action);
    setError(null);
    try {
      await work();
      onClose();
    } catch (actionError) {
      setConfirming(null);
      setError(actionError instanceof Error ? actionError.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const save = () => run("save", async () => { await onSave(payload()); });
  const archive = () =>
    run("delete", async () => {
      if (onArchive) await onArchive();
    });
  // Sửa rồi bấm duyệt: lưu phần sửa trước, để thứ được duyệt đúng là thứ đang
  // nằm trên màn hình.
  const review = (action: ProviderReviewAction) =>
    run(action, async () => {
      if (!onReview) return;
      if (action !== "reject" && dirty) {
        const saved = await onSave(payload());
        if (action === "merge" && saved.duplicate_of !== provider.duplicate_of) {
          throw new Error("The matching address changed. Review the updated Duplicate tag before merging.");
        }
      }
      await onReview(action, action === "reject" ? rejectReason : undefined);
    });

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit provider ${provider.doctors || provider.facility || provider.id}`}
        className="flex h-[min(760px,calc(100dvh-3rem))] w-full max-w-[1120px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        {/* Header như New enrollment: tiêu đề 20px, dòng phụ bên dưới. */}
        <header className="flex shrink-0 items-start gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-[#172b4d]">{title}</h2>
            {subtitle || pending || duplicate || reviewed ? (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-[#626f86]">
                {subtitle ? <span className="min-w-0 truncate">{subtitle}</span> : null}
                {pending ? (
                  <span className={`${BADGE_CLASS} bg-[#fff7d6] text-[#7f5f01]`}>Backlog</span>
                ) : null}
                {duplicate ? (
                  <span className={`${BADGE_CLASS} bg-[#ffece0] text-[#a54800]`}>Duplicate</span>
                ) : null}
                {reviewed ? (
                  <span className={`${BADGE_CLASS} bg-[#dcfff1] text-[#216e4e]`}>
                    <Check className="h-3 w-3" strokeWidth={3} />
                    Verified
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className={ICON_BUTTON_CLASS}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Hai cột như drawer Enrollment: form bên trái, Comments | Activity bên
            phải, mỗi cột tự cuộn. Màn hẹp thì xếp chồng và cuộn chung. */}
        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          <div className="bg-white px-6 py-5 lg:min-h-0 lg:overflow-y-auto">
            {duplicate ? (
              <div className="mb-4 rounded-lg border border-[#f8e6a0] bg-[#fffbeb] px-3 py-2 text-sm text-[#533f04]">
                <p className="flex flex-wrap items-center gap-x-1.5">
                  <span className="font-semibold">Already in the list:</span>
                  {duplicateOf ? (
                    <button
                      type="button"
                      onClick={() => onOpenProvider?.(duplicateOf)}
                      disabled={saving || !onOpenProvider}
                      className="font-semibold text-[#0c66e4] hover:underline disabled:no-underline"
                    >
                      {duplicateOf.doctors || duplicateOf.facility || "Provider"}
                      {duplicateOf.street ? ` · ${duplicateOf.street}` : ""}
                    </button>
                  ) : (
                    <span>the matching address was deleted.</span>
                  )}
                </p>
                {duplicateOf ? (
                  mergeChanges.length === 0 ? (
                    <p className="mt-0.5 text-xs">Nothing new — every filled field already matches.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {mergeChanges.map((change) => {
                        const column = columns.find((item) => item.key === change.key);
                        return (
                          <li key={change.key} className="break-words">
                            <span className="font-semibold">
                              {providerActivityFieldLabel(change.key, columns)}:
                            </span>{" "}
                            <span className="text-[#8590a2] line-through">
                              {formatProviderActivityValue(change.from, column, columnOptions)}
                            </span>{" "}
                            →{" "}
                            <span className="text-[#172b4d]">
                              {formatProviderActivityValue(change.to, column, columnOptions)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}
              </div>
            ) : null}
            <ProviderFormBody
              columns={columns}
              columnOptions={columnOptions}
              values={values}
              viewerName={viewerName}
              people={people}
              showSystemInfo
              fromSheet={!provider.created_by_email && provider.source_row_number !== null}
              hideReview={pending}
              disabled={readOnly}
              unreviewedValues={verifiedStampValues(initialValues)}
              onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
            />
            {error ? (
              <p className="mt-4 rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-semibold text-[#bf2600]">
                {error}
              </p>
            ) : null}
          </div>
          <ProviderCollabPanel
            providerId={provider.id}
            currentEmail={currentEmail}
            columns={columns}
            columnOptions={columnOptions}
          />
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4">
          {confirming === "delete" ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2" role="alert">
              <span className="text-sm font-semibold text-[#bf2600]">
                {pending
                  ? "Withdraw this row from the Backlog?"
                  : "Archive this address? It disappears from the list."}
              </span>
              <button
                type="button"
                onClick={() => void archive()}
                disabled={saving}
                className={DANGER_BUTTON_CLASS}
              >
                {busy === "delete"
                  ? pending ? "Withdrawing…" : "Archiving…"
                  : pending ? "Yes, withdraw" : "Yes, archive"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={saving}
                className={GHOST_BUTTON_CLASS}
              >
                Keep
              </button>
            </div>
          ) : null}
          {confirming === "reject" ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2" role="alert">
              <span className="text-sm font-semibold text-[#bf2600]">Reject this row?</span>
              <input
                autoFocus
                autoComplete="off"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                maxLength={500}
                placeholder="Reason (optional)"
                aria-label="Reason for rejecting"
                className="h-9 w-full min-w-0 max-w-[280px] rounded border-2 border-[#dfe1e6] px-2 text-sm text-[#172b4d] outline-none placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]"
              />
              <button
                type="button"
                onClick={() => void review("reject")}
                disabled={saving}
                className={DANGER_BUTTON_CLASS}
              >
                {busy === "reject" ? "Rejecting…" : "Yes, reject"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={saving}
                className={GHOST_BUTTON_CLASS}
              >
                Keep
              </button>
            </div>
          ) : null}
          {!confirming && pending && canReview && onReview ? (
            <button
              type="button"
              onClick={() => setConfirming("reject")}
              disabled={saving}
              className={`${GHOST_BUTTON_CLASS} !text-[#c9372c] hover:!bg-[#ffeceb]`}
            >
              Reject
            </button>
          ) : null}
          {/* Hiện thẳng ở footer như "Archive task" bên Task — giấu trong menu ⋯ thì
              người có quyền tưởng mình không archive được (user 26/10). */}
          {!confirming && onArchive ? (
            <button
              type="button"
              onClick={() => setConfirming("delete")}
              disabled={saving}
              className={`${GHOST_BUTTON_CLASS} !text-[#c9372c] hover:!bg-[#ffeceb]`}
            >
              {pending ? "Withdraw" : "Archive"}
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {readOnly ? (
              <button type="button" onClick={onClose} className={GHOST_BUTTON_CLASS}>
                Close
              </button>
            ) : (
              <>
                <button type="button" onClick={onClose} disabled={saving} className={GHOST_BUTTON_CLASS}>
                  Cancel
                </button>
                {pending && canReview && onReview ? (
                  <>
                    {dirty ? (
                      <button
                        type="button"
                        onClick={() => void save()}
                        disabled={saving}
                        className={GHOST_BUTTON_CLASS}
                      >
                        {busy === "save" ? "Saving…" : "Save changes"}
                      </button>
                    ) : null}
                    {duplicate && duplicateOf ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void review("approve")}
                          disabled={saving}
                          className={SECONDARY_BUTTON_CLASS}
                        >
                          {busy === "approve" ? "Adding…" : "Add as new"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void review("merge")}
                          disabled={saving}
                          className={PRIMARY_BUTTON_CLASS}
                        >
                          {busy === "merge" ? "Updating…" : "Update existing"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void review("approve")}
                        disabled={saving}
                        className={PRIMARY_BUTTON_CLASS}
                      >
                        {busy === "approve" ? "Verifying…" : "Verify"}
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
