"use client";

import type { TaskCategory } from "@/lib/tasks/types";
import { taskCategoryBadgePalette } from "@/lib/tasks/category-colors";

export function TaskCategoryBadge({
  category,
  className = "",
}: {
  category: Pick<TaskCategory, "id" | "name" | "color">;
  className?: string;
}) {
  const palette = taskCategoryBadgePalette(category);

  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.025em] ${className}`}
      style={{ backgroundColor: palette.background, color: palette.foreground }}
      title={category.name}
    >
      {category.name}
    </span>
  );
}
