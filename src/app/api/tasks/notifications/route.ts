import { newestNotificationAt } from "@/lib/notifications/delivery-cursor";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifTopic } from "@/lib/tasks/realtime";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
import { RouteTiming } from "@/lib/server-timing";
import { buildTaskActor } from "@/lib/tasks/access";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import { canViewTimeOffNotification } from "@/lib/time-off/notification-access";
import { redactNotification } from "@/lib/notifications/redaction";
import {
  visibleNotificationTaskIds,
  visibleNotificationTaskIdsById,
  type NotificationTaskScopeRow,
} from "@/lib/notifications/task-visibility";
import { canAccessEnrollment } from "@/lib/enrollment/access";
import {
  buildEnrollmentScope,
  fetchViewerPersonColumns,
  isRecordInScope,
} from "@/lib/enrollment/scope";
import { freshNotificationMembership } from "@/lib/notifications/membership";
import { alertsMutedFromRow } from "@/lib/notifications/alert-preferences";
import {
  countsAsUnread,
  parseNotificationPageCursor,
  UNREAD_SINCE,
} from "@/lib/notifications/unread-cutoff";

export const dynamic = "force-dynamic";

/** Notifications per bell page. */
const PAGE_SIZE = 30;

export async function GET(req: Request) {
  const timing = new RouteTiming("task-notifications");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };
  const session = await timing.measure("auth", async () => auth());
  const email = session?.user?.email;
  if (!email) return respond({ error: "Unauthorized" }, 401);
  // Read current RBAC rather than the per-instance JWT lookup: notifications
  // outlive assignments and a disabled account can retain a valid cookie.
  const access = await timing.measure("access", () => getUserAccessByEmail(email));
  if (!access.isActive) return respond({ error: "Unauthorized" }, 401);
  const viewerActor = buildTaskActor(access.permissions, email);

  const supabase = getSupabaseAdmin();
  const searchParams = new URL(req.url).searchParams;
  const mode = searchParams.get("mode");

  // Background consumers only need the unread badge and the task ids used by
  // the board's assignment hint. Keeping this path free of notification text
  // and enrichment queries makes polling cheap; the full list is loaded when
  // the user opens the dropdown or a realtime signal arrives.
  if (mode === "summary") {
    const tCounts = performance.now();
    const [
      unreadRes,
      enrollmentUnreadRes,
      timeOffUnreadRes,
      unreadAssignedRes,
      ...latestRes
    ] = await Promise.all([
      supabase
        .from("task_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("is_read", false)
        .gte("created_at", UNREAD_SINCE),
      supabase
        .from("enrollment_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("is_read", false)
        .gte("created_at", UNREAD_SINCE),
      supabase
        .from("time_off_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("is_read", false)
        .gte("created_at", UNREAD_SINCE),
      supabase
        .from("task_notifications")
        .select("task_id")
        .eq("recipient_email", email)
        .eq("type", "assigned")
        .eq("is_read", false)
        .gte("created_at", UNREAD_SINCE),
      // Mốc phát hiện thông báo mới cho vòng lặp nền.
      //
      // Số chưa đọc KHÔNG dùng làm mốc được: nó là tổng của ba bảng và lên
      // xuống hai chiều. Một thông báo mới tới (+1) đúng lúc người dùng đọc
      // một cái cũ ở tab khác (−1) thì tổng không đổi, và vòng lặp kết luận
      // "không có gì mới" rồi bỏ lỡ hẳn cái vừa tới.
      //
      // Mỗi truy vấn chỉ lấy MỘT dòng mới nhất, không đếm, nên đường polling
      // vẫn rẻ.
      ...["task_notifications", "enrollment_notifications", "time_off_notifications"].map(
        (table) =>
          supabase
            .from(table)
            .select("created_at")
            .eq("recipient_email", email)
            .order("created_at", { ascending: false })
            .limit(1),
      ),
    ]);
    timing.record("counts", performance.now() - tCounts);

    if (unreadRes.error) {
      return respond({ error: unreadRes.error.message }, 500);
    }
    if (
      enrollmentUnreadRes.error &&
      !isMissingOptionalTableError(enrollmentUnreadRes.error)
    ) {
      return respond(
        { error: enrollmentUnreadRes.error.message },
        500,
      );
    }
    if (
      timeOffUnreadRes.error &&
      !isMissingOptionalTableError(timeOffUnreadRes.error)
    ) {
      return respond(
        { error: timeOffUnreadRes.error.message },
        500,
      );
    }
    if (unreadAssignedRes.error) {
      return respond(
        { error: unreadAssignedRes.error.message },
        500,
      );
    }

    const assignedTaskIds = [
      ...new Set(
        ((unreadAssignedRes.data ?? []) as { task_id: string }[]).map(
          (notification) => notification.task_id,
        ),
      ),
    ];
    let visibleAssignedIds = new Set<string>();
    try {
      visibleAssignedIds = await visibleNotificationTaskIdsById(viewerActor, assignedTaskIds, supabase);
    } catch (error) {
      console.warn("Task notification scope lookup failed", {
        code: error instanceof Error ? error.message : "unknown",
      });
    }
    const unreadAssignedTaskIds = assignedTaskIds.filter((id) => visibleAssignedIds.has(id));
    // Bảng enrollment/time-off có thể chưa tồn tại ở môi trường cũ — lỗi "thiếu
    // bảng" đã được bỏ qua ở trên, nên ở đây cũng chỉ nhặt dữ liệu đọc được.
    //
    // So bằng `newestNotificationAt` chứ không sắp chuỗi: hai thời điểm viết ở
    // hai múi giờ khác nhau thì thứ tự chữ cái không còn là thứ tự thời gian.
    const latestAt = newestNotificationAt(
      latestRes.flatMap(
        (result) => (result.data ?? []) as { created_at?: string | null }[],
      ),
    );

    return respond({
      unread:
        (unreadRes.count ?? 0) +
        (enrollmentUnreadRes.count ?? 0) +
        (timeOffUnreadRes.count ?? 0),
      unreadAssignedTaskIds,
      latestAt,
      topic: notifTopic(email),
    });
  }

  // One bell page, newest first. `filter=unread` keeps only what still counts
  // as unread; `before` + `skip` continue with the next, older page. `skip`
  // covers rows already shown at exactly `before`: a cron run inserts many
  // rows at the same instant, and a page edge inside that batch must not drop
  // the rest of it.
  const unreadOnly = searchParams.get("filter") === "unread";
  const cursor = parseNotificationPageCursor(searchParams);
  const pageOf = (table: string, columns: string, skipIds: readonly string[]) => {
    let query = supabase.from(table).select(columns).eq("recipient_email", email);
    if (unreadOnly) query = query.eq("is_read", false).gte("created_at", UNREAD_SINCE);
    if (cursor) {
      query = query.lte("created_at", cursor.before);
      if (skipIds.length > 0) query = query.not("id", "in", `(${skipIds.join(",")})`);
    }
    return query.order("created_at", { ascending: false }).limit(PAGE_SIZE + 1);
  };

  // The newest row of any read state, first page only. The bell keeps it as
  // its "seen up to" mark: taken from the Unread list instead, a newest row
  // that is already read would make every poll look like news.
  const latestPromise = cursor
    ? Promise.resolve([] as { data: { created_at?: string | null }[] | null }[])
    : Promise.all(
        ["task_notifications", "enrollment_notifications", "time_off_notifications"].map((table) =>
          supabase
            .from(table)
            .select("created_at")
            .eq("recipient_email", email)
            .order("created_at", { ascending: false })
            .limit(1),
        ),
      );

  const tLists = performance.now();
  const [
    { data, error },
    enrollmentRes,
    timeOffRes,
    unreadRes,
    enrollmentUnreadRes,
    timeOffUnreadRes,
    unreadAssignedRes,
    notificationPreferencesRes,
  ] = await Promise.all([
    pageOf(
      "task_notifications",
      "id,task_id,type,actor_email,comment_id,detail,is_read,created_at",
      cursor?.skip.task ?? [],
    ),
    pageOf(
      "enrollment_notifications",
      "id,record_id,type,actor_email,comment_id,detail,is_read,created_at",
      cursor?.skip.enrollment ?? [],
    ),
    pageOf(
      "time_off_notifications",
      "id,request_id,type,actor_email,detail,is_read,created_at",
      cursor?.skip.timeoff ?? [],
    ),
    supabase
      .from("task_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("is_read", false)
      .gte("created_at", UNREAD_SINCE),
    supabase
      .from("enrollment_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("is_read", false)
      .gte("created_at", UNREAD_SINCE),
    supabase
      .from("time_off_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("is_read", false)
      .gte("created_at", UNREAD_SINCE),
    supabase
      .from("task_notifications")
      .select("task_id")
      .eq("recipient_email", email)
      .eq("type", "assigned")
      .eq("is_read", false)
      .gte("created_at", UNREAD_SINCE),
    supabase
      .from("notification_preferences")
      .select("sound_enabled")
      .eq("email", email)
      .maybeSingle(),
  ]);
  timing.record("lists", performance.now() - tLists);
  if (error) return respond({ error: error.message }, 500);
  if (enrollmentRes.error && !isMissingOptionalTableError(enrollmentRes.error)) {
    return respond({ error: enrollmentRes.error.message }, 500);
  }
  if (unreadRes.error) {
    return respond({ error: unreadRes.error.message }, 500);
  }
  if (
    enrollmentUnreadRes.error &&
    !isMissingOptionalTableError(enrollmentUnreadRes.error)
  ) {
    return respond(
      { error: enrollmentUnreadRes.error.message },
      500
    );
  }
  if (timeOffRes.error && !isMissingOptionalTableError(timeOffRes.error)) {
    return respond({ error: timeOffRes.error.message }, 500);
  }
  if (
    timeOffUnreadRes.error &&
    !isMissingOptionalTableError(timeOffUnreadRes.error)
  ) {
    return respond(
      { error: timeOffUnreadRes.error.message },
      500
    );
  }
  if (unreadAssignedRes.error) {
    return respond({ error: unreadAssignedRes.error.message }, 500);
  }

  const taskBase = ((data ?? []) as unknown as {
    id: string;
    task_id: string;
    type: string;
    actor_email: string;
    comment_id: string | null;
    detail: string | null;
    is_read: boolean;
    created_at: string;
  }[]).map((n) => ({
    ...n,
    is_read: !countsAsUnread(n),
    id: `task:${n.id}`,
    entity_type: "task" as const,
    entity_id: n.task_id,
  }));
  const enrollmentBase = ((enrollmentRes.data ?? []) as unknown as {
    id: string;
    record_id: string;
    type: string;
    actor_email: string;
    comment_id: string | null;
    detail: string | null;
    is_read: boolean;
    created_at: string;
  }[]).map((n) => ({
    ...n,
    is_read: !countsAsUnread(n),
    id: `enrollment:${n.id}`,
    task_id: n.record_id,
    entity_type: "enrollment" as const,
    entity_id: n.record_id,
  }));
  // Time Off không có bình luận, nên `comment_id` luôn null — vẫn phải có mặt
  // để ba nguồn cùng một hình dạng khi trộn.
  const timeOffBase = ((timeOffRes.data ?? []) as unknown as {
    id: string;
    request_id: string;
    type: string;
    actor_email: string;
    detail: string | null;
    is_read: boolean;
    created_at: string;
  }[]).map((n) => ({
    ...n,
    is_read: !countsAsUnread(n),
    id: `timeoff:${n.id}`,
    task_id: n.request_id,
    comment_id: null as string | null,
    entity_type: "time_off" as const,
    entity_id: n.request_id,
  }));
  const merged = [...taskBase, ...enrollmentBase, ...timeOffBase].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  // Each table returned up to PAGE_SIZE + 1 rows, so anything past PAGE_SIZE
  // here means an older page exists.
  const hasMore = merged.length > PAGE_SIZE;
  const base = merged.slice(0, PAGE_SIZE);

  // Enrich with the task title, actor display name, and comment body so the bell
  // tells users exactly what happened before they click.
  const taskIds = [
    ...new Set(base.filter((n) => n.entity_type === "task").map((n) => n.entity_id)),
  ];
  const enrollmentIds = [
    ...new Set(
      base.filter((n) => n.entity_type === "enrollment").map((n) => n.entity_id)
    ),
  ];
  const timeOffIds = [
    ...new Set(
      base.filter((n) => n.entity_type === "time_off").map((n) => n.entity_id)
    ),
  ];
  const actorEmails = [...new Set(base.map((n) => n.actor_email))];
  const taskCommentIds = [
    ...new Set(
      base
        .filter((n) => n.entity_type === "task")
        .map((n) => n.comment_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const enrollmentCommentIds = [
    ...new Set(
      base
        .filter((n) => n.entity_type === "enrollment")
        .map((n) => n.comment_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const tEnrich = performance.now();
  const [
    titlesRes,
    enrollmentTitlesRes,
    timeOffTitlesRes,
    actorsRes,
    commentsRes,
    enrollmentCommentsRes,
  ] = await Promise.all([
    taskIds.length
      ? supabase.from("tasks").select("id,title,display_number,agent_email,assignee_email,reporter_email").in("id", taskIds)
      : Promise.resolve({ data: [] as Array<NotificationTaskScopeRow & { title: string; display_number: number | null }>, error: null }),
    enrollmentIds.length
      ? supabase
          .from("enrollment_records")
          .select("id,client_name,display_number,program,agent_email,caller_email,responsible_enroll_email,created_by_email,custom_values,archived_at")
          .in("id", enrollmentIds)
      : Promise.resolve({ data: [] as {
          id: string;
          client_name: string | null;
          display_number: number | null;
          program: EnrollmentProgram;
          agent_email: string | null;
          caller_email: string | null;
          responsible_enroll_email: string | null;
          created_by_email: string | null;
          custom_values: Record<string, unknown> | null;
          archived_at: string | null;
        }[], error: null }),
    timeOffIds.length
      ? supabase
          .from("time_off_requests")
          .select("id,start_date,end_date,total_days,requester_id")
          .in("id", timeOffIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            start_date: string;
            end_date: string;
            total_days: number;
            requester_id: string;
          }[],
          error: null,
        }),
    actorEmails.length
      ? supabase.from("portal_account").select("email,name").in("email", actorEmails)
      : Promise.resolve({ data: [] as { email: string; name: string | null }[], error: null }),
    taskCommentIds.length
      ? supabase.from("task_comments").select("id,body").in("id", taskCommentIds)
      : Promise.resolve({ data: [] as { id: string; body: string }[], error: null }),
    enrollmentCommentIds.length
      ? supabase
          .from("enrollment_comments")
          .select("id,body")
          .in("id", enrollmentCommentIds)
      : Promise.resolve({ data: [] as { id: string; body: string }[], error: null }),
  ]);
  timing.record("enrich", performance.now() - tEnrich);
  reportOptionalEnrichmentFailures([
    ["task_titles", titlesRes],
    ["enrollment_titles", enrollmentTitlesRes],
    ["time_off_titles", timeOffTitlesRes],
    ["actor_names", actorsRes],
    ["task_comment_bodies", commentsRes],
    ["enrollment_comment_bodies", enrollmentCommentsRes],
  ]);
  const titleById = new Map(
    ((titlesRes.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title])
  );
  const taskDisplayNumberById = new Map(
    ((titlesRes.data ?? []) as { id: string; display_number: number | null }[]).map((t) => [t.id, t.display_number])
  );
  const enrollmentTitleById = new Map(
    ((enrollmentTitlesRes.data ?? []) as { id: string; client_name: string | null }[]).map(
      (record) => [record.id, record.client_name ?? "Enrollment record"]
    )
  );
  const enrollmentDisplayNumberById = new Map(
    ((enrollmentTitlesRes.data ?? []) as { id: string; display_number: number | null }[]).map(
      (record) => [record.id, record.display_number]
    )
  );
  const enrollmentProgramById = new Map(
    ((enrollmentTitlesRes.data ?? []) as {
      id: string;
      program: EnrollmentProgram;
    }[]).map((record) => [record.id, record.program])
  );
  const timeOffTitleById = new Map(
    ((timeOffTitlesRes.data ?? []) as {
      id: string;
      start_date: string;
      end_date: string;
      total_days: number;
    }[]).map((request) => [
      request.id,
      request.start_date === request.end_date
        ? `${request.total_days} ngày · ${request.start_date}`
        : `${request.total_days} ngày · ${request.start_date} → ${request.end_date}`,
    ])
  );
  const nameByEmail = new Map(
    ((actorsRes.data ?? []) as { email: string; name: string | null }[]).map((a) => [
      a.email,
      a.name,
    ])
  );
  const commentById = new Map(
    [
      ...((commentsRes.data ?? []) as { id: string; body: string }[]),
      ...((enrollmentCommentsRes.data ?? []) as { id: string; body: string }[]),
    ].map((c) => [c.id, c.body] as const)
  );

  let visibleTaskIds = new Set<string>();
  try {
    visibleTaskIds = await visibleNotificationTaskIds(
      viewerActor,
      (titlesRes.data ?? []) as NotificationTaskScopeRow[],
      supabase,
    );
  } catch (error) {
    console.warn("Task notification scope lookup failed", {
      code: error instanceof Error ? error.message : "unknown",
    });
  }
  const timeOffAccessById = new Map(
    ((timeOffTitlesRes.data ?? []) as Array<{ id: string; requester_id: string }>).map((request) => [
      request.id,
      canViewTimeOffNotification(access.permissions, access.userId, request.requester_id),
    ]),
  );
  let enrollmentScope: ReturnType<typeof buildEnrollmentScope> | null = null;
  if (enrollmentIds.length > 0 && canAccessEnrollment(viewerActor)) {
    try {
      enrollmentScope = buildEnrollmentScope({
        actor: viewerActor,
        ...(viewerActor.isManager
          ? { isSelectedAgent: false, assistantAgentEmails: [], personColumns: [] }
          : await Promise.all([
              freshNotificationMembership(email, supabase),
              fetchViewerPersonColumns(supabase),
            ]).then(([membership, personColumns]) => ({ ...membership, personColumns }))),
      });
    } catch (error) {
      // A scope lookup failure must redact content instead of turning an old
      // notification into a data disclosure path.
      console.warn("Enrollment notification scope lookup failed", {
        code: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  const enrollmentAccessById = new Map(
    ((enrollmentTitlesRes.data ?? []) as Array<{
      id: string;
      program: string | null;
      agent_email: string | null;
      caller_email: string | null;
      responsible_enroll_email: string | null;
      created_by_email: string | null;
      custom_values: Record<string, unknown> | null;
      archived_at: string | null;
    }>).map((record) => [
      record.id,
      Boolean(
        enrollmentScope &&
          !record.archived_at &&
          isRecordInScope(enrollmentScope, record),
      ),
    ]),
  );

  const notifications = base.map((n) => ({
    ...n,
    entity_display_number:
      n.entity_type === "enrollment"
        ? enrollmentDisplayNumberById.get(n.entity_id) ?? null
        : n.entity_type === "time_off"
          ? null
          : taskDisplayNumberById.get(n.entity_id) ?? null,
    entity_program:
      n.entity_type === "enrollment"
        ? enrollmentProgramById.get(n.entity_id) ?? "aca"
        : undefined,
    task_title:
      n.entity_type === "enrollment"
        ? enrollmentTitleById.get(n.entity_id) ?? null
        : n.entity_type === "time_off"
          ? timeOffTitleById.get(n.entity_id) ?? "Đơn xin nghỉ"
          : titleById.get(n.entity_id) ?? null,
    actor_name: nameByEmail.get(n.actor_email) ?? null,
    comment_body: n.comment_id ? commentById.get(n.comment_id) ?? null : null,
  })).map((notification) => redactNotification(
    notification,
    notification.entity_type === "enrollment"
      ? enrollmentAccessById.get(notification.entity_id) === true
      : notification.entity_type === "time_off"
        ? timeOffAccessById.get(notification.entity_id) === true
        : visibleTaskIds.has(notification.entity_id),
  ));
  const unread =
    typeof unreadRes.count === "number" ||
    typeof enrollmentUnreadRes.count === "number" ||
    typeof timeOffUnreadRes.count === "number"
      ? (unreadRes.count ?? 0) +
        (enrollmentUnreadRes.count ?? 0) +
        (timeOffUnreadRes.count ?? 0)
      : notifications.filter((n) => !n.is_read).length;
  const unreadAssignedTaskIds = [
    ...new Set(
      ((unreadAssignedRes.data ?? []) as { task_id: string }[]).map((n) => n.task_id)
    ),
  ];
  const latestAt = newestNotificationAt(
    (await latestPromise).flatMap(
      (result) => (result.data ?? []) as { created_at?: string | null }[],
    ),
  );

  return respond({
    notifications,
    hasMore,
    latestAt,
    unread,
    unreadAssignedTaskIds,
    alertsMuted: notificationPreferencesRes.error
      ? false
      : alertsMutedFromRow(
          notificationPreferencesRes.data as { sound_enabled?: boolean | null } | null,
        ),
    topic: notifTopic(email),
  });
}

/**
 * Bảng thông báo của một module phụ chưa tồn tại trên database này.
 *
 * Chuông đọc ba bảng, nhưng chỉ `task_notifications` là bắt buộc. Hai bảng kia
 * thuộc module ra đời sau, và luôn có quãng giữa lúc code lên và lúc rollout
 * chạy. Không bỏ qua được lỗi này thì một bảng còn thiếu làm CHẾT CẢ CÁI
 * CHUÔNG của mọi người, kể cả những thông báo task hoàn toàn bình thường.
 */
function isMissingOptionalTableError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("enrollment_notifications") ||
    message.includes("time_off_notifications") ||
    message.includes("notification_preferences")
  );
}

function reportOptionalEnrichmentFailures(
  results: readonly [
    string,
    { error?: { code?: string; message?: string } | null } | null | undefined,
  ][]
) {
  const failed = results
    .filter(([, result]) => Boolean(result?.error))
    .map(([name, result]) => ({
      name,
      code: result?.error?.code ?? "unknown",
    }));
  if (failed.length > 0) {
    // Keep notification text, actor emails, and record identifiers out of this
    // warning. The base notification query remains the source of truth even
    // when one optional enrichment query is unavailable.
    console.warn("Task notification enrichment degraded", { failed });
  }
}
