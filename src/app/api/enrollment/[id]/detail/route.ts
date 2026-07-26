import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { loadEnrollmentDetail } from "@/lib/enrollment/detail";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: record, error } = await supabase
    .from("enrollment_records")
    .select("id")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    return NextResponse.json(await loadEnrollmentDetail(supabase, id));
  } catch (detailError) {
    return NextResponse.json(
      {
        error:
          detailError instanceof Error
            ? detailError.message
            : "Unable to load enrollment detail.",
      },
      { status: 500 }
    );
  }
}
