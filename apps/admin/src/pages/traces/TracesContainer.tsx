import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useTraceFiles } from "../../features/traces/useTraceFiles";
import TracesPage from "./TracesPage";
import type { TracesData } from "./types";

/** 第一层：目录里有哪几个局。 */
export default function TracesContainer() {
  const navigate = useNavigate();
  const files = useTraceFiles();

  const data: TracesData = {
    dir: files.data?.dir,
    games: files.data?.games,
    gamesError: files.isError ? describeApiError(files.error) : undefined,
  };

  return (
    <TracesPage
      data={data}
      onOpenGame={(slug) => navigate(`/traces/${encodeURIComponent(slug)}`)}
      onBack={() => navigate("/")}
    />
  );
}
