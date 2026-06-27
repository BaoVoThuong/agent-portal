"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Paperclip, Reply, Send, X } from "lucide-react";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import type { CommentWithAttachments, SignedAttachment } from "@/lib/tasks/detail";
import { taskRoomTopic } from "@/lib/tasks/realtime-topics";

type Comment = CommentWithAttachments & {
  id: string;
  parent_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  attachments: SignedAttachment[];
};

const MENTION_TOKEN = /@\[([^\]]+)\]\(([^()\s]+@[^()\s]+)\)/g;
const isImage = (mime: string | null) => Boolean(mime && mime.startsWith("image/"));

export function CommentThread({
  taskId,
  currentEmail,
  members,
  comments,
  onReload,
}: {
  taskId: string;
  currentEmail: string;
  members: TaskAssignee[];
  comments: CommentWithAttachments[];
  onReload: () => Promise<void> | void;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);

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
    (email: string) => members.find((m) => m.email === email)?.name ?? email,
    [members]
  );

  async function post(body: string, files: File[], parentId: string | null) {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, parentId, hasAttachments: files.length > 0 }),
    });
    if (!res.ok) return false;
    const { comment } = (await res.json()) as { comment: { id: string } };
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      form.append("comment_id", comment.id);
      await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
    }
    setReplyTo(null);
    await onReload();
    return true;
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
    if (res.ok) await onReload();
  }

  const rows = comments as Comment[];
  const topLevel = rows.filter((c) => c.parent_id === null);
  const repliesOf = (id: string) => rows.filter((c) => c.parent_id === id);

  return (
    <div className="space-y-3">
      {topLevel.map((c) => (
        <div key={c.id} className="space-y-2">
          <CommentItem
            c={c}
            currentEmail={currentEmail}
            nameOf={nameOf}
            onDelete={remove}
            onReply={() => setReplyTo(c.id)}
          />
          <div className="ml-6 space-y-2 border-l border-[#ebecf0] pl-3">
            {repliesOf(c.id).map((rc) => (
              <CommentItem key={rc.id} c={rc} currentEmail={currentEmail} nameOf={nameOf} onDelete={remove} />
            ))}
            {replyTo === c.id && (
              <Composer members={members} onSubmit={(b, f) => post(b, f, c.id)} placeholder="Reply…" />
            )}
          </div>
        </div>
      ))}
      <Composer members={members} onSubmit={(b, f) => post(b, f, null)} placeholder="Write a comment…" />
    </div>
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
      </span>
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
  onReply,
}: {
  c: Comment;
  currentEmail: string;
  nameOf: (email: string) => string;
  onDelete: (id: string) => void;
  onReply?: () => void;
}) {
  if (c.deleted_at) {
    return <p className="text-xs italic text-[#97a0af]">comment deleted</p>;
  }
  return (
    <div className="rounded-lg bg-[#f4f5f7] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#172b4d]">{nameOf(c.author_email)}</span>
        <div className="flex items-center gap-2">
          {onReply && (
            <button type="button" onClick={onReply} className="text-[#97a0af] transition hover:text-[#42526e]" aria-label="Reply">
              <Reply className="h-3.5 w-3.5" />
            </button>
          )}
          {c.author_email === currentEmail && (
            <button type="button" onClick={() => onDelete(c.id)} className="text-xs font-medium text-[#bf2600] hover:underline">
              delete
            </button>
          )}
        </div>
      </div>
      {c.body && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-[#172b4d]">{renderBody(c.body)}</p>
      )}
      {c.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {c.attachments.map((a) =>
            isImage(a.mime_type) ? (
              <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt={a.file_name}
                  className="h-24 w-24 rounded border border-[#dfe1e6] object-cover"
                />
              </a>
            ) : (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded border border-[#dfe1e6] bg-white px-2 py-1 text-xs text-[#0c66e4] hover:underline"
              >
                <Paperclip className="h-3 w-3 shrink-0" /> {a.file_name}
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Composer({
  members,
  onSubmit,
  placeholder,
}: {
  members: TaskAssignee[];
  onSubmit: (body: string, files: File[]) => Promise<boolean>;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
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

  const matches =
    query === null
      ? []
      : members
          .filter((m) => {
            const q = query.toLowerCase();
            return (
              (m.name ?? "").toLowerCase().includes(q) ||
              m.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 6);

  function onChange(value: string, caret: number) {
    setText(value);
    const before = value.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    if (m) {
      setQuery(m[1]);
      setHi(0);
    } else {
      setQuery(null);
    }
  }

  function pick(member: TaskAssignee) {
    const el = taRef.current;
    const caret = el ? el.selectionStart : text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const m = before.match(/@([^\s@]*)$/);
    const start = m ? before.length - m[0].length : before.length;
    const token = `@[${member.name ?? member.email}](${member.email}) `;
    const next = text.slice(0, start) + token + after;
    setText(next);
    caretRef.current = start + token.length;
    setQuery(null);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((cur) => [...cur, ...Array.from(list)]);
  }

  async function submit() {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || sending) return;
    setSending(true);
    try {
      const ok = await onSubmit(trimmed, files);
      if (ok) {
        setText("");
        setFiles([]);
      }
    } finally {
      setSending(false);
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
        pick(matches[hi]);
        return;
      }
      if (e.key === "Escape") {
        setQuery(null);
        return;
      }
    }
    // Cmd/Ctrl+Enter sends.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="relative rounded-lg border border-[#dfe1e6] p-2 focus-within:border-[#0c66e4]">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
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
        rows={2}
        className="w-full resize-none bg-transparent text-sm text-[#172b4d] placeholder:text-[#7a869a] focus:outline-none"
      />

      {query !== null && matches.length > 0 && (
        <div className="absolute bottom-12 left-2 z-10 w-56 overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-[0_8px_24px_rgba(9,30,66,0.18)]">
          {matches.map((m, i) => (
            <button
              key={m.email}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm ${
                i === hi ? "bg-[#e9f2ff] text-[#0c66e4]" : "text-[#172b4d] hover:bg-[#f4f5f7]"
              }`}
            >
              {m.name ?? m.email}
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="flex items-center gap-1 rounded bg-[#f4f5f7] px-2 py-1 text-[11px] text-[#42526e]"
            >
              {f.type.startsWith("image/") ? "🖼" : "📎"} {f.name}
              <button
                type="button"
                onClick={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
                aria-label="Remove file"
                className="text-[#97a0af] hover:text-[#bf2600]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
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
          className="flex items-center gap-1 text-xs font-medium text-[#6b778c] transition hover:text-[#42526e]"
        >
          <Paperclip className="h-3.5 w-3.5" /> Attach
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={(!text.trim() && files.length === 0) || sending}
          className="flex items-center gap-1 rounded bg-[#0c66e4] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#0055cc] disabled:opacity-40"
        >
          <Send className="h-3 w-3" /> {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
