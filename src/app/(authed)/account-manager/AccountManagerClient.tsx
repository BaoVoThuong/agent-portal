"use client";

import { Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Toast } from "../_shared/Toast";
import {
  PAGE_ACTIONS_CLASS,
  PAGE_HEADER_CLASS,
  PAGE_PRIMARY_BUTTON_CLASS,
  PAGE_TITLE_CLASS,
} from "../_shared/page-header-styles";
import type { AccountUser } from "@/lib/domain/account.types";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { formatTableDate } from "@/lib/table-config/date-format";
import type { RoleOption } from "@/lib/rbac/role-management";
import { isAdminRoleName } from "@/lib/rbac/admin-role";
import { useBodyScrollLock } from "./../_shared/useBodyScrollLock";
import { usePendingKeys } from "@/lib/collaboration/use-pending-keys";
import type { PositionOption } from "@/lib/admin/positions";
import type { AccountConfig, TaskAccess } from "@/lib/admin/account-config";
import { EditAccountDialog, type EditAccountPayload } from "./EditAccountDialog";
import { CreateAccountDialog } from "./CreateAccountDialog";
import { ManagerMenu } from "./ManagerMenu";
import { PositionMenu } from "./PositionMenu";
import { OrgChart } from "./OrgChart";
import { AccountRowActions } from "./AccountRowActions";
import { TaskSelect } from "../tasks/_components/TaskSelect";
import { accountConfigEffects } from "@/lib/admin/account-config";
import { AvatarStack, Initials } from "../tasks/_components/board-ui";

type AccountManagerClientProps = {
  currentUserEmail: string;
  currentUserPermissions: string[];
  canManageAlerts: boolean;
  initialUsers: ManagedAccountUser[];
  availableRoles: RoleOption[];
  /** Role Manager → Positions, in display order. */
  positions: PositionOption[];
  /** Active accounts on the Agent list (task_agents), for Assistants to support. */
  agentOptions: Array<{ email: string; name: string }>;
  /** Task access each role gives; display only (warnings, Assistant choice). */
  taskAccessByRoleId: Record<string, TaskAccess>;
};

type ManagedAccountUser = AccountUser & {
  role_ids: string[];
  roles: RoleOption[];
  alertsMuted: boolean;
  alertsUpdatedBy: string | null;
  alertsUpdatedAt: string | null;
  /** Position assigned in Account Manager; describes the job, grants nothing. */
  position: PositionOption | null;
  managerName: string | null;
  managerEmail: string | null;
  /** Position, manager and supported Agents as Edit account loads them. */
  config: AccountConfig;
  /** Lower-cased emails of the Assistants who support this person. */
  assistantEmails: string[];
  taskAccess: TaskAccess;
  /** In the CS auto-assign pool unless an Agent or Assistant. */
  csPoolBase: boolean;
};

/** Filter values: [] means everyone; "none" stands for "no role / position / manager". */
const NONE = "none";
const ALL = "__all__";

/** What a save shows on its row before the server answers. */
type RowPatch = Partial<
  Pick<
    ManagedAccountUser,
    | "name"
    | "agent_id"
    | "roles"
    | "role_ids"
    | "position"
    | "config"
    | "managerName"
    | "managerEmail"
    | "assistantEmails"
  >
>;

type FormState = {
  email: string;
  name: string;
  agentId: string;
  password: string;
  roleIds: string[];
  config: AccountConfig;
};

