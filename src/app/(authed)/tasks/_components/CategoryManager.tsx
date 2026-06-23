"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";

type Category = { id: string; name: string; color: string | null };

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

  const load = useCallback(async () => {
    const res = await fetch("/api/tasks/categories");
    if (res.ok) setItems((await res.json()).categories as Category[]);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function add() {
    if (!name.trim()) return;
    const res = await fetch("/api/tasks/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      setName("");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#0f2849]">Categories</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="mt-4 space-y-1">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span>{c.name}</span>
              <button type="button" onClick={() => remove(c.id)} aria-label="Delete category" className="text-slate-400 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="text-xs text-slate-400">No categories yet.</li>}
        </ul>
        <div className="mt-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          />
          <button type="button" onClick={add} disabled={!name.trim()} className="rounded-lg bg-[#0f2849] px-3 py-1.5 text-sm text-white disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
