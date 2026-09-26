import { describe, expect, it } from "vitest";
import * as enrollment from "@/lib/enrollment/policy";
import * as lead from "@/lib/leads/access";
import * as task from "@/lib/tasks/access";
import { deriveCompatGrants } from "./compat";
import * as legacyEnrollment from "./legacy/enrollment-access";
import * as legacyLead from "./legacy/lead-access";
import { PERSONAS } from "./legacy/personas";
import * as legacyTask from "./legacy/task-access";

/**
 * TƯƠNG ĐƯƠNG Ở TEST (thay shadow runtime — plan Phần III, Phase B): với mọi
 * persona có role CHƯA chuyển sang grant, quyết định mới (grant tương thích →
 * policy theo scope) phải trùng quyết định cũ (bản đóng băng trước Phase D) ở
 * MỌI tổ hợp quan hệ nhất quán.
 */

const ME = "me@x.com";
const OTHER_AGENT = "agent.other@x.com";

function booleanCombos<K extends string>(keys: readonly K[]): Record<K, boolean>[] {
  const out: Record<K, boolean>[] = [];
  for (let mask = 0; mask < 1 << keys.length; mask += 1) {
    const combo = {} as Record<K, boolean>;
    keys.forEach((key, index) => {
      combo[key] = Boolean(mask & (1 << index));
    });
    out.push(combo);
  }
  return out;
}

const TASK_FLAG_KEYS = [
  "isAssignee",
  "isAgentOwner",
  "isAgentMember",
  "isParticipant",
  "isReporter",
  "seesAllTasks",
] as const;

type TaskFlags = Record<(typeof TASK_FLAG_KEYS)[number], boolean>;

/**
 * Tổ hợp NHẤT QUÁN với cách route tính cờ: `isAgentMember` (assistant của agent)
 * kéo theo `isAgentOwner`; chính agent thì không là assistant của mình; task
 * không có agent thì không ai là owner.
 */
function consistentTaskCases(): { agentEmail: string | null | undefined; flags: TaskFlags }[] {
  const cases: { agentEmail: string | null | undefined; flags: TaskFlags }[] = [];
  for (const agentEmail of [undefined, null, ME, OTHER_AGENT]) {
    for (const flags of booleanCombos(TASK_FLAG_KEYS)) {
      if (flags.isAgentMember && !flags.isAgentOwner) continue;
      if (agentEmail === ME && flags.isAgentMember) continue;
      if (agentEmail === null && (flags.isAgentOwner || flags.isAgentMember)) continue;
      cases.push({ agentEmail, flags });
    }
  }
  return cases;
}

function actorsFor(name: string) {
  const access = PERSONAS[name];
  const grants = deriveCompatGrants(access);
  const legacyActor = legacyTask.buildTaskActor(access.permissions, ME, {
    isAdmin: legacyTask.isTaskViewAdmin({ role: access.legacyRole ?? null, roles: [...access.roles] }),
  });
  return {
    legacyActor,
    taskActor: task.taskActorFromGrants(ME, grants),
    enrollmentActor: enrollment.enrollmentActorFromGrants(ME, grants),
  };
}

