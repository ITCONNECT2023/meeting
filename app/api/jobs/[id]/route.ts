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
      // F11/TRD4: once the B job has already finished (sent or failed),
      // nothing else ever looks at `clientLeft` again (the workflow's own
      // check already ran) — so if the client's leave signal shows up this
      // late, delete right away instead of leaving it for the 24h TTL.
      if (job.status === "sent" || job.status === "failed") {
        const storage = getStorage();
        await storage.deleteAudio(id);
        const deleted = await deleteJob(id);
        return NextResponse.json(
          { ok: true, deleted },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      await updateJob(id, { clientLeft: true });

      // Close the race: the workflow may finish between the read above and
      // this write, after which no later check will ever see the flag.
      const after = await getJob(id);
      if (after && (after.status === "sent" || after.status === "failed")) {
        const storage = getStorage();
        await storage.deleteAudio(id);
        const deleted = await deleteJob(id);
        return NextResponse.json(
          { ok: true, deleted },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

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

