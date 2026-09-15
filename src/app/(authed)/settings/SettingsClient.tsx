"use client";

import { useRouter } from "next/navigation";
import { Badge, CheckCircle2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { resizeImageToSquare } from "@/lib/people/resize-avatar";
import PushNotificationCard from "./PushNotificationCard";

type SettingsClientProps = {
  profile: {
    email: string;
    name: string;
    agentId: string | null;
    hasLocalPassword: boolean;
    avatarUrl: string | null;
  };
  vapidPublicKey: string;
};

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function SettingsClient({
  profile,
  vapidPublicKey,
}: SettingsClientProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.name);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
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

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      // Thu nhỏ ở TRÌNH DUYỆT trước khi gửi. Ảnh điện thoại 3-5MB mà lưu nguyên
      // cỡ thì mỗi dòng bảng task tải về một tệp như vậy.
      const resized = await resizeImageToSquare(file);
      if (!resized.ok) {
        setAvatarError(resized.error);
        return;
      }
      const body = new FormData();
      body.append("file", resized.file);
      const response = await fetch("/api/settings/avatar", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setAvatarError(payload?.error ?? "Không tải được ảnh lên.");
        return;
      }
      setAvatarUrl(payload?.avatar_url ?? null);
      // Layout nạp danh bạ avatar ở phía server, nên phải làm mới thì ảnh mới
      // đổi ở TopBar và các bảng khác.
      router.refresh();
    } catch {
      setAvatarError("Không tải được ảnh lên.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const response = await fetch("/api/settings/avatar", { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setAvatarError(payload?.error ?? "Không gỡ được ảnh.");
        return;
      }
      setAvatarUrl(null);
      router.refresh();
    } catch {
      setAvatarError("Không gỡ được ảnh.");
    } finally {
      setAvatarBusy(false);
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
              <div className="flex flex-col items-center gap-3 rounded-lg border border-[#e6eaf0] bg-[#f7f8fa] px-5 py-6">
                {avatarUrl ? (
                  // <img> thường thay cho next/image: ảnh đã thu về 256px webp ở trình
                  // duyệt, ô hiển thị chỉ 96px — đẩy qua /_next/image chỉ thêm một chặng
                  // proxy và chi phí, không giảm được byte nào.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={displayName || profile.email}
                    width={96}
                    height={96}
                    className="h-24 w-24 rounded-full object-cover ring-8 ring-white"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#deebff] text-2xl font-bold text-[#0c66e4] ring-8 ring-white">
                    {initials(displayName, profile.email)}
                  </div>
                )}

                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Xoá giá trị của input NGAY: không xoá thì chọn lại đúng
                    // tệp vừa chọn sẽ không kích hoạt onChange lần nữa, và
                    // người dùng tưởng nút hỏng.
                    event.target.value = "";
                    if (file) void uploadAvatar(file);
                  }}
                />
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={() => avatarInputRef.current?.click()}
                    className="rounded-md border border-[#cfd8e5] bg-white px-3 py-1.5 text-xs font-semibold text-[#172b4d] transition hover:bg-[#f4f7fb] disabled:opacity-60"
                  >
                    {avatarBusy ? "Đang tải…" : avatarUrl ? "Đổi ảnh" : "Tải ảnh lên"}
                  </button>
                  {avatarUrl ? (
                    <button
                      type="button"
                      disabled={avatarBusy}
                      onClick={() => void removeAvatar()}
                      className="rounded-md px-3 py-1 text-xs font-semibold text-[#6b778c] transition hover:bg-[#f4f7fb] hover:text-[#bf2600] disabled:opacity-60"
                    >
                      Gỡ ảnh
                    </button>
                  ) : null}
                </div>
                {avatarError ? (
                  <p className="text-center text-xs font-semibold text-red-700">{avatarError}</p>
                ) : null}
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
        <PushNotificationCard vapidPublicKey={vapidPublicKey} />
      </div>
    </div>
  );
}
