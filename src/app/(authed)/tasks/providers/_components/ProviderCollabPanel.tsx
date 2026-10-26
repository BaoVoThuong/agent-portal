"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import type { CommentWithAttachments } from "@/lib/tasks/detail";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import type { ProviderActivityRow } from "@/lib/providers/activity";
import {
  COMMENT_PAGE_SIZE,
  COMMENT_REFRESH_MAX,
  type CommentCursor,
} from "@/lib/collaboration/comment-pagination";
import { providerReactionTopic, providerRoomTopic } from "@/lib/providers/realtime-topics";
import { CommentThread } from "../../_components/CommentThread";
import { ProviderActivityFeed } from "./ProviderActivityFeed";

type ProviderDetail = {
  comments: CommentWithAttachments[];
  commentsHasMore: boolean;
  commentsNextCursor: CommentCursor | null;
  canComment: boolean;
};

const byCreatedAt = (a: CommentWithAttachments, b: CommentWithAttachments) =>
  String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id);

/**
 * Cột phải của dialog Provider: Comments | Activity, giống drawer Enrollment.
 * Không đính kèm; người không có quyền Manage chỉ đọc.
 */
export function ProviderCollabPanel({
  providerId,
  currentEmail,
  columns,
  columnOptions,
}: {
  providerId: string;
  currentEmail: string;
  columns: readonly TableColumn[];
  columnOptions: readonly TableColumnOption[];
}) {
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activity, setActivity] = useState<ProviderActivityRow[] | null>(null);
  const [activityFailed, setActivityFailed] = useState(false);
  const [members, setMembers] = useState<TaskAssignee[]>([]);
  // Đã bấm "Load older" thì lượt tải lại sau mỗi comment phải giữ đủ số đó.
  const loadedLimitRef = useRef(COMMENT_PAGE_SIZE);

  const reload = useCallback(async (): Promise<"ok" | "failed"> => {
    try {
      const response = await fetch(
        `/api/automation/provider-list/${providerId}/detail?comments_limit=${loadedLimitRef.current}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Could not load comments.");
      setDetail((await response.json()) as ProviderDetail);
      setLoadFailed(false);
      return "ok";
    } catch {
      setLoadFailed(true);
      return "failed";
    }
  }, [providerId]);

  useEffect(() => {
    // Nạp sau một nhịp để không setState đồng bộ trong effect.
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/automation/provider-list/${providerId}/detail?section=members`, {
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load mention candidates.");
      return response.json() as Promise<{ members: TaskAssignee[] }>;
    }).then((result) => {
      if (!cancelled) setMembers(result.members);
    }).catch(() => {
      // Comment vẫn dùng được khi danh sách gợi ý @mention tạm thời lỗi.
    });
    return () => { cancelled = true; };
  }, [providerId]);

  const loadActivity = useCallback(async () => {
    setActivityFailed(false);
    try {
      const response = await fetch(
        `/api/automation/provider-list/${providerId}/detail?section=activity`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Could not load activity.");
      const result = (await response.json()) as { activity: ProviderActivityRow[] };
      setActivity(result.activity);
    } catch {
      setActivityFailed(true);
    }
  }, [providerId]);

  // Nạp song song sau khi mở dialog để tab Activity thường đã sẵn sàng khi
  // người dùng chuyển qua, nhưng không giữ Comments chờ truy vấn này.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadActivity(), 0);
    return () => window.clearTimeout(timer);
  }, [loadActivity]);

  const openActivity = () => {
    setTab("activity");
    if (activity !== null || activityFailed) void loadActivity();
  };

  const loadOlder = useCallback(async () => {
    if (!detail?.commentsHasMore || !detail.commentsNextCursor) return;
    const params = new URLSearchParams({
      comments_before_created_at: detail.commentsNextCursor.created_at,
      comments_before_id: detail.commentsNextCursor.id,
    });
    const response = await fetch(
      `/api/automation/provider-list/${providerId}/detail?${params.toString()}`,
      { cache: "no-store" }
    );
    if (!response.ok) throw new Error("Could not load older comments.");
    const older = (await response.json()) as ProviderDetail;
    setDetail((current) => {
      if (!current) return older;
      const byId = new Map(current.comments.map((comment) => [comment.id, comment]));
      for (const comment of older.comments) byId.set(comment.id, comment);
      const comments = [...byId.values()].sort(byCreatedAt);
      loadedLimitRef.current = Math.min(
        COMMENT_REFRESH_MAX,
        Math.max(COMMENT_PAGE_SIZE, comments.length)
      );
      return {
        ...current,
        comments,
        commentsHasMore: older.commentsHasMore,
        commentsNextCursor: older.commentsNextCursor,
      };
    });
  }, [detail, providerId]);

  return (
    <section className="flex min-h-[28rem] min-w-0 flex-col gap-3 border-t border-[#dfe1e6] bg-white p-4 lg:h-full lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="flex shrink-0 flex-wrap items-center gap-5 border-b border-[#dfe1e6]">
        <PanelTab
          label="Comments"
          count={detail?.comments.length}
          active={tab === "comments"}
          onClick={() => setTab("comments")}
        />
        <PanelTab
          label="Activity"
          count={activity?.length}
          active={tab === "activity"}
          onClick={openActivity}
        />
      </div>

      {loadFailed ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 rounded border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-xs font-semibold text-[#bf2600]"
          role="alert"
        >
          <span>Could not load the latest comments.</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded bg-white px-2 py-1 text-[#bf2600] shadow-sm transition hover:bg-[#fff7f5]"
          >
            Retry
          </button>
        </div>
      ) : null}

      {tab === "comments" && !detail && !loadFailed ? (
        <div className="space-y-2">
          <div className="h-4 w-1/3 animate-pulse rounded bg-[#f1f2f4]" />
          <div className="h-16 w-full animate-pulse rounded bg-[#f1f2f4]" />
          <div className="h-16 w-5/6 animate-pulse rounded bg-[#f1f2f4]" />
        </div>
      ) : null}

      {/* Giữ thread mounted khi đổi tab: bản nháp và comment đang gửi không mất. */}
      {detail ? (
        <div className={tab === "comments" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <CommentThread
            taskId={providerId}
            apiBase="/api/automation/provider-list"
            roomTopic={providerRoomTopic(providerId)}
            reactionTopic={providerReactionTopic(providerId)}
            reactionsEnabled
            reactionCache="none"
            attachmentsEnabled={false}
            canComment={detail.canComment}
            currentEmail={currentEmail}
            members={members}
            comments={detail.comments}
            commentsHasMore={detail.commentsHasMore}
            onLoadOlder={loadOlder}
            onReload={reload}
          />
          {!detail.canComment ? (
            <p className="shrink-0 text-xs text-[#6b778c]">
              Only Provider List managers can comment.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {activityFailed ? (
            <button type="button" onClick={() => void loadActivity()} className="text-xs font-semibold text-[#0c66e4]">
              Could not load activity. Retry
            </button>
          ) : activity ? (
            <ProviderActivityFeed activity={activity} columns={columns} columnOptions={columnOptions} />
          ) : (
            <div className="h-16 w-full animate-pulse rounded bg-[#f1f2f4]" />
          )}
        </div>
      ) : null}
    </section>
  );
}

function PanelTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group -mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-semibold transition ${
        active
          ? "border-[#0c66e4] text-[#0c66e4]"
          : "border-transparent text-[#5e6c84] hover:border-[#c1c7d0] hover:text-[#172b4d]"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition ${
            active
              ? "bg-[#e9f2ff] text-[#0c66e4]"
              : "bg-[#f1f2f4] text-[#626f86] group-hover:bg-[#dfe1e6]"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
