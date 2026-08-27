"use client";

import { useRouter } from "next/navigation";
import { Badge, CheckCircle2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { LeadAlertSettings, LeadInteractionType, LeadProduct, LeadStatus, StatusKind } from "@/lib/leads/types";

type SettingsClientProps = {
  profile: {
    email: string;
    name: string;
    agentId: string | null;
    hasLocalPassword: boolean;
  };
  canManageLeads: boolean;
  initialLeadSettings: LeadAlertSettings[];
};

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function SettingsClient({ profile, canManageLeads, initialLeadSettings }: SettingsClientProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.name);
  const [hasLocalPassword, setHasLocalPassword] = useState(profile.hasLocalPassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [leadSettings, setLeadSettings] = useState(initialLeadSettings);
  const [savingLeadProduct, setSavingLeadProduct] = useState<LeadProduct | null>(null);
  const [leadSettingsMessage, setLeadSettingsMessage] = useState<string | null>(null);
  const [leadSettingsError, setLeadSettingsError] = useState<string | null>(null);
  const [vocabularyState, setVocabularyState] = useState<"idle" | "ready" | "error">("idle");
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [interactionTypes, setInteractionTypes] = useState<LeadInteractionType[]>([]);
  const [vocabularyError, setVocabularyError] = useState<string | null>(null);
  const [savingVocabularyKey, setSavingVocabularyKey] = useState<string | null>(null);
  const [newStatusProduct, setNewStatusProduct] = useState<LeadProduct>("pc");
  const [newStatusLabel, setNewStatusLabel] = useState("");
  const [newStatusKind, setNewStatusKind] = useState<StatusKind>("open");
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [newTypeCountsAsContact, setNewTypeCountsAsContact] = useState(false);

  useEffect(() => {
    if (!canManageLeads || vocabularyState !== "idle") return;
    void fetch("/api/leads/vocabulary", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.statuses) || !Array.isArray(payload?.types)) {
          throw new Error(payload?.error ?? "Could not load lead vocabulary.");
        }
        setStatuses(payload.statuses as LeadStatus[]);
        setInteractionTypes(payload.types as LeadInteractionType[]);
        setVocabularyState("ready");
      })
      .catch((error: unknown) => {
        setVocabularyError(error instanceof Error ? error.message : "Could not load lead vocabulary.");
        setVocabularyState("error");
      });
  }, [canManageLeads, vocabularyState]);

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingProfile(true);
    setProfileError(null);
    setProfileMessage(null);

    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: displayName }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setProfileError(payload.error ?? "Unable to update account information.");
        return;
      }

      setDisplayName(payload.profile?.name ?? displayName.trim());
      setProfileMessage("Account information updated.");
      router.refresh();
    } catch {
      setProfileError("Unable to update account information. Please try again.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasLocalPassword && currentPassword.trim() === "") {
      setPasswordError("Current password is required.");
      setPasswordMessage(null);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Password confirmation does not match.");
      setPasswordMessage(null);
      return;
    }

    setIsSavingPassword(true);
    setPasswordError(null);
    setPasswordMessage(null);

    try {
      const response = await fetch("/api/settings/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, password: newPassword }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setPasswordError(payload.error ?? "Unable to update password.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setHasLocalPassword(true);
      setPasswordMessage("Password updated.");
    } catch {
      setPasswordError("Unable to update password. Please try again.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function saveLeadSettings(product: LeadProduct) {
    const setting = leadSettings.find((row) => row.product === product);
    if (!setting || savingLeadProduct) return;
    setSavingLeadProduct(product);
    setLeadSettingsError(null);
    setLeadSettingsMessage(null);
    try {
      const response = await fetch("/api/leads/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setting),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Unable to update lead alerts.");
      if (payload?.setting) {
        setLeadSettings((current) => current.map((row) => row.product === product ? payload.setting as LeadAlertSettings : row));
      }
      setLeadSettingsMessage(`${product === "pc" ? "P&C" : "Health"} lead alerts updated.`);
    } catch (error) {
      setLeadSettingsError(error instanceof Error ? error.message : "Unable to update lead alerts.");
    } finally {
      setSavingLeadProduct(null);
    }
  }

  function updateLeadSetting(product: LeadProduct, key: "no_contact_hours" | "stale_days" | "max_attempts", value: string) {
    const parsed = Number(value);
    setLeadSettings((current) => current.map((row) => row.product === product ? { ...row, [key]: Number.isFinite(parsed) ? parsed : 0 } : row));
  }

  async function createVocabulary(resource: "status" | "type") {
    const label = resource === "status" ? newStatusLabel.trim() : newTypeLabel.trim();
    if (!label || savingVocabularyKey) return;
    setSavingVocabularyKey(`new:${resource}`);
    setVocabularyError(null);
    try {
      const body = resource === "status"
        ? { resource, product: newStatusProduct, label, kind: newStatusKind }
        : { resource, label, counts_as_contact: newTypeCountsAsContact };
      const response = await fetch("/api/leads/vocabulary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not create vocabulary item.");
      if (resource === "status") {
        setStatuses((current) => [...current, payload.status as LeadStatus].sort((a, b) => a.product.localeCompare(b.product) || a.position - b.position));
        setNewStatusLabel("");
      } else {
        setInteractionTypes((current) => [...current, payload.type as LeadInteractionType].sort((a, b) => a.position - b.position));
        setNewTypeLabel("");
        setNewTypeCountsAsContact(false);
      }
    } catch (error) {
      setVocabularyError(error instanceof Error ? error.message : "Could not create vocabulary item.");
    } finally {
      setSavingVocabularyKey(null);
    }
  }

  async function saveVocabulary(resource: "status" | "type", item: LeadStatus | LeadInteractionType) {
    const key = `${resource}:${item.id}`;
    if (savingVocabularyKey) return;
    setSavingVocabularyKey(key);
    setVocabularyError(null);
    try {
      const body = resource === "status"
        ? { resource, id: item.id, product: (item as LeadStatus).product, label: item.label, kind: (item as LeadStatus).kind, color: item.color, position: item.position }
        : { resource, id: item.id, label: item.label, counts_as_contact: (item as LeadInteractionType).counts_as_contact, color: item.color, position: item.position };
      const response = await fetch("/api/leads/vocabulary", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save vocabulary item.");
      if (resource === "status") setStatuses((current) => current.map((row) => row.id === item.id ? payload.status as LeadStatus : row));
      else setInteractionTypes((current) => current.map((row) => row.id === item.id ? payload.type as LeadInteractionType : row));
    } catch (error) {
      setVocabularyError(error instanceof Error ? error.message : "Could not save vocabulary item.");
    } finally {
      setSavingVocabularyKey(null);
    }
  }

  async function archiveVocabulary(resource: "status" | "type", id: string) {
    if (savingVocabularyKey) return;
    setSavingVocabularyKey(`${resource}:${id}`);
    setVocabularyError(null);
    try {
      const response = await fetch("/api/leads/vocabulary", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, id, archived_at: new Date().toISOString() }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not archive vocabulary item.");
      if (resource === "status") setStatuses((current) => current.filter((row) => row.id !== id));
      else setInteractionTypes((current) => current.filter((row) => row.id !== id));
    } catch (error) {
      setVocabularyError(error instanceof Error ? error.message : "Could not archive vocabulary item.");
    } finally {
      setSavingVocabularyKey(null);
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#16233a]">Settings</h1>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <form
            className="rounded-lg border border-[#d8dee7] bg-white"
            onSubmit={handleProfileSubmit}
          >
            <div className="border-b border-[#e6eaf0] px-6 py-5">
              <h2 className="text-base font-semibold text-[#172b4d]">
                Account Information
              </h2>
            </div>

            <div className="grid gap-6 px-6 py-6 lg:grid-cols-[150px_minmax(0,1fr)]">
              <div className="flex items-center justify-center rounded-lg border border-[#e6eaf0] bg-[#f7f8fa] px-5 py-6">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#deebff] text-2xl font-bold text-[#0c66e4] ring-8 ring-white">
                  {initials(displayName, profile.email)}
                </div>
              </div>

              <div className="min-w-0 space-y-4">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                    Display Name
                  </span>
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-[#cfd8e5] bg-white px-3 py-2.5 focus-within:border-[#0c66e4] focus-within:ring-2 focus-within:ring-[#0c66e4]/15">
                    <UserRound className="h-4 w-4 shrink-0 text-[#6b778c]" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#172b4d] outline-none"
                      type="text"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={120}
                      required
                    />
                  </div>
                </label>

                <div className="rounded-lg border border-[#e6eaf0] bg-[#f7f8fa]">
                  <div className="grid gap-2 border-b border-[#e6eaf0] px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                      <Mail className="h-4 w-4 shrink-0" />
                      Email
                    </div>
                    <div className="min-w-0 break-all text-sm font-semibold leading-5 text-[#172b4d]">
                      {profile.email}
                    </div>
                  </div>

                  <div className="grid gap-2 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                      <Badge className="h-4 w-4 shrink-0" />
                      Agent ID
                    </div>
                    <div className="text-sm font-semibold text-[#172b4d]">
                      {profile.agentId ?? "Not provided"}
                    </div>
                  </div>
                </div>

                {profileError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                    {profileError}
                  </div>
                )}
                {profileMessage && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {profileMessage}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t border-[#e6eaf0] px-6 py-4">
              <button
                type="submit"
                className="rounded-md bg-[#0c66e4] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0958c7] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSavingProfile}
              >
                {isSavingProfile ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>

          <form
            className="rounded-lg border border-[#d8dee7] bg-white"
            onSubmit={handlePasswordSubmit}
          >
            <div className="border-b border-[#e6eaf0] px-6 py-5">
              <h2 className="text-base font-semibold text-[#172b4d]">Password</h2>
            </div>

            <div className="grid gap-4 px-6 py-6">
              {hasLocalPassword && (
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                    Current Password
                  </span>
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-[#cfd8e5] bg-white px-3 py-2.5 focus-within:border-[#0c66e4] focus-within:ring-2 focus-within:ring-[#0c66e4]/15">
                    <LockKeyhole className="h-4 w-4 shrink-0 text-[#6b778c]" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                      required={hasLocalPassword}
                    />
                  </div>
                </label>
              )}

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                  New Password
                </span>
                <div className="mt-2 flex items-center gap-2 rounded-md border border-[#cfd8e5] bg-white px-3 py-2.5 focus-within:border-[#0c66e4] focus-within:ring-2 focus-within:ring-[#0c66e4]/15">
                  <LockKeyhole className="h-4 w-4 shrink-0 text-[#6b778c]" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#6b778c]">
                  Confirm Password
                </span>
                <div className="mt-2 flex items-center gap-2 rounded-md border border-[#cfd8e5] bg-white px-3 py-2.5 focus-within:border-[#0c66e4] focus-within:ring-2 focus-within:ring-[#0c66e4]/15">
                  <LockKeyhole className="h-4 w-4 shrink-0 text-[#6b778c]" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </label>

              {passwordError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  {passwordError}
                </div>
              )}
              {passwordMessage && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {passwordMessage}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-[#e6eaf0] px-6 py-4">
              <button
                type="submit"
                className="rounded-md bg-[#172b4d] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0f1f3d] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSavingPassword}
              >
                {isSavingPassword
                  ? "Saving..."
                  : hasLocalPassword
                    ? "Update Password"
                    : "Set Password"}
              </button>
            </div>
          </form>
        </div>
        {canManageLeads && (
          <section className="mt-6 rounded-lg border border-[#d8dee7] bg-white">
            <div className="border-b border-[#e6eaf0] px-6 py-5">
              <h2 className="text-base font-semibold text-[#172b4d]">Lead alerts</h2>
              <p className="mt-1 text-sm text-[#6b778c]">Set when an active lead should be called out for manager attention.</p>
            </div>
            <div className="grid gap-5 px-6 py-6 xl:grid-cols-2">
              {(["pc", "health"] as const).map((product) => {
                const setting = leadSettings.find((row) => row.product === product);
                if (!setting) return null;
                return (
                  <div key={product} className="rounded-lg border border-[#e6eaf0] bg-[#f7f8fa] p-4">
                    <h3 className="font-semibold text-[#172b4d]">{product === "pc" ? "P&C" : "Health"}</h3>
                    <div className="mt-4 grid gap-4">
                      <label className="block"><span className="text-xs font-bold text-[#6b778c]">No-contact window (hours)</span><input className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm" type="number" min={1} step={1} value={setting.no_contact_hours} onChange={(event) => updateLeadSetting(product, "no_contact_hours", event.target.value)} /><span className="mt-1 block text-xs text-[#6b778c]">Report red if a lead is assigned this long without a contact.</span></label>
                      <label className="block"><span className="text-xs font-bold text-[#6b778c]">Stale window (days)</span><input className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm" type="number" min={1} step={1} value={setting.stale_days} onChange={(event) => updateLeadSetting(product, "stale_days", event.target.value)} /><span className="mt-1 block text-xs text-[#6b778c]">Report red when a contacted lead has been quiet this long.</span></label>
                      <label className="block"><span className="text-xs font-bold text-[#6b778c]">Maximum attempts</span><input className="mt-1 w-full rounded-md border border-[#cfd8e5] bg-white px-3 py-2 text-sm" type="number" min={1} step={1} value={setting.max_attempts} onChange={(event) => updateLeadSetting(product, "max_attempts", event.target.value)} /><span className="mt-1 block text-xs text-[#6b778c]">Report amber after this many contact attempts.</span></label>
                    </div>
                    <div className="mt-4 flex justify-end"><button type="button" className="rounded-md bg-[#0c66e4] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={savingLeadProduct !== null} onClick={() => void saveLeadSettings(product)}>{savingLeadProduct === product ? "Saving..." : "Save alert settings"}</button></div>
                  </div>
                );
              })}
            </div>
            {leadSettingsError && <p className="mx-6 mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{leadSettingsError}</p>}
            {leadSettingsMessage && <p className="mx-6 mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{leadSettingsMessage}</p>}
          </section>
        )}
        {canManageLeads && (
          <section className="mt-6 rounded-lg border border-[#d8dee7] bg-white">
            <div className="border-b border-[#e6eaf0] px-6 py-5">
              <h2 className="text-base font-semibold text-[#172b4d]">Lead vocabulary</h2>
              <p className="mt-1 text-sm text-[#6b778c]">Statuses and interaction types control how the lead workflow and alerts behave.</p>
            </div>
            <div className="space-y-8 px-6 py-6">
              {vocabularyState === "idle" && <p className="text-sm text-[#6b778c]">Loading lead vocabulary...</p>}
              {vocabularyState === "error" && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{vocabularyError}</p>}
              {vocabularyState === "ready" && (
                <>
                  <div>
                    <div className="mb-3 flex flex-wrap items-end gap-2">
                      <h3 className="mr-auto font-semibold text-[#172b4d]">Statuses</h3>
                      <select className="rounded-md border border-[#cfd8e5] px-2 py-2 text-sm" value={newStatusProduct} onChange={(event) => setNewStatusProduct(event.target.value as LeadProduct)}><option value="pc">P&C</option><option value="health">Health</option></select>
                      <input className="rounded-md border border-[#cfd8e5] px-3 py-2 text-sm" placeholder="New status label" value={newStatusLabel} onChange={(event) => setNewStatusLabel(event.target.value)} />
                      <select className="rounded-md border border-[#cfd8e5] px-2 py-2 text-sm" value={newStatusKind} onChange={(event) => setNewStatusKind(event.target.value as StatusKind)}><option value="open">Open</option><option value="scheduled">Scheduled</option><option value="won">Won</option><option value="lost">Lost</option></select>
                      <button type="button" className="rounded-md bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!newStatusLabel.trim() || savingVocabularyKey !== null} onClick={() => void createVocabulary("status")}>Add status</button>
                    </div>
                    <div className="overflow-x-auto rounded-md border border-[#e6eaf0]"><table className="min-w-[720px] w-full text-left text-sm"><thead className="bg-[#f7f8fa] text-xs uppercase text-[#6b778c]"><tr><th className="px-3 py-2">Product</th><th className="px-3 py-2">Label</th><th className="px-3 py-2">Meaning</th><th className="px-3 py-2">Color</th><th className="px-3 py-2">Position</th><th className="px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-[#e6eaf0]">{statuses.map((status) => <tr key={status.id}><td className="px-3 py-2">{status.product === "pc" ? "P&C" : "Health"}</td><td className="px-3 py-2"><input className="w-full rounded border border-[#cfd8e5] px-2 py-1.5" value={status.label} onChange={(event) => setStatuses((current) => current.map((row) => row.id === status.id ? { ...row, label: event.target.value } : row))} /></td><td className="px-3 py-2"><select className="rounded border border-[#cfd8e5] px-2 py-1.5" value={status.kind} onChange={(event) => setStatuses((current) => current.map((row) => row.id === status.id ? { ...row, kind: event.target.value as StatusKind } : row))}><option value="open">Open</option><option value="scheduled">Scheduled</option><option value="won">Won</option><option value="lost">Lost</option></select><span className="mt-1 block text-[11px] text-[#6b778c]">Won/Lost stop reminders; Call back requires a date.</span></td><td className="px-3 py-2"><input type="color" value={status.color ?? "#0c66e4"} onChange={(event) => setStatuses((current) => current.map((row) => row.id === status.id ? { ...row, color: event.target.value } : row))} /></td><td className="px-3 py-2"><input className="w-20 rounded border border-[#cfd8e5] px-2 py-1.5" type="number" min={0} value={status.position} onChange={(event) => setStatuses((current) => current.map((row) => row.id === status.id ? { ...row, position: Number(event.target.value) } : row))} /></td><td className="whitespace-nowrap px-3 py-2"><button type="button" className="mr-2 rounded bg-[#0c66e4] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={savingVocabularyKey !== null} onClick={() => void saveVocabulary("status", status)}>Save</button><button type="button" className="rounded border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={savingVocabularyKey !== null} onClick={() => void archiveVocabulary("status", status.id)}>Archive</button></td></tr>)}</tbody></table></div>
                  </div>
                  <div>
                    <div className="mb-3 flex flex-wrap items-end gap-2"><h3 className="mr-auto font-semibold text-[#172b4d]">Interaction types</h3><input className="rounded-md border border-[#cfd8e5] px-3 py-2 text-sm" placeholder="New interaction type" value={newTypeLabel} onChange={(event) => setNewTypeLabel(event.target.value)} /><label className="flex items-center gap-2 rounded-md border border-[#cfd8e5] px-3 py-2 text-sm"><input type="checkbox" checked={newTypeCountsAsContact} onChange={(event) => setNewTypeCountsAsContact(event.target.checked)} /> Counts as contact</label><button type="button" className="rounded-md bg-[#0c66e4] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!newTypeLabel.trim() || savingVocabularyKey !== null} onClick={() => void createVocabulary("type")}>Add type</button></div>
                    <div className="overflow-x-auto rounded-md border border-[#e6eaf0]"><table className="min-w-[680px] w-full text-left text-sm"><thead className="bg-[#f7f8fa] text-xs uppercase text-[#6b778c]"><tr><th className="px-3 py-2">Label</th><th className="px-3 py-2">Counts as contact</th><th className="px-3 py-2">Color</th><th className="px-3 py-2">Position</th><th className="px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-[#e6eaf0]">{interactionTypes.map((type) => <tr key={type.id}><td className="px-3 py-2"><input className="w-full rounded border border-[#cfd8e5] px-2 py-1.5" value={type.label} onChange={(event) => setInteractionTypes((current) => current.map((row) => row.id === type.id ? { ...row, label: event.target.value } : row))} /></td><td className="px-3 py-2"><input type="checkbox" checked={type.counts_as_contact} onChange={(event) => setInteractionTypes((current) => current.map((row) => row.id === type.id ? { ...row, counts_as_contact: event.target.checked } : row))} /></td><td className="px-3 py-2"><input type="color" value={type.color ?? "#0c66e4"} onChange={(event) => setInteractionTypes((current) => current.map((row) => row.id === type.id ? { ...row, color: event.target.value } : row))} /></td><td className="px-3 py-2"><input className="w-20 rounded border border-[#cfd8e5] px-2 py-1.5" type="number" min={0} value={type.position} onChange={(event) => setInteractionTypes((current) => current.map((row) => row.id === type.id ? { ...row, position: Number(event.target.value) } : row))} /></td><td className="whitespace-nowrap px-3 py-2"><button type="button" className="mr-2 rounded bg-[#0c66e4] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={savingVocabularyKey !== null} onClick={() => void saveVocabulary("type", type)}>Save</button><button type="button" className="rounded border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={savingVocabularyKey !== null} onClick={() => void archiveVocabulary("type", type.id)}>Archive</button></td></tr>)}</tbody></table></div>
                  </div>
                  {vocabularyError && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{vocabularyError}</p>}
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
