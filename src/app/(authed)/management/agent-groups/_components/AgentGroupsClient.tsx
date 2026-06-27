"use client";
import { useEffect, useState } from "react";

type Person = { email: string; name: string | null };

export function AgentGroupsClient({
  agents,
  cs,
}: {
  agents: Person[];
  cs: Person[];
}) {
  const [agent, setAgent] = useState<string | null>(agents[0]?.email ?? null);
  const [members, setMembers] = useState<string[]>([]);

  useEffect(() => {
    if (!agent) return;
    void fetch(`/api/admin/agent-members?agent=${encodeURIComponent(agent)}`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members as string[]));
  }, [agent]);

  async function toggle(csEmail: string, on: boolean) {
    setMembers((cur) =>
      on ? [...cur, csEmail] : cur.filter((m) => m !== csEmail),
    );
    await fetch("/api/admin/agent-members", {
      method: on ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_email: agent, cs_email: csEmail }),
    });
  }

  return (
    <div className="flex gap-6 p-6">
      <ul className="w-64 shrink-0 space-y-1">
        {agents.map((a) => (
          <li key={a.email}>
            <button
              type="button"
              onClick={() => setAgent(a.email)}
              className={`w-full rounded px-3 py-2 text-left text-sm ${
                agent === a.email
                  ? "bg-[#e9f2ff] text-[#0c66e4]"
                  : "hover:bg-[#f4f5f7]"
              }`}
            >
              {a.name ?? a.email}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 flex-1">
        <h2 className="mb-3 text-sm font-bold uppercase text-[#6b778c]">
          CS members
        </h2>
        <ul className="space-y-1">
          {cs.map((p) => {
            const on = members.includes(p.email);
            return (
              <li key={p.email}>
                <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[#f4f5f7]">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!agent}
                    onChange={(e) => toggle(p.email, e.target.checked)}
                  />
                  {p.name ?? p.email}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
