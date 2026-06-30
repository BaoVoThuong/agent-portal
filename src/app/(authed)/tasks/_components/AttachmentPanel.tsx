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
  canEdit,
  onReload,
}: {
  attachments: SignedAttachment[];
  taskId: string;
  canEdit: boolean;
  onReload: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
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
    const res = await fetch(`/api/tasks/${taskId}/attachments/${aid}`, { method: "DELETE" });
    if (res.ok) await onReload();
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-sm">
            <Paperclip className="h-3.5 w-3.5 text-[#97a0af]" />
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-[#0c66e4] hover:underline">
              {a.file_name}
            </a>
            {canEdit && (
              <button type="button" onClick={() => remove(a.id)} aria-label="Delete attachment" className="text-[#97a0af] transition hover:text-[#bf2600]">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
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
