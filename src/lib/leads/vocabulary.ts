import {
  isLeadProduct,
  isStatusKind,
  type LeadProduct,
  type StatusKind,
} from "./types";

export type StatusInput = {
  product: LeadProduct;
  label: string;
  kind: StatusKind;
  color: string | null;
  position: number;
};

export type TypeInput = {
  label: string;
  counts_as_contact: boolean;
  color: string | null;
  position: number;
};

function label(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function position(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function color(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

export function validateStatusInput(
  body: Record<string, unknown> | null
): StatusInput | { error: string } {
  if (!isLeadProduct(body?.product)) return { error: "Unknown product." };
  const name = label(body?.label);
  if (!name) return { error: "The status needs a name." };
  if (!isStatusKind(body?.kind)) return { error: "Pick what this status means: open, scheduled, won, or lost." };
  return {
    product: body.product,
    label: name,
    kind: body.kind,
    color: color(body?.color),
    position: position(body?.position),
  };
}

export function validateTypeInput(
  body: Record<string, unknown> | null
): TypeInput | { error: string } {
  const name = label(body?.label);
  if (!name) return { error: "The interaction type needs a name." };
  return {
    label: name,
    counts_as_contact: body?.counts_as_contact === true,
    color: color(body?.color),
    position: position(body?.position),
  };
}
