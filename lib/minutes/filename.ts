/**
 * Meeting minutes filename and email subject utilities.
 *
 * Rules (PRD 5-3, FRD 5-4, 589-590):
 * - Filename: 회의록_YYYY-MM-DD.md
 *   - Date is meeting date.
 *   - If meeting date is "미정" or empty, use uploaded (createdAt) date.
 * - Email Subject: [회의록] {회의 제목} ({YYYY-MM-DD})
 *   - If date is "미정" or empty, use (미정).
 */

function formatDateToYMD(dateObj: Date): string {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function extractMeetingDate(
  dateStr?: string | null,
  fallbackCreatedAt?: number | string | Date
): string {
  if (dateStr && dateStr.trim() !== "" && dateStr.trim() !== "미정") {
    const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }
  }

  // Fallback to createdAt or today
  if (fallbackCreatedAt) {
    const d = new Date(fallbackCreatedAt);
    if (!isNaN(d.getTime())) {
      return formatDateToYMD(d);
    }
  }

  return formatDateToYMD(new Date());
}

export function formatMinutesFilename(
  dateStr?: string | null,
  fallbackCreatedAt?: number | string | Date
): string {
  const ymd = extractMeetingDate(dateStr, fallbackCreatedAt);
  return `회의록_${ymd}.md`;
}

export function formatMailSubject(
  title: string,
  dateStr?: string | null
): string {
  const cleanTitle = (title || "").trim() || "회의";
  if (!dateStr || dateStr.trim() === "" || dateStr.trim() === "미정") {
    return `[회의록] ${cleanTitle} (미정)`;
  }

  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return `[회의록] ${cleanTitle} (${match[1]})`;
  }

  return `[회의록] ${cleanTitle} (미정)`;
}
