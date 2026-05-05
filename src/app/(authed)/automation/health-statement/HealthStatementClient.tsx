"use client";

import { FormEvent, useMemo, useState } from "react";

const carriers = [
  "AMBETTER",
  "ANTHEM",
  "BCBS",
  "CHRISTUS",
  "CIGNA",
  "MOLINA",
  "OSCAR",
  "UHC",
];

type FormState = {
  carrier: string;
  monthReport: string;
};

type PaymentFileInput = {
  id: string;
  statementNumber: string;
  file: File | null;
};

type PreviewRow = {
  agent: string | null;
  carrier_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  gross_compensation: number | null;
  transaction_id: string | null;
  statement: string | null;
};

type RunResult = {
  inserted: number;
  preview: PreviewRow[];
};

const initialForm: FormState = {
  carrier: "",
  monthReport: "",
};

function createPaymentFileInput(): PaymentFileInput {
  return {
    id: crypto.randomUUID(),
    statementNumber: "",
    file: null,
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function HealthStatementClient() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [paymentFiles, setPaymentFiles] = useState<PaymentFileInput[]>([
    createPaymentFileInput(),
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = useMemo(
    () =>
      form.carrier.trim() !== "" &&
      form.monthReport !== "" &&
      paymentFiles.length > 0 &&
      paymentFiles.every((item) => item.statementNumber.trim() !== "" && item.file),
    [form, paymentFiles]
  );

  const updateField = (key: keyof FormState, value: string) => {
    setResult(null);
    setError(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updatePaymentFile = (
    id: string,
    next: Partial<Pick<PaymentFileInput, "statementNumber" | "file">>
  ) => {
    setResult(null);
    setError(null);
    setPaymentFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...next } : item))
    );
  };

  const addPaymentFile = () => {
    setResult(null);
    setError(null);
    setPaymentFiles((current) => [...current, createPaymentFileInput()]);
  };

  const removePaymentFile = (id: string) => {
    setResult(null);
    setError(null);
    setPaymentFiles((current) =>
      current.length === 1 ? current : current.filter((item) => item.id !== id)
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRun) return;

    setIsRunning(true);
    setResult(null);
    setError(null);

    const payload = new FormData();
    payload.set("carrier", form.carrier.trim());
    payload.set("monthReport", form.monthReport);
    paymentFiles.forEach((item) => {
      if (!item.file) return;
      payload.append("statementNumbers", item.statementNumber.trim());
      payload.append("files", item.file);
    });

    try {
      const response = await fetch("/api/automation/health-statement/run", {
        method: "POST",
        body: payload,
      });
      const data = (await response.json()) as Partial<RunResult> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Run report failed");
      }

      setResult({
        inserted: data.inserted ?? 0,
        preview: data.preview ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run report failed");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,520px)_minmax(360px,1fr)]">
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-[#d8dee7] bg-white shadow-sm"
      >
        <div className="border-b border-[#e6ebf2] px-6 py-5">
          <h2 className="text-base font-semibold text-[#16233a]">
            Statement Input
          </h2>
        </div>

        <div className="space-y-5 px-6 py-6">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[#344054]">
              Carrier
            </span>
            <input
              value={form.carrier}
              onChange={(event) =>
                updateField("carrier", event.target.value.toUpperCase())
              }
              list="carrier-options"
              className="h-11 w-full rounded-md border border-[#cfd7e3] px-3 text-sm uppercase text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
              placeholder="MOLINA"
            />
            <datalist id="carrier-options">
              {carriers.map((carrier) => (
                <option key={carrier} value={carrier} />
              ))}
            </datalist>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[#344054]">
              Month report
            </span>
            <input
              type="month"
              value={form.monthReport}
              onChange={(event) => updateField("monthReport", event.target.value)}
              className="h-11 w-full rounded-md border border-[#cfd7e3] px-3 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
            />
          </label>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-[#344054]">
                Payment files
              </span>
              <button
                type="button"
                onClick={addPaymentFile}
                className="h-9 rounded-md border border-[#cfd7e3] px-3 text-sm font-semibold text-[#245a94] transition hover:bg-[#f3f6fa]"
              >
                Add File
              </button>
            </div>

            <div className="space-y-3">
              {paymentFiles.map((item, index) => (
                <div
                  key={item.id}
                  className="rounded-md border border-[#e1e7ef] bg-[#f8fafc] p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold text-[#16233a]">
                      File {index + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePaymentFile(item.id)}
                      disabled={paymentFiles.length === 1}
                      className="text-sm font-semibold text-[#b42318] disabled:cursor-not-allowed disabled:text-[#98a2b3]"
                    >
                      Remove
                    </button>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-[#344054]">
                      Statement number
                    </span>
                    <input
                      value={item.statementNumber}
                      onChange={(event) =>
                        updatePaymentFile(item.id, {
                          statementNumber: event.target.value,
                        })
                      }
                      className="h-11 w-full rounded-md border border-[#cfd7e3] bg-white px-3 text-sm text-[#16233a] outline-none transition focus:border-[#245a94] focus:ring-2 focus:ring-[#245a94]/15"
                      placeholder="58651"
                    />
                  </label>

                  <label className="mt-3 block">
                    <span className="mb-2 block text-sm font-medium text-[#344054]">
                      Payment file
                    </span>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(event) =>
                        updatePaymentFile(item.id, {
                          file: event.target.files?.[0] ?? null,
                        })
                      }
                      className="block w-full rounded-md border border-dashed border-[#b8c4d4] bg-white px-3 py-3 text-sm text-[#344054] file:mr-4 file:rounded-md file:border-0 file:bg-[#245a94] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-[#f3f6fa]"
                    />
                    <span className="mt-2 block truncate text-sm text-[#667085]">
                      {item.file
                        ? `${item.file.name} · ${formatFileSize(item.file.size)}`
                        : "No file selected"}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#e6ebf2] px-6 py-4">
          <p className="text-sm text-[#667085]">
            {paymentFiles.filter((item) => item.file).length} file(s) selected
          </p>
          <button
            type="submit"
            disabled={!canRun || isRunning}
            className="h-10 rounded-md bg-[#245a94] px-5 text-sm font-semibold text-white transition hover:bg-[#1f4c7d] disabled:cursor-not-allowed disabled:bg-[#b8c4d4]"
          >
            {isRunning ? "Running..." : "Run Report"}
          </button>
        </div>
      </form>

      <section className="rounded-lg border border-[#d8dee7] bg-white shadow-sm">
        <div className="border-b border-[#e6ebf2] px-6 py-5">
          <h2 className="text-base font-semibold text-[#16233a]">
            Report Preview
          </h2>
        </div>
        <div className="px-6 py-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                Statements
              </dt>
              <dd className="mt-1 text-sm text-[#16233a]">
                {paymentFiles
                  .map((item) => item.statementNumber.trim())
                  .filter(Boolean)
                  .join(", ") || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                Carrier
              </dt>
              <dd className="mt-1 text-sm text-[#16233a]">
                {form.carrier || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                Month
              </dt>
              <dd className="mt-1 text-sm text-[#16233a]">
                {form.monthReport || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
                Files
              </dt>
              <dd className="mt-1 truncate text-sm text-[#16233a]">
                {paymentFiles.filter((item) => item.file).length || "-"}
              </dd>
            </div>
          </dl>

          <div className="mt-8 overflow-hidden rounded-md border border-[#e6ebf2]">
            <div className="grid grid-cols-5 bg-[#edf2f7] text-xs font-semibold uppercase tracking-wide text-[#344054]">
              <div className="px-3 py-2">Agent</div>
              <div className="px-3 py-2">Customer</div>
              <div className="px-3 py-2">Carrier</div>
              <div className="px-3 py-2">Gross</div>
              <div className="px-3 py-2">Statement</div>
            </div>
            {(result?.preview.length ? result.preview : [null]).map((row, index) => (
              <div
                key={row?.transaction_id ?? row?.customer_id ?? index}
                className="grid grid-cols-5 border-t border-[#e6ebf2] text-sm text-[#667085]"
              >
                <div className="truncate px-3 py-3">{row?.agent ?? "-"}</div>
                <div className="truncate px-3 py-3">
                  {row?.customer_name ?? row?.customer_id ?? "-"}
                </div>
                <div className="truncate px-3 py-3">{row?.carrier_name ?? "-"}</div>
                <div className="px-3 py-3">
                  {row?.gross_compensation ?? "-"}
                </div>
                <div className="truncate px-3 py-3">{row?.statement ?? "-"}</div>
              </div>
            ))}
          </div>

          {result && (
            <div className="mt-5 rounded-md border border-[#b7dfca] bg-[#effaf4] px-4 py-3 text-sm font-medium text-[#25613d]">
              Inserted {result.inserted} cleaned rows into Supabase.
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-md border border-[#f2b8b5] bg-[#fff4f2] px-4 py-3 text-sm font-medium text-[#9f2f24]">
              {error}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
