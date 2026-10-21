"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import type { SignedAttachment } from "@/lib/tasks/detail";
import {
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
} from "@/lib/tasks/attachments";

export function AttachmentPanel({
  attachments,
  taskId,
  apiBase = "/api/tasks",
  canEdit,
  onReload,
  mutationSourceId,
  mutationSourceHeader,
}: {
  attachments: SignedAttachment[];
  taskId: string;
  apiBase?: string;
  canEdit: boolean;
  onReload: () => Promise<void> | void;
  mutationSourceId?: string;
  mutationSourceHeader?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
      setError(attachmentTooLargeMessage());
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("client_request_id", crypto.randomUUID());
      const res = await fetch(`${apiBase}/${taskId}/attachments`, {
        method: "POST",
        headers: mutationSourceId && mutationSourceHeader
          ? { [mutationSourceHeader]: mutationSourceId }
          : undefined,
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Could not upload attachment.");
        return;
      }
      await onReload();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload attachment."
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(aid: string) {
    if (deletingId) return;
    setDeleteErrors((current) => {
      if (!current[aid]) return current;
      const next = { ...current };
      delete next[aid];
      return next;
    });
    setDeletingId(aid);
    try {
      const res = await fetch(`${apiBase}/${taskId}/attachments/${aid}`, {
        method: "DELETE",
        headers: mutationSourceId && mutationSourceHeader
          ? { [mutationSourceHeader]: mutationSourceId }
          : undefined,
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "Could not delete attachment.");
      }
      try {
        await onReload();
      } catch {
        setDeleteErrors((current) => ({
          ...current,
          [aid]: "Attachment deleted, but the list could not refresh. Please retry loading the details.",
        }));
      }
    } catch (deleteError) {
      setDeleteErrors((current) => ({
        ...current,
        [aid]: deleteError instanceof Error ? deleteError.message : "Could not delete attachment.",
      }));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {attachments.map((a) => (
          <li key={a.id} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Paperclip className="h-3.5 w-3.5 text-[#97a0af]" />
              {a.unavailable || !a.url ? (
                <span title="This file may have been removed or is temporarily unavailable" className="flex-1 truncate text-[#8993a4]">{a.file_name} · File unavailable</span>
              ) : (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-[#0c66e4] hover:underline">{a.file_name}</a>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void remove(a.id)}
                  disabled={deletingId !== null}
                  aria-label={`Delete ${a.file_name}`}
                  aria-busy={deletingId === a.id}
                  className="text-[#97a0af] transition hover:text-[#bf2600] disabled:cursor-wait disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {deleteErrors[a.id] ? (
              <div role="alert" className="pl-5 text-xs font-semibold text-[#bf2600]">
                {deleteErrors[a.id]}
              </div>
            ) : null}
          </li>
        ))}
        {attachments.length === 0 && <li className="text-xs text-[#6b778c]">No attachments.</li>}
      </ul>
      {error ? (
        <div className="rounded border border-[#ffbdad] bg-[#ffebe6] px-2.5 py-2 text-xs font-semibold text-[#bf2600]">
          {error}
        </div>
      ) : null}
      {canEdit && (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1 rounded border border-[#dfe1e6] px-2.5 py-1 text-xs font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:opacity-40"
          >
            <Paperclip className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Attach file"}
          </button>
        </div>
      )}
    </div>
  );
}
