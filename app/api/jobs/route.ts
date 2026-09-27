import { NextResponse, type NextRequest } from "next/server";

import { JobInputSchema } from "@/lib/validation/input";
import { createJob } from "@/lib/store/jobs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
  }

  const parsed = JobInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "VALIDATION_FAILED", errors: parsed.error.issues },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const job = await createJob(parsed.data);
  return NextResponse.json(
    { job },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
