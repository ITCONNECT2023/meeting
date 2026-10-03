import { NextResponse, type NextRequest } from "next/server";

import { confirmBlobUpload } from "@/lib/storage/blob";
import { finishUpload } from "@/lib/storage/finish-upload";
import { getStorage, isBlobStorage } from "@/lib/storage";
import { isAudioPathnameFor } from "@/lib/storage/pathname";
import { getJob } from "@/lib/store/jobs";
import { VALIDATION_MESSAGES } from "@/lib/validation/input";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const contentType = request.headers.get("content-type") ?? "";

  // EPIC 10-3: in Blob mode the browser has already put the file in Blob and
  // only tells us its pathname here (the "in case the completion callback is
  // late" path; the callback does the same work).
  if (/^application\/json\b/i.test(contentType)) {
    return confirmBlobUploadRequest(request, url.searchParams.get("jobId"));
  }

  // Vercel rejects request bodies over 4.5 MB, so a 200 MB recording can't
  // come through here once Blob is linked. The browser uploads it directly.
  if (isBlobStorage()) {
    return NextResponse.json(
      { code: "DIRECT_UPLOAD_ONLY", message: "녹음은 저장소에 직접 올려야 합니다. 화면을 새로고침한 뒤 다시 시도해 주세요." },
      { status: 415, headers: NO_STORE },
    );
  }

  let jobId = url.searchParams.get("jobId");
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

  await finishUpload(jobId);

  return NextResponse.json(
    { ok: true, jobId },
    { status: 200, headers: NO_STORE },
  );
}

async function confirmBlobUploadRequest(
  request: NextRequest,
  jobId: string | null,
): Promise<NextResponse> {
  if (!isBlobStorage()) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 415, headers: NO_STORE });
  }

  let body: { pathname?: unknown };
  try {
    body = (await request.json()) as { pathname?: unknown };
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  }

  if (!jobId || !(await getJob(jobId))) {
    return NextResponse.json(
      { code: "JOB_NOT_FOUND", message: "작업을 찾을 수 없습니다." },
      { status: 404, headers: NO_STORE },
    );
  }

  const pathname = typeof body.pathname === "string" ? body.pathname : "";
  if (!isAudioPathnameFor(pathname, jobId)) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  }

  if (!(await confirmBlobUpload(pathname))) {
    return NextResponse.json(
      { code: "UPLOAD_NOT_FOUND", message: "녹음이 올라가지 않았습니다. 다시 시도해 주세요." },
      { status: 400, headers: NO_STORE },
    );
  }

  await finishUpload(jobId);
  return NextResponse.json({ ok: true, jobId }, { status: 200, headers: NO_STORE });
}
