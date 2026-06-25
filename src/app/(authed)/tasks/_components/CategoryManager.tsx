"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

type Category = { id: string; name: string; color: string | null };
const CATEGORY_COLORS = ["#ffab00", "#ff7452", "#00b8d9", "#6554c0", "#36b37e"];

export function CategoryManager({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);

  async function load() {
    const res = await fetch("/api/tasks/categories");
    if (res.ok) setItems((await res.json()).categories as Category[]);
  }

  useEffect(() => {
    if (!open) return;

    let isCurrent = true;

    void fetch("/api/tasks/categories")
      .then((res) => (res.ok ? res.json() : { categories: [] }))
      .then((data) => {
        if (isCurrent) {
          setItems(data.categories as Category[]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [open]);

  async function add() {
    if (!name.trim()) return;
    const res = await fetch("/api/tasks/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), color }),
    });
    if (res.ok) {
      setName("");
      setColor(CATEGORY_COLORS[0]);
      await load();
      onChanged();
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tasks/categories/${id}`, { method: "DELETE" });
    if (res.ok) {
      await load();
      onChanged();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4">
      <div className="w-full max-w-sm rounded bg-white p-5 shadow-[0_12px_32px_rgba(9,30,66,0.24)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#172b4d]">Categories</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[#626f86] hover:bg-[#f4f5f7]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="mt-4 space-y-1">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded bg-[#f4f5f7] px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-semibold text-[#172b4d]">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: c.color ?? "#c1c7d0" }}
                />
                <span className="truncate">{c.name}</span>
              </span>
              <button type="button" onClick={() => remove(c.id)} aria-label="Delete category" className="text-[#626f86] hover:text-[#de350b]">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="text-xs text-[#626f86]">No categories yet.</li>}
        </ul>
        <div className="mt-4 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category"
            className="w-full rounded border-2 border-[#dfe1e6] px-3 py-2 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#6b778c] focus:border-[#0c66e4]"
          />
          <div className="flex items-center gap-2">
            {CATEGORY_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setColor(option)}
                className={`h-7 w-7 rounded transition ${
                  color === option ? "ring-2 ring-[#0c66e4] ring-offset-2" : ""
                }`}
                style={{ backgroundColor: option }}
                aria-label={`Use category color ${option}`}
              />
            ))}
            <button type="button" onClick={add} disabled={!name.trim()} className="ml-auto rounded bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#0055cc] disabled:opacity-40">
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
