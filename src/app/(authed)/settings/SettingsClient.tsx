"use client";

import { useState } from "react";

type SettingsClientProps = {
  email: string;
};

export default function SettingsClient({ email }: SettingsClientProps) {
  const [newPassword, setNewPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);

    try {
      const response = await fetch("/api/settings/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setPasswordError(payload.error ?? "Unable to update password.");
        return;
      }

      setNewPassword("");
      setPasswordMessage("Password updated.");
    } catch {
      setPasswordError("Unable to update password. Please try again.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <section className="rounded-lg border border-[#d8dee7] bg-white px-8 py-8">
        <h1 className="text-2xl font-semibold text-[#16233a]">Settings</h1>

        <div className="mt-7 grid max-w-[980px] gap-6 xl:grid-cols-3">
          <div className="flex min-h-[210px] flex-col items-center justify-center rounded-lg border border-[#e0e4ec] bg-white px-7 py-7">
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-[#e8e6e3] text-sm font-medium text-[#667085]">
              Image
            </div>
            <button
              type="button"
              className="mt-5 inline-flex items-center gap-2 rounded-md border border-[#163f6b] bg-white px-4 py-2 text-sm font-semibold text-[#163f6b] transition hover:bg-[#f4f7fb]"
            >
              <UploadIcon />
              Upload Image
            </button>
          </div>

          <form className="min-h-[210px] rounded-lg border border-[#e0e4ec] bg-white px-7 py-7">
            <label className="block">
              <span className="text-sm font-medium text-[#16233a]">Email</span>
              <input
                className="mt-5 w-full rounded-md border border-[#d8dee7] px-4 py-3 text-sm text-[#16233a] outline-none focus:border-[#163f6b] focus:ring-2 focus:ring-[#163f6b]/15"
                type="email"
                defaultValue={email}
              />
            </label>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="rounded-md bg-[#112f54] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0d2747]"
              >
                Save
              </button>
            </div>
          </form>

          <form
            className="min-h-[210px] rounded-lg border border-[#e0e4ec] bg-white px-7 py-7"
            onSubmit={handlePasswordSubmit}
          >
            <label className="block">
              <span className="text-sm font-medium text-[#16233a]">
                New Password
              </span>
              <input
                className="mt-5 w-full rounded-md border border-[#d8dee7] px-4 py-3 text-sm text-[#16233a] outline-none focus:border-[#163f6b] focus:ring-2 focus:ring-[#163f6b]/15"
                type="password"
                placeholder="********"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            {passwordError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {passwordError}
              </div>
            )}
            {passwordMessage && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {passwordMessage}
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                className="rounded-md bg-[#8d98a8] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#7c8798] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSavingPassword}
              >
                {isSavingPassword ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
