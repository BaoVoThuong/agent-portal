"use client";

import { ExternalLink, Paperclip } from "lucide-react";
import type { SignedAttachment } from "@/lib/tasks/detail";

export function AttachmentStrip({ attachments }: { attachments: SignedAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    // One row, label inline, chips scrolling sideways. A wrapping two-row strip
    // cost 78px of a fixed 760px column, and every pixel here is taken from the
    // comment thread — the only flex-1 child below it.
    <div className="flex shrink-0 items-center gap-2">
      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        Files ({attachments.length})
      </span>
      <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="max-w-[16rem] shrink-0">
            {attachment.unavailable || !attachment.url ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded bg-[#f4f5f7] px-2 py-1 text-xs text-[#7a869a]" title={attachment.file_name}>
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{attachment.file_name}</span>
              </span>
            ) : (
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded bg-[#e9f2ff] px-2 py-1 text-xs font-semibold text-[#0c66e4] hover:bg-[#deebff]"
                title={attachment.file_name}
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{attachment.file_name}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
