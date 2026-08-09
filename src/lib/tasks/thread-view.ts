const NEAR_BOTTOM_PX = 120;

export function isNearBottom(input: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return input.scrollHeight - (input.scrollTop + input.clientHeight) <= NEAR_BOTTOM_PX;
}

export function shouldFollowNewRows(input: {
  nearBottom: boolean;
  ownSend: boolean;
  deepLink: boolean;
}): boolean {
  if (input.deepLink) return false;
  return input.nearBottom || input.ownSend;
}

export function activeCommentCount(
  comments: readonly object[],
): number {
  return comments.filter((comment) => {
    if (!("deleted_at" in comment)) return true;
    return (comment as { deleted_at?: string | null }).deleted_at === null;
  }).length;
}
