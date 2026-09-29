import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

/** GET /api/users — list technicians (for job assignment dropdown). */
export async function GET() {
  try {
    const { data, error } = await getSupabase()
      .from("users")
      .select("id, name, email, role")
      .eq("role", "technician")
      .order("name");
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error("[GET /api/users]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
