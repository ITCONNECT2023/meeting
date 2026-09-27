import type { MeetingMinutes } from "@/lib/minutes/types";
import { formatMailSubject, formatMinutesFilename } from "@/lib/minutes/filename";
import { renderMarkdown } from "@/lib/minutes/render-md";

export interface RenderEmailOptions {
  minutes: MeetingMinutes;
  createdAt?: number | string | Date;
}

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface RenderEmailResult {
  subject: string;
  text: string;
  html: string;
  attachment: EmailAttachment;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmail(options: RenderEmailOptions): RenderEmailResult {
  const { minutes, createdAt } = options;
  const title = minutes.title?.trim() || "회의";
  const dateStr = minutes.date?.trim() || "미정";
  const attendeesStr =
    minutes.attendees && minutes.attendees.length > 0
      ? minutes.attendees.join(", ")
      : "미정";

  const subject = formatMailSubject(title, minutes.date);
  const attachmentFilename = formatMinutesFilename(minutes.date, createdAt);
  const attachmentContent = renderMarkdown(minutes);

  const allText = JSON.stringify(minutes);
  const hasModified = allText.includes("(수정됨)");

  // 1. Plain Text Body
  const textParts: string[] = [];
  textParts.push(`# ${title}\n`);
  textParts.push(`- 일시: ${dateStr}`);
  textParts.push(`- 참석자: ${attendeesStr}\n`);

  textParts.push("## 요약");
  if (!minutes.summary || minutes.summary.length === 0) {
    textParts.push("- 없음\n");
  } else {
    for (const item of minutes.summary) {
      textParts.push(`- ${item}`);
    }
    textParts.push("");
  }

  textParts.push("## 결정사항");
  if (!minutes.decisions || minutes.decisions.length === 0) {
    textParts.push("없음\n");
  } else {
    minutes.decisions.forEach((d, idx) => {
      let tsSuffix = "";
      if (d.ts) {
        const cleanTs = d.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
        tsSuffix = ` [${cleanTs}]`;
      }
      textParts.push(`${idx + 1}. ${d.text}${tsSuffix}`);
    });
    textParts.push("");
  }

  textParts.push("## 할 일");
  if (!minutes.todos || minutes.todos.length === 0) {
    textParts.push("없음\n");
  } else {
    textParts.push("| 할 일 | 담당자 | 기한 | 근거 |");
    textParts.push("|---|---|---|---|");
    for (const t of minutes.todos) {
      let tsCell = "근거 없음";
      if (t.ts) {
        const cleanTs = t.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
        tsCell = cleanTs === "근거 없음" ? "[근거 없음]" : `[${cleanTs}]`;
      }
      textParts.push(`| ${t.task} | ${t.owner} | ${t.due} | ${tsCell} |`);
    }
    textParts.push("");
  }

  // AI Disclaimer in Text
  let textDisclaimer = "이 회의록은 녹음을 바탕으로 AI가 작성했습니다.";
  if (hasModified) {
    textDisclaimer += " `(수정됨)` 표시는 검토자가 고친 부분입니다.";
  }
  textParts.push(textDisclaimer);

  const textBody = textParts.join("\n");

  // 2. HTML Body
  const htmlParts: string[] = [];
  htmlParts.push(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1C1B18; background-color: #F8F7F4; margin: 0; padding: 24px; }
    .card { max-width: 680px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DDD8CE; border-radius: 16px; padding: 36px 40px; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 16px; color: #1C1B18; line-height: 1.35; }
    h2 { font-size: 17px; font-weight: 700; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #EEEAE2; color: #1C1B18; }
    dl { margin: 0 0 20px; font-size: 14px; display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 6px 12px; }
    dt { color: #5E5A52; font-weight: 500; }
    dd { margin: 0; color: #1C1B18; }
    ul, ol { margin: 0 0 16px; padding-left: 20px; font-size: 14px; }
    li { margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 20px; font-size: 14px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #EEEAE2; }
    th { background: #F4F2EC; color: #5E5A52; font-weight: 600; font-size: 13px; }
    .ts { font-family: monospace; font-size: 12px; padding: 1px 6px; border-radius: 4px; background: #EFECE5; color: #3D3A34; }
    .dashed { display: inline-block; padding: 1px 8px; border: 1px dashed #A39C8F; border-radius: 4px; font-size: 12px; color: #5E5A52; background: #FAF9F6; }
    .disclaimer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #EEEAE2; font-size: 12px; color: #5E5A52; line-height: 1.5; }
    .attachment-notice { margin-top: 16px; padding: 12px 16px; background: #F4F2EC; border-radius: 10px; font-size: 13px; color: #3D3A34; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <dl>
      <dt>일시</dt>
      <dd>${escapeHtml(dateStr)}</dd>
      <dt>참석자</dt>
      <dd>${escapeHtml(attendeesStr)}</dd>
    </dl>
`);

  // Summary HTML
  htmlParts.push(`    <h2>요약</h2>`);
  if (!minutes.summary || minutes.summary.length === 0) {
    htmlParts.push(`    <p><span class="dashed">없음</span></p>`);
  } else {
    htmlParts.push(`    <ul>`);
    for (const item of minutes.summary) {
      htmlParts.push(`      <li>${escapeHtml(item)}</li>`);
    }
    htmlParts.push(`    </ul>`);
  }

  // Decisions HTML
  htmlParts.push(`    <h2>결정사항</h2>`);
  if (!minutes.decisions || minutes.decisions.length === 0) {
    htmlParts.push(`    <p><span class="dashed">없음</span></p>`);
  } else {
    htmlParts.push(`    <ol>`);
    for (const d of minutes.decisions) {
      let tsBadge = "";
      if (d.ts) {
        const cleanTs = d.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
        tsBadge = ` <span class="ts">[${escapeHtml(cleanTs)}]</span>`;
      }
      htmlParts.push(`      <li>${escapeHtml(d.text)}${tsBadge}</li>`);
    }
    htmlParts.push(`    </ol>`);
  }

  // Todos HTML
  htmlParts.push(`    <h2>할 일</h2>`);
  if (!minutes.todos || minutes.todos.length === 0) {
    htmlParts.push(`    <p><span class="dashed">없음</span></p>`);
  } else {
    htmlParts.push(`    <table>
      <thead>
        <tr>
          <th>할 일</th>
          <th>담당자</th>
          <th>기한</th>
          <th>근거</th>
        </tr>
      </thead>
      <tbody>`);
    for (const t of minutes.todos) {
      let ownerHtml = escapeHtml(t.owner);
      if (t.owner === "미정") {
        ownerHtml = `<span class="dashed">미정</span>`;
      }
      let dueHtml = escapeHtml(t.due);
      if (t.due === "미정") {
        dueHtml = `<span class="dashed">미정</span>`;
      }
      let tsHtml = `<span class="dashed">근거 없음</span>`;
      if (t.ts && t.ts !== "근거 없음") {
        const cleanTs = t.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
        tsHtml = `<span class="ts">[${escapeHtml(cleanTs)}]</span>`;
      }

      htmlParts.push(`        <tr>
          <td>${escapeHtml(t.task)}</td>
          <td>${ownerHtml}</td>
          <td>${dueHtml}</td>
          <td>${tsHtml}</td>
        </tr>`);
    }
    htmlParts.push(`      </tbody>
    </table>`);
  }

  // Attachment notice & AI Disclaimer
  let htmlDisclaimer = "이 회의록은 녹음을 바탕으로 AI가 작성했습니다.";
  if (hasModified) {
    htmlDisclaimer += " `(수정됨)` 표시는 검토자가 고친 부분입니다.";
  }

  htmlParts.push(`    <div class="attachment-notice">
      첨부된 <strong>${escapeHtml(attachmentFilename)}</strong> 파일에 발언별 타임스탬프가 포함된 전체 회의록이 들어 있습니다.
    </div>
    <div class="disclaimer">
      ${escapeHtml(htmlDisclaimer).replace("`(수정됨)`", "<strong>(수정됨)</strong>")}
    </div>
  </div>
</body>
</html>`);

  const htmlBody = htmlParts.join("\n");

  return {
    subject,
    text: textBody,
    html: htmlBody,
    attachment: {
      filename: attachmentFilename,
      content: attachmentContent,
      contentType: "text/markdown; charset=utf-8",
    },
  };
}
