"use client";

import {
  useCallback,
  useEffect,
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
import { formatEmailAsName } from "@/lib/tasks/people";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import type {
  CommentWithAttachments,
  SignedAttachment,
} from "@/lib/tasks/detail";
import {
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
} from "@/lib/tasks/attachments";
import { taskRoomTopic } from "@/lib/tasks/realtime-topics";
import { Initials } from "./board-ui";
import { useAnchoredMenu } from "./use-anchored-menu";

type Comment = CommentWithAttachments & {
  id: string;
  parent_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  attachments: SignedAttachment[];
  optimistic?: boolean;
  failed?: boolean;
  error?: string;
};

type DraftMention = {
  label: string;
  email: string;
};

type ActiveMention = {
  query: string;
  start: number;
  end: number;
};

type MentionMenuPosition = {
  top: number;
  left: number;
};

type ImagePreview = {
  url: string;
  fileName: string;
};

const MENTION_TOKEN = /@\[([^\]]+)\]\(([^()\s]+@[^()\s]+)\)/g;
const MENTION_MENU_WIDTH = 288;
const isImage = (mime: string | null) =>
  Boolean(mime && mime.startsWith("image/"));

async function readResponseError(
  response: Response,
  fallback: string
): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return data?.error ?? fallback;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function mentionLabel(member: TaskAssignee) {
  return member.name ?? member.email;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findActiveMention(value: string, caret: number): ActiveMention | null {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;

  const tokenLength = match[0].length - match[1].length;
  return {
    query: match[2],
    start: beforeCaret.length - tokenLength,
    end: caret,
  };
}

function measureTextareaCaret(
  textarea: HTMLTextAreaElement,
  caret: number,
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

  return {
    top: Math.max(34, markerTop + markerHeight + 6),
    left: Math.min(
      Math.max(12, markerLeft),
      Math.max(12, textarea.clientWidth - MENTION_MENU_WIDTH - 12),
    ),
  };
}

function encodeDraftMentions(body: string, mentions: DraftMention[]) {
  const uniqueMentions = [
    ...new Map(mentions.map((mention) => [mention.email, mention])).values(),
  ].sort((a, b) => b.label.length - a.label.length);

  return uniqueMentions.reduce((nextBody, mention) => {
    const label = mention.label.trim();
    if (!label) return nextBody;

    const pattern = new RegExp(
      `(^|\\s)@${escapeRegExp(label)}(?=\\s|$|[.,!?;:])`,
      "g",
    );
    return nextBody.replace(
      pattern,
      (_, prefix: string) => `${prefix}@[${label}](${mention.email})`,
    );
  }, body);
}

function decodeStoredMentions(body: string): {
  text: string;
  mentions: DraftMention[];
} {
  const mentions: DraftMention[] = [];
  const text = body.replace(
    MENTION_TOKEN,
    (_, label: string, email: string) => {
      mentions.push({ label, email });
      return `@${label}`;
    },
  );

  return { text, mentions };
}

export function CommentThread({
  taskId,
  currentEmail,
  members,
  comments,
  highlightCommentId,
  onReload,
}: {
  taskId: string;
  currentEmail: string;
  members: TaskAssignee[];
  comments: CommentWithAttachments[];
  highlightCommentId?: string | null;
  onReload: () => Promise<void> | void;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [optimisticComments, setOptimisticComments] = useState<Comment[]>([]);
  const rootRef = useRef<HTMLElement | null>(null);
  const optimisticUrlsRef = useRef(new Map<string, string[]>());
  const optimisticCounterRef = useRef(0);

  useEffect(
    () => () => {
      for (const urls of optimisticUrlsRef.current.values()) {
        for (const url of urls) URL.revokeObjectURL(url);
      }
      optimisticUrlsRef.current.clear();
    },
    [],
  );

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
      .channel(taskRoomTopic(taskId))
      .on("broadcast", { event: "changed" }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [taskId, onReload]);

  const nameOf = useCallback(
    (email: string) =>
      members.find((m) => m.email === email)?.name ?? formatEmailAsName(email),
    [members],
  );

  function releaseOptimistic(id: string) {
    const urls = optimisticUrlsRef.current.get(id) ?? [];
    for (const url of urls) URL.revokeObjectURL(url);
    optimisticUrlsRef.current.delete(id);
    setOptimisticComments((current) =>
      current.filter((comment) => comment.id !== id),
    );
  }

  function post(body: string, files: File[], parentId: string | null) {
    const tempId = `optimistic-${taskId}-${optimisticCounterRef.current++}`;
    const urls: string[] = [];
    const attachments = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      urls.push(url);
      return {
        id: `${tempId}-file-${index}`,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        url,
      };
    });
    optimisticUrlsRef.current.set(tempId, urls);
    setOptimisticComments((current) => [
      ...current,
      {
        id: tempId,
        parent_id: parentId,
        author_email: currentEmail,
        body,
        created_at: new Date().toISOString(),
        deleted_at: null,
        attachments,
        optimistic: true,
      },
    ]);
    setReplyTo(null);

    void persistComment(tempId, body, files, parentId);
    return true;
  }

  async function persistComment(
    tempId: string,
    body: string,
    files: File[],
    parentId: string | null,
  ) {
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          parentId,
          hasAttachments: files.length > 0,
        }),
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to create comment."));
      }

      const { comment } = (await res.json()) as { comment: { id: string } };
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("comment_id", comment.id);
        const upload = await fetch(`/api/tasks/${taskId}/attachments`, {
          method: "POST",
          body: form,
        });
        if (!upload.ok) {
          throw new Error(
            await readResponseError(upload, "Failed to upload attachment.")
          );
        }
      }

      await onReload();
      releaseOptimistic(tempId);
    } catch (error) {
      const message = getErrorMessage(error, "Failed to send comment.");
      setOptimisticComments((current) =>
        current.map((comment) =>
          comment.id === tempId
            ? { ...comment, failed: true, error: message }
            : comment,
        ),
      );
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tasks/${taskId}/comments/${id}`, {
      method: "DELETE",
    });
    if (res.ok) await onReload();
  }

  async function edit(id: string, body: string) {
    const res = await fetch(`/api/tasks/${taskId}/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) return false;
    await onReload();
    return true;
  }

  const rows = [...(comments as Comment[]), ...optimisticComments];
  const timestampOf = (comment: Comment) =>
    new Date(comment.created_at).getTime() || 0;
  const repliesOf = (id: string) =>
    rows
      .filter((c) => c.parent_id === id)
      .sort((a, b) => timestampOf(a) - timestampOf(b));
  const topLevel = rows
    .filter((c) => c.parent_id === null)
    .sort((a, b) => timestampOf(a) - timestampOf(b));
  const rowSignature = rows.map((comment) => comment.id).join("|");

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
      <section ref={rootRef} className="space-y-3">
        <div className="border-b border-[#dfe1e6] pb-3">
          <Composer
            currentEmail={currentEmail}
            members={members}
            nameOf={nameOf}
            onSubmit={(b, f) => post(b, f, null)}
            placeholder="Add a comment..."
          />
        </div>

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
                  currentEmail={currentEmail}
                  nameOf={nameOf}
                  onDelete={c.optimistic ? releaseOptimistic : remove}
                  onEdit={edit}
                  onPreviewImage={setImagePreview}
                  onReply={c.optimistic ? undefined : () => setReplyTo(c.id)}
                />
                <div className="ml-5 space-y-2 border-l-2 border-[#dfe1e6] pl-4">
                  {repliesOf(c.id).map((rc) => (
                    <div key={rc.id} data-comment-id={rc.id}>
                      <CommentItem
                        c={rc}
                        currentEmail={currentEmail}
                        nameOf={nameOf}
                        onDelete={rc.optimistic ? releaseOptimistic : remove}
                        onEdit={edit}
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
                      onSubmit={(b, f) => post(b, f, c.id)}
                      placeholder="Reply..."
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {imagePreview
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-[#091e42]/80 p-4 sm:p-6"
              onClick={() => setImagePreview(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={imagePreview.fileName}
                className="relative flex max-h-full max-w-5xl flex-col overflow-hidden rounded-lg bg-[#0b1220] shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-white">
                  <span className="min-w-0 truncate text-sm font-semibold">
                    {imagePreview.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setImagePreview(null)}
                    aria-label="Close preview"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/80 transition hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview.url}
                  alt={imagePreview.fileName}
                  className="max-h-[calc(100vh-8rem)] max-w-full object-contain"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function renderBody(body: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of body.matchAll(MENTION_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(body.slice(last, idx));
    nodes.push(
      <span
        key={`m${key++}`}
        className="rounded bg-[#deebff] px-1 font-medium text-[#0c66e4]"
      >
        @{m[1]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < body.length) nodes.push(body.slice(last));
  return nodes;
}

function CommentItem({
  c,
  currentEmail,
  nameOf,
  onDelete,
  onEdit,
  onPreviewImage,
  onReply,
}: {
  c: Comment;
  currentEmail: string;
  nameOf: (email: string) => string;
  onDelete: (id: string) => Promise<void> | void;
  onEdit: (id: string, body: string) => Promise<boolean>;
  onPreviewImage: (preview: ImagePreview) => void;
  onReply?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const { isOpen, setIsOpen, toggle, triggerRef, menuRef, menuStyle } =
    useAnchoredMenu();
  const canReply = Boolean(onReply && !c.optimistic);
  const canEdit = c.author_email === currentEmail && !c.optimistic && !c.failed;
  const canDelete =
    c.author_email === currentEmail && (!c.optimistic || c.failed);
  const hasMenu = canEdit || canDelete;

  if (c.deleted_at) {
    return (
      <div className="flex gap-2.5">
        <Initials email={c.author_email} label={nameOf(c.author_email)} />
        <p className="pt-1 text-xs italic text-[#97a0af]">comment deleted</p>
      </div>
    );
  }

  return (
    <article className="group flex gap-2.5">
      <div className="shrink-0 pt-0.5">
        <Initials email={c.author_email} label={nameOf(c.author_email)} />
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-[#172b4d]">
              {nameOf(c.author_email)}
            </span>
            <span
              className="text-xs font-medium text-[#6b778c]"
              title={formatExactCommentTime(c.created_at)}
            >
              {formatCommentTime(c.created_at)}
            </span>
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
              onCancel={() => setIsEditing(false)}
              onSave={(body) => onEdit(c.id, body)}
            />
          ) : (
            <>
              <div className="mt-0.5 text-sm leading-5 text-[#172b4d]">
                {c.body ? (
                  <p className="whitespace-pre-wrap">{renderBody(c.body)}</p>
                ) : null}
              </div>

              {c.attachments.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {c.attachments.map((a) =>
                    isImage(a.mime_type) ? (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          onPreviewImage({
                            url: a.url,
                            fileName: a.file_name,
                          })
                        }
                        className="group/image block overflow-hidden rounded border border-[#dfe1e6] bg-[#f7f8f9] text-left transition hover:border-[#85b8ff] focus:border-[#0c66e4] focus:outline-none focus:ring-2 focus:ring-[#85b8ff]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={a.url}
                          alt={a.file_name}
                          className="h-24 w-24 object-cover transition group-hover/image:scale-[1.02]"
                        />
                      </button>
                    ) : (
                      <AttachmentLink key={a.id} attachment={a} />
                    ),
                  )}
                </div>
              )}

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
                          void onDelete(c.id);
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
      </div>
    </article>
  );
}

function EditCommentForm({
  initialBody,
  onCancel,
  onSave,
}: {
  initialBody: string;
  onCancel: () => void;
  onSave: (body: string) => Promise<boolean>;
}) {
  const [decodedInitialBody] = useState(() =>
    decodeStoredMentions(initialBody),
  );
  const [body, setBody] = useState(decodedInitialBody.text);
  const [saving, setSaving] = useState(false);
  const trimmed = body.trim();
  const encodedBody = encodeDraftMentions(trimmed, decodedInitialBody.mentions);
  const unchanged = encodedBody === initialBody.trim();

  async function save() {
    if (!trimmed || saving) return;
    if (unchanged) {
      onCancel();
      return;
    }

    setSaving(true);
    try {
      const ok = await onSave(encodedBody);
      if (ok) onCancel();
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        className="block min-h-[4.5rem] w-full resize-y bg-white px-3 py-2 text-sm leading-5 text-[#172b4d] outline-none"
      />
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
  currentEmail,
  members,
  nameOf,
  onCancel,
  onSubmit,
  placeholder,
}: {
  initiallyExpanded?: boolean;
  currentEmail: string;
  members: TaskAssignee[];
  nameOf: (email: string) => string;
  onCancel?: () => void;
  onSubmit: (body: string, files: File[]) => boolean;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [mentionPosition, setMentionPosition] =
    useState<MentionMenuPosition | null>(null);
  const [hi, setHi] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const activeMentionRef = useRef<ActiveMention | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (!expanded) return;
    const frame = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  const matches =
    query === null
      ? []
      : [...members]
          .filter((m) => {
            const q = query.trim().toLowerCase();
            return (
              mentionLabel(m).toLowerCase().includes(q) ||
              m.email.toLowerCase().includes(q)
            );
          })
          .sort((a, b) => {
            const q = query.trim().toLowerCase();
            const aLabel = mentionLabel(a).toLowerCase();
            const bLabel = mentionLabel(b).toLowerCase();
            const aStarts = aLabel.startsWith(q) || a.email.toLowerCase().startsWith(q);
            const bStarts = bLabel.startsWith(q) || b.email.toLowerCase().startsWith(q);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return mentionLabel(a).localeCompare(mentionLabel(b));
          });
  const highlightedMatch = matches[hi] ?? matches[0];

  function onChange(
    value: string,
    caret: number,
    textarea: HTMLTextAreaElement,
  ) {
    setText(value);
    const activeMention = findActiveMention(value, caret);
    activeMentionRef.current = activeMention;
    if (activeMention) {
      setQuery(activeMention.query);
      setMentionPosition(measureTextareaCaret(textarea, caret));
      setHi(0);
    } else {
      setQuery(null);
      setMentionPosition(null);
    }
  }

  function pick(member: TaskAssignee) {
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
    setDraftMentions((current) => [
      ...current.filter((mention) => mention.email !== member.email),
      { label, email: member.email },
    ]);
    caretRef.current = start + token.length;
    activeMentionRef.current = null;
    setQuery(null);
    setMentionPosition(null);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const selected = Array.from(list);
    const accepted = selected.filter((file) => file.size <= TASK_ATTACHMENT_MAX_BYTES);
    const rejected = selected.find((file) => file.size > TASK_ATTACHMENT_MAX_BYTES);

    setFileError(
      rejected ? `${rejected.name}: ${attachmentTooLargeMessage()}` : null
    );
    if (accepted.length > 0) setFiles((cur) => [...cur, ...accepted]);
  }

  function clearDraft() {
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
    } else {
      setExpanded(false);
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;

    const ok = onSubmit(encodeDraftMentions(trimmed, draftMentions), files);
    if (ok) {
      clearDraft();
      if (onCancel) {
        onCancel();
      } else {
        setExpanded(false);
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (query !== null && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHi((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHi((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (highlightedMatch) pick(highlightedMatch);
        return;
      }
      if (e.key === "Escape") {
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
          onChange={(e) =>
            onChange(e.target.value, e.target.selectionStart, e.target)
          }
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (e.clipboardData.files.length > 0) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onDrop={(e) => {
            if (e.dataTransfer.files.length > 0) {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }
          }}
          placeholder={placeholder}
          rows={3}
          className="block min-h-[5.5rem] w-full resize-y bg-white px-3 py-3 text-sm leading-6 text-[#172b4d] outline-none placeholder:text-[#7a869a]"
        />

        {query !== null && matches.length > 0 && (
          <div
            style={{
              top: mentionPosition?.top ?? 42,
              left: mentionPosition?.left ?? 12,
            }}
            className="absolute z-20 max-h-56 w-72 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded border border-[#dfe1e6] bg-white py-1 shadow-[0_8px_24px_rgba(9,30,66,0.18)]"
          >
            {matches.map((m, i) => (
              <button
                key={m.email}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  i === hi
                    ? "bg-[#e9f2ff] text-[#0c66e4]"
                    : "text-[#172b4d] hover:bg-[#f4f5f7]"
                }`}
              >
                <Initials email={m.email} label={m.name ?? m.email} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {mentionLabel(m)}
                </span>
              </button>
            ))}
          </div>
        )}

        {fileError ? (
          <div className="border-t border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]">
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
                <span className="min-w-0 truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setFiles((cur) => cur.filter((_, idx) => idx !== i))
                  }
                  aria-label="Remove file"
                  className="rounded text-[#6b778c] transition hover:bg-[#ebecf0] hover:text-[#bf2600]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[#ebecf0] bg-[#fafbfc] px-3 py-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-semibold text-[#44546f] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
          >
            <Paperclip className="h-4 w-4" /> Attach
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancel}
              className="h-8 rounded px-2 text-xs font-semibold text-[#44546f] transition hover:bg-[#ebecf0] hover:text-[#172b4d]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() && files.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0c66e4] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" /> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentLink({ attachment }: { attachment: SignedAttachment }) {
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-[#dfe1e6] bg-[#fafbfc] px-2 py-1 text-xs font-medium text-[#0c66e4] transition hover:bg-[#e9f2ff] hover:underline"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{attachment.file_name}</span>
    </a>
  );
}

function formatCommentTime(value: string) {
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
