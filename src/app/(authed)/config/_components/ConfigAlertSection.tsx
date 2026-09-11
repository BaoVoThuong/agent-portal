"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { LeadAlertSettings, LeadProduct } from "@/lib/leads/types";

/**
 * Ngưỡng để một lead bị gọi tên là "cần quản lý để mắt tới".
 *
 * Chuyển từ /settings sang đây ngày 2026-09-11. Settings là trang CÁ NHÂN —
 * đổi tên, đổi mật khẩu, bật thông báo cho máy mình — còn ba con số này là chính
 * sách áp cho cả công ty, nên nằm cạnh các cấu hình toàn cục khác thì đúng chỗ
 * hơn và dễ tìm hơn.
 *
 * Chỉ hiện ở bảng Event Leads; API vẫn tự gác quyền `lead.manage`.
 */

type AlertField = "no_contact_hours" | "stale_days" | "max_attempts";

const PRODUCT_LABEL: Record<LeadProduct, string> = {
  pc: "P&C",
  health: "Health",
};

const FIELDS: { key: AlertField; label: string; hint: string }[] = [
  {
    key: "no_contact_hours",
    label: "No-contact window (hours)",
    hint: "Report red if a lead is assigned this long without a contact.",
  },
  {
    key: "stale_days",
    label: "Stale window (days)",
    hint: "Report red when a contacted lead has been quiet this long.",
  },
  {
    key: "max_attempts",
    label: "Maximum attempts",
    hint: "Report amber after this many contact attempts.",
  },
];

export default function ConfigAlertSection({
  settings,
  onSettingsChange,
  available,
  availabilityError,
}: {
  settings: LeadAlertSettings[];
  onSettingsChange: (next: LeadAlertSettings[]) => void;
  available: boolean;
  availabilityError?: string;
}) {
  const [saving, setSaving] = useState<LeadProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function updateField(product: LeadProduct, key: AlertField, value: string) {
    const parsed = Number(value);
    onSettingsChange(
      settings.map((row) =>
        row.product === product
          ? { ...row, [key]: Number.isFinite(parsed) ? parsed : 0 }
          : row
      )
    );
  }

  async function save(product: LeadProduct) {
    const setting = settings.find((row) => row.product === product);
    if (!setting || saving) return;
    setSaving(product);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/leads/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setting),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Unable to update alert settings.");
      if (payload?.setting) {
        onSettingsChange(
          settings.map((row) =>
            row.product === product ? (payload.setting as LeadAlertSettings) : row
          )
        );
      }
      setMessage(`${PRODUCT_LABEL[product]} alert settings updated.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update alert settings.");
    } finally {
      setSaving(null);
    }
  }

  if (!available) {
    return (
      <div className="rounded-lg border border-[#e6eaf0] bg-[#fffaf5] px-4 py-3 text-sm text-[#8a5a12]">
        {availabilityError ?? "Alert settings are unavailable."}
      </div>
    );
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[#172b4d]">Alert settings</h2>
        <p className="mt-1 text-sm text-[#6b778c]">
          Set when an active lead should be called out for manager attention.
          These thresholds apply company-wide, and are set per product.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {(["pc", "health"] as const).map((product) => {
          const setting = settings.find((row) => row.product === product);
          if (!setting) return null;
          return (
            <div
              key={product}
              className="rounded-lg border border-[#e6eaf0] bg-[#f7f8fa] p-4"
            >
              <h3 className="font-semibold text-[#172b4d]">{PRODUCT_LABEL[product]}</h3>
              <div className="mt-4 grid gap-4">
                {FIELDS.map((field) => (
                  <label key={field.key} className="block">
                    <span className="text-xs font-bold text-[#6b778c]">{field.label}</span>
                    <input
                      className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm"
                      type="number"
                      min={1}
                      step={1}
                      value={setting[field.key]}
                      onChange={(event) => updateField(product, field.key, event.target.value)}
                    />
                    <span className="mt-1 block text-xs text-[#6b778c]">{field.hint}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-md bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={saving !== null}
                  onClick={() => void save(product)}
                >
                  {saving === product ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {saving === product ? "Saving…" : "Save alert settings"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          {message}
        </p>
      ) : null}
    </section>
  );
}
