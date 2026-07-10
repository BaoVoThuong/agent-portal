"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";

// Generic "type a reason to proceed" dialog — used both for reopening an
// overdue task and for reopening a Done/Cancel task. Both actions are audited
// because they return closed/blocked work back to To Do.
export function ReasonModal({
  open,
  title,
  description,
  placeholder = "Reason...",
  submitLabel = "Submit",
  accentColor = "#0c66e4",
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  placeholder?: string;
  submitLabel?: string;
  accentColor?: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  function handleClose() {
    if (submitting) return;
    setReason("");
    onClose();
  }

  async function handleSubmit() {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    const ok = await onSubmit(reason.trim());
    setSubmitting(false);
    if (ok) setReason("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded bg-white p-5 shadow-[0_12px_32px_rgba(9,30,66,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#172b4d]">{title}</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded p-1 text-[#626f86] hover:bg-[#f4f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-[#626f86]">{description}</p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          autoFocus
          placeholder={placeholder}
          className="mt-3 w-full rounded border-2 border-[#dfe1e6] p-2 text-sm outline-none focus:border-[#0c66e4]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded px-3 py-1.5 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!reason.trim() || submitting}
            style={{ backgroundColor: accentColor }}
            className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
