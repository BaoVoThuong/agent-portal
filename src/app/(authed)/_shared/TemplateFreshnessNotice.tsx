"use client";

import { AlertTriangle } from "lucide-react";
import type { TemplateFreshness } from "@/lib/import-template/spec";

/**
 * Cảnh báo file Import được điền trên một template cũ (hoặc của bảng khác).
 * Không chặn Import: preview vẫn cho thấy dòng nào bị bỏ và vì sao.
 */
export function TemplateFreshnessNotice({
  freshness,
  onDownload,
}: {
  freshness: TemplateFreshness | null;
  onDownload: () => void;
}) {
  if (!freshness || (freshness.status !== "outdated" && freshness.status !== "other")) {
    return null;
  }
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg border border-[#ffe2bd] bg-[#fffaf0] px-3 py-2 text-xs font-semibold text-[#974f0c]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {freshness.status === "outdated"
          ? "This file was made from an older template — columns or dropdown values have changed since. "
          : "This file is a template for a different table. "}
        <button
          type="button"
          onClick={onDownload}
          className="font-bold text-[#0c66e4] underline-offset-2 hover:underline"
        >
          Download the current template
        </button>{" "}
        and copy your rows into it.
      </span>
    </p>
  );
}
