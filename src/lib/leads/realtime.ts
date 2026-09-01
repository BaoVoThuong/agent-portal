import { sendBroadcastMessages } from "@/lib/tasks/realtime";
import {
  LEAD_MUTATION_SOURCE_HEADER,
  LEADS_TOPIC,
  leadRoomTopic,
} from "./realtime-topics";

export { LEAD_MUTATION_SOURCE_HEADER, LEADS_TOPIC, leadRoomTopic };

export function readLeadMutationSourceId(request: Request): string | undefined {
  const sourceId = request.headers.get(LEAD_MUTATION_SOURCE_HEADER)?.trim();
  if (
    !sourceId ||
    sourceId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(sourceId)
  ) {
    return undefined;
  }
  return sourceId;
}

/**
 * `leadIds` cho phép người nhận vá ĐÚNG những dòng đã đổi thay vì kéo lại toàn
 * bộ danh sách. Ở quy mô 5.000 lead, một lần kéo lại là ~5 MB cho mỗi tab đang
 * mở — mà nguyên nhân thường chỉ là một người vừa ghi một cuộc gọi.
 *
 * Bỏ trống khi việc thay đổi không quy về vài dòng cụ thể (import hàng loạt,
 * tạo sự kiện): lúc đó người nhận buộc phải tải lại cả danh sách.
 */
export async function broadcastLeadsChanged(
  sourceId?: string,
  leadIds?: readonly string[]
): Promise<boolean> {
  const ids = leadIds?.filter(Boolean) ?? [];
  return sendBroadcastMessages([
    {
      topic: LEADS_TOPIC,
      event: "changed",
      payload: {
        ...(sourceId ? { sourceId } : {}),
        // Quá nhiều id thì vá từng dòng không còn rẻ hơn tải lại.
        ...(ids.length > 0 && ids.length <= 25 ? { leadIds: ids.join(",") } : {}),
      },
    },
  ]);
}
