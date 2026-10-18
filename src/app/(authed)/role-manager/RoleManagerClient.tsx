"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Toast } from "../_shared/Toast";
import {
  PAGE_ACTIONS_CLASS,
  PAGE_HEADER_CLASS,
  PAGE_PRIMARY_BUTTON_CLASS,
  PAGE_TITLE_CLASS,
} from "../_shared/page-header-styles";
import { can } from "@/lib/rbac/client";
import {
  normalizeExclusivePermissionKeys,
  PERMISSIONS,
} from "@/lib/rbac/permissions";
import type {
  PermissionRecord,
  RoleRecord,
} from "@/lib/rbac/role-management";
import { isAdminRoleName } from "@/lib/rbac/admin-role";
import { ReassignRoleDialog } from "./ReassignRoleDialog";
import { PositionsSection } from "./PositionsSection";
import type { PositionRecord } from "@/lib/admin/positions";
import { RoleList } from "./RoleList";
import {
  RolePanel,
  type PersonDirectory,
  type RoleFormState,
  type RoleMenuItem,
  type RolePanelTab,
} from "./RolePanel";

type RoleManagerClientProps = {
  initialRoles: RoleRecord[];
  permissions: PermissionRecord[];
  currentUserPermissions: string[];
  initialPositions: PositionRecord[];
  initialPeople: Array<{ id: string; name: string | null; email: string }>;
};

const EMPTY_PEOPLE: RoleManagerClientProps["initialPeople"] = [];

const emptyRoleForm: RoleFormState = {
  id: null,
  name: "",
  description: "",
  is_active: true,
  permissionKeys: [],
  is_system: false,
};

function toForm(role: RoleRecord): RoleFormState {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? "",
    is_active: role.is_active,
    permissionKeys: normalizeExclusivePermissionKeys(
      role.permissions.map((permission) => permission.key)
    ),
    is_system: role.is_system,
  };
}

function isSameForm(a: RoleFormState, b: RoleFormState) {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.is_active === b.is_active &&
    [...a.permissionKeys].sort().join() === [...b.permissionKeys].sort().join()
  );
}

// The Admin role is fixed and view-only: it holds every permission and is
// changed only by SQL rollouts.
function isProtectedRole(role: Pick<RoleRecord, "name">) {
  return isAdminRoleName(role.name);
}

