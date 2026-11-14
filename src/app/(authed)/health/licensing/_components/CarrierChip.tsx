"use client";

import type { ReactNode } from "react";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import type { LicensingStatus } from "@/lib/health-licensing/types";

/** Chip hãng cùng kiểu chip ACA plans / Medicare plans của Provider List. */
export const CARRIER_CHIP_CLASS =
  "inline-flex max-w-[200px] items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.02em]";

export function carrierChipStyle(option: { id: string; label: string; color: string | null }) {
  const palette = tableColumnOptionBadgePalette(option);
  return { background: palette.background, color: palette.foreground };
}

/** Pending: viền vàng; Terminated: gạch ngang, mờ. Active: chỉ màu của hãng. */
export function carrierChipStatusClass(status: LicensingStatus | null | undefined): string {
  if (status === "pending") return "ring-1 ring-inset ring-[#e2b203]";
  if (status === "terminated") return "line-through opacity-50";
  return "";
}

export function CarrierChip({
  option,
  status,
  highlighted = false,
  title,
  onClick,
  trailing,
}: {
  option: { id: string; label: string; color: string | null };
  status?: LicensingStatus | null;
  highlighted?: boolean;
  title?: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const className = `${CARRIER_CHIP_CLASS} ${carrierChipStatusClass(status)} ${
    highlighted ? "outline outline-2 outline-offset-1 outline-[#0c66e4]" : ""
  }`;
  const content = (
    <>
      <span className="truncate">{option.label}</span>
      {status === "pending" ? <span className="font-semibold normal-case tracking-normal opacity-80">· pending</span> : null}
      {trailing}
    </>
  );
  if (!onClick) {
    return (
      <span className={className} style={carrierChipStyle(option)} title={title}>
        {content}
      </span>
    );
  }
  // span role="button" thay vì <button>: chip nằm trong ô chọn (cũng bấm được)
  // và có nút × bên trong — <button> lồng nhau là HTML sai.
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }
      }}
      title={title}
      className={`${className} cursor-pointer transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0c66e4]`}
      style={carrierChipStyle(option)}
    >
      {content}
    </span>
  );
}
