import { NextResponse } from "next/server";
import { hindsightHealth } from "@/lib/hindsight";
import { getSupabase } from "@/lib/supabase";

/** GET /api/health — quick health check for Hindsight + PostgreSQL. */
export async function GET() {
  const [hd, db] = await Promise.allSettled([
    hindsightHealth(),
    getSupabase().from("assets").select("id", { count: "exact", head: true }),
  ]);

  const hindsight =
    hd.status === "fulfilled"
      ? hd.value
      : { ok: false, detail: String((hd as PromiseRejectedResult).reason) };

  const supabase =
    db.status === "fulfilled" && !db.value.error
      ? { ok: true, detail: "connected" }
      : {
          ok: false,
          detail:
            db.status === "rejected"
              ? String((db as PromiseRejectedResult).reason)
              : db.value.error?.message ?? "unknown",
        };

  const allOk = hindsight.ok && supabase.ok;
  return NextResponse.json({ ok: allOk, hindsight, supabase }, { status: allOk ? 200 : 503 });
}
