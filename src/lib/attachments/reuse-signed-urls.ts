// Every task / enrollment detail response re-signs every attachment, and a
// re-signed URL carries a new token, so <img> treats it as a different file and
// downloads it again — once per drawer refresh (every 60s). Storage signs for
// one hour (signTaskFiles), so keep showing the first URL until it is 45
// minutes old.
//
// Keyed by attachment id rather than by detail-cache entry: a refresh
// invalidates the entry before it fetches, and every realtime change clears
// the whole cache. Not cleared with it on purpose — a remembered URL only
// replaces one the server just returned for the same attachment, so the server
// still decides who sees which file.
export const SIGNED_URL_REUSE_MS = 45 * 60 * 1000;
const MAX_REMEMBERED_SIGNED_URLS = 500;
const signedUrls = new Map<string, { url: string; signedAt: number }>();

type SignedFile = { id: string; url: string | null };

function reuseSignedUrl<A extends SignedFile>(attachment: A, now: number): A {
  if (!attachment.url) return attachment;
  const remembered = signedUrls.get(attachment.id);
  if (remembered && now - remembered.signedAt < SIGNED_URL_REUSE_MS) {
    return remembered.url === attachment.url
      ? attachment
      : { ...attachment, url: remembered.url };
  }
  signedUrls.delete(attachment.id);
  if (signedUrls.size >= MAX_REMEMBERED_SIGNED_URLS) {
    const oldest = signedUrls.keys().next();
    if (!oldest.done) signedUrls.delete(oldest.value);
  }
  signedUrls.set(attachment.id, { url: attachment.url, signedAt: now });
  return attachment;
}

/** Swap each freshly signed URL for the one this tab already loaded, if still young. */
export function reuseSignedAttachmentUrls<
  A extends SignedFile,
  D extends { attachments: A[]; comments: Array<{ attachments: A[] }> },
>(detail: D): D {
  const now = Date.now();
  return {
    ...detail,
    attachments: detail.attachments.map((attachment) => reuseSignedUrl(attachment, now)),
    comments: detail.comments.map((comment) => ({
      ...comment,
      attachments: comment.attachments.map((attachment) => reuseSignedUrl(attachment, now)),
    })),
  };
}
