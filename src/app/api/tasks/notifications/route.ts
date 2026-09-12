import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifTopic } from "@/lib/tasks/realtime";
import type { EnrollmentProgram } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const mode = new URL(req.url).searchParams.get("mode");

  // Background consumers only need the unread badge and the task ids used by
  // the board's assignment hint. Keeping this path free of notification text
  // and enrichment queries makes polling cheap; the full list is loaded when
  // the user opens the dropdown or a realtime signal arrives.
  if (mode === "summary") {
    const [unreadRes, enrollmentUnreadRes, timeOffUnreadRes, unreadAssignedRes] =
      await Promise.all([
      supabase
        .from("task_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("is_read", false),
      supabase
        .from("enrollment_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("is_read", false),
      supabase
        .from("time_off_notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("is_read", false),
      supabase
        .from("task_notifications")
        .select("task_id")
        .eq("recipient_email", email)
        .eq("type", "assigned")
        .eq("is_read", false),
    ]);

    if (unreadRes.error) {
      return NextResponse.json({ error: unreadRes.error.message }, { status: 500 });
    }
    if (
      enrollmentUnreadRes.error &&
      !isMissingOptionalTableError(enrollmentUnreadRes.error)
    ) {
      return NextResponse.json(
        { error: enrollmentUnreadRes.error.message },
        { status: 500 },
      );
    }
    if (
      timeOffUnreadRes.error &&
      !isMissingOptionalTableError(timeOffUnreadRes.error)
    ) {
      return NextResponse.json(
        { error: timeOffUnreadRes.error.message },
        { status: 500 },
      );
    }
    if (unreadAssignedRes.error) {
      return NextResponse.json(
        { error: unreadAssignedRes.error.message },
        { status: 500 },
      );
    }

    const unreadAssignedTaskIds = [
      ...new Set(
        ((unreadAssignedRes.data ?? []) as { task_id: string }[]).map(
          (notification) => notification.task_id,
        ),
      ),
    ];
    return NextResponse.json({
      unread:
        (unreadRes.count ?? 0) +
        (enrollmentUnreadRes.count ?? 0) +
        (timeOffUnreadRes.count ?? 0),
      unreadAssignedTaskIds,
      topic: notifTopic(email),
    });
  }

  const [
    { data, error },
    enrollmentRes,
    timeOffRes,
    unreadRes,
    enrollmentUnreadRes,
    timeOffUnreadRes,
    unreadAssignedRes,
  ] = await Promise.all([
    supabase
      .from("task_notifications")
      .select("id,task_id,type,actor_email,comment_id,detail,is_read,created_at")
      .eq("recipient_email", email)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("enrollment_notifications")
      .select("id,record_id,type,actor_email,comment_id,detail,is_read,created_at")
      .eq("recipient_email", email)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("time_off_notifications")
      .select("id,request_id,type,actor_email,detail,is_read,created_at")
      .eq("recipient_email", email)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("task_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("is_read", false),
    supabase
      .from("enrollment_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("is_read", false),
    supabase
      .from("time_off_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("is_read", false),
    supabase
      .from("task_notifications")
      .select("task_id")
      .eq("recipient_email", email)
      .eq("type", "assigned")
      .eq("is_read", false),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (enrollmentRes.error && !isMissingOptionalTableError(enrollmentRes.error)) {
    return NextResponse.json({ error: enrollmentRes.error.message }, { status: 500 });
  }
  if (unreadRes.error) {
    return NextResponse.json({ error: unreadRes.error.message }, { status: 500 });
  }
  if (
    enrollmentUnreadRes.error &&
    !isMissingOptionalTableError(enrollmentUnreadRes.error)
  ) {
    return NextResponse.json(
      { error: enrollmentUnreadRes.error.message },
      { status: 500 }
    );
  }
  if (timeOffRes.error && !isMissingOptionalTableError(timeOffRes.error)) {
    return NextResponse.json({ error: timeOffRes.error.message }, { status: 500 });
  }
  if (
    timeOffUnreadRes.error &&
    !isMissingOptionalTableError(timeOffUnreadRes.error)
  ) {
    return NextResponse.json(
      { error: timeOffUnreadRes.error.message },
      { status: 500 }
    );
  }
  if (unreadAssignedRes.error) {
    return NextResponse.json({ error: unreadAssignedRes.error.message }, { status: 500 });
  }

  const taskBase = ((data ?? []) as {
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
    id: `task:${n.id}`,
    entity_type: "task" as const,
    entity_id: n.task_id,
  }));
  const enrollmentBase = ((enrollmentRes.data ?? []) as {
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
    id: `enrollment:${n.id}`,
    task_id: n.record_id,
    entity_type: "enrollment" as const,
    entity_id: n.record_id,
  }));
  // Time Off không có bình luận, nên `comment_id` luôn null — vẫn phải có mặt
  // để ba nguồn cùng một hình dạng khi trộn.
  const timeOffBase = ((timeOffRes.data ?? []) as {
    id: string;
    request_id: string;
    type: string;
    actor_email: string;
    detail: string | null;
    is_read: boolean;
    created_at: string;
  }[]).map((n) => ({
    ...n,
    id: `timeoff:${n.id}`,
    task_id: n.request_id,
    comment_id: null as string | null,
    entity_type: "time_off" as const,
    entity_id: n.request_id,
  }));
  const base = [...taskBase, ...enrollmentBase, ...timeOffBase]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 30);

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
  const [
    titlesRes,
    enrollmentTitlesRes,
    timeOffTitlesRes,
    actorsRes,
    commentsRes,
    enrollmentCommentsRes,
  ] = await Promise.all([
    taskIds.length
      ? supabase.from("tasks").select("id,title,display_number").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: string; title: string; display_number: number | null }[], error: null }),
    enrollmentIds.length
      ? supabase.from("enrollment_records").select("id,client_name,display_number,program").in("id", enrollmentIds)
      : Promise.resolve({ data: [] as { id: string; client_name: string | null; display_number: number | null; program: EnrollmentProgram }[], error: null }),
    timeOffIds.length
      ? supabase
          .from("time_off_requests")
          .select("id,start_date,end_date,total_days")
          .in("id", timeOffIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            start_date: string;
            end_date: string;
            total_days: number;
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
  }));
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
  return NextResponse.json({
    notifications,
    unread,
    unreadAssignedTaskIds,
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
    message.includes("time_off_notifications")
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
