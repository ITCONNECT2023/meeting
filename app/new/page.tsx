import { UploadScreen } from "./UploadScreen";
import type { UploadMode } from "./useUploadForm";

type NewPageProps = {
  searchParams: Promise<{ mode?: string | string[] }>;
};

function resolveMode(value: string | string[] | undefined): UploadMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "b" ? "b" : "a";
}

// EPIC 2: server component only resolves ?mode=a|b (default a) so the
// first paint already has the right tab/badge; UploadScreen (client) owns
// every input from there. EPIC 3 grows this same page into
// processing/review/result.
export default async function NewPage({ searchParams }: NewPageProps) {
  const params = await searchParams;
  const mode = resolveMode(params.mode);

  return <UploadScreen initialMode={mode} />;
}
