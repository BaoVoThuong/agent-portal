"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  LeadComment,
  LeadInteraction,
  LeadInteractionType,
  LeadStatus,
} from "@/lib/leads/types";
import { personLabel } from "@/lib/tasks/people";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";
import { TaskSelect } from "../../_components/TaskSelect";
import { Initials } from "../../_components/board-ui";
import { useBodyScrollLock } from "../../../_shared/useBodyScrollLock";

// Keep the compact form controls visually aligned with the editable Lead
// fields, while reusing the same custom picker behaviour as Task List.
const INTERACTION_SELECT_BUTTON_CLASS =
  "!h-10 !rounded !border-2 !border-[#dfe1e6] !bg-white !px-3 !text-sm !font-medium !shadow-none hover:!border-[#cfd8e5] hover:!shadow-none focus-visible:!border-[#0c66e4] focus-visible:!shadow-none";

type InteractionLogProps = {
  /** The shared activity-feed header. Interaction is one feed item, not a separate tab. */
  toolbar: ReactNode;
  /** Loading/error feedback that belongs directly below the toolbar. */
  notice?: ReactNode;
  statuses: LeadStatus[];
  interactionTypes: LeadInteractionType[];
  /**
   * Danh sách HIỆN TẠI, không phải giá trị khởi tạo. Trước đây tên là
   * `initialInteractions` và component giữ một bản sao qua `useState`, nên dữ
   * liệu về sau lúc mount không bao giờ vào được danh sách — badge đếm một
   * nguồn, danh sách đọc nguồn khác. Cái tên là thứ đã mời gọi lỗi đó.
   */
  interactions: LeadInteraction[];
  comments: LeadComment[];
  /** Đang tải lịch sử — để KHÔNG hiện "chưa có tương tác nào" khi chưa biết. */
  loading?: boolean;
  canLog: boolean;
  canComment: boolean;
  /** Who owns the lead, so a locked composer can say why rather than just look broken. */
  ownerLabel: string | null;
  sourceId: string;
  onSave: (payload: {
    type_id: string;
    status_id: string;
    note: string;
    follow_up_at: string | null;
    client_request_id: string;
  }) => Promise<{ interaction: LeadInteraction }>;
  /** Keeps the parent tab counter in sync after this composer saves. */
  onInteractionSaved?: (interaction: LeadInteraction) => void;
  onSaveComment: (payload: {
    body: string;
    client_request_id: string;
  }) => Promise<{ comment: LeadComment }>;
  onCommentSaved?: (comment: LeadComment) => void;
};

type FeedItem =
  | { kind: "comment"; timestamp: string; comment: LeadComment }
  | { kind: "interaction"; timestamp: string; interaction: LeadInteraction };

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return "just now";
  const unit = absolute < 3600 ? "minute" : absolute < 86400 ? "hour" : "day";
  const divisor = unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400;
  const amount = Math.round(seconds / divisor);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    amount,
    unit,
  );
}

function formatDateTimeInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * One rectangle per vocabulary value, coloured by whatever the admin picked in
 * Lead Table Configuration. Falls back to the shared palette keyed on the id,
 * so a freshly added type still reads distinctly instead of blending in.
 */
function badgeStyle(
  id: string,
  label: string,
  color: string | null | undefined,
) {
  const palette = taskCategoryBadgePalette({
    id,
    name: label,
    color: color ?? null,
  });
  return { backgroundColor: palette.background, color: palette.foreground };
}

