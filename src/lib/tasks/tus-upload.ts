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
  if (!base) return Promise.reject(new Error("File uploads are not configured."));
  const url = new URL(base);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  const endpoint = new URL("/storage/v1/upload/resumable", url).toString();

  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      headers: { "x-signature": ticket.token },
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
    }, reject);
  });
}