type AlertPreference = {
  alertsMuted: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

const emptyForm: FormState = {
  email: "",
  name: "",
  agentId: "",
  password: "",
  roleIds: [],
  config: { positionId: null, managerId: null, assistedAgentEmails: [] },
};

// Display only (sort order, badge colour). Never decides what anyone may do.
function isAdminRole(role: Pick<RoleOption, "name">) {
  return isAdminRoleName(role.name);
}

export default function AccountManagerClient({
  currentUserEmail,
  currentUserPermissions,
  canManageAlerts,
  initialUsers,
  availableRoles,
  positions,
  agentOptions,
  taskAccessByRoleId,
}: AccountManagerClientProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editUser, setEditUser] = useState<ManagedAccountUser | null>(null);
  /** Edit account opened from the Position cell with an Assistant position picked. */
  const [editInitialConfig, setEditInitialConfig] = useState<AccountConfig | null>(null);
  const [resetUser, setResetUser] = useState<ManagedAccountUser | null>(null);
  /** A Position change that changes who sees what, waiting for Confirm. */
  const [positionConfirm, setPositionConfirm] = useState<{
    user: ManagedAccountUser;
    positionId: string | null;
    effects: string[];
  } | null>(null);
  // Bốn modal nội tuyến trong một component: khoá nền khi BẤT KỲ cái nào mở.
  useBodyScrollLock(Boolean(showCreateForm || editUser || resetUser || positionConfirm));
  const [resetPassword, setResetPassword] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string[]>([]);
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  /** Ids of the people they report to, or NONE. */
  const [managerFilter, setManagerFilter] = useState<string[]>([]);
  // Keep the production default: show active and inactive accounts.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS_FILTER);
  const [view, setView] = useState<"table" | "orgchart">("table");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alertOverrides, setAlertOverrides] = useState<Map<string, AlertPreference>>(
    () => new Map(),
  );
  // Công tắc Alerts khoá theo đúng công tắc đó, không khoá cả dòng (plan
  // instant feedback T3.1).
  const {
    pending: alertPendingIds,
    start: startAlertToggle,
    finish: finishAlertToggle,
  } = usePendingKeys();
  /**
   * Mọi thay đổi trên một dòng (tên, Agent ID, Role, Position, Agent của
   * Assistant, Manager) hiện ngay trên bảng. `base` là danh sách server lúc
   * ghi: lượt đã xác nhận chỉ còn tác dụng tới khi `router.refresh()` mang về
   * danh sách mới (đã có thay đổi đó). Lượt đang chờ thì luôn áp. Server từ
   * chối thì bỏ lượt đó, dòng trở về giá trị đang lưu.
   */
  const [userOverrides, setUserOverrides] = useState<
    ReadonlyMap<
      string,
      {
        patch: RowPatch;
        pending: boolean;
        base: ManagedAccountUser[];
      }
    >
  >(() => new Map());
  const initialUsersRef = useRef(initialUsers);
  useEffect(() => {
    initialUsersRef.current = initialUsers;
  });
  const users = useMemo(
    () =>
      initialUsers.map((user) => {
        const override = userOverrides.get(user.id);
        if (!override || (!override.pending && override.base !== initialUsers)) return user;
        return { ...user, ...override.patch };
      }),
    [initialUsers, userOverrides],
  );
  const canManageAccounts = can(
    currentUserPermissions,
    PERMISSIONS.ACCOUNT_MANAGER
  );
  const canCreate = canManageAccounts;
  const canEdit = canManageAccounts;
  const canResetPassword = canManageAccounts;
  const canAssignRoles = canManageAccounts;
  const nameByEmail = useMemo(
    () =>
      new Map(
        initialUsers.map((user) => [user.email.trim().toLowerCase(), user.name?.trim() || user.email]),
      ),
    [initialUsers],
  );
  const nameOfEmail = useMemo(
    () => (email: string) => nameByEmail.get(email.trim().toLowerCase()) ?? email,
    [nameByEmail],
  );
  const managerOptions = useMemo(
    () =>
      initialUsers
        .filter((user) => user.is_active)
        .map((user) => ({ id: user.id, email: user.email, name: user.name?.trim() || user.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [initialUsers],
  );
  const managerIds = useMemo(
    () => new Set(managerOptions.map((option) => option.id)),
    [managerOptions],
  );

  const sortedUsers = useMemo(
    () =>
      [...users].sort((firstUser, secondUser) => {
        const firstIsAdmin = firstUser.roles.some(isAdminRole);
        const secondIsAdmin = secondUser.roles.some(isAdminRole);

        if (firstIsAdmin !== secondIsAdmin) {
          return firstIsAdmin ? -1 : 1;
        }

        if (firstUser.is_active !== secondUser.is_active) {
          return firstUser.is_active ? -1 : 1;
        }

        return (
          new Date(secondUser.created_at).getTime() -
          new Date(firstUser.created_at).getTime()
        );
      }),
    [users]
  );
  // Who a person reports to: the Agents they assist (an Assistant), else
  // their manager. Same rule as the Manager column and the tree.
  const reportsToIds = useMemo(() => {
    const idByEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user.id]));
    return new Map(
      users.map((user) => [
        user.id,
        user.config.assistedAgentEmails.length > 0
          ? user.config.assistedAgentEmails
              .map((email) => idByEmail.get(email))
              .filter((id): id is string => Boolean(id))
          : user.config.managerId
            ? [user.config.managerId]
            : [],
      ]),
    );
  }, [users]);
  const managerChoices = useMemo(() => {
    const ids = new Set([...reportsToIds.values()].flat());
    return users
      .filter((user) => ids.has(user.id))
      .map((user) => ({ id: user.id, email: user.email, name: user.name?.trim() || user.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [reportsToIds, users]);

  const filteredUsers = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();

    return sortedUsers.filter((user) => {
      if (positionFilter.length > 0 && !positionFilter.includes(user.position?.id ?? NONE)) return false;
      if (roleFilter.length > 0 && !roleFilter.includes(user.role_ids[0] ?? NONE)) return false;
      if (managerFilter.length > 0) {
        const reportsTo = reportsToIds.get(user.id) ?? [];
        const matches =
          (managerFilter.includes(NONE) && reportsTo.length === 0) ||
          reportsTo.some((id) => managerFilter.includes(id));
        if (!matches) return false;
      }
      if (statusFilter && user.is_active !== (statusFilter === "active")) return false;
      if (!query) return true;

      const searchableValues = [
        user.name,
        user.email,
        user.agent_id,
        user.position?.name,
        user.managerName,
        ...user.config.assistedAgentEmails.map(nameOfEmail),
        ...user.roles.map((role) => role.name),
      ];

      return searchableValues.some((value) =>
        value?.toLowerCase().includes(query)
      );
    });
  }, [
    accountSearch,
    managerFilter,
    nameOfEmail,
    positionFilter,
    reportsToIds,
    roleFilter,
    sortedUsers,
    statusFilter,
  ]);
  const isFiltering =
    Boolean(accountSearch.trim()) ||
    positionFilter.length > 0 ||
    roleFilter.length > 0 ||
    managerFilter.length > 0 ||
    statusFilter !== DEFAULT_STATUS_FILTER;
  const alertPreferences = useMemo(() => {
    const preferences = new Map<string, AlertPreference>(
      initialUsers.map((user) => [
        user.id,
        {
          alertsMuted: user.alertsMuted,
          updatedBy: user.alertsUpdatedBy,
          updatedAt: user.alertsUpdatedAt,
        },
      ]),
    );
    for (const [userId, preference] of alertOverrides) {
      if (preferences.has(userId)) preferences.set(userId, preference);
    }
    return preferences;
  }, [alertOverrides, initialUsers]);

  function openCreateForm() {
    setForm(emptyForm);
    setShowCreateForm(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim() || null,
          agentId: form.agentId.trim(),
          password: form.password,
          roleIds: form.roleIds,
          ...(form.config.positionId ? { positionId: form.config.positionId } : {}),
          ...(form.config.managerId ? { managerId: form.config.managerId } : {}),
          ...(positions.find((position) => position.id === form.config.positionId)?.kind === "assistant"
            ? { assistedAgentEmails: form.config.assistedAgentEmails }
            : {}),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Unable to create account.");
        return;
      }

      setMessage(`Created ${payload.user.email}.`);
      setForm(emptyForm);
      setShowCreateForm(false);
      router.refresh();
    } catch {
      setError("Unable to create account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateUser(
    user: ManagedAccountUser,
    payload: Partial<Pick<AccountUser, "is_active">> &
      Partial<EditAccountPayload> & {
        password?: string;
      }
  ) {
    setBusyUserId(user.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse(response);

      if (!response.ok) {
        setError(result.error ?? "Unable to update account.");
        return false;
      }

      setMessage(`Updated ${user.email}.`);
      if (!isPasswordOnlyUpdate(payload)) {
        router.refresh();
      }
      return true;
    } catch {
      setError("Unable to update account. Please try again.");
      return false;
    } finally {
      setBusyUserId(null);
    }
  }

  /** Org chart drop or "Remove manager", after its confirmation. */
  async function changeManagerFromChart(personId: string, managerId: string | null) {
    const user = users.find((item) => item.id === personId);
    if (!user) return false;
    return saveRow(user, { managerId, expected: expectedFor(user) });
  }

  /** Org chart "Add direct report": the new account starts under this manager. */
  function openCreateReport(managerId: string) {
    setForm({ ...emptyForm, config: { ...emptyForm.config, managerId } });
    setShowCreateForm(true);
  }

  function openEditAccountModal(user: ManagedAccountUser) {
    setEditUser(user);
  }

  function setUserOverride(
    userId: string,
    value: { patch: RowPatch; pending: boolean } | null,
  ) {
    setUserOverrides((current) => {
      const next = new Map(current);
      if (value === null) {
        next.delete(userId);
        return next;
      }
      // Keep an earlier save that is still showing (its refresh has not
      // arrived yet), so a second edit does not flash the first one back.
      const earlier = current.get(userId);
      const keep =
        earlier && (earlier.pending || earlier.base === initialUsersRef.current) ? earlier.patch : {};
      next.set(userId, {
        patch: { ...keep, ...value.patch },
        pending: value.pending,
        base: initialUsersRef.current,
      });
      return next;
    });
  }

  /** The row as it will look once this save lands. */
  function rowPatchFor(user: ManagedAccountUser, payload: Partial<EditAccountPayload>): RowPatch {
    const patch: RowPatch = {};
    if (payload.name !== undefined) patch.name = payload.name;
    if (payload.agentId !== undefined) patch.agent_id = payload.agentId || null;
    if (payload.roleIds) {
      patch.role_ids = payload.roleIds;
      patch.roles = availableRoles.filter((role) => payload.roleIds?.includes(role.id));
    }
    const config: AccountConfig = { ...user.config };
    if (payload.positionId !== undefined) {
      const nextPosition = positions.find((position) => position.id === payload.positionId) ?? null;
      patch.position = nextPosition;
      config.positionId = payload.positionId;
      if (nextPosition?.kind !== "assistant") config.assistedAgentEmails = [];
      if (user.position?.kind === "agent" && nextPosition?.kind !== "agent") patch.assistantEmails = [];
    }
    if (payload.assistedAgentEmails) config.assistedAgentEmails = payload.assistedAgentEmails;
    if (payload.managerId !== undefined) {
      const manager = initialUsers.find((candidate) => candidate.id === payload.managerId);
      config.managerId = payload.managerId;
      patch.managerName = manager ? manager.name?.trim() || manager.email : null;
      patch.managerEmail = manager?.email ?? null;
    }
    if (
      payload.positionId !== undefined ||
      payload.assistedAgentEmails !== undefined ||
      payload.managerId !== undefined
    ) {
      patch.config = config;
    }
    return patch;
  }

  /** Show the change on the row now, save, and undo the row if the save fails. */
  async function saveRow(user: ManagedAccountUser, payload: Partial<EditAccountPayload>) {
    setUserOverride(user.id, { patch: rowPatchFor(user, payload), pending: true });
    const updated = await updateUser(user, payload);
    if (updated) {
      setUserOverride(user.id, { patch: {}, pending: false });
    } else {
      setUserOverride(user.id, null);
    }
    return updated;
  }

  function expectedFor(user: ManagedAccountUser) {
    return {
      position_id: user.config.positionId,
      manager_id: user.config.managerId,
      assisted_agent_emails: user.config.assistedAgentEmails,
    };
  }

  async function handleEditAccount(user: ManagedAccountUser, payload: EditAccountPayload) {
    // Đóng hộp và đổi cả dòng ngay. Server từ chối thì dòng trở lại như cũ và
    // hộp mở lại với giá trị đang lưu (updateUser đã hiện lỗi).
    setEditUser(null);
    setEditInitialConfig(null);
    if (!(await saveRow(user, payload))) setEditUser(user);
  }

  // The manager only places someone in the management tree; it grants no
  // access. `expected` refuses the save if someone else changed this account's
  // position, Agents or manager since the page loaded.
  async function setManager(user: ManagedAccountUser, managerId: string | null) {
    await saveRow(user, { managerId, expected: expectedFor(user) });
  }

  /**
   * Position from the table. An Assistant needs its Agents, so that opens Edit
   * account. A change that moves someone on or off the Agent list, or drops
   * Assistant links, changes who sees what: it waits for Confirm. Anything
   * else saves at once.
   */
  function setPosition(user: ManagedAccountUser, positionId: string | null) {
    const kindOf = (id: string | null) => positions.find((position) => position.id === id)?.kind ?? null;
    if (kindOf(positionId) === "assistant") {
      setEditInitialConfig({ ...user.config, positionId, assistedAgentEmails: user.config.assistedAgentEmails });
      setEditUser(user);
      return;
    }
    const next: AccountConfig = { ...user.config, positionId, assistedAgentEmails: [] };
    const effects = accountConfigEffects({
      personName: user.name?.trim() || user.email,
      current: user.config,
      next,
      kindOf,
      assistantNames: user.assistantEmails.map(nameOfEmail),
      nameOfEmail,
      access: { taskAccess: user.taskAccess, csPoolBase: user.csPoolBase },
    });
    if (effects.length > 0) {
      setPositionConfirm({ user, positionId, effects });
      return;
    }
    void saveRow(user, { positionId, expected: expectedFor(user) });
  }

  function confirmPosition() {
    if (!positionConfirm) return;
    const { user, positionId } = positionConfirm;
    setPositionConfirm(null);
    void saveRow(user, { positionId, expected: expectedFor(user) });
  }

  async function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;

    const updated = await updateUser(resetUser, { password: resetPassword });

    if (updated) {
      setResetPassword("");
      setResetUser(null);
    }
  }

  async function toggleAlerts(user: ManagedAccountUser) {
    if (!startAlertToggle(user.id)) return;
    const current = alertPreferences.get(user.id) ?? {
      alertsMuted: user.alertsMuted,
      updatedBy: user.alertsUpdatedBy,
      updatedAt: user.alertsUpdatedAt,
    };
    const previousOverride = alertOverrides.get(user.id);
    const alertsMuted = !current.alertsMuted;
    const optimisticPreference: AlertPreference = {
      alertsMuted,
      updatedBy: currentUserEmail,
      updatedAt: new Date().toISOString(),
    };

    // Đổi giao diện ngay khi bấm; request chỉ đồng bộ lại kết quả thật từ server.
    setAlertOverrides((previous) => {
      const next = new Map(previous);
      next.set(user.id, optimisticPreference);
      return next;
    });
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/notification-alerts`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertsMuted }),
        },
      );
      const result = await readJsonResponse(response);
      if (!response.ok) {
        setAlertOverrides((previous) => {
          const next = new Map(previous);
          if (previousOverride) next.set(user.id, previousOverride);
          else next.delete(user.id);
          return next;
        });
        setError(result.error ?? "Unable to update notification alerts.");
        return;
      }
      setAlertOverrides((previous) => {
        const next = new Map(previous);
        next.set(user.id, {
          alertsMuted: result.alertsMuted === true,
          updatedBy:
            typeof result.updatedBy === "string" ? result.updatedBy : null,
          updatedAt:
            typeof result.updatedAt === "string" ? result.updatedAt : null,
        });
        return next;
      });
    } catch {
      setAlertOverrides((previous) => {
        const next = new Map(previous);
        if (previousOverride) next.set(user.id, previousOverride);
        else next.delete(user.id);
        return next;
      });
      setError("Unable to update notification alerts. Please try again.");
    } finally {
      finishAlertToggle(user.id);
    }
  }

  return (
    // A frame page like the Task board: title and filters stay put, the
    // table scrolls inside its frame.
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <header className={PAGE_HEADER_CLASS}>
          <h1 className={PAGE_TITLE_CLASS}>Account Manager</h1>
          {canCreate && (
            <div className={PAGE_ACTIONS_CLASS}>
              <button type="button" onClick={openCreateForm} className={PAGE_PRIMARY_BUTTON_CLASS}>
                <Plus className="h-4 w-4" />
                New account
              </button>
            </div>
          )}
        </header>

        <section className="mt-2 min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
              {(
                [
                  ["table", "Table"],
                  ["orgchart", "Org chart"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                  className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                    view === value
                      ? "bg-white text-[#0c66e4] shadow-sm"
                      : "text-[#5e6c84] hover:text-[#172b4d]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === "table" && (
              <label className="relative block min-w-[18rem] flex-1">
                <span className="sr-only">Search accounts</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b778c]" aria-hidden />
                <input
                  aria-label="Search accounts"
                  className="h-9 w-full rounded-lg border border-[#dfe1e6] bg-white pl-8 pr-3 text-sm text-[#172b4d] outline-none transition placeholder:text-[#8590a2] hover:border-[#c1c7d0] focus:border-[#0c66e4] focus:ring-2 focus:ring-[#0c66e4]/20"
                  onChange={(event) => setAccountSearch(event.target.value)}
                  placeholder="Search name, email, ID…"
                  type="search"
                  value={accountSearch}
                />
              </label>
            )}
          </div>
          {view === "table" && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <TaskSelect
                multi
                searchable
                values={roleFilter}
                allValue={ALL}
                options={[
                  { value: ALL, label: "All accessibility" },
                  ...availableRoles.map((role) => ({ value: role.id, label: role.name })),
                  { value: NONE, label: "No accessibility" },
                ]}
                placeholder="Accessibility"
                summaryLabel="selected"
                className="w-max min-w-[8rem]"
                buttonClassName={FILTER_BUTTON_CLASS}
                onValuesChange={setRoleFilter}
              />
              <TaskSelect
                multi
                searchable
                values={positionFilter}
                allValue={ALL}
                options={[
                  { value: ALL, label: "All positions" },
                  ...positions.map((position) => ({ value: position.id, label: position.name })),
                  { value: NONE, label: "No position" },
                ]}
                placeholder="Position"
                summaryLabel="positions"
                className="w-max min-w-[8rem]"
                buttonClassName={FILTER_BUTTON_CLASS}
                onValuesChange={setPositionFilter}
              />
              <TaskSelect
                multi
                searchable
                values={managerFilter}
                allValue={ALL}
                options={[
                  { value: ALL, label: "All managers" },
                  ...managerChoices.map((manager) => ({
                    value: manager.id,
                    label: manager.name,
                    keywords: [manager.email],
                  })),
                  { value: NONE, label: "No manager" },
                ]}
                renderOption={(option) => {
                  const manager = managerChoices.find((choice) => choice.id === option.value);
                  return manager ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Initials email={manager.email} label={manager.name} />
                      <span className="truncate">{manager.name}</span>
                    </span>
                  ) : (
                    option.label
                  );
                }}
                placeholder="Manager"
                summaryLabel="managers"
                className="w-max min-w-[8rem]"
                buttonClassName={FILTER_BUTTON_CLASS}
                onValuesChange={setManagerFilter}
              />
              <TaskSelect
                value={statusFilter}
                options={[
                  { value: "", label: "All statuses" },
                  { value: "active", label: "Active" },
                  { value: "disabled", label: "Inactive" },
                ]}
                placeholder="Status"
                className="w-max min-w-[8rem]"
                buttonClassName={FILTER_BUTTON_CLASS}
                onChange={(value) => setStatusFilter(value as StatusFilter)}
              />
              {isFiltering && (
                <button
                  type="button"
                  className="h-9 shrink-0 px-1 text-sm font-medium text-[#0c66e4] transition hover:underline"
                  onClick={() => {
                    setAccountSearch("");
                    setRoleFilter([]);
                    setPositionFilter([]);
                    setManagerFilter([]);
                    setStatusFilter(DEFAULT_STATUS_FILTER);
                  }}
                >
                  Clear all
                </button>
              )}
              <span className="ml-auto shrink-0 text-sm font-medium text-[#626f86]">
                {filteredUsers.length} of {initialUsers.length} accounts
              </span>
            </div>
          )}
        </section>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-[0_1px_2px_rgba(9,30,66,0.12)]">
          <div className="min-h-0 flex-1 overflow-auto">
            {view === "orgchart" && (
              <OrgChart
                people={users}
                currentUserEmail={currentUserEmail}
                editing={
                  canEdit
                    ? {
                        managerIds,
                        onChangeManager: changeManagerFromChart,
                        onEditAccount: (personId) => {
                          const user = users.find((item) => item.id === personId);
                          if (user) openEditAccountModal(user);
                        },
                        onAddReport: openCreateReport,
                      }
                    : null
                }
              />
            )}
            <table hidden={view !== "table"} className="w-full table-fixed border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-[#fafbfc] text-[11px] font-bold uppercase tracking-wide text-[#6b778c] shadow-[0_1px_0_#dfe1e6]">
                <tr>
                  <th className="w-[25%] px-4 py-2">User</th>
                  <th className="w-[15%] px-3 py-2">Accessibility</th>
                  <th className="w-[15%] px-3 py-2">Position</th>
                  <th className="w-[15%] px-3 py-2">Manager</th>
                  <th className="w-[9%] px-3 py-2">Status</th>
                  {canManageAlerts && <th className="w-[7%] px-3 py-2">Alerts</th>}
                  <th className="w-[9%] whitespace-nowrap px-3 py-2 text-right">Created</th>
                  <th className="w-[5%] px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {filteredUsers.map((user) => {
                  const isCurrentUser =
                    user.email.toLowerCase() === currentUserEmail.toLowerCase();
                  const isBusy = busyUserId === user.id;

                  return (
                    <tr
                      key={user.id}
                      className={`border-b border-[#ebecf0] transition-colors last:border-b-0 hover:bg-[#f7f8f9] ${
                        user.is_active ? "" : "bg-[#fafbfc] text-[#6b778c]"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <UserCell user={user} isCurrentUser={isCurrentUser} />
                      </td>
                      <td className="px-3 py-2.5">
                        <RoleBadges user={user} />
                      </td>
                      <td className="px-3 py-2.5">
                        <PositionMenu
                          position={user.position}
                          positions={positions}
                          canEdit={canEdit}
                          lockedReason={
                            isCurrentUser
                              ? "You cannot change your own position."
                              : !user.is_active
                                ? "Enable the account before changing its position."
                                : null
                          }
                          busy={isBusy}
                          onChange={(positionId) => setPosition(user, positionId)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        {/* An Assistant's manager is the Agent(s) they support.
                            Changing those changes access, so it goes through
                            Edit account and its warnings. */}
                        {user.config.assistedAgentEmails.length > 0 ? (
                          <button
                            type="button"
                            disabled={isBusy || !canEdit}
                            onClick={() => openEditAccountModal(user)}
                            title="Change in Edit account"
                            className="block max-w-full rounded text-left transition hover:opacity-80 disabled:cursor-default disabled:hover:opacity-100"
                          >
                            <PeopleCell emails={user.config.assistedAgentEmails} nameByEmail={nameByEmail} />
                          </button>
                        ) : (
                          <ManagerMenu
                            manager={
                              user.config.managerId && user.managerEmail
                                ? {
                                    id: user.config.managerId,
                                    email: user.managerEmail,
                                    name: user.managerName ?? user.managerEmail,
                                  }
                                : null
                            }
                            options={managerOptions.filter((option) => option.id !== user.id)}
                            canEdit={canEdit}
                            busy={isBusy}
                            onChange={(managerId) => void setManager(user, managerId)}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge active={user.is_active} />
                      </td>
                      {canManageAlerts && (
                        <td className="px-3 py-2.5">
                          <AlertCheckbox
                            busy={isBusy || alertPendingIds.has(user.id)}
                            preference={
                              alertPreferences.get(user.id) ?? {
                                alertsMuted: user.alertsMuted,
                                updatedBy: user.alertsUpdatedBy,
                                updatedAt: user.alertsUpdatedAt,
                              }
                            }
                            updatedByName={nameOfEmail(
                              alertPreferences.get(user.id)?.updatedBy ??
                                user.alertsUpdatedBy ??
                                "",
                            )}
                            onClick={() => void toggleAlerts(user)}
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-semibold text-[#6b778c]">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <AccountRowActions
                          label={`Actions for ${user.email}`}
                          actions={[
                            {
                              label: "Edit account",
                              disabled: isBusy || !canEdit,
                              onSelect: () => openEditAccountModal(user),
                            },
                            {
                              label: "Reset password",
                              disabled: isBusy || !canResetPassword,
                              onSelect: () => {
                                setResetUser(user);
                                setResetPassword("");
                              },
                            },
                            // Accounts are disabled, never deleted: their email still
                            // ties tasks, leads, enrollments and leave to them.
                            {
                              label: user.is_active ? "Disable account" : "Enable account",
                              tone: user.is_active ? "danger" : "success",
                              disabled: isBusy || isCurrentUser || !canEdit,
                              onSelect: () => void updateUser(user, { is_active: !user.is_active }),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td
                      className="px-4 py-12 text-center text-sm font-semibold text-[#6b778c]"
                      colSpan={canManageAlerts ? 8 : 7}
                    >
                      {isFiltering
                        ? "No accounts match your search or filter."
                        : "No accounts yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreateForm && (
        <CreateAccountDialog
          form={form}
          roles={availableRoles}
          positions={positions}
          agentOptions={agentOptions}
          managerOptions={managerOptions}
          nameOfEmail={nameOfEmail}
          taskAccessByRoleId={taskAccessByRoleId}
          canAssignRoles={canAssignRoles}
          submitting={isSubmitting}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          onClose={() => setShowCreateForm(false)}
          onSubmit={handleSubmit}
        />
      )}

      {editUser && (
        <EditAccountDialog
          account={{
            id: editUser.id,
            email: editUser.email,
            name: editUser.name,
            agent_id: editUser.agent_id,
            is_active: editUser.is_active,
            role_ids: editUser.role_ids,
            config: editUser.config,
            assistantEmails: editUser.assistantEmails,
            taskAccess: editUser.taskAccess,
            csPoolBase: editUser.csPoolBase,
          }}
          taskAccessByRoleId={taskAccessByRoleId}
          isCurrentUser={editUser.email.toLowerCase() === currentUserEmail.toLowerCase()}
          roles={availableRoles}
          positions={positions}
          agentOptions={agentOptions}
          managerOptions={managerOptions}
          nameOfEmail={nameOfEmail}
          busy={busyUserId === editUser.id}
          initialConfig={editInitialConfig ?? undefined}
          onCancel={() => {
            setEditUser(null);
            setEditInitialConfig(null);
          }}
          onSave={(payload) => void handleEditAccount(editUser, payload)}
        />
      )}

      {positionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <div className="w-full max-w-[460px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-[#16233a]">Change position?</h2>
            <p className="mt-1 text-sm text-[#667085]">
              This changes what people can see and do:
            </p>
            <div className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {positionConfirm.effects.map((effect) => (
                <p key={effect}>{effect}</p>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                onClick={() => setPositionConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155]"
                onClick={confirmPosition}
              >
                Change position
              </button>
            </div>
          </div>
        </div>
      )}

      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <form
            className="w-full max-w-[420px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl"
            onSubmit={handleResetPassword}
          >
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-[#16233a]">
                Reset Password
              </h2>
              <p className="mt-1 truncate text-sm text-[#667085]">
                {resetUser.email}
              </p>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-[#344054]">
                New password
              </span>
              <input
                className="mt-1 w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15"
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
                type="button"
                onClick={() => {
                  setResetUser(null);
                  setResetPassword("");
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155] disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={busyUserId === resetUser.id}
              >
                {busyUserId === resetUser.id ? "Saving..." : "Save Password"}
              </button>
            </div>
          </form>
        </div>
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
function isPasswordOnlyUpdate(
  payload: Partial<Pick<AccountUser, "is_active">> & {
    name?: string | null;
    password?: string;
    roleIds?: string[];
  }
) {
  return (
    payload.password !== undefined &&
    payload.name === undefined &&
    payload.roleIds === undefined &&
    payload.is_active === undefined
  );
}

async function readJsonResponse(response: Response) {
  const text = await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text) as { error?: string; [key: string]: unknown };
  } catch {
    return {
      error: response.ok
        ? "Unexpected response from server."
        : text.slice(0, 200),
    };
  }
}

function UserCell({ user, isCurrentUser }: { user: ManagedAccountUser; isCurrentUser: boolean }) {
  const name = user.name?.trim() || user.email;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Initials email={user.email} label={name} size="md" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate font-semibold ${user.is_active ? "text-[#172b4d]" : "text-[#6b778c]"}`}>
            {user.name || "No name"}
          </span>
          {isCurrentUser && (
            <span className="shrink-0 rounded bg-[#e9f2ff] px-1 py-px text-[10px] font-bold uppercase text-[#0c66e4]">
              You
            </span>
          )}
        </div>
        <div className="truncate text-xs text-[#6b778c]" title={user.email}>
          {user.email}
          {user.agent_id ? <span className="text-[#8590a2]"> · {user.agent_id}</span> : null}
        </div>
      </div>
    </div>
  );
}

// Same filter buttons as the Task Board toolbar.
type StatusFilter = "" | "active" | "disabled";
const DEFAULT_STATUS_FILTER: StatusFilter = "";

const FILTER_BUTTON_CLASS =
  "!h-9 !rounded-lg !border !border-[#dfe1e6] !px-3 !text-sm !font-medium !shadow-none";

// Wraps instead of cutting, so a long role name stays whole.
const LOZENGE = "inline-block max-w-full break-words rounded px-1.5 py-0.5 text-[11px] font-bold uppercase leading-4";

function RoleBadges({ user }: { user: ManagedAccountUser }) {
  if (user.roles.length === 0) {
    return <span className={`${LOZENGE} bg-[#fff7d6] text-[#a54800]`}>No accessibility</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {user.roles.map((role) => (
        <span
          key={role.id}
          title={role.name}
          className={`${LOZENGE} ${
            isAdminRole(role) ? "bg-[#e9f2ff] text-[#0055cc]" : "bg-[#f1f2f4] text-[#44546f]"
          }`}
        >
          {role.name}
        </span>
      ))}
    </div>
  );
}

// Same look as the Agent cell on the Task Board: avatar + name.
function PersonCell({ email, name }: { email: string | null; name: string | null }) {
  if (!email) return <span className="text-xs text-[#8590a2]">—</span>;
  const label = name ?? email;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#42526e]" title={label}>
      <Initials email={email} label={label} />
      <span className="truncate">{label}</span>
    </span>
  );
}

// Several managers (an Assistant supporting several Agents): stacked avatars,
// the first name, and how many more.
function PeopleCell({
  emails,
  nameByEmail,
}: {
  emails: string[];
  nameByEmail: Map<string, string>;
}) {
  if (emails.length === 1) return <PersonCell email={emails[0]} name={nameByEmail.get(emails[0]) ?? null} />;
  const names = emails.map((email) => nameByEmail.get(email) ?? email);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#42526e]" title={names.join(", ")}>
      <AvatarStack emails={emails} labelByEmail={nameByEmail} />
      <span className="truncate">
        {names[0]} +{emails.length - 1}
      </span>
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${active ? "bg-[#22a06b]" : "bg-[#8590a2]"}`}
      />
      <span className={active ? "text-[#216e4e]" : "text-[#6b778c]"}>
        {active ? "Active" : "Disabled"}
      </span>
    </span>
  );
}

function AlertCheckbox({
  busy,
  preference,
  updatedByName,
  onClick,
}: {
  busy: boolean;
  preference: {
    alertsMuted: boolean;
    updatedBy: string | null;
    updatedAt: string | null;
  };
  updatedByName: string | null | undefined;
  onClick: () => void;
}) {
  const tooltip =
    preference.alertsMuted && preference.updatedAt
      ? `Muted by ${updatedByName ?? preference.updatedBy ?? "admin"} · ${formatTableDate(preference.updatedAt)}`
      : undefined;
  const enabled = !preference.alertsMuted;
  return (
    <input
      type="checkbox"
      checked={enabled}
      aria-label={preference.alertsMuted ? "Enable alerts" : "Mute alerts"}
      title={tooltip ?? (enabled ? "Alerts on" : "Alerts off")}
      disabled={busy}
      onChange={onClick}
      className="h-4 w-4 cursor-pointer accent-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