describe("Task: policy theo grant ≡ quyết định cũ", () => {
  for (const name of Object.keys(PERSONAS)) {
    const { legacyActor, taskActor } = actorsFor(name);

    it(`${name}: cổng mức board`, () => {
      expect(task.canAccessBoard(taskActor)).toBe(legacyTask.canAccessBoard(legacyActor));
      expect(task.canSeeBacklog(taskActor)).toBe(legacyTask.canSeeBacklog(legacyActor));
      expect(task.canCreateTask(taskActor)).toBe(legacyTask.canCreateTask(legacyActor));
      expect(task.canAssign(taskActor)).toBe(legacyTask.canAssign(legacyActor));
      expect(task.canManageCategories(taskActor)).toBe(legacyTask.canManageCategories(legacyActor));
      // Overview, cấu hình SLA/nhắc việc/hàng đợi từng gác bằng `isManager`.
      expect(task.canReadTaskOverview(taskActor)).toBe(legacyActor.isManager);
      expect(task.canManageTaskConfig(taskActor)).toBe(legacyActor.isManager);
      expect(task.holdsAllTaskScopes(taskActor)).toBe(legacyActor.isManager);
      expect(taskActor.isManager).toBe(legacyActor.isManager);
      expect(taskActor.isWorker).toBe(legacyActor.isWorker);
      for (const hasAgentScope of [false, true]) {
        expect(task.canCreateTaskWithScope(taskActor, hasAgentScope)).toBe(
          legacyTask.canCreateTaskWithScope(legacyActor, hasAgentScope)
        );
      }
    });

    it(`${name}: capability trên từng task, mọi tổ hợp quan hệ`, () => {
      for (const { agentEmail, flags } of consistentTaskCases()) {
        const ref = agentEmail === undefined
          ? { assignee_email: null }
          : { assignee_email: null, agent_email: agentEmail };
        const context = JSON.stringify({ agentEmail, flags });
        expect(task.resolveTaskCapabilities(taskActor, ref, flags), context).toEqual(
          legacyTask.resolveTaskCapabilities(legacyActor, { assignee_email: null }, flags)
        );
        // Activity: route cũ cho manager hoặc agent owner/assistant.
        expect(task.canReadTaskActivity(taskActor, flags.isAgentOwner), context).toBe(
          legacyActor.isManager || (legacyActor.isWorker && flags.isAgentOwner)
        );
      }
    });

    it(`${name}: phân giao khi tạo task`, () => {
      for (const hasAgentScope of [false, true]) {
        // Route gọi canCreateTaskWithScope TRƯỚC resolveCreateAssignment.
        if (!legacyTask.canCreateTaskWithScope(legacyActor, hasAgentScope)) continue;
        for (const input of [
          { assignee_email: null, status: "backlog" as const },
          { assignee_email: null, status: "todo" as const },
          { assignee_email: "cs@x.com", status: "backlog" as const },
          { assignee_email: "cs@x.com", status: "in_progress" as const },
        ]) {
          expect(task.resolveCreateAssignment(taskActor, input, { hasAgentScope })).toEqual(
            legacyTask.resolveCreateAssignment(legacyActor, input, { hasAgentScope })
          );
        }
      }
    });
  }
});

const ENROLLMENT_FLAG_KEYS = ["isAgentOwner", "isCaller", "isResponsible", "isCreator"] as const;

describe("Enrollment: policy theo grant ≡ quyết định cũ", () => {
  for (const name of Object.keys(PERSONAS)) {
    const { legacyActor, enrollmentActor } = actorsFor(name);

    it(`${name}: cổng và capability, mọi tổ hợp quan hệ`, () => {
      expect(enrollment.canAccessEnrollment(enrollmentActor)).toBe(
        legacyEnrollment.canAccessEnrollment(legacyActor)
      );
      expect(enrollment.canManageEnrollmentOptions(enrollmentActor)).toBe(
        legacyEnrollment.canManageEnrollmentOptions(legacyActor)
      );
      expect(enrollment.canReadEnrollmentOverview(enrollmentActor)).toBe(legacyActor.isManager);
      expect(enrollmentActor.isManager).toBe(legacyActor.isManager);
      expect(enrollmentActor.isWorker).toBe(legacyActor.isWorker);
      for (const hasAgentScope of [false, true]) {
        expect(enrollment.canCreateEnrollmentWithScope(enrollmentActor, hasAgentScope)).toBe(
          legacyEnrollment.canCreateEnrollmentWithScope(legacyActor, hasAgentScope)
        );
      }
      for (const flags of booleanCombos(ENROLLMENT_FLAG_KEYS)) {
        expect(
          enrollment.resolveEnrollmentCapabilities(enrollmentActor, flags),
          JSON.stringify(flags)
        ).toEqual(legacyEnrollment.resolveEnrollmentCapabilities(legacyActor, flags));
      }
    });
  }
});

