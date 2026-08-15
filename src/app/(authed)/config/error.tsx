"use client";

export default function ConfigError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fa] px-6 text-[#172b4d]">
      <section className="max-w-lg rounded-lg border border-[#dfe1e6] bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold">Health Table Configuration is unavailable</h1>
        <p className="mt-2 text-sm text-[#6b778c]">
          The load-bearing table configuration could not be loaded. Retry without changing any data.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded bg-[#0c66e4] px-4 py-2 text-sm font-bold text-white"
        >
          Retry
        </button>
      </section>
    </main>
  );
}
