"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, Search, Trash2, UsersRound, X } from "lucide-react";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";

type Person = { email: string; name: string | null };
type Member = { email: string; is_assistant: boolean };

export function AgentGroupsModal({
  open,
  agents,
  candidates,
  cs,
  isManager,
  manageableAgentEmails,
  onAgentsChange,
  onClose,
}: {
  open: boolean;
  agents: TaskAgent[];
  candidates: TaskAgent[];
  cs: TaskAssignee[];
  isManager: boolean;
  manageableAgentEmails: string[];
  onAgentsChange: (agents: TaskAgent[]) => void;
  onClose: () => void;
}) {
  const visibleAgents = isManager
    ? agents
    : agents.filter((agent) => manageableAgentEmails.includes(agent.email));
  const [selectedAgent, setSelectedAgent] = useState<string | null>(
    visibleAgents[0]?.email ?? null
  );
  const activeAgent =
    selectedAgent && visibleAgents.some((agent) => agent.email === selectedAgent)
      ? selectedAgent
      : visibleAgents[0]?.email ?? null;
  const [members, setMembers] = useState<Member[]>([]);
  const [loadedAgent, setLoadedAgent] = useState<string | null>(null);
  const [agentQuery, setAgentQuery] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidatePickerOpen, setCandidatePickerOpen] = useState(false);
  const [csQuery, setCsQuery] = useState("");
  const [savingAgent, setSavingAgent] = useState(false);
  const [removingAgent, setRemovingAgent] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidatePickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !activeAgent) return;

    let active = true;
    void fetch(`/api/admin/agent-members?agent=${encodeURIComponent(activeAgent)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Load failed"))))
      .then((d) => {
        if (active) {
          setMembers(Array.isArray(d.members) ? d.members : []);
          setLoadedAgent(activeAgent);
          setError(null);
        }
      })
      .catch(() => {
        if (active) {
          setMembers([]);
          setLoadedAgent(activeAgent);
          setError("Could not load members.");
        }
      });

    return () => {
      active = false;
    };
  }, [activeAgent, open]);

  useEffect(() => {
    if (!candidatePickerOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        candidatePickerRef.current?.contains(target)
      ) {
        return;
      }
      setCandidatePickerOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [candidatePickerOpen]);

  const selectedPerson = useMemo(
    () => agents.find((a) => a.email === activeAgent) ?? null,
    [activeAgent, agents]
  );

  const filteredAgents = useMemo(
    () => filterPeople(visibleAgents, agentQuery),
    [visibleAgents, agentQuery]
  );

  const availableCandidates = useMemo(
    () =>
      candidates.filter(
        (candidate) => !agents.some((agent) => agent.email === candidate.email)
      ),
    [agents, candidates]
  );

  const filteredCandidates = useMemo(
    () => filterPeople(availableCandidates, candidateQuery).slice(0, 6),
    [availableCandidates, candidateQuery]
  );

  const filteredCs = useMemo(
    () => filterPeople(cs, csQuery),
    [cs, csQuery]
  );

  if (!open) return null;

  const loadingMembers = Boolean(activeAgent && loadedAgent !== activeAgent);

  async function addAgent(email: string) {
    if (!email || savingAgent) return;

    setSavingAgent(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/task-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as {
        agent?: TaskAgent;
        error?: string;
      } | null;
      if (!res.ok || !data?.agent) throw new Error(data?.error ?? "Save failed");

      onAgentsChange(sortPeople([...agents, data.agent]));
      setSelectedAgent(data.agent.email);
      setLoadedAgent(null);
      setCandidateQuery("");
      setCandidatePickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add agent.");
    } finally {
      setSavingAgent(false);
    }
  }

  async function removeAgent(email: string) {
    if (removingAgent || savingAgent) return;

    setRemovingAgent(email);
    setError(null);
    try {
      const res = await fetch("/api/admin/task-agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Remove failed");
      }

      const nextAgents = agents.filter((agent) => agent.email !== email);
      onAgentsChange(nextAgents);
      if (activeAgent === email) {
        setSelectedAgent(nextAgents[0]?.email ?? null);
        setMembers([]);
        setLoadedAgent(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove agent.");
    } finally {
      setRemovingAgent(null);
    }
  }

  async function toggleMember(csEmail: string, on: boolean) {
    if (!activeAgent || savingEmail) return;

    const before = members;
    setSavingEmail(csEmail);
    setError(null);
    setMembers((cur) =>
      on
        ? [...cur.filter((m) => m.email !== csEmail), { email: csEmail, is_assistant: false }]
        : cur.filter((m) => m.email !== csEmail)
    );

    try {
      const res = await fetch("/api/admin/agent-members", {
        method: on ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_email: activeAgent, cs_email: csEmail }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch {
      setMembers(before);
      setError("Could not save this member.");
    } finally {
      setSavingEmail(null);
    }
  }

  async function toggleAssistant(csEmail: string, isAssistant: boolean) {
    if (!activeAgent || savingEmail) return;

    const before = members;
    setSavingEmail(csEmail);
    setError(null);
    setMembers((cur) =>
      cur.map((m) => (m.email === csEmail ? { ...m, is_assistant: isAssistant } : m))
    );

    try {
      const res = await fetch("/api/admin/agent-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_email: activeAgent,
          cs_email: csEmail,
          is_assistant: isAssistant,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
    } catch {
      setMembers(before);
      setError("Could not update assistant status.");
    } finally {
      setSavingEmail(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/45 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[min(780px,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded bg-white shadow-[0_18px_54px_rgba(9,30,66,0.34)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[#dfe1e6] bg-[#fafbfc] px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[#deebff] text-[#0c66e4]">
              <UsersRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-[#172b4d]">
                Agent Groups
              </h2>
              <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-[#626f86]">
                <span className="rounded bg-white px-2 py-0.5 shadow-sm">
                  {visibleAgents.length} agent{visibleAgents.length === 1 ? "" : "s"}
                </span>
                <span className="rounded bg-white px-2 py-0.5 shadow-sm">
                  {members.length} CS selected
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[#dfe1e6] md:grid-cols-[22rem_minmax(0,1fr)] md:divide-x md:divide-y-0">
          <section className="flex min-h-0 flex-col bg-[#f7f8f9]">
            <div className="shrink-0 space-y-4 border-b border-[#dfe1e6] p-4">
              {isManager ? (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-bold uppercase text-[#6b778c]">
                      Add Agent
                    </span>
                    <span className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-[#626f86] shadow-sm">
                      {availableCandidates.length} available
                    </span>
                  </div>
                  <div ref={candidatePickerRef} className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#626f86]" />
                    <input
                      value={candidateQuery}
                      onFocus={() => setCandidatePickerOpen(true)}
                      onChange={(event) => {
                        setCandidateQuery(event.target.value);
                        setCandidatePickerOpen(true);
                      }}
                      placeholder="Search people"
                      className="h-10 w-full rounded border-2 border-[#dfe1e6] bg-white pl-9 pr-3 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-medium placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]"
                    />
                    {candidatePickerOpen ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[70] max-h-72 overflow-auto rounded border border-[#dfe1e6] bg-white p-1 shadow-[0_10px_28px_rgba(9,30,66,0.22)]">
                        {filteredCandidates.map((candidate) => (
                          <button
                            key={candidate.email}
                            type="button"
                            onClick={() => addAgent(candidate.email)}
                            disabled={savingAgent}
                            className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition hover:bg-[#f4f5f7] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Initials email={candidate.email} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-[#172b4d]">
                                {personLabel(candidate)}
                              </span>
                              {candidate.name?.trim() ? (
                                <span className="block truncate text-xs text-[#626f86]">
                                  {candidate.email}
                                </span>
                              ) : null}
                            </span>
                            {savingAgent ? (
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" />
                            ) : (
                              <Plus className="h-4 w-4 shrink-0 text-[#0c66e4]" />
                            )}
                          </button>
                        ))}
                        {filteredCandidates.length === 0 ? (
                          <div className="px-3 py-6 text-center text-sm font-semibold text-[#626f86]">
                            No available people.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-bold uppercase text-[#6b778c]">
                    Selected Agents
                  </span>
                  <span className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-[#626f86] shadow-sm">
                    {agents.length}
                  </span>
                </div>
                <SearchBox
                  value={agentQuery}
                  onChange={setAgentQuery}
                  placeholder="Search agents"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {filteredAgents.map((agent) => {
                const active = agent.email === activeAgent;
                const removing = removingAgent === agent.email;
                return (
                  <div
                    key={agent.email}
                    className={`mb-2 flex items-center gap-1 rounded border px-2 py-2 shadow-sm transition ${
                      active
                        ? "border-[#85b8ff] bg-[#e9f2ff] text-[#0c66e4]"
                        : "border-[#dfe1e6] bg-white text-[#172b4d] hover:border-[#c1c7d0]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAgent(agent.email);
                        setError(null);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded px-1 py-0.5 text-left"
                    >
                      <Initials email={agent.email} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {agent.name?.trim() || agent.email}
                        </span>
                        {agent.name?.trim() ? (
                          <span className="block truncate text-xs text-[#626f86]">
                            {agent.email}
                          </span>
                        ) : null}
                      </span>
                      {active ? <Check className="h-4 w-4 shrink-0" /> : null}
                    </button>
                    {isManager ? (
                      <button
                        type="button"
                        onClick={() => removeAgent(agent.email)}
                        disabled={removingAgent !== null || savingAgent}
                        aria-label={`Remove ${personLabel(agent)} as agent`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#ffebe6] hover:text-[#ae2a19] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {removing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {filteredAgents.length === 0 ? <EmptyState label="No agents selected." /> : null}
            </div>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-[#dfe1e6] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {selectedPerson ? <Initials email={selectedPerson.email} size="lg" /> : null}
                  <div className="min-w-0">
                    <span className="block text-xs font-bold uppercase text-[#6b778c]">
                      CS Members
                    </span>
                    <span className="block truncate text-base font-semibold text-[#172b4d]">
                      {selectedPerson ? personLabel(selectedPerson) : "No agent selected"}
                    </span>
                  </div>
                </div>
                <span className="rounded bg-[#e9f2ff] px-2.5 py-1 text-xs font-bold text-[#0c66e4]">
                  {members.length} selected
                </span>
              </div>
              <div className="mt-3">
                <SearchBox
                  value={csQuery}
                  onChange={setCsQuery}
                  placeholder="Search CS"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[#fafbfc] p-4">
              {!activeAgent ? (
                <EmptyState label="Select a person as agent first." />
              ) : loadingMembers ? (
                <div className="flex h-full items-center justify-center text-sm font-medium text-[#626f86]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading members
                </div>
              ) : (
                <ul className="grid gap-2 lg:grid-cols-2">
                  {filteredCs.map((person) => {
                    const member = members.find((m) => m.email === person.email);
                    const checked = Boolean(member);
                    const saving = savingEmail === person.email;
                    return (
                      <li key={person.email}>
                        <div
                          className={`flex min-h-14 items-center gap-3 rounded border px-3 py-2 transition ${
                            checked
                              ? "border-[#85b8ff] bg-[#e9f2ff]"
                              : "border-[#dfe1e6] bg-white hover:bg-[#f7f8f9]"
                          } ${saving ? "opacity-60" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!activeAgent || savingEmail !== null}
                            onChange={(event) =>
                              toggleMember(person.email, event.target.checked)
                            }
                            className="h-4 w-4 shrink-0 accent-[#0c66e4]"
                          />
                          <Initials email={person.email} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#172b4d]">
                              {person.name?.trim() || person.email}
                            </span>
                            {person.name?.trim() ? (
                              <span className="block truncate text-xs text-[#626f86]">
                                {person.email}
                              </span>
                            ) : null}
                          </span>
                          {checked ? (
                            <label
                              className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#42526e]"
                              title="Assistant gets the same rights as the agent owner on this agent's tasks"
                            >
                              <input
                                type="checkbox"
                                checked={member?.is_assistant ?? false}
                                disabled={savingEmail !== null}
                                onChange={(event) =>
                                  toggleAssistant(person.email, event.target.checked)
                                }
                                className="h-4 w-4 accent-[#0c66e4]"
                              />
                              Assistant
                            </label>
                          ) : null}
                          {saving ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0c66e4]" />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!loadingMembers && filteredCs.length === 0 ? (
                <EmptyState label="No CS found." />
              ) : null}
            </div>

            {error ? (
              <div className="shrink-0 border-t border-[#dfe1e6] bg-[#ffebe6] px-4 py-2 text-sm font-medium text-[#ae2a19]">
                {error}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#626f86]" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded border-2 border-[#dfe1e6] bg-white pl-9 pr-3 text-sm font-medium text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]"
      />
    </label>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-dashed border-[#c1c7d0] bg-[#f7f8f9] px-4 py-8 text-center text-sm font-semibold text-[#626f86]">
      {label}
    </div>
  );
}

function Initials({ email, size = "sm" }: { email: string; size?: "sm" | "lg" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#dfe1e6] font-bold uppercase text-[#42526e] ${
        size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs"
      }`}
    >
      {email.slice(0, 2)}
    </span>
  );
}

function filterPeople<T extends Person>(people: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  return people.filter((p) =>
    `${p.name ?? ""} ${p.email}`.toLowerCase().includes(q)
  );
}

function sortPeople<T extends Person>(people: T[]): T[] {
  return [...people].sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
}

function personLabel(person: Person): string {
  return person.name?.trim() || person.email;
}
