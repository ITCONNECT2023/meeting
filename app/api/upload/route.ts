import { NextResponse, type NextRequest } from "next/server";

import { getStorage } from "@/lib/storage";
import { getJob, updateJob } from "@/lib/store/jobs";
import { VALIDATION_MESSAGES } from "@/lib/validation/input";
import { startProcessMeeting } from "@/workflows/runner";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  let jobId = url.searchParams.get("jobId");

  const contentType = request.headers.get("content-type") ?? "";
  let fileName = "";
  let fileSource: ReadableStream<Uint8Array> | Buffer | null = null;

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 });
    }

    jobId = (formData.get("jobId") as string) || jobId;
    const fileEntry = formData.get("file");
    if (!fileEntry || !(fileEntry instanceof File)) {
      return NextResponse.json(
        { code: "FILE_MISSING", message: VALIDATION_MESSAGES.fileMissing },
        { status: 400 },
      );
    }

    fileName = fileEntry.name;
    const buffer = Buffer.from(await fileEntry.arrayBuffer());
    fileSource = buffer;
  } else {
    // Raw body stream
    fileName = request.headers.get("x-file-name") || "recording.mp3";
    if (!request.body) {
      return NextResponse.json(
        { code: "FILE_MISSING", message: VALIDATION_MESSAGES.fileMissing },
        { status: 400 },
      );
    }
    fileSource = request.body;
  }

  if (!jobId) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "jobId is required" },
      { status: 400 },
    );
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json(
      { code: "JOB_NOT_FOUND", message: "작업을 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const storage = getStorage();

  try {
    await storage.saveAudio(jobId, fileName, fileSource);
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err.code === "FILE_TYPE") {
      return NextResponse.json(
        { code: "FILE_TYPE", message: err.message },
        { status: 400 },
      );
    }
    if (err.code === "FILE_TOO_LARGE") {
      return NextResponse.json(
        { code: "FILE_TOO_LARGE", message: err.message },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { code: "UPLOAD_FAILED", message: "파일을 올리지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  // Mark upload completed
  await updateJob(jobId, {
    steps: {
      ...job.steps,
      upload: {
        status: "completed",
        startedAt: job.steps.upload?.startedAt ?? job.createdAt,
        completedAt: Date.now(),
      },
    },
  });

  // Kick off workflow
  await startProcessMeeting(jobId);

  return NextResponse.json(
    { ok: true, jobId },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