describe("Lead: policy theo grant ≡ quyết định cũ", () => {
  for (const [name, access] of Object.entries(PERSONAS)) {
    const legacyActor = legacyLead.buildLeadActor(access.permissions, ME, {
      isAdmin: legacyLead.isLeadViewAdmin({ role: access.legacyRole ?? null, roles: [...access.roles] }),
    });
    const actor = lead.leadActorFromGrants(ME, deriveCompatGrants(access));

    it(`${name}: cổng module và từng lead`, () => {
      const manages = legacyLead.canManageLeads(legacyActor);
      expect(lead.canWorkLeads(actor)).toBe(legacyLead.canWorkLeads(legacyActor));
      expect(lead.canCreateLeads(actor)).toBe(manages);
      expect(lead.canAssignLeads(actor)).toBe(manages);
      expect(lead.canImportLeads(actor)).toBe(manages);
      expect(lead.canManageLeadSettings(actor)).toBe(manages);
      expect(lead.canReadLeadOverview(actor)).toBe(manages);
      expect(lead.canConfigureLeadColumns(actor)).toBe(manages);
      expect(actor.isManager).toBe(legacyActor.isManager);
      expect(actor.isWorker).toBe(legacyActor.isWorker);

      // Chính mình được giao thì isOwnerOrAssistant luôn đúng; lead chưa giao
      // thì không ai là owner/assistant.
      for (const assigned of [ME, OTHER_AGENT, null]) {
        for (const isOwnerOrAssistant of [false, true]) {
          if (assigned === ME && !isOwnerOrAssistant) continue;
          if (assigned === null && isOwnerOrAssistant) continue;
          const row = { assigned_to_email: assigned };
          const flags = { isOwnerOrAssistant };
          const context = JSON.stringify({ assigned, isOwnerOrAssistant });
          expect(lead.canViewLead(actor, row, flags), context).toBe(
            legacyLead.canViewLead(legacyActor, row, flags)
          );
          expect(lead.canEditLead(actor, row, flags), context).toBe(
            legacyLead.canEditLead(legacyActor, row, flags)
          );
          expect(lead.canLogInteraction(actor, row, flags), context).toBe(
            legacyLead.canLogInteraction(legacyActor, row, flags)
          );
        }
      }
    });
  }
});

describe("grant tường minh hẹp hơn: scope thật sự có tác dụng", () => {
  // Role đã chuyển sang grant: chỉ xem/đổi trạng thái task được giao.
  const narrow = task.taskActorFromGrants(ME, ["task.read:assigned", "task.status.update:assigned"]);

  it("chỉ quan hệ được cấp mới mở quyền", () => {
    expect(task.canViewTask(narrow, { assignee_email: null }, { isAssignee: true })).toBe(true);
    expect(task.canViewTask(narrow, { assignee_email: null }, { isReporter: true })).toBe(false);
    expect(task.canViewTask(narrow, { assignee_email: null }, { seesAllTasks: true })).toBe(false);
    expect(
      task.canMutateTask(narrow, { assignee_email: null }, { isAgentOwner: true, isReporter: true })
    ).toBe(false);
  });

  it("agent_owned và assistant_for_agent tách được khi biết agent của task", () => {
    const ownOnly = task.taskActorFromGrants(ME, ["task.read:agent_owned"]);
    expect(
      task.canViewTask(ownOnly, { assignee_email: null, agent_email: ME }, { isAgentOwner: true })
    ).toBe(true);
    expect(
      task.canViewTask(
        ownOnly,
        { assignee_email: null, agent_email: OTHER_AGENT },
        { isAgentOwner: true, isAgentMember: true }
      )
    ).toBe(false);
  });

  it("read:all không kéo theo quyền sửa", () => {
    const reader = task.taskActorFromGrants(ME, ["task.read:all"]);
    expect(reader.isManager).toBe(true);
    expect(task.holdsAllTaskScopes(reader)).toBe(false);
    expect(task.resolveTaskCapabilities(reader, { assignee_email: null }, {})).toMatchObject({
      canView: true,
      canEditContent: false,
      canAssign: false,
      canDelete: false,
    });
    expect(task.canSeeBacklog(reader)).toBe(false);
  });
});
