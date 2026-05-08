"use client";

import { FormEvent, useMemo, useState } from "react";

type PaymentFileInput = {
  id: string;
  file: File | null;
};

const emptyTotals = {
  allPaymentsRaw: 0,
  basePolicy: 0,
  additional: 0,
  unclaimed: 0,
  final: 0,
};

function createPaymentFileInput(): PaymentFileInput {
  return {
    id: crypto.randomUUID(),
    file: null,
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function isBalanced(total: number, final: number) {
  return Math.round(total * 100) === Math.round(final * 100);
}

export default function PcStatementClient() {
  const [paymentFiles, setPaymentFiles] = useState<PaymentFileInput[]>([
    createPaymentFileInput(),
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [totals] = useState(emptyTotals);
  const [error, setError] = useState<string | null>(null);

  const canRun = useMemo(
    () => paymentFiles.length > 0 && paymentFiles.every((item) => item.file),
    [paymentFiles]
  );
  const selectedFileCount = paymentFiles.filter((item) => item.file).length;
  const status = isBalanced(totals.allPaymentsRaw, totals.final);

  const updatePaymentFile = (id: string, file: File | null) => {
    setError(null);
    setPaymentFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, file } : item))
    );
  };

  const addPaymentFile = () => {
    setError(null);
    setPaymentFiles((current) => [...current, createPaymentFileInput()]);
  };

  const removePaymentFile = (id: string) => {
    setError(null);
    setPaymentFiles((current) =>
      current.length === 1 ? current : current.filter((item) => item.id !== id)
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRun) return;

    setIsRunning(true);
    setError(null);

    try {
      // Data logic will be wired after the source tables and rules are defined.
      await Promise.resolve();
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
                      Payment file
                    </span>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(event) =>
                        updatePaymentFile(item.id, event.target.files?.[0] ?? null)
                      }
                      className="block w-full rounded-md border border-dashed border-[#b8c4d4] bg-white px-3 py-3 text-sm text-[#344054] file:mr-4 file:rounded-md file:border-0 file:bg-[#245a94] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:bg-[#f3f6fa]"
                    />
                    <span className="mt-2 block truncate text-sm text-[#667085]">
                      {item.file
                        ? `${item.file.name} - ${formatFileSize(item.file.size)}`
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
            {selectedFileCount} file(s) selected
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
                Files
              </dt>
              <dd className="mt-1 truncate text-sm text-[#16233a]">
                {selectedFileCount || "-"}
              </dd>
            </div>
          </dl>

          <div className="mt-8 rounded-md border border-[#d8dee7] bg-[#f8fafc] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[#16233a]">
                Statement Reconcile
              </div>
              <div
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  status
                    ? "bg-[#d1fadf] text-[#15803d]"
                    : "bg-[#fee2e2] text-[#b91c1c]"
                }`}
              >
                Status: {status ? "True" : "False"}
              </div>
            </div>

            <div className="overflow-hidden rounded-md border border-[#e6ebf2] bg-white">
              <div className="grid grid-cols-5 bg-[#edf2f7] text-xs font-semibold uppercase tracking-wide text-[#344054]">
                <div className="px-3 py-2">All Payments Raw</div>
                <div className="px-3 py-2">Base Policy</div>
                <div className="px-3 py-2">Additional</div>
                <div className="px-3 py-2">Unclaimed</div>
                <div className="px-3 py-2">Final</div>
              </div>
              <div className="grid grid-cols-5 border-t border-[#e6ebf2] text-sm font-semibold text-[#16233a]">
                <div className="px-3 py-3">
                  {formatMoney(totals.allPaymentsRaw)}
                </div>
                <div className="px-3 py-3">{formatMoney(totals.basePolicy)}</div>
                <div className="px-3 py-3">{formatMoney(totals.additional)}</div>
                <div className="px-3 py-3">{formatMoney(totals.unclaimed)}</div>
                <div className="px-3 py-3">{formatMoney(totals.final)}</div>
              </div>
            </div>
          </div>

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
