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

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Chưa chọn ảnh." }, { status: 400 });
  }
  // Chặn theo kích thước đã khai TRƯỚC khi đọc vào bộ nhớ: đọc hết rồi mới từ
  // chối nghĩa là một tệp 500MB vẫn kịp chiếm sạch RAM của tiến trình.
  if (file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json(
      { error: "Ảnh quá lớn (tối đa 512KB sau khi thu nhỏ)." },
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
      { error: caught instanceof Error ? caught.message : "Không tải được ảnh lên." },
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
