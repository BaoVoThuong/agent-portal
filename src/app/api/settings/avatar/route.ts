import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  AVATAR_MAX_BYTES,
  deleteAvatarByUrl,
  uploadAvatar,
  validateAvatarFile,
} from "@/lib/people/avatar-storage";

export const dynamic = "force-dynamic";

/**
 * Ảnh đại diện của CHÍNH người đang đăng nhập.
 *
 * Cố ý không nhận email trong body: email lấy từ phiên. Có một ô nhận email là
 * bất kỳ ai cũng đổi được ảnh của người khác, và đó là loại lỗi không ai phát
 * hiện cho tới lúc đã muộn. Admin cũng không đổi hộ được — đội đã chốt vậy.
 */

type Account = { id: string; email: string; avatar_url: string | null };

async function currentAccount(): Promise<Account | null> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return null;

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,avatar_url")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as Account;
}

export async function POST(request: Request) {
  const account = await currentAccount();
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `request.formData()` đọc TOÀN BỘ thân request vào bộ nhớ rồi mới trả về, nên
  // kiểm `file.size` sau đó không chặn được một tệp khổng lồ. Chặn thô bằng
  // Content-Length TRƯỚC khi parse; nới thêm 64KB cho phần vỏ multipart. Kiểm
  // chính xác vẫn là file.size bên dưới. Thiếu header (chunked) thì trần body của
  // nền tảng vẫn là lớp chặn cuối.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > AVATAR_MAX_BYTES + 64 * 1024) {
    return NextResponse.json(
      { error: "This photo is too large (max 512 KB after resizing)." },
      { status: 413 }
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a photo to upload." }, { status: 400 });
  }
  // Kiểm chính xác kích thước tệp; Content-Length ở trên chỉ là chặn thô.
  if (file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json(
      { error: "This photo is too large (max 512 KB after resizing)." },
      { status: 400 }
    );
  }

  const data = await file.arrayBuffer();
  const validated = validateAvatarFile(file.name, data);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  let uploaded: { path: string; publicUrl: string };
  try {
    uploaded = await uploadAvatar(data, validated.contentType, validated.extension);
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Couldn't upload the photo. Please try again." },
      { status: 500 }
    );
  }

  const previousUrl = account.avatar_url;
  const { error: updateError } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .update({ avatar_url: uploaded.publicUrl })
    .eq("id", account.id);
  if (updateError) {
    // Cột không ghi được thì tệp vừa tải lên là rác. Dọn ngay, nếu không mỗi
    // lần lỗi lại bỏ lại một tệp không ai tham chiếu tới.
    after(() => deleteAvatarByUrl(uploaded.publicUrl));
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Xoá ảnh cũ SAU khi cột đã trỏ sang ảnh mới, và sau khi phản hồi đã trả.
  // Thứ tự này quan trọng: xoá trước mà ghi cột hỏng thì người dùng mất ảnh cũ
  // lẫn ảnh mới.
  after(() => deleteAvatarByUrl(previousUrl));

  return NextResponse.json({ avatar_url: uploaded.publicUrl });
}

export async function DELETE() {
  const account = await currentAccount();
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const previousUrl = account.avatar_url;
  const { error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .update({ avatar_url: null })
    .eq("id", account.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  after(() => deleteAvatarByUrl(previousUrl));
  return NextResponse.json({ avatar_url: null });
}
