import { NextResponse, type NextRequest } from "next/server";

import { JobInputSchema } from "@/lib/validation/input";
import { isBlobStorage } from "@/lib/storage";
import { createJob } from "@/lib/store/jobs";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { code: "NOT_FOUND" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

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
  // EPIC 10-3: tells the browser whether to send the file to Blob or to this server.
  const uploadMode = isBlobStorage() ? "blob" : "local";
  return NextResponse.json(
    { id: job.id, job, record: job, uploadMode },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

