"use client";

import { Plus, Send, X } from "lucide-react";
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
  /** Avatar cạnh ô viết comment, như Task/Enrollment. */
  currentUserEmail?: string;
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
    /** Trả lời một comment gốc. Chỉ một cấp — RPC từ chối trả lời một reply. */
    parent_id: string | null;
    client_request_id: string;
  }) => Promise<{ comment: LeadComment }>;
  onCommentSaved?: (comment: LeadComment) => void;
};

type FeedItem =
  | { kind: "comment"; timestamp: string; comment: LeadComment }
  | { kind: "interaction"; timestamp: string; interaction: LeadInteraction };

/** Tương tác đã bấm Save, đang chờ server (plan instant feedback T2.5). */
type PendingInteraction = {
  tempId: string;
  requestId: string;
  typeId: string;
  statusId: string;
  note: string;
  followUpAt: string;
};

type PendingComment = {
  tempId: string;
  requestId: string;
  body: string;
  parentId: string | null;
};

/** Ô trả lời đang mở dưới một comment gốc; mỗi lúc chỉ một ô. */
type ReplyDraft = { parentId: string; body: string; error: string | null };

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

function LeadCommentItem({
  comment,
  onReply,
}: {
  comment: LeadComment;
  onReply?: () => void;
}) {
  return (
    <article className="group flex gap-2.5">
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
        {onReply ? (
          <button
            type="button"
            onClick={onReply}
            className="mt-0.5 rounded px-1 py-0.5 text-xs font-semibold text-[#44546f] transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
          >
            Reply
          </button>
        ) : null}
      </div>
    </article>
  );
}

