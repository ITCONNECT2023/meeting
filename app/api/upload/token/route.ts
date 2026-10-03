import { NextResponse, type NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { isValidSessionCookie } from "@/lib/auth/check";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { finishUpload } from "@/lib/storage/finish-upload";
import { isAudioPathnameFor } from "@/lib/storage/pathname";
import { getJob } from "@/lib/store/jobs";
import { MAX_FILE_BYTES } from "@/lib/validation/input";

/**
 * EPIC 10-3: the browser asks here for permission to upload one recording
 * straight to Blob, then Blob calls back here when the upload finishes.
 *
 * Two different callers reach this URL:
 * - the browser asks for a token (`blob.generate-client-token`), so the
 *   session cookie must be valid. proxy.ts lets this path through without
 *   the cookie because the callback below has none, so the check is here;
 * - Blob's completion callback (`blob.upload-completed`) has no cookie. The
 *   `handleUpload` helper verifies its signature instead.
 *
 * A token is only handed out for this job's own pathname (`uploads/<jobId>_…`)
 * with an audio extension and at most 200 MB, and only while the job has not
 * already received its upload.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Browsers report m4a/mp3/wav as audio/*; unknown types arrive as octet-stream. */
const ALLOWED_CONTENT_TYPES = ["audio/*", "application/octet-stream"];

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400, headers: NO_STORE });
  }

  if (
    body.type === "blob.generate-client-token" &&
    !isValidSessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value)
  ) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: NO_STORE });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const jobId = clientPayload ?? "";
        const job = jobId ? await getJob(jobId) : null;
        if (!job) throw new Error("JOB_NOT_FOUND");
        if (job.steps.upload?.status === "completed") throw new Error("ALREADY_UPLOADED");
        if (!isAudioPathnameFor(pathname, jobId)) throw new Error("BAD_PATHNAME");

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: jobId,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const jobId = tokenPayload ?? "";
        if (!isAudioPathnameFor(blob.pathname, jobId)) return;
        await finishUpload(jobId);
      },
    });
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { code: "UPLOAD_TOKEN_FAILED", message: "올리기 허가를 받지 못했습니다. 다시 시도해 주세요." },
      { status: 400, headers: NO_STORE },
    );
  }
}
