import { NextResponse, type NextRequest } from "next/server";
import { executeSendWorkflow } from "@/workflows/send-mail";
import { getJob } from "@/lib/store/jobs";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return NextResponse.json(
      {
        code: "EXPIRED",
        message: "보관 시간(24시간)이 지나 회의록이 삭제되었습니다. 녹음을 다시 올려 주세요.",
      },
      { status: 410, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: { retry?: boolean; immediate?: boolean } = {};
  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    // Body is optional
  }

  try {
    const result = await executeSendWorkflow(id, {
      isRetry: body.retry === true,
      immediateResolve: body.immediate === true,
    });

    return NextResponse.json(
      {
        ok: true,
        status: result.job.status,
        recipientResults: result.recipientResults,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (errorMsg.includes("이미 발송 중")) {
      return NextResponse.json(
        {
          ok: false,
          error: "ALREADY_SENDING",
          message: "이미 메일을 발송 중입니다.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "SEND_FAILED",
        message: "메일을 보내지 못했습니다. 잠시 뒤 다시 보내 주세요.",
        details: errorMsg,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
