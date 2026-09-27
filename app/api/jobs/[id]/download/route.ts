import { NextResponse, type NextRequest } from "next/server";

import { formatMinutesFilename } from "@/lib/minutes/filename";
import { renderMarkdown } from "@/lib/minutes/render-md";
import { getJob } from "@/lib/store/jobs";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
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
        code: "JOB_NOT_READY",
        message: "회의록이 아직 준비되지 않았습니다.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const markdown = renderMarkdown(job.minutes);
  const filename = formatMinutesFilename(job.minutes.date, job.createdAt);
  const encodedFilename = encodeURIComponent(filename);

  return new Response(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
      "Cache-Control": "no-store",
    },
  });
}
