import { useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { type AdvanceInput, useGameActions } from "../../features/games/useGameActions";
import {
  useGameJob,
  useGameJobs,
  useGameMessages,
  useMemory,
  useNameLeaks,
} from "../../features/games/useGameData";
import { useTraceTurns, useTurnEvents } from "../../features/traces/useTraces";
import GamePanels from "./GamePanels";
import type { GamePageActions, GamePageData, MemoryQuery } from "./types";

/**
 * 局控制台。
 *
 * 两件事只在这里做：发控制面请求、读回来。展示层拿到的都是已经收窄好的数据与回调，
 * 它不判断作业算不算成功，也不自己重读——那两条口径只由容器执行一次。
 */
export default function GameConsole({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const actions = useGameActions(slug);

  const messages = useGameMessages(slug);
  const jobs = useGameJobs(slug);
  const turns = useTraceTurns({ game: slug, limit: 50 });

  const [watchedJobId, setWatchedJobId] = useState<string>();
  const watchedJob = useGameJob(slug, watchedJobId);

  const [selectedTurnId, setSelectedTurnId] = useState<string>();
  const turnEvents = useTurnEvents(selectedTurnId);

  const [memoryQuery, setMemoryQuery] = useState<MemoryQuery>();
  const memory = useMemory(slug, memoryQuery);

  const [leaksEnabled, setLeaksEnabled] = useState(false);
  const leaks = useNameLeaks(slug, leaksEnabled);

  const [probeResult, setProbeResult] = useState<unknown>();
  const [auxResult, setAuxResult] = useState<{ title: string; payload: unknown }>();
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
    cancelJob: async (jobId) => {
      await run("取消作业", async () => {
        const job = await actions.cancelJob(jobId);
        setWatchedJobId(job.jobId);
      });
    },
    advance: async (input: AdvanceInput) => {
      await run("入队回合", async () => {
        const job = await actions.advance(input);
        setWatchedJobId(job.jobId);
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
    compact: async (input) => {
      await run("压缩记忆", async () => {
        setAuxResult({ title: "压缩", payload: await actions.compact(input) });
      });
    },
    probe: async (input) => {
      await run("探针", async () => {
        setProbeResult(await actions.probe(input));
      });
    },
    snapshot: async () => {
      await run("快照", async () => {
        setAuxResult({ title: "快照", payload: await actions.snapshot() });
      });
    },
    story: async () => {
      await run("故事总结", async () => {
        setAuxResult({ title: "故事总结", payload: await actions.story() });
      });
    },
    loadMemory: (query) => setMemoryQuery(query),
    loadLeaks: () => setLeaksEnabled(true),
    selectTurn: (turnId) => setSelectedTurnId(turnId),
  };

  const data: GamePageData = {
    slug,
    busy,
    actionError,
    messages: messages.data,
    messagesError: messages.isError ? describeApiError(messages.error) : undefined,
    jobs: jobs.data,
    jobsError: jobs.isError ? describeApiError(jobs.error) : undefined,
    watchedJob: watchedJob.data,
    turns: turns.data,
    turnsError: turns.isError ? describeApiError(turns.error) : undefined,
    selectedTurnId,
    turnEvents: turnEvents.data,
    memory:
      memoryQuery === undefined || memory.data === undefined
        ? undefined
        : { query: memoryQuery, payload: memory.data },
    memoryError: memory.isError ? describeApiError(memory.error) : undefined,
    leaks: leaks.data,
    leaksError: leaks.isError ? describeApiError(leaks.error) : undefined,
    probeResult,
    auxResult,
  };

  return <GamePanels data={data} actions={handlers} />;
}
