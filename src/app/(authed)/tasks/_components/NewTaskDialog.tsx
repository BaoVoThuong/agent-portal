"use client";

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { TaskPriority, TaskCategory } from "@/lib/tasks/types";
import type { TaskAgent, TaskAssignee } from "@/lib/tasks/assignees";
import { TaskSelect } from "./TaskSelect";
import { TaskPrioritySelect } from "./TaskPrioritySelect";

export type NewTaskPayload = {
  title: string;
  description: string;
  fub_link?: string;
  priority: TaskPriority;
  agent_email?: string;
  assignee_email?: string;
  category_id?: string;
};

export function NewTaskDialog({
  open,
  isManager,
  assignees,
  agents,
  myAgents,
  categories,
  onClose,
  onCreate,
}: {
  open: boolean;
  isManager: boolean;
  assignees: TaskAssignee[];
  agents: TaskAgent[];
  myAgents: string[];
  categories: TaskCategory[];
  onClose: () => void;
  onCreate: (payload: NewTaskPayload) => Promise<void>;
}) {
  const defaultAgent = !isManager && myAgents.length === 1 ? myAgents[0] : "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fubLink, setFubLink] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [agentEmail, setAgentEmail] = useState(defaultAgent);
  const [assignee, setAssignee] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const categoryOptions = [
    { value: "", label: "No category" },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];
  const visibleAgents = isManager
    ? agents
    : agents.filter((agent) => myAgents.includes(agent.email));
  const agentOptions = [
    { value: "", label: "No agent" },
    ...visibleAgents.map((agent) => ({
      value: agent.email,
      label: agent.name ?? agent.email,
    })),
  ];
  const assigneeOptions = [
    { value: "", label: "Unassigned (Backlog)" },
    ...assignees.map((assigneeOption) => ({
      value: assigneeOption.email,
      label: assigneeOption.name ?? assigneeOption.email,
    })),
  ];

  if (!open) return null;

  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        fub_link: fubLink.trim() || undefined,
        priority,
        agent_email: agentEmail || undefined,
        assignee_email: isManager && assignee ? assignee : undefined,
        category_id: categoryId || undefined,
      });
      setTitle("");
      setDescription("");
      setFubLink("");
      setPriority("medium");
      setAgentEmail(defaultAgent);
      setAssignee("");
      setCategoryId("");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/45 p-4 sm:p-6">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]">
        <header className="shrink-0 border-b border-[#dfe1e6] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-[#172b4d]">New task</h2>
              <p className="mt-1 text-sm text-[#626f86]">
                Capture the work item, then set ownership on the right.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[#626f86] transition hover:bg-[#f4f5f7] hover:text-[#172b4d]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase text-[#6b778c]">
              Title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="h-11 w-full rounded border-2 border-[#dfe1e6] bg-white px-3 text-base font-medium text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]"
              autoFocus
            />
          </label>

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase text-[#6b778c]">
                  Description
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add context, acceptance notes, links, or customer details..."
                  rows={13}
                  className="min-h-[21rem] w-full resize-none rounded border-2 border-[#dfe1e6] bg-white px-3 py-3 text-sm leading-6 text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]"
                />
              </label>
            </section>

            <aside className="space-y-4 rounded border border-[#dfe1e6] bg-[#f7f8f9] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)]">
              <div className="flex items-center justify-between border-b border-[#dfe1e6] pb-3">
                <span className="text-xs font-bold uppercase text-[#6b778c]">
                  Properties
                </span>
                <span className="rounded bg-[#e9f2ff] px-2 py-0.5 text-xs font-bold text-[#0c66e4]">
                  Task
                </span>
              </div>
              <MetaField label="Priority">
                <TaskPrioritySelect
                  value={priority}
                  onChange={setPriority}
                  menuClassName="min-w-full"
                />
              </MetaField>

              <MetaField label="Category">
                <TaskSelect
                  label="Category"
                  value={categoryId}
                  options={categoryOptions}
                  onChange={setCategoryId}
                  buttonClassName="!h-10 !border-[#dfe1e6] !bg-white !shadow-none"
                  menuClassName="min-w-full"
                />
              </MetaField>

              <MetaField label="FUB Link">
                <input
                  value={fubLink}
                  onChange={(e) => setFubLink(e.target.value)}
                  placeholder="https://..."
                  className="h-10 w-full rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4]"
                />
              </MetaField>

              <MetaField label="Agent">
                <TaskSelect
                  label="Agent"
                  value={agentEmail}
                  options={agentOptions}
                  onChange={setAgentEmail}
                  buttonClassName="!h-10 !border-[#dfe1e6] !bg-white !shadow-none"
                  menuClassName="min-w-full"
                />
              </MetaField>

              <MetaField label="Assignee">
                {isManager ? (
                  <TaskSelect
                    label="Assignee"
                    value={assignee}
                    options={assigneeOptions}
                    onChange={setAssignee}
                    buttonClassName="!h-10 !border-[#dfe1e6] !bg-white !shadow-none"
                    menuClassName="min-w-full"
                  />
                ) : (
                  <div className="flex h-10 items-center rounded border-2 border-[#dfe1e6] bg-white px-3 text-sm font-medium text-[#172b4d]">
                    Assigned to you
                  </div>
                )}
              </MetaField>

            </aside>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#dfe1e6] bg-white px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm font-semibold text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || saving}
            className="rounded bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function MetaField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold uppercase text-[#6b778c]">
        {label}
      </span>
      {children}
    </div>
  );
}
