export function AgentHealthDashboardSkeleton() {
  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <article
            key={index}
            className="grid min-h-20 grid-rows-[1.35rem_2.35rem_1rem] items-center rounded-lg border border-[#d8dee7] bg-white px-3 py-2.5 text-center shadow-[0_1px_3px_rgba(22,35,58,0.06)]"
          >
            <div className="mx-auto h-3 w-40 animate-pulse rounded bg-[#e5eaf1]" />
            <div className="mx-auto h-8 w-24 animate-pulse rounded bg-[#e5eaf1]" />
            <div className="mx-auto h-3 w-36 animate-pulse rounded bg-[#e5eaf1]" />
          </article>
        ))}
      </section>

      <section>
        <div className="mb-2 h-7 w-[30rem] max-w-full animate-pulse rounded bg-[#e5eaf1]" />
        <div className="rounded-lg border border-[#d1d5db] bg-white p-3 shadow-[0_2px_8px_rgba(22,35,58,0.18)]">
          <div className="h-[360px] min-w-[980px] animate-pulse rounded bg-[#eef2f7]" />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <PaymentStatusSkeleton titleWidth="w-80" />
        <PaymentStatusSkeleton titleWidth="w-72" />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <PaymentStatusSkeleton titleWidth="w-96" />
        <PaymentStatusSkeleton titleWidth="w-96" />
      </section>

      <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.08)]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#edf0f4] px-6 py-5">
          <div>
            <div className="h-5 w-80 animate-pulse rounded bg-[#e5eaf1]" />
            <div className="mt-2 h-3 w-40 animate-pulse rounded bg-[#e5eaf1]" />
          </div>
          <div className="h-10 w-72 animate-pulse rounded-md bg-[#e5eaf1]" />
        </header>
        <div className="p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-[3rem_1.8fr_0.8fr_1fr_0.8fr] gap-3 border-b border-[#f1f3f7] py-3 last:border-b-0"
            >
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PaymentStatusSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <section>
      <div className={`mb-2 h-7 ${titleWidth} animate-pulse rounded bg-[#e5eaf1]`} />
      <article className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white shadow-[0_2px_8px_rgba(22,35,58,0.08)]">
        <div className="p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-5 gap-3 border-b border-[#f1f3f7] py-3 last:border-b-0"
            >
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
              <div className="h-4 animate-pulse rounded bg-[#eef2f7]" />
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