function PendingCommentItem({ pending }: { pending: PendingComment }) {
  return (
    <article className="flex gap-2.5 opacity-60" aria-busy="true">
      <div className="min-w-0 flex-1 rounded border border-dashed border-[#c1c7d0] px-3 py-2">
        <p className="text-xs font-semibold italic text-[#6b778c]">Sending…</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-[#172b4d] [overflow-wrap:anywhere]">
          {pending.body}
        </p>
      </div>
    </article>
  );
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
  currentUserEmail,
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
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  // Hộp ghi tương tác đóng ngay khi bấm Save; dòng tạm "Saving…" hiện trong feed
  // cho tới khi server trả lời. Status, follow-up, số lần liên hệ của lead do
  // server tính nên chỉ đổi khi có kết quả thật.
  const [pendingInteractions, setPendingInteractions] = useState<PendingInteraction[]>([]);
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [reply, setReply] = useState<ReplyDraft | null>(null);
  const composerOpenRef = useRef(false);
  /** Comment vừa hỏng: gửi lại đúng chữ đó thì dùng lại request id, không tạo trùng. */
  const failedCommentRef = useRef<{
    body: string;
    parentId: string | null;
    requestId: string;
  } | null>(null);

  // Reply nằm dưới comment gốc của nó, không chen vào dòng thời gian chung.
  // Reply mà comment gốc đã bị xoá thì hiện như một comment thường, để nó không
  // biến mất khỏi màn hình.
  const { topLevelComments, repliesByParent } = useMemo(() => {
    const visible = comments.filter((comment) => !comment.deleted_at);
    const visibleIds = new Set(visible.map((comment) => comment.id));
    const replies = new Map<string, LeadComment[]>();
    const topLevel: LeadComment[] = [];
    for (const comment of visible) {
      if (comment.parent_id && visibleIds.has(comment.parent_id)) {
        replies.set(comment.parent_id, [...(replies.get(comment.parent_id) ?? []), comment]);
      } else {
        topLevel.push(comment);
      }
    }
    for (const list of replies.values()) {
      list.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
    }
    return { topLevelComments: topLevel, repliesByParent: replies };
  }, [comments]);

  const feedItems = useMemo<FeedItem[]>(
    () =>
      [
        ...topLevelComments
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
    [topLevelComments, interactions],
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
    composerOpenRef.current = true;
    setComposerOpen(true);
  }

  function closeComposer() {
    resetComposer();
    composerOpenRef.current = false;
    setComposerOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    const draft: PendingInteraction = {
      tempId: `temp-${requestId}`,
      requestId,
      typeId,
      statusId,
      note,
      followUpAt,
    };
    setPendingInteractions((current) => [
      ...current.filter((item) => item.requestId !== requestId),
      draft,
    ]);
    closeComposer();
    try {
      const result = await onSave({
        type_id: draft.typeId,
        status_id: draft.statusId,
        note: draft.note,
        follow_up_at: draft.followUpAt ? new Date(draft.followUpAt).toISOString() : null,
        client_request_id: requestId,
      });
      // Không tự giữ danh sách nữa: cha thêm dòng rồi truyền xuống. Một nguồn
      // sự thật thì badge và danh sách không thể lệch nhau.
      onInteractionSaved?.(result.interaction);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Could not save interaction.";
      if (composerOpenRef.current) {
        // Người dùng đang soạn một tương tác khác: không ghi đè chữ họ đang gõ.
        setError(`The previous interaction was not saved: ${message}`);
      } else {
        // Mở lại hộp với đúng nội dung vừa nhập. Giữ request id: thử lại không
        // tạo trùng.
        setTypeId(draft.typeId);
        setStatusId(draft.statusId);
        setFollowUpAt(draft.followUpAt);
        setNote(draft.note);
        requestIdRef.current = requestId;
        setError(message);
        composerOpenRef.current = true;
        setComposerOpen(true);
      }
    } finally {
      setPendingInteractions((current) =>
        current.filter((item) => item.tempId !== draft.tempId),
      );
    }
  }

  /** Gửi một comment hoặc reply; dòng tạm "Sending…" hiện ngay tới khi server trả lời. */
  async function sendComment(body: string, parentId: string | null) {
    const failed = failedCommentRef.current;
    const requestId =
      failed && failed.body === body && failed.parentId === parentId
        ? failed.requestId
        : crypto.randomUUID();
    failedCommentRef.current = null;
    const pending: PendingComment = { tempId: `temp-${requestId}`, requestId, body, parentId };
    setPendingComments((current) => [...current, pending]);
    try {
      const result = await onSaveComment({
        body,
        parent_id: parentId,
        client_request_id: requestId,
      });
      onCommentSaved?.(result.comment);
    } catch (saveError) {
      failedCommentRef.current = { body, parentId, requestId };
      throw saveError;
    } finally {
      setPendingComments((current) => current.filter((item) => item.tempId !== pending.tempId));
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentBody.trim();
    if (!body || !canComment) return;
    // Comment hiện ngay, ô nhập xoá ngay.
    setCommentBody("");
    setCommentError(null);
    try {
      await sendComment(body, null);
    } catch (saveError) {
      // Trả chữ về ô nhập, trừ khi người dùng đã gõ cái mới.
      setCommentBody((current) => (current.trim() ? current : body));
      setCommentError(
        saveError instanceof Error ? saveError.message : "Could not save comment.",
      );
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>, parentId: string) {
    event.preventDefault();
    const body = reply?.parentId === parentId ? reply.body.trim() : "";
    if (!body || !canComment) return;
    // Ô trả lời đóng ngay; reply hiện "Sending…" dưới comment gốc.
    setReply(null);
    try {
      await sendComment(body, parentId);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Could not save reply.";
      // Mở lại đúng ô đó với chữ vừa gửi — trừ khi người dùng đã mở ô trả lời
      // ở comment khác hoặc đã gõ chữ mới.
      setReply((current) => {
        if (current && current.parentId !== parentId) return current;
        return {
          parentId,
          body: current?.body.trim() ? current.body : body,
          error: message,
        };
      });
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
                disabled={!canLog}
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
                disabled={!canLog}
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
                disabled={!canLog}
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
              disabled={!canLog}
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
              className="inline-flex h-9 items-center rounded px-3 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              className="inline-flex h-9 items-center rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={!canSubmit}
            >
              Log interaction
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
        ) : feedItems.length === 0 &&
          pendingInteractions.length === 0 &&
          pendingComments.length === 0 ? null : (
          feedItems.map((item) => {
            if (item.kind === "comment") {
              const comment = item.comment;
              const replies = repliesByParent.get(comment.id) ?? [];
              const pendingReplies = pendingComments.filter(
                (pending) => pending.parentId === comment.id,
              );
              const replyOpen = reply?.parentId === comment.id;
              return (
                <div key={`comment:${comment.id}`} className="space-y-2">
                  <LeadCommentItem
                    comment={comment}
                    onReply={
                      canComment
                        ? () =>
                            setReply((current) =>
                              current?.parentId === comment.id
                                ? current
                                : { parentId: comment.id, body: "", error: null },
                            )
                        : undefined
                    }
                  />
                  {replies.length > 0 || pendingReplies.length > 0 || replyOpen ? (
                    <div className="ml-3 space-y-2 border-l-2 border-[#dfe1e6] pl-3 sm:ml-5 sm:pl-4">
                      {replies.map((replyComment) => (
                        <LeadCommentItem key={replyComment.id} comment={replyComment} />
                      ))}
                      {pendingReplies.map((pending) => (
                        <PendingCommentItem key={pending.tempId} pending={pending} />
                      ))}
                      {replyOpen && reply ? (
                        <form
                          className="space-y-2"
                          onSubmit={(event) => void submitReply(event, comment.id)}
                        >
                          <textarea
                            autoFocus
                            value={reply.body}
                            onChange={(event) => {
                              const body = event.target.value;
                              setReply((current) =>
                                current?.parentId === comment.id
                                  ? { ...current, body, error: null }
                                  : current,
                              );
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setReply(null);
                            }}
                            maxLength={4000}
                            placeholder="Reply…"
                            aria-label={`Reply to ${personLabel(comment.author_email)}`}
                            className="min-h-16 w-full resize-y rounded border border-[#cfd8e5] bg-white px-3 py-2 text-sm text-[#172b4d] outline-none placeholder:text-[#8993a4] focus:border-[#0c66e4]"
                          />
                          {reply.error ? (
                            <p
                              role="alert"
                              className="rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]"
                            >
                              {reply.error}
                            </p>
                          ) : null}
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setReply(null)}
                              className="inline-flex h-8 items-center rounded px-2.5 text-xs font-bold text-[#42526e] transition hover:bg-[#f4f5f7]"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={!reply.body.trim()}
                              className="inline-flex h-8 items-center rounded bg-[#0c66e4] px-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Reply
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
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
        {pendingInteractions.map((pending) => {
          const pendingType = interactionTypes.find((candidate) => candidate.id === pending.typeId);
          const pendingStatus = statuses.find((candidate) => candidate.id === pending.statusId);
          return (
            <article
              key={pending.tempId}
              className="flex gap-2.5 opacity-60"
              aria-busy="true"
            >
              <div className="min-w-0 flex-1 rounded border border-dashed border-[#c1c7d0] px-3 py-2">
                <p className="text-xs font-semibold italic text-[#6b778c]">Saving interaction…</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {pendingType ? (
                    <span
                      className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em]"
                      style={badgeStyle(pendingType.id, pendingType.label, pendingType.color)}
                    >
                      {pendingType.label}
                    </span>
                  ) : null}
                  {pendingStatus ? (
                    <span
                      className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold"
                      style={badgeStyle(pendingStatus.id, pendingStatus.label, pendingStatus.color)}
                    >
                      {pendingStatus.label}
                    </span>
                  ) : null}
                </div>
                {pending.note ? (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-[#172b4d] [overflow-wrap:anywhere]">
                    {pending.note}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
        {pendingComments
          .filter((pending) => pending.parentId === null)
          .map((pending) => (
            <PendingCommentItem key={pending.tempId} pending={pending} />
          ))}
      </div>
      {canComment ? (
        // Cùng kiểu ô viết comment với Task/Enrollment (CommentThread Composer):
        // avatar, khung bo tròn, dải đáy chứa nút phụ và nút Send.
        <form
          className="shrink-0 border-t border-[#dfe1e6] bg-white pt-3"
          onSubmit={submitComment}
        >
          <div className="flex gap-3">
            {currentUserEmail ? (
              <div className="shrink-0 pt-1">
                <Initials email={currentUserEmail} label={personLabel(currentUserEmail)} />
              </div>
            ) : null}
            <div className="relative min-w-0 flex-1 overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_1px_rgba(9,30,66,0.08)] transition focus-within:border-[#0c66e4] focus-within:shadow-[0_0_0_1px_#0c66e4]">
              <textarea
                value={commentBody}
                onChange={(event) => {
                  setCommentBody(event.target.value);
                  if (commentError) setCommentError(null);
                }}
                maxLength={4000}
                rows={2}
                placeholder="Add a comment…"
                className="block min-h-[2.25rem] w-full resize-y bg-white px-3 py-2 text-sm leading-5 text-[#172b4d] outline-none placeholder:text-[#7a869a]"
              />
              {commentError ? (
                <div
                  role="alert"
                  className="border-t border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]"
                >
                  {commentError}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 border-t border-[#ebecf0] bg-[#fafbfc] px-2 py-1">
                <div className="flex items-center gap-1">
                  {canLog ? (
                    <button
                      type="button"
                      onClick={openComposer}
                      className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-semibold text-[#44546f] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add interaction
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {commentBody.length > 0 ? (
                    <span className="text-[11px] text-[#8993a4]">{commentBody.length}/4000</span>
                  ) : null}
                  <button
                    type="submit"
                    disabled={!commentBody.trim()}
                    className="inline-flex h-7 items-center gap-1.5 rounded bg-[#0c66e4] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" /> Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
