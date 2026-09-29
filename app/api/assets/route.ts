import { NextResponse } from "next/server";
import { listAssets } from "@/lib/db";

/** GET /api/assets — list all assets (for the new-request form). */
export async function GET() {
  try {
    const assets = await listAssets();
    return NextResponse.json(assets);
  } catch (e) {
    console.error("[GET /api/assets]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
