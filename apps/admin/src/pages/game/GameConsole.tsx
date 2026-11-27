import {
  advanceOnce,
  roundComplete,
  type TurnJob,
  type TurnRequest,
  waitForTurnJob,
} from "@ai-trpg/api-client";
import { useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import {
  createAdvancePort,
  enqueueTurn,
  fetchTurnJob,
  fetchTurnState,
  labelOf,
} from "../../features/games/advance";
import { useGameActions } from "../../features/games/useGameActions";
import { useMessageCursor, useNameLeaks } from "../../features/games/useGameData";
import { useGameGraph } from "../../features/games/useGameGraph";
import GamePanels from "./GamePanels";
import { readSeenCursor, unseenCount } from "./seenCursor";
import type { AdvanceStep, GamePageActions, GamePageData } from "./types";

/**
 * 局控制台。
 *
 * 两件事只在这里做：发控制面请求、读回来。展示层拿到的都是已经收窄好的数据与回调，
 * 它不判断作业算不算成功，也不自己重读——那两条口径只由容器执行一次。
 */
export default function GameConsole({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const actions = useGameActions(slug);

  const graph = useGameGraph(slug);
  const [advanceSteps, setAdvanceSteps] = useState<AdvanceStep[]>([]);
  const [advanceNote, setAdvanceNote] = useState<string>();

  const [leaksOpen, setLeaksOpen] = useState(false);
  const leaks = useNameLeaks(slug, leaksOpen);

  // 「新事件」：推进刚产出的事件不该在主事件流那张全量表里找，所以按钮放在推进面板上。
  // 条数 = 当前最大序号 − 这个浏览器的阅读水位；水位在关窗时重读一次。
  const cursor = useMessageCursor(slug);
  const [feedOpen, setFeedOpen] = useState(false);
  const [seen, setSeen] = useState(() => readSeenCursor(slug));

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

  /**
   * 跑一个回合：入队 → 轮询到终态 → 记进步骤日志。
   *
   * 日志在终态时补写，所以失败那一步也留得住作业 id 与错误原因。
   */
  async function runStep(request: TurnRequest): Promise<TurnJob> {
    const job = await enqueueTurn(slug, request);
    setAdvanceSteps((previous) => [
      ...previous,
      { label: labelOf(request), jobId: job.jobId, status: job.status },
    ]);
    try {
      const done = await waitForTurnJobSafe(job);
      setAdvanceSteps((previous) =>
        previous.map((step) =>
          step.jobId === job.jobId ? { ...step, status: done.status } : step,
        ),
      );
      return done;
    } catch (caught) {
      setAdvanceSteps((previous) =>
        previous.map((step) =>
          step.jobId === job.jobId
            ? { ...step, status: "failed", detail: describeApiError(caught) }
            : step,
        ),
      );
      throw caught;
    }
  }

  const waitForTurnJobSafe = (job: TurnJob): Promise<TurnJob> =>
    waitForTurnJob(job, (jobId) => fetchTurnJob(slug, jobId));

  /** 编排端口：规则来自契约包，`runTurn` 换成带日志的那一版。 */
  const port = createAdvancePort(slug, runStep);

  const handlers: GamePageActions = {
    refresh: async () => {
      await run("刷新", async () => {
        await actions.refresh();
      });
    },
    next: async () => {
      await run("下一个", async () => {
        setAdvanceSteps([]);
        setAdvanceNote(undefined);
        // 每一步都重新读：面板上那份 5 秒前的图不能拿来做决定。
        const { order, round } = await fetchTurnState(slug);
        if (order === null) {
          const created = await actions.openOrder();
          await actions.refresh();
          setAdvanceNote(`开了一条顺位（${created.entries.length} 个名次）。再点一次开始推。`);
          return;
        }
        if (order.nextActor === null) {
          await actions.completeOrder(order.id);
          setAdvanceNote("顺位上没有活着的人了：这条顺位已收工。");
          return;
        }
        // 账上说这一轮 world 还没推、而活人计数已经齐平：先把这一轮收尾，
        // 否则下一位的回合会把这一轮的第一位盖过去，world 就被跳掉了。
        if (roundComplete(order) && round?.world !== true) {
          await runStep({ kind: "world" });
          await actions.refresh();
          setAdvanceNote(`world 回合推完了第 ${round?.index ?? 1} 轮。`);
          return;
        }
        if (order.nextActor.control === "player") {
          setAdvanceNote(`轮到 ${order.nextActor.actorName}：玩家席位由玩家端自己决定。`);
          return;
        }
        const result = await advanceOnce(port, { retryOnStale: true });
        await actions.refresh();
        setAdvanceNote(noteOf(result));
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
    openFeed: () => setFeedOpen(true),
    closeFeed: () => {
      setFeedOpen(false);
      setSeen(readSeenCursor(slug));
    },
    openLeaks: () => setLeaksOpen(true),
    closeLeaks: () => setLeaksOpen(false),
    rescanLeaks: () => void leaks.refetch(),
  };

  const data: GamePageData = {
    slug,
    busy,
    actionError,
    advanceSteps,
    ...(advanceNote === undefined ? {} : { advanceNote }),
    ...(graph.data === undefined ? {} : { graph: graph.data }),
    ...(graph.isError ? { graphError: describeApiError(graph.error) } : {}),
    leaks: leaks.data,
    leaksError: leaks.isError ? describeApiError(leaks.error) : undefined,
    leaksOpen,
    ...(cursor.data === undefined ? {} : { latestCursor: cursor.data }),
    unseen: unseenCount(cursor.data, seen),
    feedOpen,
  };

  return <GamePanels data={data} actions={handlers} />;
}

const STEP_LABEL = { npc: "NPC 回合", stage: "舞台回合", world: "world 回合" } as const;

/** 编排回到界面时的一句话：停在哪、为什么停。 */
function noteOf(result: Awaited<ReturnType<typeof advanceOnce>>): string {
  switch (result.kind) {
    case "no-order":
      return "没有进行中的顺位：先开一条再推。";
    case "idle":
      return `停住了：${result.reason}。活人都推完了就收工。`;
    case "player":
      return `轮到 ${result.actorName}，这是玩家席位：由玩家端自己动手，后台不替他决定。`;
    case "advanced":
      return `已推：${result.steps.map((step) => STEP_LABEL[step]).join(" → ")}。`;
  }
}
