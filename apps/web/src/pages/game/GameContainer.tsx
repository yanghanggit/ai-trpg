import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { describeApiError } from "../../api/describeApiError";
import { useGameView } from "../../features/games/useGameView";
import { useActiveTurnJobs } from "../../features/turns/useTurnJob";
import HistoryDialog from "./HistoryDialog";
import StagePage from "./StagePage";
import TurnDialog from "./TurnDialog";

/** 进度只有阶段与一句补充；页面只负责把它们串成人话。 */
function describeProgress(job: {
  progress: { step?: string; detail?: string } | null;
  status: string;
}): string {
  return job.progress?.detail ?? job.progress?.step ?? job.status;
}

/** 取数；渲染交给 `StagePage`（mock 用的也是这个页面组件）。 */
export default function GameContainer({ slug }: { slug: string }) {
  const game = useGameView(slug);
  // 有人（或刷新前的自己）正在推这一局：页面先给出事实，别让人对着旧投影干等。
  const activeJobs = useActiveTurnJobs(slug);
  const running = activeJobs.data?.[0] ?? null;

  // 回合在别处跑完（别人发起的、刷新前发起的）：投影要跟着重读，别让人对着旧的一屏。
  const queryClient = useQueryClient();
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running !== null) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      void queryClient.invalidateQueries({ queryKey: ["games", slug, "view"] });
    }
  }, [running, queryClient, slug]);

  if (game.isPending) {
    return (
      <main className="launch">
        <div className="launch__inner">
          <p className="muted">读取中…</p>
        </div>
      </main>
    );
  }

  if (game.isError) {
    return (
      <main className="launch">
        <div className="launch__inner">
          <p className="form-error" role="alert">
            {describeApiError(game.error)}
          </p>
        </div>
      </main>
    );
  }

  return (
    <StagePage
      view={game.data}
      renderHistory={({ slug: gameSlug, onClose }) => (
        <HistoryDialog slug={gameSlug} onClose={onClose} />
      )}
      renderTurn={({ slug: gameSlug, onClose }) => (
        <TurnDialog slug={gameSlug} view={game.data} onClose={onClose} />
      )}
      notice={
        running === null ? undefined : (
          <p className="muted">
            {`这一局有回合在跑（${describeProgress(running)}）；结束后重读这一页可以看到结果。`}
          </p>
        )
      }
    />
  );
}
