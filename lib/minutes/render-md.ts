import type { MeetingMinutes } from "@/lib/minutes/types";

export interface RenderMarkdownOptions {
  includeAiDisclaimer?: boolean;
}

export function renderMarkdown(
  minutes: MeetingMinutes,
  options: RenderMarkdownOptions = { includeAiDisclaimer: true }
): string {
  const parts: string[] = [];

  // Title
  parts.push(`# ${minutes.title || "회의"}\n`);

  // Meta (Date & Attendees)
  const dateStr = minutes.date || "미정";
  const attendeesStr =
    minutes.attendees && minutes.attendees.length > 0
      ? minutes.attendees.join(", ")
      : "미정";

  parts.push(`- **일시:** ${dateStr}\n- **참석자:** ${attendeesStr}\n`);

  // Summary
  parts.push("## 요약");
  if (!minutes.summary || minutes.summary.length === 0) {
    parts.push("- 없음\n");
  } else {
    const summaryLines = minutes.summary.map((s) => `- ${s}`).join("\n");
    parts.push(`${summaryLines}\n`);
  }

  // Decisions
  parts.push("## 결정사항");
  if (!minutes.decisions || minutes.decisions.length === 0) {
    parts.push("없음\n");
  } else {
    const decisionLines = minutes.decisions
      .map((d, idx) => {
        let tsSuffix = "";
        if (d.ts) {
          const cleanTs = d.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
          tsSuffix = ` \`[${cleanTs}]\``;
        }
        return `${idx + 1}. ${d.text}${tsSuffix}`;
      })
      .join("\n");
    parts.push(`${decisionLines}\n`);
  }

  // Todos
  parts.push("## 할 일");
  if (!minutes.todos || minutes.todos.length === 0) {
    parts.push("없음\n");
  } else {
    const tableHeader = "| 할 일 | 담당자 | 기한 | 근거 |\n|---|---|---|---|";
    const tableRows = minutes.todos
      .map((t) => {
        let tsCell = "근거 없음";
        if (t.ts) {
          const cleanTs = t.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
          tsCell = cleanTs === "근거 없음" ? "`[근거 없음]`" : `\`[${cleanTs}]\``;
        }
        return `| ${t.task} | ${t.owner} | ${t.due} | ${tsCell} |`;
      })
      .join("\n");
    parts.push(`${tableHeader}\n${tableRows}\n`);
  }

  // Full Script
  parts.push("## 전체 스크립트");
  if (!minutes.script || minutes.script.length === 0) {
    parts.push("없음");
  } else {
    const scriptLines = minutes.script
      .map((line) => {
        const cleanTs = line.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
        return `[${cleanTs}] ${line.speaker}: ${line.text}`;
      })
      .join("\n");
    parts.push(scriptLines);
  }

  let fullMarkdown = parts.join("\n");

  // AI Disclaimer
  if (options.includeAiDisclaimer !== false) {
    const hasModified = fullMarkdown.includes("(수정됨)");
    let disclaimer = "이 회의록은 녹음을 바탕으로 AI가 작성했습니다.";
    if (hasModified) {
      disclaimer += " `(수정됨)` 표시는 검토자가 고친 부분입니다.";
    }
    fullMarkdown += `\n\n${disclaimer}`;
  }

  return fullMarkdown;
}
