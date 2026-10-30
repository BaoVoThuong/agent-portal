"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { AgentLinks } from "@/lib/accounting/health/links";
import type { PortalAccount } from "@/lib/accounting/health/source";

/** Link each agent name in the data to a portal account, or leave it as a name. */
export function AgentLinksDialog({
  agents,
  accounts,
  links,
  onClose,
  onSave,
}: {
  agents: Array<[string, number]>;
  accounts: PortalAccount[];
  links: AgentLinks;
  onClose: () => void;
  onSave: (links: AgentLinks) => void;
}) {
  const [draft, setDraft] = useState<AgentLinks>(links);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agents"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#dfe1e6] px-6 py-4">
          <h2 className="text-xl font-semibold text-[#172b4d]">Agents</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#dfe1e6] text-left text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                <th className="py-2 pr-2">Name in data</th>
                <th className="px-2 py-2 text-right">Rows</th>
                <th className="px-2 py-2">Portal account</th>
                <th className="py-2 pl-2">ID</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(([name, count]) => {
                const account = accounts.find((item) => item.id === draft[name]);
                return (
                  <tr key={name} className="border-b border-[#ebecf0]">
                    <td className="py-2 pr-2 font-semibold text-[#172b4d]">{name}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#44546f]">{count.toLocaleString()}</td>
                    <td className="px-2 py-2">
                      <select
                        value={draft[name] ?? ""}
                        onChange={(event) => {
                          const next = { ...draft };
                          if (event.target.value) next[name] = event.target.value;
                          else delete next[name];
                          setDraft(next);
                        }}
                        className="h-9 w-60 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#172b4d] focus:border-[#0c66e4] focus:outline-none"
                      >
                        <option value="">— Name only —</option>
                        {accounts.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pl-2">
                      {account ? (
                        <span className="inline-flex h-[22px] items-center rounded-full bg-[#dcfff1] px-2 text-xs font-semibold text-[#216e4e]">
                          {account.agentId || "Linked"}
                        </span>
                      ) : (
                        <span className="inline-flex h-[22px] items-center rounded-full bg-[#f1f2f4] px-2 text-xs font-semibold text-[#44546f]">
                          Name only
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#dfe1e6] px-6 py-4">
          <span className="text-sm text-[#6b778c]">Not saved yet — UI preview</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded bg-[#f1f2f4] px-4 text-sm font-semibold text-[#44546f] transition hover:bg-[#e4e6ea]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-semibold text-white transition hover:bg-[#0055cc]"
            >
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
