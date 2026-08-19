"use client";

import { ExternalLink, Paperclip } from "lucide-react";
import type { SignedAttachment } from "@/lib/tasks/detail";

export function AttachmentStrip({ attachments }: { attachments: SignedAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="shrink-0 space-y-1">
      <span className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">
        Attachments ({attachments.length})
      </span>
      <ul className="flex max-h-[58px] flex-wrap gap-1.5 overflow-y-auto">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="max-w-[16rem]">
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
