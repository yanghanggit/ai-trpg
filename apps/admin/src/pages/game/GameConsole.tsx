import { useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { type AdvanceInput, useGameActions } from "../../features/games/useGameActions";
import { useNameLeaks } from "../../features/games/useGameData";
import { useGameGraph } from "../../features/games/useGameGraph";
import GamePanels from "./GamePanels";
import type { GamePageActions, GamePageData } from "./types";

/**
 * 局控制台。
 *
 * 两件事只在这里做：发控制面请求、读回来。展示层拿到的都是已经收窄好的数据与回调，
 * 它不判断作业算不算成功，也不自己重读——那两条口径只由容器执行一次。
 */
export default function GameConsole({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const actions = useGameActions(slug);

  const [queuedJobId, setQueuedJobId] = useState<string>();
  const graph = useGameGraph(slug);

  const [leaksOpen, setLeaksOpen] = useState(false);
  const leaks = useNameLeaks(slug, leaksOpen);

  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  /** 所有写操作走这一条：失败只留一行原因，不把上一次的结果留在屏幕上。 */
  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setActionError(undefined);
    try {
      await work();
    } catch (caught) {
      setActionError(describeApiError(caught));
    } finally {
      setBusy(undefined);
    }
  }

  const handlers: GamePageActions = {
    refresh: async () => {
      await run("刷新", async () => {
        await actions.refresh();
      });
    },
    advance: async (input: AdvanceInput) => {
      await run("入队回合", async () => {
        const job = await actions.advance(input);
        setQueuedJobId(job.jobId);
      });
    },
    pass: async (actors) => {
      await run("记空回合", async () => {
        await actions.pass(actors);
      });
    },
    endGame: async (input) => {
      await run("结束一局", async () => {
        await actions.endGame(input);
      });
    },
    deleteGame: async () => {
      await run("删除一局", async () => {
        await actions.deleteGame();
        navigate("/");
      });
    },
    openLeaks: () => setLeaksOpen(true),
    closeLeaks: () => setLeaksOpen(false),
    rescanLeaks: () => void leaks.refetch(),
  };

  const data: GamePageData = {
    slug,
    busy,
    actionError,
    queuedJobId,
    ...(graph.data === undefined ? {} : { graph: graph.data }),
    ...(graph.isError ? { graphError: describeApiError(graph.error) } : {}),
    leaks: leaks.data,
    leaksError: leaks.isError ? describeApiError(leaks.error) : undefined,
    leaksOpen,
  };

  return <GamePanels data={data} actions={handlers} />;
}
