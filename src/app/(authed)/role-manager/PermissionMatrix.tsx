"use client";

import { useMemo, type ReactNode } from "react";
import { Check } from "lucide-react";
import { normalizeExclusivePermissionKeys } from "@/lib/rbac/permissions";
import {
  ADMIN_KEYS,
  AUTOMATION_TOOL_KEYS,
  LEVEL_ROWS,
  LINE_COLUMNS,
  LINE_ROWS,
  LINE_SCOPES,
  PLACED_PERMISSION_KEYS,
  type LevelRow,
} from "@/lib/rbac/permission-matrix";
import type { PermissionRecord } from "@/lib/rbac/role-management";
import type { RoleFormState } from "./RolePanel";

/**
 * The role's permissions as a matrix (2026-10-31): one row per module with a
 * level — No access / Work / Manage — where Manage shows Work as included, plus one
 * "Statement Tool" row that ticks both Statement tools; then the Health & P&C
 * screens, then administration. Only a different way to tick the
 * same keys: every key saved is a `permissions` row, nothing new is stored.
 * A key this layout does not place still shows, under "Other".
 */

const COLUMNS = "grid-cols-[minmax(220px,1fr)_repeat(5,120px)]";
const HEAD_CELL = "flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-[#6b778c]";

/** One box for every cell: same size ticked or not, one accent colour. */
function Box({
  state,
  label,
  disabled,
  onClick,
}: {
  state: "off" | "on" | "included";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state !== "off"}
      aria-label={label}
      title={state === "included" ? `${label} (included)` : label}
      disabled={disabled}
      onClick={onClick}
      className="group flex h-full min-h-[52px] w-full items-center justify-center disabled:cursor-not-allowed"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-[5px] border-2 transition ${
          state === "on"
            ? "border-[#0c66e4] bg-[#0c66e4] text-white"
            : state === "included"
              ? "border-[#cce0ff] bg-[#cce0ff] text-[#0c66e4]"
              : "border-[#c1c7d0] bg-white text-transparent group-hover:border-[#85b8ff] group-disabled:group-hover:border-[#c1c7d0]"
        } group-disabled:opacity-50`}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-0.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">{title}</h3>
        {hint ? <span className="text-xs text-[#8590a2]">{hint}</span> : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-[#dfe1e6]">{children}</div>
    </section>
  );
}

function RowName({ name, on }: { name: string; on: boolean }) {
  return (
    <div className="flex min-h-[52px] items-center px-4">
      <span className={`text-sm font-semibold ${on ? "text-[#172b4d]" : "text-[#8590a2]"}`}>{name}</span>
    </div>
  );
}

const EMPTY_CELL = <div className="flex min-h-[52px] items-center justify-center text-[#dcdfe4]">—</div>;

export function PermissionMatrix({
  form,
  onChange,
  permissions,
  search,
  locked,
}: {
  form: RoleFormState;
  onChange: (update: (current: RoleFormState) => RoleFormState) => void;
  permissions: PermissionRecord[];
  search: string;
  locked: boolean;
}) {
  const byKey = useMemo(() => new Map(permissions.map((permission) => [permission.key, permission])), [permissions]);
  const keys = new Set(form.permissionKeys);
  const has = (key: string) => keys.has(key);
  const exists = (key: string) => byKey.has(key);
  const labelOf = (key: string) => byKey.get(key)?.label ?? key;

  const query = search.trim().toLowerCase();
  const matches = (...texts: Array<string | undefined>) =>
    !query || texts.some((text) => text?.toLowerCase().includes(query));

  function update(add: string[], remove: string[]) {
    onChange((current) => {
      const next = current.permissionKeys.filter((key) => !remove.includes(key));
      return { ...current, permissionKeys: normalizeExclusivePermissionKeys([...new Set([...next, ...add])]) };
    });
  }
  const toggle = (key: string) => (has(key) ? update([], [key]) : update([key], []));

  const levelOf = (row: LevelRow) => (has(row.high) ? 2 : has(row.low) ? 1 : 0);
  const extraKeys = (row: LevelRow) => (row.extras ?? []).map((extra) => extra.key);
  function setLevel(row: LevelRow, level: 0 | 1 | 2) {
    // Export / Import add to Work or Manage, so No access clears them too.
    if (level === 0) update([], [row.low, row.high, ...extraKeys(row)]);
    else if (level === 1) update([row.low], [row.high]);
    else update([row.high], [row.low]);
  }

  const levelRows = LEVEL_ROWS.filter(
    (row) =>
      exists(row.low) &&
      exists(row.high) &&
      matches(row.name, ...[row.low, row.high, ...extraKeys(row)].flatMap((key) => [key, labelOf(key)])),
  );
  // One "Statement Tool" row ticks every Statement tool at once (2026-11-01).
  const toolKeys = AUTOMATION_TOOL_KEYS.filter(exists);
  const showTools = toolKeys.length > 0 && matches("Statement Tool", ...toolKeys.flatMap((key) => [key, labelOf(key)]));
  const scopeKeys = Object.values(LINE_SCOPES);
  const lineRows = LINE_ROWS.filter((row) =>
    matches(row.name, ...LINE_COLUMNS, ...[...row.keys, ...scopeKeys].flatMap((key) => [key, labelOf(key)]), "All agents"),
  );
  const adminKeys = ADMIN_KEYS.filter((key) => exists(key) && matches(key, labelOf(key), byKey.get(key)?.description ?? undefined));
  const others = permissions.filter(
    (permission) =>
      !PLACED_PERMISSION_KEYS.has(permission.key) &&
      matches(permission.key, permission.label, permission.group_label, permission.description ?? undefined),
  );

  if (levelRows.length + (showTools ? 1 : 0) + lineRows.length + adminKeys.length + others.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-10 text-center text-sm font-semibold text-[#6b778c]">
        No permissions match your search.
      </div>
    );
  }

  return (
    <div>
      {levelRows.length > 0 || showTools ? (
        <Section title="Modules" hint="Manage includes Work">
          <div className={`grid ${COLUMNS} border-b border-[#dfe1e6] bg-[#fafbfc]`}>
            <div className={`${HEAD_CELL} !items-start pl-4`}>Module</div>
            <div className={HEAD_CELL}>No access</div>
            <div className={HEAD_CELL}>Work</div>
            <div className={HEAD_CELL}>Manage</div>
            <div className={HEAD_CELL}>Export</div>
            <div className={HEAD_CELL}>Import</div>
          </div>
          {levelRows.map((row) => {
            const level = levelOf(row);
            const extra = (column: "export" | "import") => {
              const item = row.extras?.find((candidate) => candidate.column === column);
              if (!item || !exists(item.key)) return EMPTY_CELL;
              return (
                <Box
                  state={has(item.key) ? "on" : "off"}
                  label={level === 0 ? `${labelOf(item.key)} (needs Work or Manage)` : labelOf(item.key)}
                  disabled={locked || level === 0}
                  onClick={() => toggle(item.key)}
                />
              );
            };
            return (
              <div
                key={row.name}
                className={`grid ${COLUMNS} border-b border-[#ebecf0] transition last:border-b-0 hover:bg-[#f7f8f9]`}
              >
                <RowName name={row.name} on={level > 0} />
                <Box state={level === 0 ? "on" : "off"} label={`${row.name}: no access`} disabled={locked} onClick={() => setLevel(row, 0)} />
                <Box
                  state={level === 1 ? "on" : level === 2 ? "included" : "off"}
                  label={labelOf(row.low)}
                  disabled={locked}
                  onClick={() => setLevel(row, 1)}
                />
                <Box state={level === 2 ? "on" : "off"} label={labelOf(row.high)} disabled={locked} onClick={() => setLevel(row, 2)} />
                {extra("export")}
                {extra("import")}
              </div>
            );
          })}
          {showTools && (
            <div className={`grid ${COLUMNS} border-b border-[#ebecf0] transition last:border-b-0 hover:bg-[#f7f8f9]`}>
              <RowName name="Statement Tool" on={toolKeys.some(has)} />
              <Box
                state={toolKeys.some(has) ? "off" : "on"}
                label="Statement Tool: no access"
                disabled={locked}
                onClick={() => update([], toolKeys)}
              />
              <Box
                state={toolKeys.every(has) ? "on" : "off"}
                label={toolKeys.map(labelOf).join(" + ")}
                disabled={locked}
                onClick={() => update(toolKeys, [])}
              />
              {EMPTY_CELL}
              {EMPTY_CELL}
              {EMPTY_CELL}
            </div>
          )}
        </Section>
      ) : null}

      {lineRows.length > 0 && (
        <Section title="Data Accessibility" hint="Scope applies to both Health and P&C">
          <div className={`grid ${COLUMNS} border-b border-[#dfe1e6] bg-[#fafbfc]`}>
            <div className={`${HEAD_CELL} !items-start pl-4`}>Line</div>
            {LINE_COLUMNS.map((column) => (
              <div key={column} className={HEAD_CELL}>
                {column}
              </div>
            ))}
          </div>
          {lineRows.map((row) => {
            const onCount = row.keys.filter(has).length;
            return (
              <div key={row.name} className={`grid ${COLUMNS} border-b border-[#ebecf0] transition hover:bg-[#f7f8f9]`}>
                <RowName name={row.name} on={onCount > 0} />
                {row.keys.map((key) =>
                  exists(key) ? (
                    <Box key={key} state={has(key) ? "on" : "off"} label={labelOf(key)} disabled={locked} onClick={() => toggle(key)} />
                  ) : (
                    <div key={key}>{EMPTY_CELL}</div>
                  ),
                )}
              </div>
            );
          })}
          <div className={`grid ${COLUMNS} bg-[#fafbfc]`}>
            <RowName name="Scope" on />
            {LINE_COLUMNS.map((column) => {
              const scopeKey = LINE_SCOPES[column];
              if (!scopeKey || !exists(scopeKey)) return <div key={column}>{EMPTY_CELL}</div>;
              return (
                <div key={column} className="flex min-h-[52px] items-center justify-center">
                  <span className="inline-flex rounded-md bg-[#ebecf0] p-0.5" title={byKey.get(scopeKey)?.description ?? undefined}>
                    {[false, true].map((all) => (
                      <button
                        key={String(all)}
                        type="button"
                        disabled={locked}
                        onClick={() => (all ? update([scopeKey], []) : update([], [scopeKey]))}
                        className={`whitespace-nowrap rounded px-1.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed ${
                          has(scopeKey) === all ? "bg-white text-[#0c66e4] shadow-sm" : "text-[#6b778c] hover:text-[#172b4d]"
                        }`}
                      >
                        {all ? "All agents" : "Own"}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {adminKeys.length > 0 && (
        <Section title="Administration" hint="Give to admins only">
          <div className={`grid ${COLUMNS} border-b border-[#dfe1e6] bg-[#fafbfc]`}>
            <div className={`${HEAD_CELL} !items-start pl-4`}>Permission</div>
            <div className={HEAD_CELL}>Access</div>
          </div>
          {adminKeys.map((key) => (
            <div key={key} className={`grid ${COLUMNS} border-b border-[#ebecf0] transition last:border-b-0 hover:bg-[#f7f8f9]`}>
              <RowName name={labelOf(key)} on={has(key)} />
              <Box state={has(key) ? "on" : "off"} label={labelOf(key)} disabled={locked} onClick={() => toggle(key)} />
            </div>
          ))}
        </Section>
      )}

      {others.length > 0 && (
        <Section title="Other">
          {others.map((permission) => (
            <div key={permission.key} className={`grid ${COLUMNS} border-b border-[#ebecf0] transition last:border-b-0 hover:bg-[#f7f8f9]`}>
              <RowName name={permission.label} on={has(permission.key)} />
              <Box
                state={has(permission.key) ? "on" : "off"}
                label={permission.label}
                disabled={locked}
                onClick={() => toggle(permission.key)}
              />
            </div>
          ))}
        </Section>
      )}

      <div className="mt-3 flex items-center gap-5 px-0.5 text-xs text-[#6b778c]">
        <span className="inline-flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded border-2 border-[#0c66e4] bg-[#0c66e4] text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          Chosen
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded border-2 border-[#cce0ff] bg-[#cce0ff] text-[#0c66e4]">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          Included by Manage
        </span>
      </div>
    </div>
  );
}