export default function RoleManagerClient({
  initialRoles,
  permissions,
  currentUserPermissions,
  initialPositions,
  initialPeople = EMPTY_PEOPLE,
}: RoleManagerClientProps) {
  const router = useRouter();
  const [pageTab, setPageTab] = useState<"roles" | "positions">("roles");
  const [roles, setRoles] = useState(initialRoles);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(
    initialRoles[0]?.id ?? null
  );
  const [panelTab, setPanelTab] = useState<RolePanelTab>("permissions");
  // Unsaved edits to the selected role, or a new role (id null). Null means
  // the panel shows the role as stored.
  const [draft, setDraft] = useState<RoleFormState | null>(null);
  // What a new role started from (empty or a duplicate), to tell whether
  // leaving it drops changes.
  const [newRoleBaseline, setNewRoleBaseline] = useState<RoleFormState | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<RoleRecord | null>(null);
  const [roleToReassign, setRoleToReassign] = useState<RoleRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManageRoles = can(currentUserPermissions, PERMISSIONS.ROLE_MANAGER);
  const canCreate = canManageRoles;
  const canEdit = canManageRoles;
  const canDelete = canManageRoles;
  const canAssignPermissions = canManageRoles;

  const filteredRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    if (!query) return roles;

    return roles.filter((role) => {
      const searchableValues = [
        role.name,
        role.description,
        ...role.permissions.flatMap((permission) => [
          permission.label,
          permission.key,
          permission.group_label,
        ]),
      ];

      return searchableValues.some((value) =>
        value?.toLowerCase().includes(query)
      );
    });
  }, [roleSearch, roles]);

  const positionNameById = useMemo(
    () => new Map(initialPositions.map((position) => [position.id, position.name])),
    [initialPositions]
  );

  // A manager can have no role (new Google sign-ups), so include every account.
  const people = useMemo<PersonDirectory>(() => {
    const directory = new Map(
      initialPeople.map((person) => [
        person.id,
        { name: person.name?.trim() || person.email, email: person.email },
      ] as const)
    );
    for (const role of roles) {
      for (const holder of role.holders) {
        directory.set(holder.user_id, {
          name: holder.name?.trim() || holder.email,
          email: holder.email,
        });
      }
    }
    return directory;
  }, [initialPeople, roles]);

  // A deleted or missing selection falls back to the first role.
  const selectedRole =
    roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null;

  const creating = draft !== null && draft.id === null;
  // Edits to a role that is no longer selected (deleted meanwhile) are dropped.
  const activeDraft =
    draft && (creating || draft.id === selectedRole?.id) ? draft : null;
  // Admin is shown with the same switches, all locked.
  const readOnly = !creating && selectedRole !== null && isProtectedRole(selectedRole);
  // The role as stored, as a form.
  const baseline = creating ? newRoleBaseline : selectedRole ? toForm(selectedRole) : null;
  const form = activeDraft ?? baseline;
  const isDirty = Boolean(activeDraft && baseline && !isSameForm(activeDraft, baseline));

  function updateForm(update: (current: RoleFormState) => RoleFormState) {
    if (!form) return;
    setDraft(update(form));
  }

  /** Drops the draft; asks first when it holds unsaved changes. */
  function leaveDraft() {
    if (isDirty && !window.confirm("Discard your unsaved changes to this role?")) {
      return false;
    }
    setDraft(null);
    setNewRoleBaseline(null);
    return true;
  }

  function openNewRole(next: RoleFormState) {
    if (!leaveDraft()) return;
    setError(null);
    setMessage(null);
    setDraft(next);
    setNewRoleBaseline(next);
  }

  function openCreateRole() {
    openNewRole(emptyRoleForm);
  }

  function openDuplicateRole(role: RoleRecord) {
    openNewRole({
      ...toForm(role),
      id: null,
      name: `${role.name} Copy`,
      is_system: false,
    });
  }

  function selectRole(role: RoleRecord) {
    if (!creating && role.id === selectedRole?.id) return;
    if (!leaveDraft()) return;
    setSelectedRoleId(role.id);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const permissionKeys = normalizeExclusivePermissionKeys(form.permissionKeys);
      const requestBody =
        form.id && !canEdit
          ? { permissionKeys }
          : {
              name: form.name,
              description: form.description,
              is_active: form.is_active,
              permissionKeys,
            };

      const response = await fetch(
        form.id ? `/api/admin/roles/${form.id}` : "/api/admin/roles",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Unable to save role.");
        return;
      }

      setRoles(payload.roles ?? roles);
      setSelectedRoleId(form.id ?? payload.role?.id ?? selectedRoleId);
      setMessage(form.id ? "Role updated." : "Role created.");
      setDraft(null);
      setNewRoleBaseline(null);
      router.refresh();
    } catch {
      setError("Unable to save role. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Someone may have been given this role since the page loaded. Reload the
  // list so the next Delete click opens the move dialog with every holder.
  async function reloadRoles() {
    try {
      const response = await fetch("/api/admin/roles", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && Array.isArray(result.roles)) setRoles(result.roles);
    } catch {
      // The error toast already explains what to do; a stale list is harmless.
    }
  }

  /**
   * Deletes a role. A role that people still hold (disabled accounts included)
   * needs moveToRoleId: the server moves every holder there first.
   */
  async function deleteRole(role: RoleRecord, moveToRoleId: string | null) {
    setBusyRoleId(role.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/roles/${role.id}`, {
        method: "DELETE",
        ...(moveToRoleId
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moveToRoleId }),
            }
          : {}),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Unable to delete role.");
        if (response.status === 409) await reloadRoles();
        return false;
      }

      setRoles(result.roles ?? roles.filter((item) => item.id !== role.id));
      if (draft?.id === role.id) setDraft(null);
      const targetName = roles.find((item) => item.id === moveToRoleId)?.name;
      const moved = typeof result.moved === "number" ? result.moved : 0;
      setMessage(
        moved > 0 && targetName
          ? `Moved ${moved} account${moved === 1 ? "" : "s"} to ${targetName}. Role deleted.`
          : "Role deleted."
      );
      router.refresh();
      return true;
    } catch {
      setError("Unable to delete role. Please try again.");
      return false;
    } finally {
      setBusyRoleId(null);
    }
  }

  async function handleDeleteRole() {
    if (!roleToDelete) return;
    if (await deleteRole(roleToDelete, null)) setRoleToDelete(null);
  }

  async function handleReassignAndDelete(moveToRoleId: string) {
    if (!roleToReassign) return;
    if (await deleteRole(roleToReassign, moveToRoleId)) setRoleToReassign(null);
  }

  function requestDeleteRole(role: RoleRecord) {
    setError(null);
    setMessage(null);
    if (role.holders.length > 0) setRoleToReassign(role);
    else setRoleToDelete(role);
  }

  function roleMenuItems(role: RoleRecord): RoleMenuItem[] {
    const protectedRole = isProtectedRole(role);
    const items: RoleMenuItem[] = [];
    if (canCreate) {
      items.push({ label: "Duplicate", onSelect: () => openDuplicateRole(role) });
    }
    if (canDelete && !protectedRole) {
      items.push({
        label: "Delete",
        danger: true,
        onSelect: () => requestDeleteRole(role),
      });
    }
    return items;
  }

  return (
    // On desktop the Roles tab is a frame one screen tall: the role list and
    // the panel each scroll inside it instead of the page.
    <div
      className={`flex flex-col px-6 pb-6 pt-5 ${
        pageTab === "roles" ? "lg:h-full lg:min-h-0" : ""
      }`}
    >
      <header className={`mb-3 shrink-0 ${PAGE_HEADER_CLASS}`}>
        <h1 className={PAGE_TITLE_CLASS}>Role Manager</h1>
        {canCreate && pageTab === "roles" && (
          <div className={PAGE_ACTIONS_CLASS}>
            <button type="button" onClick={openCreateRole} className={PAGE_PRIMARY_BUTTON_CLASS}>
              <Plus className="h-4 w-4" />
              New role
            </button>
          </div>
        )}
      </header>

      <div className="mb-3 flex w-fit shrink-0 rounded border border-[#dfe3ea] bg-[#f4f5f7] p-0.5 shadow-sm">
        {(
          [
            ["roles", "Roles"],
            ["positions", "Positions"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setPageTab(value)}
            className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
              pageTab === value
                ? "bg-white text-[#0c66e4] shadow-sm ring-1 ring-[#d8dee7]"
                : "text-[#44546f] hover:bg-white/70 hover:text-[#172b4d]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {pageTab === "positions" ? <PositionsSection initialPositions={initialPositions} /> : null}

      <section
        hidden={pageTab !== "roles"}
        className="grid overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)] lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <RoleList
          roles={filteredRoles}
          totalCount={roles.length}
          search={roleSearch}
          onSearchChange={setRoleSearch}
          selectedRoleId={selectedRole?.id ?? null}
          creating={creating}
          dirty={isDirty}
          onSelect={selectRole}
        />

        <div className="min-h-0 min-w-0">
          {form ? (
            <RolePanel
              role={creating ? null : selectedRole}
              form={form}
              onChange={updateForm}
              permissions={permissions}
              readOnly={readOnly}
              detailsLocked={readOnly || (Boolean(form.id) && !canEdit)}
              permissionsLocked={readOnly || !canAssignPermissions}
              isDirty={isDirty}
              saveDisabled={
                isSubmitting ||
                (creating ? !canCreate : !isDirty || (!canEdit && !canAssignPermissions))
              }
              isSubmitting={isSubmitting}
              onDiscard={() => {
                setDraft(null);
                setNewRoleBaseline(null);
              }}
              onSubmit={handleSubmit}
              tab={panelTab}
              onTabChange={setPanelTab}
              menuItems={creating || !selectedRole ? [] : roleMenuItems(selectedRole)}
              busy={Boolean(selectedRole && busyRoleId === selectedRole.id)}
              positionNameById={positionNameById}
              people={people}
            />
          ) : (
            <div className="px-6 py-16 text-center text-sm font-semibold text-[#6b778c]">
              No roles yet.
            </div>
          )}
        </div>
      </section>

      {roleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <div className="w-full max-w-[420px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-[#16233a]">
                Delete Role
              </h2>
              <p className="mt-1 text-sm text-[#667085]">
                This permanently deletes the role{" "}
                <span className="font-semibold text-[#16233a]">
                  {roleToDelete.name}
                </span>
                . This action cannot be undone.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => setRoleToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={busyRoleId === roleToDelete.id}
                onClick={() => void handleDeleteRole()}
              >
                {busyRoleId === roleToDelete.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {roleToReassign && (
        <ReassignRoleDialog
          role={roleToReassign}
          targets={roles
            .filter((role) => role.is_active && role.id !== roleToReassign.id)
            .map((role) => ({
              id: role.id,
              name: role.name,
              grantsFullAccess: isProtectedRole(role),
            }))}
          busy={busyRoleId === roleToReassign.id}
          onCancel={() => setRoleToReassign(null)}
          onConfirm={(moveToRoleId) => void handleReassignAndDelete(moveToRoleId)}
        />
      )}

      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast
        message={message}
        tone="success"
        onDismiss={() => setMessage(null)}
        stackIndex={error ? 1 : 0}
      />
    </div>
  );
}
