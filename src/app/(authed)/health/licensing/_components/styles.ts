// Class dùng chung của trang, chép từ các màn hình có sẵn để cùng một kiểu:
// dialog = AddProviderDialog, nhãn/ô nhập = ProviderFormFields, bảng =
// ProviderTable, công tắc Map | Table = ProviderToolbar.
import type { LicensingStatus } from "@/lib/health-licensing/types";

export const SCRIM = "fixed inset-0 z-[180] flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6 max-md:p-0";
export const DIALOG =
  "flex max-h-[calc(100dvh-3rem)] w-full flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)] max-md:h-full max-md:max-h-none max-md:rounded-none";
export const DIALOG_HEAD = "flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4 max-md:px-4";
export const DIALOG_TITLE = "min-w-0 truncate text-xl font-semibold text-[#172b4d]";
export const DIALOG_CLOSE =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]";
export const DIALOG_BODY = "min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5 max-md:px-4";
export const DIALOG_FOOT = "flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4 max-md:px-4";
export const CANCEL_BUTTON =
  "inline-flex h-9 items-center rounded px-4 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7] max-md:h-11";
export const SAVE_BUTTON =
  "inline-flex h-9 items-center rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40 max-md:h-11";
export const DANGER_BUTTON =
  "inline-flex h-9 items-center rounded bg-[#c9372c] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#ae2e24] disabled:opacity-40 max-md:h-11";
export const ERROR_BOX = "rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-semibold text-[#bf2600]";

export const LABEL = "mb-1 block text-xs font-bold uppercase tracking-wide text-[#6b778c]";
export const INPUT =
  "h-9 w-full rounded border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4] max-md:h-11";
export const TEXTAREA =
  "min-h-[72px] w-full rounded border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]";
export const FILTER_SELECT =
  "h-9 shrink-0 rounded-lg border border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d] outline-none focus:border-[#0c66e4] max-md:h-11 max-md:w-full";
export const ICON_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d] disabled:opacity-30 max-md:h-11 max-md:w-11";

export const SEG_ON = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition bg-white text-[#0c66e4] shadow-sm";
export const SEG_OFF = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition text-[#5e6c84] hover:text-[#172b4d]";
export const COUNT_ON = "rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums bg-[#e9f2ff] text-[#0c66e4]";
export const COUNT_OFF = "rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums bg-[#dfe1e6] text-[#44546f]";

export const CARD = "rounded-lg border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]";
export const TH =
  "sticky top-0 z-20 whitespace-nowrap border-b border-[#dfe1e6] bg-[#fafbfc] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]";
export const TD = "border-b border-[#ebecf0] px-3 py-2.5 align-top text-sm font-medium text-[#42526e]";
export const EMPTY_BOX =
  "rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 text-center text-sm font-semibold text-[#6b778c]";

export const STATUS_BADGE: Record<LicensingStatus, string> = {
  active: "bg-[#e3fcef] text-[#006644]",
  pending: "bg-[#fffae6] text-[#974f0c]",
  terminated: "bg-[#f4f5f7] text-[#6b778c]",
};
export const CARRIER_CHIP: Record<LicensingStatus, string> = {
  active: "bg-[#f4f5f7] text-[#44546f]",
  pending: "bg-[#fffae6] text-[#974f0c]",
  terminated: "bg-[#f4f5f7] text-[#97a0af] line-through",
};
export const CHIP_HIT = "bg-[#e9f2ff] text-[#0c66e4] ring-1 ring-[#85b8ff]";

const AVATAR_COLORS = ["#0c66e4", "#216e4e", "#ae2e24", "#a54800", "#5e4db2", "#206a83", "#943d73", "#626f86"];
export function avatarColor(name: string): string {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
