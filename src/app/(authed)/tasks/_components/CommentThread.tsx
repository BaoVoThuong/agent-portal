"use client";

import { useEffect, useState, useCallback } from "react";
import { AtSign, Reply } from "lucide-react";
import type { TaskAssignee } from "@/lib/tasks/assignees";

type Comment = {
  id: string;
  parent_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

export function CommentThread({
  taskId,
  currentEmail,
}: {
  taskId: string;
  currentEmail: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<TaskAssignee[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/comments`);
    if (res.ok) setComments((await res.json()).comments as Comment[]);
  }, [taskId]);

  useEffect(() => {
    let isCurrent = true;

    void fetch(`/api/tasks/${taskId}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => {
        if (isCurrent) {
          setComments(d.comments as Comment[]);
        }
      });
    void fetch("/api/tasks/members")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => {
        if (isCurrent) {
          setMembers(d.members as TaskAssignee[]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [taskId]);

  async function post(body: string, mentions: string[], parentId: string | null) {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, mentions, parentId }),
    });
    if (res.ok) {
      setReplyTo(null);
      await load();
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tasks/${taskId}/comments/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  const topLevel = comments.filter((c) => c.parent_id === null);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  return (
    <div className="space-y-3">
      {topLevel.map((c) => (
        <div key={c.id} className="space-y-2">
          <CommentItem c={c} currentEmail={currentEmail} onDelete={remove} onReply={() => setReplyTo(c.id)} />
          <div className="ml-6 space-y-2 border-l border-[#ebecf0] pl-3">
            {repliesOf(c.id).map((rc) => (
              <CommentItem key={rc.id} c={rc} currentEmail={currentEmail} onDelete={remove} />
            ))}
            {replyTo === c.id && (
              <Composer members={members} onSubmit={(b, m) => post(b, m, c.id)} placeholder="Reply…" />
            )}
          </div>
        </div>
      ))}
      <Composer members={members} onSubmit={(b, m) => post(b, m, null)} placeholder="Write a comment…" />
    </div>
  );
}

function CommentItem({
  c,
  currentEmail,
  onDelete,
  onReply,
}: {
  c: Comment;
  currentEmail: string;
  onDelete: (id: string) => void;
  onReply?: () => void;
}) {
  if (c.deleted_at) {
    return <p className="text-xs italic text-[#97a0af]">comment deleted</p>;
  }
  return (
    <div className="rounded-lg bg-[#f4f5f7] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#172b4d]">{c.author_email}</span>
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
      <p className="mt-1 whitespace-pre-wrap text-sm text-[#172b4d]">{c.body}</p>
    </div>
  );
}

function Composer({
  members,
  onSubmit,
  placeholder,
}: {
  members: TaskAssignee[];
  onSubmit: (body: string, mentions: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  function addMention(m: TaskAssignee) {
    if (!mentions.includes(m.email)) {
      setMentions((cur) => [...cur, m.email]);
      setText((t) => `${t}@${m.name ?? m.email} `);
    }
    setPickerOpen(false);
  }

  function submit() {
    if (!text.trim()) return;
    onSubmit(text.trim(), mentions);
    setText("");
    setMentions([]);
  }

  return (
    <div className="rounded-lg border border-[#dfe1e6] p-2 focus-within:border-[#0c66e4]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent text-sm text-[#172b4d] placeholder:text-[#7a869a] focus:outline-none"
      />
      {mentions.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span key={m} className="rounded bg-[#deebff] px-1.5 py-0.5 text-[10px] font-medium text-[#0c66e4]">@{m}</span>
          ))}
        </div>
      )}
      <div className="relative flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          className="flex items-center gap-1 text-xs font-medium text-[#6b778c] transition hover:text-[#42526e]"
        >
          <AtSign className="h-3.5 w-3.5" /> Mention
        </button>
        {pickerOpen && (
          <div className="absolute bottom-7 left-0 z-10 max-h-40 w-56 overflow-y-auto rounded-lg border border-[#dfe1e6] bg-white shadow-[0_8px_24px_rgba(9,30,66,0.18)]">
            {members.map((m) => (
              <button
                key={m.email}
                type="button"
                onClick={() => addMention(m)}
                className="block w-full px-3 py-1.5 text-left text-sm text-[#172b4d] hover:bg-[#f4f5f7]"
              >
                {m.name ?? m.email}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="rounded bg-[#0c66e4] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#0055cc] disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
