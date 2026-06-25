"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";

type Attachment = {
  id: string;
  file_name: string;
  size_bytes: number | null;
  created_at: string;
  url: string;
};

export function AttachmentPanel({
  taskId,
  canEdit,
}: {
  taskId: string;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/attachments`);
    if (res.ok) setItems((await res.json()).attachments as Attachment[]);
  }, [taskId]);

  useEffect(() => {
    let isCurrent = true;

    void fetch(`/api/tasks/${taskId}/attachments`)
      .then((res) => (res.ok ? res.json() : { attachments: [] }))
      .then((data) => {
        if (isCurrent) {
          setItems(data.attachments as Attachment[]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [taskId]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
      if (res.ok) await load();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(aid: string) {
    const res = await fetch(`/api/tasks/${taskId}/attachments/${aid}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {items.map((a) => (
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
        {items.length === 0 && <li className="text-xs text-[#6b778c]">No attachments.</li>}
      </ul>
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
