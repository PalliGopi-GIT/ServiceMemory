import { NextResponse } from "next/server";
import { getServiceRequest } from "@/lib/db";
import { NotFoundError } from "@/lib/db";

/** GET /api/requests/[id] — fetch one request with its asset. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const request = await getServiceRequest(id);
    return NextResponse.json(request);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("[GET /api/requests/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
