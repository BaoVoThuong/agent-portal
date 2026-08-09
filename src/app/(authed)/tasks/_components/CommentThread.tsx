"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  FileText,
  ImageIcon,
  MoreHorizontal,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { UNKNOWN_PERSON_LABEL } from "@/lib/people/display-names";
import {
  decodeMentions,
  diffMentionEmails,
  encodeMentions,
  filterMentionCandidates,
  findActiveMention,
  mentionLabel,
  mentionStartsWithQuery,
  MENTION_TOKEN,
  rebaseMentions,
  type ActiveMention,
  type DraftMention,
  type MentionPerson,
} from "@/lib/tasks/mention-draft";
import { moveEnabledChoiceIndex } from "@/lib/ui/option-search";
import {
  isNearBottom,
  shouldFollowNewRows,
} from "@/lib/tasks/thread-view";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { checkOperationLimits } from "@/lib/tasks/attachment-limits";
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  formatAttachmentSize,
  inferAttachmentMimeType,
} from "@/lib/tasks/attachments";
import type {
  CommentWithAttachments,
  SignedAttachment,
} from "@/lib/tasks/detail";
import { taskRoomTopic } from "@/lib/tasks/realtime-topics";
import {
  beginSubmission,
  canSubmit,
  commentCommitted,
  fileFailed,
  fileUploaded,
  fileUploading,
  failSubmission,
  finishSubmission,
  reloadFailed,
  type FileState,
  type SubmissionState,
} from "@/lib/tasks/comment-submission";
import { Initials } from "./board-ui";
import { useAnchoredMenu } from "./use-anchored-menu";

type Comment = CommentWithAttachments & {
  id: string;
  parent_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
  updated_at?: string;
  deleted_at: string | null;
  optimistic?: boolean;
  failed?: boolean;
  error?: string;
  fileStates?: FileState[];
  reloadFailed?: boolean;
  // Set once the server has created the real row. Posting a comment broadcasts
  // to the room, so a reload can bring the real comment back while this
  // optimistic copy is still on screen waiting for its files to finish
  // uploading — without this link the same comment renders twice.
  realId?: string;
  author_name?: string;
};

type CommentEdit = {
  id: string;
  previous_body: string;
  edited_by: string;
  edited_at: string;
  edited_by_name?: string;
};

type EditOutcome =
  | { ok: true }
  | { ok: false; kind: "conflict" | "error"; message: string };

type MutationOutcome =
  | { ok: true; warning?: string }
  | { ok: false; message: string };

type MentionMenuPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

const MENTION_MENU_WIDTH = 288;
const MENTION_MENU_MAX_HEIGHT = 224;
const MENTION_MENU_ROW_HEIGHT = 44;
const MENTION_MENU_GAP = 6;
const MENTION_MENU_VIEWPORT_PADDING = 8;

async function readResponseError(
  response: Response,
  fallback: string
): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return data?.error ?? fallback;
}

type ImagePreview = {
  url: string;
  fileName: string;
  trigger?: HTMLElement | null;
};

const isImage = (mime: string | null) =>
  Boolean(mime && mime.startsWith("image/"));

function isAllowedClientAttachment(file: File): boolean {
  const inferred = inferAttachmentMimeType(file.name, file.type || undefined);
  return ATTACHMENT_ALLOWED_MIME_TYPES.includes(inferred);
}

