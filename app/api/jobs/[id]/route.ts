import { NextResponse, type NextRequest } from "next/server";

import { getStorage } from "@/lib/storage";
import { deleteJob, getJob, updateJob } from "@/lib/store/jobs";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
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

  return NextResponse.json(
    { job },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const storage = getStorage();

  await storage.deleteAudio(id);
  const deleted = await deleteJob(id);

  return NextResponse.json(
    { ok: true, deleted },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const isClientLeft = request.nextUrl.searchParams.get("clientLeft") === "1";
  let bodyJson: { clientLeft?: boolean } | null = null;
  try {
    const text = await request.text();
    if (text) {
      bodyJson = JSON.parse(text);
    }
  } catch {
    // ignore
  }

  if (isClientLeft || bodyJson?.clientLeft) {
    const job = await getJob(id);
    if (job && job.mode === "B") {
      await updateJob(id, { clientLeft: true });
      return NextResponse.json(
        { ok: true, clientLeft: true },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const storage = getStorage();
  await storage.deleteAudio(id);
  const deleted = await deleteJob(id);

  return NextResponse.json(
    { ok: true, deleted },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const body = await request.json();
    if (body.clientLeft) {
      const job = await getJob(id);
      if (job && job.mode === "B") {
        await updateJob(id, { clientLeft: true });
        return NextResponse.json(
          { ok: true, clientLeft: true },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
  } catch {
    // ignore
  }
  return NextResponse.json({ ok: false }, { status: 400 });
}

