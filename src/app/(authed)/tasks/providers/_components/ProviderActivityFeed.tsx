"use client";

import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import {
  formatProviderActivityValue,
  providerActivityChanges,
  providerActivityFieldLabel,
  type ProviderActivityRow,
} from "@/lib/providers/activity";
import { UNKNOWN_PERSON_LABEL } from "@/lib/people/display-names";

function sentence(row: ProviderActivityRow): string {
  const fromImport = row.meta?.source === "import";
  switch (row.type) {
    case "created":
      return fromImport ? "imported this provider" : "added this provider";
    case "field_changed":
      return fromImport ? "updated this provider from an import" : "edited this provider";
    case "archived":
      return "deleted this address";
    case "comment_added":
      return "commented";
    case "comment_edited":
      return "edited a comment";
    case "comment_deleted":
      return "deleted a comment";
    default:
      return row.type.replaceAll("_", " ");
  }
}

/** Cùng kiểu chữ với ActivityFeed của Task/Enrollment, thêm từng ô "cũ → mới". */
export function ProviderActivityFeed({
  activity,
  columns,
  columnOptions,
}: {
  activity: ProviderActivityRow[];
  columns: readonly TableColumn[];
  columnOptions: readonly TableColumnOption[];
}) {
  if (activity.length === 0) {
    return <p className="text-xs text-[#6b778c]">No activity yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {activity.map((row) => {
        const changes = row.type === "field_changed" ? providerActivityChanges(row.meta) : [];
        return (
          <li key={row.id} className="text-xs leading-5 text-[#6b778c]">
            <strong className="font-semibold text-[#172b4d]">
              {row.actor_name?.trim() || UNKNOWN_PERSON_LABEL}
            </strong>{" "}
            {sentence(row)}
            <span className="ml-1 whitespace-nowrap text-[#97a0af]">
              {new Date(row.created_at).toLocaleString()}
            </span>
            {changes.length > 0 ? (
              <ul className="mt-1 space-y-0.5 border-l-2 border-[#dfe1e6] pl-2">
                {changes.map((change) => {
                  const column = columns.find((item) => item.key === change.key);
                  return (
                    <li key={change.key} className="break-words">
                      <span className="font-semibold text-[#42526e]">
                        {providerActivityFieldLabel(change.key, columns)}:
                      </span>{" "}
                      <span className="text-[#97a0af] line-through">
                        {formatProviderActivityValue(change.from, column, columnOptions)}
                      </span>{" "}
                      →{" "}
                      <span className="text-[#172b4d]">
                        {formatProviderActivityValue(change.to, column, columnOptions)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