function AttachmentLink({ attachment }: { attachment: SignedAttachment }) {
  const size = attachment.size_bytes == null ? "Size unavailable" : formatAttachmentSize(attachment.size_bytes);
  if (attachment.unavailable || !attachment.url) {
    return (
      <span title="This file may have been removed or is temporarily unavailable" className="inline-flex max-w-full items-center gap-1.5 rounded border border-[#dfe1e6] bg-[#f7f8f9] px-2 py-1 text-xs font-medium text-[#8993a4]">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={attachment.file_name}>
          {attachment.file_name} · {size} · File unavailable
        </span>
      </span>
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${attachment.file_name}`}
      title={`${attachment.file_name} · ${size}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-[#dfe1e6] bg-[#fafbfc] px-2 py-1 text-xs font-medium text-[#0c66e4] transition hover:bg-[#e9f2ff] hover:underline"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{attachment.file_name} · {size}</span>
    </a>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function measureTextareaCaret(
  textarea: HTMLTextAreaElement,
  caret: number,
  matchCount: number,
  preferAbove: boolean,
): MentionMenuPosition {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.border = style.border;
  mirror.style.padding = style.padding;
  mirror.style.font = style.font;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = "break-word";

  mirror.textContent = textarea.value.slice(0, caret);
  marker.textContent = textarea.value.slice(caret, caret + 1) || "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerTop = marker.offsetTop - textarea.scrollTop;
  const markerLeft = marker.offsetLeft - textarea.scrollLeft;
  const markerHeight = marker.offsetHeight;
  document.body.removeChild(mirror);

  const textareaRect = textarea.getBoundingClientRect();
  const caretTop = textareaRect.top + markerTop;
  const caretBottom = caretTop + markerHeight;
  const desiredHeight = Math.min(
    MENTION_MENU_MAX_HEIGHT,
    Math.max(MENTION_MENU_ROW_HEIGHT, matchCount * MENTION_MENU_ROW_HEIGHT + 8),
  );
  const spaceAbove = Math.max(
    0,
    caretTop - MENTION_MENU_GAP - MENTION_MENU_VIEWPORT_PADDING,
  );
  const spaceBelow = Math.max(
    0,
    window.innerHeight -
      caretBottom -
      MENTION_MENU_GAP -
      MENTION_MENU_VIEWPORT_PADDING,
  );
  const opensAbove =
    (preferAbove && spaceAbove >= MENTION_MENU_ROW_HEIGHT) ||
    (spaceBelow < Math.min(desiredHeight, 96) && spaceAbove > spaceBelow);
  const availableHeight = opensAbove ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(
    MENTION_MENU_ROW_HEIGHT,
    Math.min(desiredHeight, availableHeight),
  );
  const top = opensAbove
    ? Math.max(
        MENTION_MENU_VIEWPORT_PADDING,
        caretTop - MENTION_MENU_GAP - maxHeight,
      )
    : Math.min(
        window.innerHeight - MENTION_MENU_VIEWPORT_PADDING - maxHeight,
        caretBottom + MENTION_MENU_GAP,
      );
  const left = Math.min(
    Math.max(
      MENTION_MENU_VIEWPORT_PADDING,
      textareaRect.left + markerLeft,
    ),
    Math.max(
      MENTION_MENU_VIEWPORT_PADDING,
      window.innerWidth - MENTION_MENU_WIDTH - MENTION_MENU_VIEWPORT_PADDING,
    ),
  );

  return {
    top,
    left,
    maxHeight,
  };
}

function mentionOptionId(listId: string, email: string) {
  return `${listId}-option-${email.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
}

function MentionPicker({
  listId,
  candidates,
  activeIndex,
  position,
  onSelect,
}: {
  listId: string;
  candidates: readonly MentionPerson[];
  activeIndex: number;
  position: MentionMenuPosition;
  onSelect: (person: MentionPerson) => void;
}) {
  const noResults = candidates.length === 0;
  return createPortal(
    <div
      id={listId}
      role="listbox"
      aria-label="Mention a person"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        maxHeight: position.maxHeight,
        width: "min(288px, calc(100vw - 16px))",
      }}
      className="z-[120] overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white py-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
    >
      {noResults ? (
        <div className="px-3 py-3 text-sm font-medium text-[#6b778c]">
          No matching people
        </div>
      ) : (
        candidates.map((person, index) => {
          const optionId = mentionOptionId(listId, person.email);
          const secondary = person.roles?.[0]?.label || "Team member";
          return (
            <button
              key={person.email}
              id={optionId}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(person);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                index === activeIndex
                  ? "bg-[#e9f2ff] text-[#0c66e4]"
                  : "text-[#172b4d] hover:bg-[#f4f5f7]"
              }`}
            >
              <Initials email={person.email} label={mentionLabel(person)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {mentionLabel(person)}
                </span>
                <span className="block truncate text-xs font-medium text-[#8993a4]">
                  {secondary}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>,
    document.body,
  );
}

export function CommentThread({
  taskId,
  apiBase = "/api/tasks",
  roomTopic,
  currentEmail,
  members,
  comments,
  highlightCommentId,
  onReload,
  onParentUpdatedAt,
}: {
  taskId: string;
  apiBase?: string;
  roomTopic?: string;
  currentEmail: string;
  members: TaskAssignee[];
  comments: CommentWithAttachments[];
  highlightCommentId?: string | null;
  onReload: () => Promise<unknown> | void;
  /** Receives the parent task/record's new updated_at after a comment is
   * posted, so the owning list can keep its optimistic-concurrency token
   * current instead of 409-ing on the user's next edit. */
  onParentUpdatedAt?: (updatedAt: string) => void;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [optimisticComments, setOptimisticComments] = useState<Comment[]>([]);
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"loading" | "loaded" | "error">("loading");
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  const previewDialogRef = useRef<HTMLDivElement | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const optimisticCounterRef = useRef(0);
  const submissionRef = useRef<SubmissionState>({ inFlight: false, requestId: null });
  const failedSubmissionIntentRef = useRef<string | null>(null);
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [newRowsCount, setNewRowsCount] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const nearBottomRef = useRef(true);
  const previousRowIdsRef = useRef<string[] | null>(null);
  const ownSendRef = useRef(false);
  // Blob URLs created for optimistic attachment previews, keyed by temp comment
  // id so they can be revoked once the real (signed) URLs replace them.
  const optimisticUrlsRef = useRef(new Map<string, string[]>());
  const optimisticFilesRef = useRef(new Map<string, Map<string, File>>());
  const optimisticFileRequestIdsRef = useRef(new Map<string, Map<string, string>>());

  // Live thread: refetch when the task room pings (someone commented/attached).
  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void onReload(), 300);
    };
    const channel = sb
      .channel(roomTopic ?? taskRoomTopic(taskId))
      .on("broadcast", { event: "changed" }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [roomTopic, taskId, onReload]);

  // Revoke every optimistic blob URL when the drawer unmounts or switches to
  // another task. Without this, failed sends keep file previews alive for the
  // entire session even though the composer is no longer visible.
  useEffect(() => {
    return () => {
      for (const urls of optimisticUrlsRef.current.values()) {
        for (const url of urls) URL.revokeObjectURL(url);
      }
      optimisticUrlsRef.current.clear();
      optimisticFilesRef.current.clear();
      optimisticFileRequestIdsRef.current.clear();
    };
  }, [taskId]);

  // One clock per open thread keeps relative timestamps current without one
  // interval per comment. Hidden tabs wait until they become visible again.
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setClockTick((value) => value + 1);
    };
    const interval = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    if (!imagePreview) return;
    setPreviewStatus("loading");
    previewTriggerRef.current = imagePreview.trigger ?? (document.activeElement as HTMLElement | null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => previewCloseRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setImagePreview(null);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = previewDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href]:not([aria-disabled="true"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
    };
  }, [imagePreview]);

  const nameOf = useCallback(
    (email: string, canonicalName?: string | null) =>
      canonicalName?.trim() ||
      members.find((m) => m.email.trim().toLowerCase() === email.trim().toLowerCase())?.name?.trim() ||
      UNKNOWN_PERSON_LABEL,
    [members],
  );

  function releaseOptimistic(id: string) {
    const urls = optimisticUrlsRef.current.get(id);
    if (urls) {
      for (const url of urls) URL.revokeObjectURL(url);
      optimisticUrlsRef.current.delete(id);
    }
    optimisticFilesRef.current.delete(id);
    optimisticFileRequestIdsRef.current.delete(id);
    setOptimisticComments((current) =>
      current.filter((comment) => comment.id !== id),
    );
    // Explicitly discarding a failed draft starts a new user intent. A retry
    // of the same draft keeps its id; a new draft must not replay the old row.
    submissionRef.current = finishSubmission();
    failedSubmissionIntentRef.current = null;
  }

  function post(body: string, files: File[], parentId: string | null) {
    if (!canSubmit(submissionRef.current)) return false;
    const intentKey = [body, parentId ?? "", ...files.map((file) => `${file.name}:${file.size}:${file.lastModified}`)].join("\u0000");
    if (
      failedSubmissionIntentRef.current &&
      failedSubmissionIntentRef.current !== intentKey
    ) {
      submissionRef.current = finishSubmission();
    }
    submissionRef.current = beginSubmission(submissionRef.current, () => crypto.randomUUID());
    ownSendRef.current = true;
    setSubmissionBusy(true);
    const tempId = `optimistic-${taskId}-${optimisticCounterRef.current++}`;
    // Show the picked files immediately using local blob URLs; they are revoked
    // once the server round-trip finishes and the real signed URLs arrive.
    const urls: string[] = [];
    const fileStates: FileState[] = [];
    const fileMap = new Map<string, File>();
    const fileRequestIds = new Map<string, string>();
    const attachments = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      urls.push(url);
      const fileId = `${tempId}-file-${index}`;
      fileStates.push({ id: fileId, status: "pending" });
      fileMap.set(fileId, file);
      fileRequestIds.set(fileId, crypto.randomUUID());
      return {
        id: fileId,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        url,
      };
    });
    optimisticUrlsRef.current.set(tempId, urls);
    optimisticFilesRef.current.set(tempId, fileMap);
    optimisticFileRequestIdsRef.current.set(tempId, fileRequestIds);
    setOptimisticComments((current) => [
      ...current,
      {
        id: tempId,
        parent_id: parentId,
        author_email: currentEmail,
        author_name: nameOf(currentEmail),
        body,
        created_at: new Date().toISOString(),
        deleted_at: null,
        attachments,
        fileStates,
        optimistic: true,
      },
    ]);
    setReplyTo(null);

    void persistComment(
      tempId,
      body,
      files,
      parentId,
      submissionRef.current.requestId,
      intentKey,
    );
    return true;
  }

  async function persistComment(
    tempId: string,
    body: string,
    files: File[],
    parentId: string | null,
    requestId: string | null,
    intentKey: string,
  ) {
    let comment: { id: string };
    let parentUpdatedAt: string | undefined;
    try {
      const res = await fetch(`${apiBase}/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          parentId,
          hasAttachments: files.length > 0,
          client_request_id: requestId,
        }),
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to create comment."));
      }
      ({ comment, parent_updated_at: parentUpdatedAt } = (await res.json()) as {
        comment: { id: string };
        parent_updated_at?: string;
      });
    } catch (error) {
      const message = getErrorMessage(error, "Failed to send comment.");
      setOptimisticComments((current) =>
        current.map((comment) =>
          comment.id === tempId
            ? { ...comment, failed: true, error: message }
          : comment,
        ),
      );
      submissionRef.current = failSubmission(submissionRef.current);
      failedSubmissionIntentRef.current = intentKey;
      setSubmissionBusy(false);
      return;
    }

    // The comment is now durable even if a file or reload fails. Keep the
    // optimistic row linked to its real id until every file has a server row.
    if (parentUpdatedAt) onParentUpdatedAt?.(parentUpdatedAt);
    const committed = commentCommitted(
      { files: files.map((_, index) => ({ id: `${tempId}-file-${index}`, status: "pending" })) },
      comment.id,
    );
    setOptimisticComments((current) =>
      current.map((item) =>
        item.id === tempId
          ? { ...item, realId: comment.id, failed: false, error: undefined, fileStates: committed.files }
          : item,
      ),
    );

    let uploadFailed = false;
    for (const [index, file] of files.entries()) {
      const fileId = `${tempId}-file-${index}`;
      setOptimisticComments((current) =>
        current.map((item) =>
          item.id === tempId && item.fileStates
            ? { ...item, fileStates: fileUploading({ ...committed, files: item.fileStates }, fileId).files }
            : item,
        ),
      );
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("comment_id", comment.id);
        const requestIdForFile = optimisticFileRequestIdsRef.current.get(tempId)?.get(fileId);
        if (requestIdForFile) form.append("client_request_id", requestIdForFile);
        const upload = await fetch(`${apiBase}/${taskId}/attachments`, {
          method: "POST",
          body: form,
        });
        if (!upload.ok) {
          throw new Error(await readResponseError(upload, "Failed to upload attachment."));
        }
        setOptimisticComments((current) =>
          current.map((item) =>
            item.id === tempId && item.fileStates
              ? { ...item, fileStates: fileUploaded({ ...committed, files: item.fileStates }, fileId).files }
              : item,
          ),
        );
      } catch (error) {
        uploadFailed = true;
        const message = getErrorMessage(error, "Failed to upload attachment.");
        setOptimisticComments((current) =>
          current.map((item) =>
            item.id === tempId && item.fileStates
              ? { ...item, fileStates: fileFailed({ ...committed, files: item.fileStates }, fileId, message).files }
              : item,
          ),
        );
      }
    }

    let reloadDidFail = false;
    try {
      const reloadResult = await onReload();
      if (reloadResult === "failed") {
        throw new Error("Comment saved; refresh failed.");
      }
    } catch (error) {
      reloadDidFail = true;
      setOptimisticComments((current) =>
        current.map((item) =>
          item.id === tempId && item.fileStates
            ? {
                ...item,
                reloadFailed: reloadFailed({
                  realId: comment.id,
                  files: item.fileStates,
                  reloadFailed: false,
                }).reloadFailed,
                error: getErrorMessage(error, "Comment saved; refresh failed."),
              }
            : item,
        ),
      );
    }

    if (!uploadFailed && !reloadDidFail) releaseOptimistic(tempId);
    submissionRef.current = finishSubmission();
    failedSubmissionIntentRef.current = null;
    setSubmissionBusy(false);
  }

  async function retryFile(tempId: string, fileId: string) {
    const draft = optimisticComments.find((comment) => comment.id === tempId);
    const realId = draft?.realId;
    const file = optimisticFilesRef.current.get(tempId)?.get(fileId);
    if (!draft || !realId || !file) return;

    setOptimisticComments((current) =>
      current.map((item) =>
        item.id === tempId && item.fileStates
          ? {
              ...item,
              fileStates: fileUploading(
                { realId, files: item.fileStates, reloadFailed: Boolean(item.reloadFailed) },
                fileId,
              ).files,
            }
          : item,
      ),
    );
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("comment_id", realId);
      const requestIdForFile = optimisticFileRequestIdsRef.current.get(tempId)?.get(fileId);
      if (requestIdForFile) form.append("client_request_id", requestIdForFile);
      const upload = await fetch(`${apiBase}/${taskId}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!upload.ok) {
        throw new Error(await readResponseError(upload, "Failed to upload attachment."));
      }
      setOptimisticComments((current) =>
        current.map((item) =>
          item.id === tempId && item.fileStates
            ? {
                ...item,
                fileStates: fileUploaded(
                  { realId, files: item.fileStates, reloadFailed: Boolean(item.reloadFailed) },
                  fileId,
                ).files,
              }
            : item,
        ),
      );
      try {
        const reloadResult = await onReload();
        if (reloadResult === "failed") {
          throw new Error("Refresh failed.");
        }
        const latest = optimisticComments.find((item) => item.id === tempId);
        if (latest?.fileStates?.every((state) => state.status === "success")) {
          releaseOptimistic(tempId);
        }
      } catch (error) {
        setOptimisticComments((current) =>
          current.map((item) =>
            item.id === tempId
              ? { ...item, reloadFailed: true, error: getErrorMessage(error, "Refresh failed.") }
              : item,
          ),
        );
      }
    } catch (error) {
      const message = getErrorMessage(error, "Failed to upload attachment.");
      setOptimisticComments((current) =>
        current.map((item) =>
          item.id === tempId && item.fileStates
            ? {
                ...item,
                fileStates: fileFailed(
                  { realId, files: item.fileStates, reloadFailed: Boolean(item.reloadFailed) },
                  fileId,
                  message,
                ).files,
              }
            : item,
        ),
      );
    }
  }

  async function remove(id: string): Promise<MutationOutcome> {
    let res: Response;
    try {
      res = await fetch(`${apiBase}/${taskId}/comments/${id}`, {
        method: "DELETE",
      });
    } catch {
      return { ok: false, message: "Could not delete the comment. Try again." };
    }
    if (!res.ok) {
      return { ok: false, message: "Could not delete the comment. Try again." };
    }
    try {
      const reloadResult = await onReload();
      return reloadResult === "failed"
        ? { ok: true, warning: "Comment deleted, but the thread could not refresh." }
        : { ok: true };
    } catch {
      return { ok: true, warning: "Comment deleted, but the thread could not refresh." };
    }
  }

  async function edit(
    id: string,
    body: string,
    expectedUpdatedAt: string | null,
    newMentions: string[] = [],
  ): Promise<EditOutcome> {
    let res: Response;
    try {
      res = await fetch(`${apiBase}/${taskId}/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          expected_updated_at: expectedUpdatedAt,
          new_mentions: newMentions,
        }),
      });
    } catch {
      return { ok: false, kind: "error", message: "Could not save the edit. Try again." };
    }
    if (!res.ok) {
      const message = await readResponseError(res, "Could not save the edit.");
      return {
        ok: false,
        kind: res.status === 409 ? "conflict" : "error",
        message,
      };
    }
    const result = (await res.json().catch(() => null)) as {
      parent_updated_at?: string;
    } | null;
    if (result?.parent_updated_at) onParentUpdatedAt?.(result.parent_updated_at);
    try {
      await onReload();
    } catch {
      return { ok: false, kind: "error", message: "Saved, but the thread could not refresh." };
    }
    return { ok: true };
  }

  // Posting broadcasts to the room, so a reload can deliver the real comment
  // while its files are still uploading. Show exactly one copy: keep the
  // optimistic row (it carries the local image previews) and hide the server
  // row it maps to until releaseOptimistic swaps them after the upload.
  const shadowedIds = new Set(
    optimisticComments
      .map((comment) => comment.realId)
      .filter((id): id is string => Boolean(id)),
  );
  const rows = [
    ...(comments as Comment[]).filter((comment) => !shadowedIds.has(comment.id)),
    ...optimisticComments,
  ];
  const timestampOf = (comment: Comment) =>
    new Date(comment.created_at).getTime() || 0;
  const repliesOf = (id: string) =>
    rows
      .filter((c) => c.parent_id === id)
      .sort((a, b) => timestampOf(a) - timestampOf(b));
  const topLevel = rows
    .filter((c) => c.parent_id === null)
    .sort((a, b) => timestampOf(a) - timestampOf(b));
  const rowIds = rows.map((comment) => comment.id);
  const rowSignature = rowIds.join("|");

  useEffect(() => {
    const el = scrollRef.current;
    const previous = previousRowIdsRef.current;
    const currentIds = rowSignature ? rowSignature.split("|") : [];
    previousRowIdsRef.current = currentIds;
    if (!el || highlightCommentId) return;
    if (!previous) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      setNewRowsCount(0);
      ownSendRef.current = false;
      return;
    }
    const previousIds = new Set(previous);
    const addedCount = currentIds.filter((id) => !previousIds.has(id)).length;
    if (addedCount === 0) return;
    if (
      shouldFollowNewRows({
        nearBottom: nearBottomRef.current,
        ownSend: ownSendRef.current,
        deepLink: Boolean(highlightCommentId),
      })
    ) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      setNewRowsCount(0);
      ownSendRef.current = false;
    } else {
      setNewRowsCount((count) => count + addedCount);
    }
  }, [rowSignature, highlightCommentId]);

  useEffect(() => {
    if (!highlightCommentId) return;

    const element = rootRef.current?.querySelector(
      `[data-comment-id="${highlightCommentId}"]`
    );
    if (!(element instanceof HTMLElement)) return;

    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.classList.add("comment-flash");
    const timer = window.setTimeout(
      () => element.classList.remove("comment-flash"),
      2000
    );
    return () => window.clearTimeout(timer);
  }, [highlightCommentId, rowSignature]);

  return (
    <>
      {/* Messenger layout: the thread scrolls inside its own box and the
          composer is docked underneath it, so the input never moves. */}
      <section ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={(event) => {
            nearBottomRef.current = isNearBottom(event.currentTarget);
            if (nearBottomRef.current) setNewRowsCount(0);
          }}
          className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1"
        >
        {topLevel.length === 0 ? (
          <div className="rounded border border-dashed border-[#c1c7d0] bg-[#fafbfc] px-4 py-5 text-sm font-medium text-[#6b778c]">
            No comments yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {topLevel.map((c) => (
              <div key={c.id} data-comment-id={c.id} className="space-y-2">
                <CommentItem
                  c={c}
                  taskId={taskId}
                  apiBase={apiBase}
                  currentEmail={currentEmail}
                  members={members}
                  nowTick={clockTick}
                  nameOf={nameOf}
                  onDelete={c.optimistic ? releaseOptimistic : remove}
                  onEdit={edit}
                  onReply={c.optimistic ? undefined : () => setReplyTo(c.id)}
                  onRetryFile={c.optimistic ? (fileId) => void retryFile(c.id, fileId) : undefined}
                  onPreviewImage={setImagePreview}
                />
                <div className="ml-3 space-y-2 border-l-2 border-[#dfe1e6] pl-3 sm:ml-5 sm:pl-4">
                  {repliesOf(c.id).map((rc) => (
                    <div key={rc.id} data-comment-id={rc.id}>
                      <CommentItem
                        c={rc}
                        taskId={taskId}
                        apiBase={apiBase}
                        currentEmail={currentEmail}
                        members={members}
                        nowTick={clockTick}
                        nameOf={nameOf}
                        onDelete={rc.optimistic ? releaseOptimistic : remove}
                        onEdit={edit}
                        onRetryFile={rc.optimistic ? (fileId) => void retryFile(rc.id, fileId) : undefined}
                        onPreviewImage={setImagePreview}
                      />
                    </div>
                  ))}
                  {replyTo === c.id && (
            <Composer
                      initiallyExpanded
                      currentEmail={currentEmail}
                      members={members}
                      nameOf={nameOf}
                      onCancel={() => setReplyTo(null)}
              onSubmit={(body, files) => post(body, files, c.id)}
              submitting={submissionBusy}
              placeholder="Reply..."
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
        {newRowsCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              const element = scrollRef.current;
              if (!element) return;
              element.scrollTop = element.scrollHeight;
              nearBottomRef.current = true;
              setNewRowsCount(0);
            }}
            className="mx-auto my-2 shrink-0 rounded-full bg-[#e9f2ff] px-3 py-1.5 text-xs font-semibold text-[#0c66e4] shadow-sm transition hover:bg-[#deebff]"
          >
            New comments ({newRowsCount})
          </button>
        ) : null}

        <div className="shrink-0 border-t border-[#dfe1e6] bg-white pt-3">
          <Composer
            alwaysOpen
            currentEmail={currentEmail}
            members={members}
            nameOf={nameOf}
            onSubmit={(body, files) => post(body, files, null)}
            submitting={submissionBusy}
            placeholder="Add a comment..."
          />
        </div>
      </section>

      {imagePreview
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-[#091e42]/70 p-4"
              onClick={() => setImagePreview(null)}
            >
              <div
                ref={previewDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="attachment-preview-title"
                className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#dfe1e6] px-4 py-2.5">
                  <h2 id="attachment-preview-title" className="min-w-0 truncate text-sm font-bold text-[#172b4d]" title={imagePreview.fileName}>
                    {imagePreview.fileName}
                  </h2>
                  <button
                    ref={previewCloseRef}
                    type="button"
                    onClick={() => setImagePreview(null)}
                    aria-label="Close preview"
                    className="rounded p-1 text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#f7f8f9] p-3">
                  {previewStatus === "loading" ? (
                    <p className="px-4 py-8 text-sm font-semibold text-[#6b778c]" role="status">
                      Loading preview…
                    </p>
                  ) : null}
                  {previewStatus === "error" ? (
                    <div className="px-4 py-8 text-center" role="alert">
                      <p className="text-sm font-semibold text-[#bf2600]">Preview unavailable.</p>
                      <p className="mt-1 text-xs text-[#6b778c]">The signed link may have expired.</p>
                    </div>
                  ) : null}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview.url}
                    alt={imagePreview.fileName}
                    onLoad={() => setPreviewStatus("loaded")}
                    onError={() => setPreviewStatus("error")}
                    className={`max-h-[calc(100vh-10rem)] max-w-full object-contain ${previewStatus === "loaded" ? "" : "hidden"}`}
                  />
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] px-4 py-2.5">
                  <a
                    href={imagePreview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded px-3 py-1.5 text-sm font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]"
                  >
                    Open
                  </a>
                  <a
                    href={imagePreview.url}
                    download={imagePreview.fileName}
                    className="rounded bg-[#0c66e4] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0055cc]"
                  >
                    Download
                  </a>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function renderBody(body: string, names?: ReadonlyMap<string, string>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of body.matchAll(MENTION_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(body.slice(last, idx));
    const email = m[2].trim().toLowerCase();
    const label = names?.get(email) || m[1] || UNKNOWN_PERSON_LABEL;
    nodes.push(
      <span
        key={`m${key++}`}
        className="inline-flex rounded-md bg-[#e9f2ff] px-1.5 py-0.5 font-semibold text-[#0c66e4]"
      >
        @{label}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < body.length) nodes.push(body.slice(last));
  return nodes;
}

function CommentItem({
  c,
  taskId,
  apiBase,
  currentEmail,
  members,
  nowTick,
  nameOf,
  onDelete,
  onEdit,
  onReply,
  onRetryFile,
  onPreviewImage,
}: {
  c: Comment;
  taskId: string;
  apiBase: string;
  currentEmail: string;
  members: TaskAssignee[];
  nowTick: number;
  nameOf: (email: string, canonicalName?: string | null) => string;
  onDelete: (id: string) => Promise<MutationOutcome | void> | MutationOutcome | void;
  onEdit: (id: string, body: string, expectedUpdatedAt: string | null, newMentions?: string[]) => Promise<EditOutcome>;
  onReply?: () => void;
  onRetryFile?: (fileId: string) => void;
  onPreviewImage: (preview: ImagePreview) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mutationStatus, setMutationStatus] = useState<
    { kind: "status" | "alert"; message: string } | null
  >(null);
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const canReply = Boolean(onReply && !c.optimistic);
  const canEdit = c.author_email === currentEmail && !c.optimistic && !c.failed;
  const canDelete =
    c.author_email === currentEmail && (!c.optimistic || c.failed);
  const hasMenu = canEdit || canDelete;
  const mentionNames = new Map(
    members.map((member) => [member.email.trim().toLowerCase(), mentionLabel(member)]),
  );
  const editedAt = (c as { updated_at?: string | null }).updated_at;
  const wasEdited =
    !c.optimistic &&
    typeof editedAt === "string" &&
    new Date(editedAt).getTime() > new Date(c.created_at).getTime() + 1000;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [edits, setEdits] = useState<CommentEdit[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmingDelete) deleteCancelRef.current?.focus();
  }, [confirmingDelete]);

  async function loadHistory() {
    setHistoryError(false);
    try {
      const res = await fetch(`${apiBase}/${taskId}/comments/${c.id}/edits`);
      if (!res.ok) throw new Error("history request failed");
      setEdits(((await res.json()).edits ?? []) as CommentEdit[]);
    } catch {
      setEdits([]);
      setHistoryError(true);
    }
  }

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && edits === null) {
      await loadHistory();
    }
  }

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setMutationStatus(null);
    try {
      const result = await onDelete(c.id);
      if (result && !result.ok) {
        setMutationStatus({ kind: "alert", message: result.message });
        return;
      }
      if (result?.warning) {
        setMutationStatus({ kind: "status", message: result.warning });
      }
      setConfirmingDelete(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } finally {
      setDeleting(false);
    }
  }

  if (c.deleted_at) {
    return (
      <article className="flex gap-2.5">
        <Initials email={c.author_email} label={nameOf(c.author_email, c.author_name)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-[#172b4d]">
              {nameOf(c.author_email, c.author_name)}
            </span>
            <span
              className="text-xs font-medium text-[#6b778c]"
              title={formatExactCommentTime(c.created_at)}
            >
              {formatCommentTime(c.created_at, nowTick)}
            </span>
          </div>
          <p className="pt-0.5 text-xs italic text-[#97a0af]">Comment deleted</p>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex gap-2.5">
      <div className="shrink-0 pt-0.5">
        <Initials email={c.author_email} label={nameOf(c.author_email, c.author_name)} />
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-[#172b4d]">
              {nameOf(c.author_email, c.author_name)}
            </span>
            <span
              className="text-xs font-medium text-[#6b778c]"
              title={formatExactCommentTime(c.created_at)}
            >
              {formatCommentTime(c.created_at, nowTick)}
            </span>
            {wasEdited ? (
              <button
                type="button"
                onClick={toggleHistory}
                className="text-xs font-medium text-[#97a0af] transition hover:text-[#0c66e4] hover:underline"
              >
                (edited)
              </button>
            ) : null}
            {c.failed ? (
              <span
                title={c.error}
                className="rounded bg-[#ffebe6] px-1.5 py-0.5 text-[11px] font-bold text-[#bf2600]"
              >
                Failed to send
              </span>
            ) : null}
          </div>

          {isEditing ? (
            <EditCommentForm
              initialBody={c.body}
              members={members}
              onCancel={() => setIsEditing(false)}
              onSave={(body, expectedUpdatedAt, newMentions) =>
                onEdit(c.id, body, expectedUpdatedAt, newMentions)
              }
              expectedUpdatedAt={c.updated_at ?? null}
            />
          ) : (
            <>
              <div className="mt-0.5 text-sm leading-5 text-[#172b4d]">
                {c.body ? (
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{renderBody(c.body, mentionNames)}</p>
                ) : null}
              </div>

              {historyOpen ? (
                <div className="mt-1.5 space-y-1.5 rounded-lg border border-[#dfe1e6] bg-[#f7f8f9] p-2 text-xs">
                  <div className="font-bold uppercase tracking-wide text-[#6b778c]">
                    Edit history
                  </div>
                  {edits === null ? (
                    <div className="text-[#97a0af]">Loading…</div>
                  ) : historyError ? (
                    <div role="alert" className="flex items-center justify-between gap-2 text-[#bf2600]">
                      <span>Could not load edit history.</span>
                      <button type="button" onClick={() => void loadHistory()} className="font-bold underline">
                        Retry
                      </button>
                    </div>
                  ) : edits.length === 0 ? (
                    <div className="text-[#97a0af]">No previous versions.</div>
                  ) : (
                    edits.map((e) => (
                      <div key={e.id} className="rounded bg-white p-1.5">
                        <p className="whitespace-pre-wrap break-words text-[#42526e]">
                          {renderBody(e.previous_body, mentionNames)}
                        </p>
                        <div className="mt-0.5 text-[10px] text-[#97a0af]">
                          {nameOf(e.edited_by, e.edited_by_name)} ·{" "}
                          {new Date(e.edited_at).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : null}

              {c.attachments.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {c.attachments.map((a) =>
                    a.unavailable || !a.url ? (
                      <AttachmentLink key={a.id} attachment={a} />
                    ) : isImage(a.mime_type) ? (
                      <button
                        key={a.id}
                        type="button"
                        onClick={(event) =>
                          onPreviewImage({
                            url: a.url!,
                            fileName: a.file_name,
                            trigger: event.currentTarget,
                          })
                        }
                        className="group/image block overflow-hidden rounded border border-[#dfe1e6] bg-[#f7f8f9] text-left transition hover:border-[#85b8ff] focus:border-[#0c66e4] focus:outline-none focus:ring-2 focus:ring-[#85b8ff]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={a.url}
                          alt={a.file_name}
                          className="h-24 w-24 object-contain transition group-hover/image:scale-[1.02]"
                        />
                      </button>
                    ) : (
                      <AttachmentLink key={a.id} attachment={a} />
                    ),
                  )}
                </div>
              )}

              {c.fileStates && c.fileStates.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                  {c.fileStates.map((file) => {
                    const attachment = c.attachments.find((item) => item.id === file.id);
                    const label = attachment?.file_name ?? "Attachment";
                    const size = attachment?.size_bytes == null ? null : formatAttachmentSize(attachment.size_bytes);
                    return (
                      <span
                        key={file.id}
                        className={`inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 font-semibold ${
                          file.status === "failed"
                            ? "border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]"
                            : file.status === "success"
                              ? "border-[#abf5d1] bg-[#e3fcef] text-[#006644]"
                              : "border-[#dfe1e6] bg-[#f7f8f9] text-[#6b778c]"
                        }`}
                      >
                        <span className="min-w-0 truncate" title={label}>{label}</span>
                        {size ? <span className="shrink-0 text-[10px] font-medium text-[#8993a4]">{size}</span> : null}
                        <span className="shrink-0">
                          {file.status === "failed"
                            ? "failed"
                            : file.status === "uploading"
                              ? "uploading…"
                              : file.status === "success"
                                ? "uploaded"
                                : "pending"}
                        </span>
                        {file.status === "failed" && onRetryFile ? (
                          <button
                            type="button"
                            onClick={() => onRetryFile(file.id)}
                            className="rounded px-1 font-bold underline hover:bg-white/70"
                          >
                            Retry
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              ) : null}

              {c.reloadFailed ? (
                <p className="mt-1 rounded border border-[#ffe380] bg-[#fffae6] px-2 py-1.5 text-xs font-semibold text-[#7a5d00]">
                  Comment saved; refresh failed. It will sync when the drawer reloads.
                </p>
              ) : null}

              {c.failed && c.error ? (
                <p className="mt-1 rounded border border-[#ffbdad] bg-[#ffebe6] px-2 py-1.5 text-xs font-semibold text-[#bf2600]">
                  {c.error}
                </p>
              ) : null}

              {canReply ? (
                <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-[#44546f]">
                  <button
                    type="button"
                    onClick={onReply}
                    className="rounded px-1 py-0.5 transition hover:bg-[#f4f5f7] hover:text-[#0c66e4]"
                  >
                    Reply
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {hasMenu ? (
          <div className="relative shrink-0">
            <button
              ref={triggerRef}
              type="button"
              onClick={toggle}
              aria-label="Comment actions"
              aria-expanded={isOpen}
              className="flex h-7 w-7 items-center justify-center rounded border border-transparent text-[#6b778c] transition hover:border-[#dfe1e6] hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {isOpen
              ? createPortal(
                  <div
                    ref={menuRef}
                    role="menu"
                    style={menuStyle}
                    className="z-[100] min-w-[8rem] overflow-hidden rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
                  >
                    {canEdit ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsOpen(false);
                          setIsEditing(true);
                        }}
                        className="flex w-full items-center rounded px-2.5 py-1.5 text-left text-sm font-medium text-[#172b4d] transition hover:bg-[#f4f5f7]"
                      >
                        Edit
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsOpen(false);
                          setConfirmingDelete(true);
                        }}
                        className="flex w-full items-center rounded px-2.5 py-1.5 text-left text-sm font-medium text-[#bf2600] transition hover:bg-[#ffebe6]"
                      >
                        {c.failed ? "Remove" : "Delete"}
                      </button>
                    ) : null}
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : null}
        {mutationStatus ? (
          <p
            role={mutationStatus.kind === "alert" ? "alert" : "status"}
            className={`mt-1 text-xs font-semibold ${mutationStatus.kind === "alert" ? "text-[#bf2600]" : "text-[#7a5d00]"}`}
          >
            {mutationStatus.message}
          </p>
        ) : null}
      </div>
      {confirmingDelete ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-[#091e42]/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`delete-title-${c.id}`}
        >
          <div className="w-full max-w-sm rounded-lg border border-[#dfe1e6] bg-white p-4 shadow-2xl">
            <h2 id={`delete-title-${c.id}`} className="text-sm font-bold text-[#172b4d]">
              Delete comment?
            </h2>
            <p className="mt-2 text-sm leading-5 text-[#44546f]">
              Replies will remain visible, and linked files will be removed.
            </p>
            {mutationStatus?.kind === "alert" ? (
              <p role="alert" className="mt-2 text-xs font-semibold text-[#bf2600]">
                {mutationStatus.message}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={deleteCancelRef}
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                disabled={deleting}
                className="rounded px-3 py-1.5 text-sm font-semibold text-[#44546f] hover:bg-[#f4f5f7]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="rounded bg-[#bf2600] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#a52300] disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EditCommentForm({
  initialBody,
  members,
  expectedUpdatedAt,
  onCancel,
  onSave,
}: {
  initialBody: string;
  members: TaskAssignee[];
  expectedUpdatedAt: string | null;
  onCancel: () => void;
  onSave: (
    body: string,
    expectedUpdatedAt: string | null,
    newMentions: string[],
  ) => Promise<EditOutcome>;
}) {
  const [decodedInitialBody] = useState(() =>
    decodeMentions(initialBody),
  );
  const [body, setBody] = useState(decodedInitialBody.text);
  const bodyRef = useRef(decodedInitialBody.text);
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>(
    decodedInitialBody.mentions,
  );
  const [query, setQuery] = useState<string | null>(null);
  const [mentionPosition, setMentionPosition] =
    useState<MentionMenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeMentionRef = useRef<ActiveMention | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches =
    query === null
      ? []
      : filterMentionCandidates(members, query).sort((a, b) => {
          const aStarts = mentionStartsWithQuery(a, query);
          const bStarts = mentionStartsWithQuery(b, query);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return mentionLabel(a).localeCompare(mentionLabel(b));
        });
  const highlightedMatch = matches[activeIndex] ?? matches[0];

  useEffect(() => {
    if (query === null || !mentionPosition) return;
    const updatePosition = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caret = textarea.selectionStart ?? textarea.value.length;
      setMentionPosition(
        measureTextareaCaret(textarea, caret, Math.max(1, matches.length), false),
      );
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [matches.length, mentionPosition, query]);

  function onChange(value: string, caret: number, textarea: HTMLTextAreaElement) {
    const nextMentions = rebaseMentions(bodyRef.current, value, draftMentions);
    bodyRef.current = value;
    setBody(value);
    setDraftMentions(nextMentions);
    const active = findActiveMention(value, caret);
    activeMentionRef.current = active;
    if (!active) {
      setQuery(null);
      setMentionPosition(null);
      return;
    }
    setQuery(active.query);
    setActiveIndex(0);
    setMentionPosition(
      measureTextareaCaret(textarea, caret, Math.max(1, filterMentionCandidates(members, active.query).length), false),
    );
  }

  function pick(person: MentionPerson) {
    const textarea = textareaRef.current;
    const currentText = textarea?.value ?? body;
    const caret = textarea?.selectionStart ?? currentText.length;
    const active = activeMentionRef.current ?? findActiveMention(currentText, caret);
    const start = active?.start ?? caret;
    const end = active?.end ?? caret;
    const label = mentionLabel(person);
    const visibleToken = `@${label}`;
    const nextText = currentText.slice(0, start) + visibleToken + " " + currentText.slice(end);
    const rebased = rebaseMentions(currentText, nextText, draftMentions).filter(
      (mention) => mention.email.toLowerCase() !== person.email.toLowerCase(),
    );
    setDraftMentions([
      ...rebased,
      { label, email: person.email, start, end: start + visibleToken.length },
    ]);
    bodyRef.current = nextText;
    setBody(nextText);
    setQuery(null);
    setMentionPosition(null);
    activeMentionRef.current = null;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + visibleToken.length + 1, start + visibleToken.length + 1);
    });
  }

  const trimmed = body.trim();
  const encodedBody = encodeMentions({ text: body, mentions: draftMentions }).trim();
  const beforeEmails = decodedInitialBody.mentions.map((mention) => mention.email);
  const afterEmails = draftMentions
    .filter((mention) => body.slice(mention.start, mention.end) === `@${mention.label}`)
    .map((mention) => mention.email);
  const newMentions = diffMentionEmails(beforeEmails, afterEmails);
  const unchanged = encodedBody === initialBody.trim();

  async function save() {
    if (!trimmed || saving) return;
    if (unchanged) {
      onCancel();
      return;
    }

    setSaving(true);
    try {
      const result = await onSave(encodedBody, expectedUpdatedAt, newMentions);
      if (result.ok) onCancel();
      else setError(result.message);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (query !== null) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) =>
          moveEnabledChoiceIndex(
            matches.map((match) => ({ value: match.email, label: mentionLabel(match) })),
            index,
            event.key === "ArrowDown" ? 1 : -1,
          ),
        );
        return;
      }
      if (event.key === "Enter") {
        if (highlightedMatch) {
          event.preventDefault();
          pick(highlightedMatch);
          return;
        }
      }
      if (event.key === "Tab") {
        setQuery(null);
        setMentionPosition(null);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        setMentionPosition(null);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  }

  return (
    <div className="mt-1.5 overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_1px_rgba(9,30,66,0.08)] focus-within:border-[#0c66e4] focus-within:shadow-[0_0_0_1px_#0c66e4]">
      <textarea
        ref={textareaRef}
        value={body}
        role="combobox"
        aria-expanded={query !== null}
        aria-controls={query !== null ? listId : undefined}
        aria-activedescendant={
          query !== null && highlightedMatch
            ? mentionOptionId(listId, highlightedMatch.email)
            : undefined
        }
        onChange={(event) =>
          onChange(event.target.value, event.target.selectionStart, event.target)
        }
        onKeyDown={onKeyDown}
        rows={3}
        className="block min-h-[4.5rem] w-full resize-y bg-white px-3 py-2 text-sm leading-5 text-[#172b4d] outline-none"
      />
      {query !== null && mentionPosition ? (
        <MentionPicker
          listId={listId}
          candidates={matches}
          activeIndex={activeIndex}
          position={mentionPosition}
          onSelect={pick}
        />
      ) : null}
      {error ? (
        <p role="alert" className="border-t border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t border-[#ebecf0] bg-[#fafbfc] px-3 py-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded px-2 text-xs font-semibold text-[#44546f] transition hover:bg-[#ebecf0] hover:text-[#172b4d] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!trimmed || saving}
          className="inline-flex h-8 items-center rounded bg-[#0c66e4] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function Composer({
  initiallyExpanded = false,
  alwaysOpen = false,
  currentEmail,
  members,
  nameOf,
  onCancel,
  onSubmit,
  submitting = false,
  placeholder,
}: {
  initiallyExpanded?: boolean;
  /** Messenger-style: the box stays open at the bottom instead of collapsing. */
  alwaysOpen?: boolean;
  currentEmail: string;
  members: TaskAssignee[];
  nameOf: (email: string, canonicalName?: string | null) => string;
  onCancel?: () => void;
  onSubmit: (body: string, files: File[]) => boolean;
  submitting?: boolean;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const textRef = useRef("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(initiallyExpanded || alwaysOpen);
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [mentionPosition, setMentionPosition] =
    useState<MentionMenuPosition | null>(null);
  const [hi, setHi] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const activeMentionRef = useRef<ActiveMention | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Apply a programmatic caret position after a mention insert.
  useEffect(() => {
    if (caretRef.current != null && taRef.current) {
      const pos = caretRef.current;
      taRef.current.focus();
      taRef.current.setSelectionRange(pos, pos);
      caretRef.current = null;
    }
  });

  useEffect(() => {
    // An always-open box is present from the start, so focusing it here would
    // steal the caret every time the drawer opens. Only auto-focus a box the
    // user actively expanded (reply, or the collapsed composer).
    if (!expanded || alwaysOpen) return;
    const frame = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [expanded, alwaysOpen]);

  const matches =
    query === null
      ? []
      : filterMentionCandidates(members, query).sort((a, b) => {
          const aStarts = mentionStartsWithQuery(a, query);
          const bStarts = mentionStartsWithQuery(b, query);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return mentionLabel(a).localeCompare(mentionLabel(b));
        });
  const highlightedMatch = matches[hi] ?? matches[0];

  useEffect(() => {
    if (query === null || !mentionPosition) return;
    const textarea = taRef.current;
    const updatePosition = () => {
      const element = taRef.current;
      if (!element) return;
      const caret = element.selectionStart ?? element.value.length;
      setMentionPosition(
        measureTextareaCaret(element, caret, Math.max(1, matches.length), alwaysOpen),
      );
    };
    const observer = textarea ? new ResizeObserver(updatePosition) : null;
    if (textarea) observer?.observe(textarea);
    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [alwaysOpen, matches.length, mentionPosition, query]);

  function onChange(
    value: string,
    caret: number,
    textarea: HTMLTextAreaElement,
  ) {
    const nextMentions = rebaseMentions(textRef.current, value, draftMentions);
    textRef.current = value;
    setText(value);
    setDraftMentions(nextMentions);
    const activeMention = findActiveMention(value, caret);
    activeMentionRef.current = activeMention;
    if (activeMention) {
      setQuery(activeMention.query);
      const nextMatchCount = filterMentionCandidates(members, activeMention.query).length;
      setMentionPosition(
        measureTextareaCaret(textarea, caret, Math.max(1, nextMatchCount), alwaysOpen),
      );
      setHi(0);
    } else {
      setQuery(null);
      setMentionPosition(null);
    }
  }

  function pick(member: MentionPerson) {
    const el = taRef.current;
    const currentText = el?.value ?? text;
    const caret = el?.selectionStart ?? currentText.length;
    const activeMention =
      activeMentionRef.current ?? findActiveMention(currentText, caret);
    const start = activeMention?.start ?? caret;
    const end = activeMention?.end ?? caret;
    const label = mentionLabel(member);
    const token = `@${label} `;
    const next = currentText.slice(0, start) + token + currentText.slice(end);
    setText(next);
    const rebased = rebaseMentions(currentText, next, draftMentions).filter(
      (mention) => mention.email.toLowerCase() !== member.email.toLowerCase(),
    );
    setDraftMentions([
      ...rebased,
      { label, email: member.email, start, end: start + label.length + 1 },
    ]);
    textRef.current = next;
    caretRef.current = start + token.length;
    activeMentionRef.current = null;
    setQuery(null);
    setMentionPosition(null);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const selected = Array.from(list);
    const unsupported = selected.find((file) => !isAllowedClientAttachment(file));
    if (unsupported) {
      setFileError(`Unsupported file type: ${unsupported.name}`);
      return;
    }
    const existingKeys = new Set(files.map((file) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`));
    const duplicate = selected.find((file) => {
      const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
      return existingKeys.has(key) || selected.some((other) => other !== file && `${other.name}\u0000${other.size}\u0000${other.lastModified}` === key);
    });
    if (duplicate) {
      setFileError(`That file is already attached: ${duplicate.name}`);
      return;
    }
    const limits = checkOperationLimits({
      textLength: text.length,
      sizes: [...files.map((file) => file.size), ...selected.map((file) => file.size)],
    });
    if (!limits.ok) {
      setFileError(limits.message);
      return;
    }
    setFileError(null);
    setFiles((cur) => [...cur, ...selected]);
  }

  function clearDraft() {
    textRef.current = "";
    setText("");
    setFiles([]);
    setFileError(null);
    setDraftMentions([]);
    setQuery(null);
    setMentionPosition(null);
    setHi(0);
    activeMentionRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  }

  function cancel() {
    clearDraft();
    if (onCancel) {
      onCancel();
    } else if (!alwaysOpen) {
      setExpanded(false);
    }
  }

  function submit() {
    const trimmed = text.trim();
    // A comment with only an attachment (no text) is valid.
    if (!trimmed && files.length === 0) return;
    const limits = checkOperationLimits({
      textLength: text.length,
      sizes: files.map((file) => file.size),
    });
    if (!limits.ok) {
      setFileError(limits.message);
      return;
    }

    const ok = onSubmit(
      encodeMentions({ text, mentions: draftMentions }).trim(),
      files,
    );
    if (ok) {
      clearDraft();
      if (onCancel) {
        onCancel();
      } else if (!alwaysOpen) {
        setExpanded(false);
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (query !== null) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setHi((i) =>
          moveEnabledChoiceIndex(
            matches.map((match) => ({ value: match.email, label: mentionLabel(match) })),
            i,
            e.key === "ArrowDown" ? 1 : -1,
          ),
        );
        return;
      }
      if (e.key === "Enter" && highlightedMatch) {
        e.preventDefault();
        pick(highlightedMatch);
        return;
      }
      if (e.key === "Tab") {
        setQuery(null);
        setMentionPosition(null);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        setMentionPosition(null);
        return;
      }
    }
    // Enter sends; Shift+Enter keeps the normal newline behavior.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  if (!expanded) {
    return (
      <div className="flex gap-3">
        <div className="shrink-0 pt-1">
          <Initials email={currentEmail} label={nameOf(currentEmail)} />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="min-h-11 flex-1 rounded border border-[#dfe1e6] bg-white px-4 text-left text-sm font-medium text-[#6b778c] shadow-[0_1px_1px_rgba(9,30,66,0.08)] transition hover:bg-[#fafbfc] hover:text-[#172b4d] focus:border-[#0c66e4] focus:outline-none focus:ring-2 focus:ring-[#85b8ff]"
        >
          {placeholder}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="shrink-0 pt-1">
        <Initials email={currentEmail} label={nameOf(currentEmail)} />
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_1px_rgba(9,30,66,0.08)] transition focus-within:border-[#0c66e4] focus-within:shadow-[0_0_0_1px_#0c66e4]">
        <textarea
          ref={taRef}
          value={text}
          role="combobox"
          aria-expanded={query !== null}
          aria-controls={query !== null ? listId : undefined}
          aria-activedescendant={
            query !== null && highlightedMatch
              ? mentionOptionId(listId, highlightedMatch.email)
              : undefined
          }
          onChange={(e) =>
            onChange(e.target.value, e.target.selectionStart, e.target)
          }
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className="block min-h-[2.25rem] w-full resize-y bg-white px-3 py-2 text-sm leading-5 text-[#172b4d] outline-none placeholder:text-[#7a869a]"
        />

        {query !== null && mentionPosition ? (
          <MentionPicker
            listId={listId}
            candidates={matches}
            activeIndex={hi}
            position={mentionPosition}
            onSelect={pick}
          />
        ) : null}

        {fileError ? (
          <div role="alert" className="border-t border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]">
            {fileError}
          </div>
        ) : null}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-[#ebecf0] px-3 py-2">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded border border-[#dfe1e6] bg-[#f7f8f9] px-2 py-1 text-xs font-medium text-[#42526e]"
              >
                {f.type.startsWith("image/") ? (
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#0c66e4]" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[#6b778c]" />
                )}
                <span className="min-w-0 truncate" title={`${f.name} · ${formatAttachmentSize(f.size)}`}>
                  {f.name} · {formatAttachmentSize(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFiles((cur) => cur.filter((_, idx) => idx !== i))
                  }
                  aria-label={`Remove ${f.name}`}
                  className="rounded text-[#6b778c] transition hover:bg-[#ebecf0] hover:text-[#bf2600]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[#ebecf0] bg-[#fafbfc] px-2 py-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ATTACHMENT_ALLOWED_MIME_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          {/* Icon-only: the bar is tight and the paperclip reads on its own. */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach files"
            title="Attach files"
            className="inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-semibold text-[#44546f] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            {/* An always-open box has nothing to collapse back to, so Cancel
                only appears once there is a draft — there it means "clear". */}
            {alwaysOpen && !text.trim() && files.length === 0 ? null : (
              <button
                type="button"
                onClick={cancel}
                className="h-7 rounded px-2 text-xs font-semibold text-[#44546f] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
              >
                {alwaysOpen ? "Clear" : "Cancel"}
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={submitting || (!text.trim() && files.length === 0)}
              className="inline-flex h-7 items-center gap-1.5 rounded bg-[#0c66e4] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" /> {submitting ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCommentTime(value: string, nowTick?: number) {
  // The tick is intentionally consumed by callers to refresh relative labels
  // without creating one timer per comment. The timestamp remains the source
  // of truth for the displayed value.
  void nowTick;
  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return value;

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatExactCommentTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
