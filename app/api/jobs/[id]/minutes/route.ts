import { NextResponse, type NextRequest } from "next/server";

import { applyMinutesEdits } from "@/lib/minutes/apply-edits";
import { getJob, updateJob } from "@/lib/store/jobs";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return NextResponse.json(
      {
        code: "EXPIRED",
        message: "보관 시간(24시간)이 지나 회의록이 삭제되었습니다. 녹음을 다시 올려 주세요.",
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!job.minutes) {
    return NextResponse.json(
      {
        code: "MINUTES_NOT_READY",
        message: "회의록이 아직 준비되지 않았습니다.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_JSON",
        message: "요청 본문 형식이 올바르지 않습니다.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { section, data } = body;
  if (!section || !["meta", "summary", "decisions", "todos"].includes(section)) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_SECTION",
        message: "편집할 구역이 올바르지 않습니다.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = applyMinutesEdits(
    job.minutes,
    section,
    data,
    job.durationSeconds,
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        message: result.message,
        field: result.field,
        index: result.index,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const newMaskedCount = (job.maskedCount || 0) + (result.maskedCountAdded || 0);

  // Single source of truth update
  await updateJob(id, {
    minutes: result.minutes,
    maskedCount: newMaskedCount,
  });

  return NextResponse.json(
    {
      ok: true,
      minutes: result.minutes,
      maskedCount: newMaskedCount,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
