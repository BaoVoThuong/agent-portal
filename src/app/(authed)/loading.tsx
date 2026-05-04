export default function Loading() {
  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <div className="h-7 w-64 animate-pulse rounded bg-[#e2e6ee]" />
        <div className="mt-2 h-4 w-96 animate-pulse rounded bg-[#eef1f6]" />
      </header>
      <div className="space-y-6">
        <div className="rounded-lg border border-[#d8dee7] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="h-5 w-40 animate-pulse rounded bg-[#e2e6ee]" />
            <div className="flex gap-2">
              <div className="h-8 w-20 animate-pulse rounded bg-[#eef1f6]" />
              <div className="h-8 w-20 animate-pulse rounded bg-[#eef1f6]" />
              <div className="h-8 w-32 animate-pulse rounded bg-[#15345f] opacity-30" />
            </div>
          </div>
          <div className="h-[430px] w-full animate-pulse rounded bg-[#f4f6fa]" />
        </div>
        <div className="rounded-lg border border-[#d8dee7] bg-white p-5 shadow-sm">
          <div className="mb-4 h-5 w-40 animate-pulse rounded bg-[#e2e6ee]" />
          <div className="h-[380px] w-full animate-pulse rounded bg-[#f4f6fa]" />
        </div>
      </div>
    </div>
  );
}