export function InteractionLog({
  toolbar,
  notice,
  statuses,
  interactionTypes,
  interactions,
  comments,
  loading = false,
  canLog,
  canComment,
  ownerLabel,
  onSave,
  onInteractionSaved,
  onSaveComment,
  onCommentSaved,
}: InteractionLogProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const feedItems = useMemo<FeedItem[]>(
    () =>
      [
        ...comments
          .filter((comment) => !comment.deleted_at)
          .map((comment) => ({
            kind: "comment" as const,
            timestamp: comment.created_at,
            comment,
          })),
        ...interactions.map((interaction) => ({
          kind: "interaction" as const,
          timestamp: interaction.occurred_at,
          interaction,
        })),
      ].sort(
        (left, right) =>
          Date.parse(left.timestamp) - Date.parse(right.timestamp),
      ),
    [comments, interactions],
  );

  const status = useMemo(
    () => statuses.find((candidate) => candidate.id === statusId) ?? null,
    [statusId, statuses],
  );
  const needsFollowUp = status?.kind === "scheduled";
  const canSubmit = Boolean(
    typeId && statusId && (!needsFollowUp || followUpAt) && canLog,
  );

  function resetComposer() {
    setTypeId("");
    setStatusId("");
    setFollowUpAt("");
    setNote("");
    setError(null);
    requestIdRef.current = null;
  }

  function openComposer() {
    resetComposer();
    setComposerOpen(true);
  }

  function closeComposer() {
    if (saving) return;
    resetComposer();
    setComposerOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave({
        type_id: typeId,
        status_id: statusId,
        note,
        follow_up_at: followUpAt ? new Date(followUpAt).toISOString() : null,
        client_request_id: requestId,
      });
      // Không tự giữ danh sách nữa: cha thêm dòng rồi truyền xuống. Một nguồn
      // sự thật thì badge và danh sách không thể lệch nhau.
      onInteractionSaved?.(result.interaction);
      resetComposer();
      setComposerOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save interaction.",
      );
      // Keep requestIdRef intact: retrying this failed network request is idempotent.
    } finally {
      setSaving(false);
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body || !canComment || commentSaving) return;
    setCommentSaving(true);
    setCommentError(null);
    try {
      const result = await onSaveComment({
        body,
        client_request_id: crypto.randomUUID(),
      });
      onCommentSaved?.(result.comment);
      setCommentBody("");
    } catch (saveError) {
      setCommentError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save comment.",
      );
    } finally {
      setCommentSaving(false);
    }
  }


  useBodyScrollLock(composerOpen);
  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#dfe1e6] pb-3">
        {toolbar}
      </div>
      {notice}
      {composerOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[#091e42]/35 p-4"
          onClick={closeComposer}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="log-interaction-title"
            className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 border-b border-[#dfe1e6] px-5 py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#e9f2ff] text-[#0c66e4]">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h2
                    id="log-interaction-title"
                    className="text-base font-semibold text-[#172b4d]"
                  >
                    Log interaction
                  </h2>
                  <p className="mt-0.5 text-xs text-[#6b778c]">
                    Record the latest contact and outcome.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeComposer}
                disabled={saving}
                aria-label="Close interaction composer"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>
            <form
          className="space-y-4 p-5"
          onSubmit={submit}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="block">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                Type
              </span>
              <TaskSelect
                label="interaction type"
                value={typeId}
                options={interactionTypes.map((type) => ({
                  value: type.id,
                  label: type.label,
                }))}
                placeholder="Choose interaction"
                disabled={!canLog || saving}
                searchable
                className="mt-1 w-full"
                buttonClassName={INTERACTION_SELECT_BUTTON_CLASS}
                menuClassName="max-h-[17rem]"
                onChange={setTypeId}
              />
            </div>
            <div className="block">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                Result
              </span>
              <TaskSelect
                label="interaction result"
                value={statusId}
                options={statuses.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.label,
                }))}
                placeholder="Choose result"
                disabled={!canLog || saving}
                searchable
                className="mt-1 w-full"
                buttonClassName={INTERACTION_SELECT_BUTTON_CLASS}
                menuClassName="max-h-[17rem]"
                onChange={(value) => {
                  setStatusId(value);
                  setFollowUpAt("");
                }}
              />
            </div>
          </div>
          {needsFollowUp && (
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                Call back at
              </span>
              <input
                className="mt-1 h-10 w-full rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4]"
                type="datetime-local"
                min={formatDateTimeInput(new Date())}
                value={followUpAt}
                onChange={(event) => setFollowUpAt(event.target.value)}
                disabled={!canLog || saving}
                required
              />
            </label>
          )}
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b778c]">
              Notes
            </span>
            <textarea
              className="mt-1 min-h-20 w-full resize-y rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none focus:border-[#0c66e4]"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!canLog || saving}
              placeholder="What happened?"
              maxLength={4000}
            />
          </label>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-[#ebecf0] pt-4">
            <button
              type="button"
              onClick={closeComposer}
              disabled={saving}
              className="inline-flex h-9 items-center rounded px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-9 items-center rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={!canSubmit || saving}
            >
              {saving ? "Saving..." : "Log interaction"}
            </button>
          </div>
            </form>
          </div>
        </div>
      ) : !canLog ? (
        // A disabled pair of dropdowns reads as a broken screen. Say who holds
        // the lead and what to do about it instead.
        <div className="rounded border border-[#dbe2eb] bg-[#f7f9fc] px-4 py-5 text-sm text-[#42526e]">
          <p className="font-semibold text-[#172b4d]">
            Only the agent holding this lead can add activity.
          </p>
          <p className="mt-1">
            {ownerLabel
              ? `It is currently assigned to ${ownerLabel}. A manager can reassign it from the Leads list.`
              : "Nobody holds it yet. Assign it from the Leads list first."}
          </p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {loading && feedItems.length === 0 ? (
          // Chưa tải xong thì CHƯA biết lead có tương tác hay không. Hiện
          // "No interactions yet." lúc này là nói một điều chưa chắc đúng, rồi
          // một nhịp sau lại thay bằng danh sách — người đọc tưởng mình nhìn nhầm.
          <p
            className="rounded border border-dashed border-[#c1c7d0] bg-[#fafbfc] px-4 py-5 text-sm font-medium text-[#6b778c]"
            role="status"
          >
            Loading activity…
          </p>
        ) : feedItems.length === 0 ? null : (
          feedItems.map((item) => {
            if (item.kind === "comment") {
              const comment = item.comment;
              return (
                <article key={`comment:${comment.id}`} className="group flex gap-2.5">
                  <div className="shrink-0 pt-0.5">
                    <Initials
                      email={comment.author_email}
                      label={personLabel(comment.author_email)}
                      size="md"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-[#172b4d]">
                        {personLabel(comment.author_email)}
                      </span>
                      <time
                        dateTime={comment.created_at}
                        title={new Date(comment.created_at).toLocaleString()}
                        className="text-xs font-medium text-[#6b778c]"
                      >
                        {relativeTime(comment.created_at)}
                      </time>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-[#172b4d] [overflow-wrap:anywhere]">
                      {comment.body}
                    </p>
                  </div>
                </article>
              );
            }

            const interaction = item.interaction;
            const interactionType = interactionTypes.find(
              (candidate) => candidate.id === interaction.type_id,
            );
            const interactionStatus = statuses.find(
              (candidate) => candidate.id === interaction.status_id,
            );
            return (
              <article
                key={`interaction:${interaction.id}`}
                className="group flex gap-2.5"
              >
                <div className="shrink-0 pt-0.5">
                  <Initials
                    email={interaction.actor_email}
                    label={personLabel(interaction.actor_email)}
                    size="md"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-[#172b4d]">
                      {personLabel(interaction.actor_email)}
                    </span>
                    <time
                      dateTime={interaction.occurred_at}
                      title={new Date(interaction.occurred_at).toLocaleString()}
                      className="text-xs font-medium text-[#6b778c]"
                    >
                      {relativeTime(interaction.occurred_at)}
                    </time>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span
                      className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em]"
                      style={badgeStyle(
                        interactionType?.id ?? interaction.type_id,
                        interactionType?.label ?? "Interaction",
                        interactionType?.color,
                      )}
                    >
                      {interactionType?.label ?? "Interaction"}
                    </span>
                    {interactionStatus ? (
                      <span
                        className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold"
                        style={badgeStyle(
                          interactionStatus.id,
                          interactionStatus.label,
                          interactionStatus.color,
                        )}
                      >
                        {interactionStatus.label}
                      </span>
                    ) : null}
                  </div>

                  {interaction.note ? (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-[#172b4d] [overflow-wrap:anywhere]">
                      {interaction.note}
                    </p>
                  ) : null}
                  {interaction.follow_up_at ? (
                    <p className="mt-1 text-xs font-semibold text-[#0c66e4]">
                      Follow-up: {new Date(interaction.follow_up_at).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
      {canComment ? (
        <form
          className="shrink-0 border-t border-[#dfe1e6] bg-white pt-3"
          onSubmit={submitComment}
        >
          <textarea
            value={commentBody}
            onChange={(event) => {
              setCommentBody(event.target.value);
              if (commentError) setCommentError(null);
            }}
            disabled={commentSaving}
            maxLength={4000}
            placeholder="Add a comment…"
            className="min-h-20 w-full resize-y rounded border border-[#cfd8e5] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none placeholder:text-[#8993a4] focus:border-[#0c66e4] disabled:bg-[#f4f5f7]"
          />
          {commentError ? (
            <p className="mt-2 rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]">
              {commentError}
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-[#8993a4]">
              {commentBody.length > 0 ? `${commentBody.length}/4000` : " "}
            </span>
            <div className="flex items-center gap-2">
              {canLog ? (
                <button
                  type="button"
                  onClick={openComposer}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#cfd8e5] bg-white px-2.5 text-xs font-bold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add interaction
                </button>
              ) : null}
              <button
                type="submit"
                disabled={!commentBody.trim() || commentSaving}
                className="inline-flex h-8 items-center rounded bg-[#0c66e4] px-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {commentSaving ? "Sending…" : "Send comment"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
