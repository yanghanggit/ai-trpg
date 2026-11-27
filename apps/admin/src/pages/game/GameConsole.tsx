import {
  type AdvancePort,
  advanceOnce,
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
  labelOf,
} from "../../features/games/advance";
import { type AdvanceInput, useGameActions } from "../../features/games/useGameActions";
import { useNameLeaks } from "../../features/games/useGameData";
import { useGameGraph } from "../../features/games/useGameGraph";
import GamePanels from "./GamePanels";
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

  /** 下一位现在站在哪个舞台：舞台回合的目标由顺位与当前站位一起决定。 */
  function stageNameOfNext(): string | undefined {
    const next = graph.data?.order?.nextActor;
    if (next === null || next === undefined) {
      return undefined;
    }
    const actor = graph.data?.actors.find((item) => item.id === next.actorId);
    const stage = graph.data?.stages.find((item) => item.id === actor?.stageId);
    return stage?.name;
  }

  /** 编排端口：规则来自契约包，runTurn 换成带日志的那一版。 */
  const port: AdvancePort = createAdvancePort(slug, runStep);

  const handlers: GamePageActions = {
    refresh: async () => {
      await run("刷新", async () => {
        await actions.refresh();
      });
    },
    advance: async (input: AdvanceInput) => {
      await run("指定推进", async () => {
        await actions.advance(input);
        setAdvanceNote("已按指定的层推进一步。");
      });
    },
    advanceChain: async () => {
      await run("推进一步", async () => {
        setAdvanceSteps([]);
        setAdvanceNote(undefined);
        const result = await advanceOnce(port, { retryOnStale: true });
        await actions.refresh();
        setAdvanceNote(noteOf(result));
      });
    },
    advanceOne: async (kind) => {
      await run("推进一步", async () => {
        setAdvanceNote(undefined);
        const order = graph.data?.order ?? null;
        const next = order?.nextActor;
        if (kind === "npc") {
          if (next === null || next === undefined) {
            setAdvanceNote("顺位上没有下一位，推不了 NPC 回合。");
            return;
          }
          await runStep({
            kind: "npc",
            actor: next.actorName,
            ...(order === null ? {} : { expectedVersion: order.gameVersion }),
          });
          await actions.refresh();
          setAdvanceNote(`已推 ${next.actorName} 的回合。`);
          return;
        }
        if (kind === "stage") {
          const stage = stageNameOfNext();
          if (stage === undefined) {
            setAdvanceNote("认不出下一位所在的舞台，用「指定推进」写舞台名。");
            return;
          }
          await runStep({ kind: "stage", stage });
          await actions.refresh();
          setAdvanceNote(`已推 ${stage} 的舞台回合。`);
          return;
        }
        await runStep({ kind: "world" });
        await actions.refresh();
        setAdvanceNote("已推 world 回合。");
      });
    },
    openOrder: async () => {
      await run("开一条顺位", async () => {
        await actions.openOrder();
        setAdvanceNote("顺位已开：名次按敏捷现值排定。");
      });
    },
    completeOrder: async () => {
      await run("收工", async () => {
        const order = graph.data?.order;
        if (order === null || order === undefined) {
          return;
        }
        await actions.completeOrder(order.id);
        setAdvanceNote("这条顺位已收工。");
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
    advanceSteps,
    ...(advanceNote === undefined ? {} : { advanceNote }),
    ...(graph.data === undefined ? {} : { graph: graph.data }),
    ...(graph.isError ? { graphError: describeApiError(graph.error) } : {}),
    leaks: leaks.data,
    leaksError: leaks.isError ? describeApiError(leaks.error) : undefined,
    leaksOpen,
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
