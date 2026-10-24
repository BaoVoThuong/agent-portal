import { Upload } from "tus-js-client";

export type TusTicket = {
  bucket: string;
  path: string;
  token: string;
  contentType: string;
};

/** Supabase requires 6 MiB TUS chunks. The signed token, never the service
 * key, authorizes this one path; the browser never sends bytes through Vercel. */
export function uploadFileWithTus(
  file: File,
  ticket: TusTicket,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !apiKey) return Promise.reject(new Error("File uploads are not configured."));
  const url = new URL(base);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  // `/sign` is the TUS endpoint that accepts a signed upload token in
  // `x-signature`; plain `/upload/resumable` wants a user JWT and answers
  // "Invalid Compact JWS" (403) — every upload failed that way on 2026-10-24.
  const endpoint = new URL("/storage/v1/upload/resumable/sign", url).toString();

  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      // The public API key passes Supabase's gateway; x-signature authorizes
      // the particular object. This matches Supabase's signed TUS example.
      headers: { apikey: apiKey, "x-signature": ticket.token },
      metadata: {
        bucketName: ticket.bucket,
        objectName: ticket.path,
        contentType: ticket.contentType,
      },
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
      removeFingerprintOnSuccess: true,
      // tus-js-client otherwise fingerprints only the local File, so uploading
      // it to a different comment could resume the first comment's path.
      fingerprint: async () =>
        `eps:${ticket.bucket}:${ticket.path}:${file.name}:${file.size}:${file.lastModified}`,
      onError: reject,
      onProgress,
      onSuccess: () => resolve(),
    });
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, () => {
      // Browser URL storage can fail (private mode/quota). Starting a fresh
      // upload still works; only cross-attempt resume is unavailable.
      upload.options.storeFingerprintForResuming = false;
      upload.start();
    });
  });
}
