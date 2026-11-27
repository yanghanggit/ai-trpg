import { useState } from "react";
import { useSearchParams } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGameActions } from "../../features/games/useGameActions";
import { useMemory } from "../../features/games/useGameData";
import { useGameGraph } from "../../features/games/useGameGraph";
import GameMemoryPage from "./GameMemoryPage";
import { findTarget, type MemoryTarget, memoryTargets } from "./memory/targets";
import type { GameMemoryData, GameProbeAnswer } from "./types";

/**
 * 记忆页的容器：把「选了谁」放进地址栏，其余交给三个请求。
 *
 * 选中的实体是 `?owner=&name=`，所以读某一份记忆可以直接给链接；
 * 世界不需要名字——一局只有一个。
 */
export default function GameMemoryContainer({ slug }: { slug: string }) {
  const [params, setParams] = useSearchParams();
  const graph = useGameGraph(slug);
  const actions = useGameActions(slug);

  const targets = graph.data === undefined ? [] : memoryTargets(graph.data);
  const target = findTarget(targets, params.get("owner"), params.get("name"));

  const memory = useMemory(
    slug,
    target === undefined
      ? undefined
      : target.kind === "world"
        ? { owner: "world" }
        : { owner: target.kind, name: target.name },
  );

  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [probe, setProbe] = useState<{ answer: GameProbeAnswer; question: string }>();

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

  const data: GameMemoryData = {
    slug,
    targets,
    ...(target === undefined ? {} : { target }),
    ...(memory.data === undefined ? {} : { memory: memory.data }),
    ...(memory.isError ? { memoryError: describeApiError(memory.error) } : {}),
    ...(graph.isError ? { targetsError: describeApiError(graph.error) } : {}),
    ...(busy === undefined ? {} : { busy }),
    ...(actionError === undefined ? {} : { actionError }),
    ...(probe === undefined ? {} : { probe }),
  };

  return (
    <GameMemoryPage
      data={data}
      onSelect={(next: MemoryTarget | undefined) =>
        setParams(
          next === undefined
            ? {}
            : next.kind === "world"
              ? { owner: next.kind }
              : { owner: next.kind, name: next.name },
        )
      }
      onCompact={(choice) => {
        if (choice === "all") {
          void run("压缩全部", async () => {
            await actions.compact({ owner: "all" });
          });
          return;
        }
        if (target === undefined) {
          return;
        }
        void run("压缩记忆", async () => {
          await actions.compact(
            target.kind === "world"
              ? { owner: "world" }
              : { owner: target.kind, name: target.name },
          );
          await memory.refetch();
        });
      }}
      onAsk={(question) => {
        const askTarget = target === undefined || target.kind === "world" ? undefined : target;
        if (askTarget === undefined) {
          return;
        }
        void run("探针", async () => {
          const answer = await actions.probe({
            message: question,
            ...(askTarget.kind === "actor" ? { actor: askTarget.name } : { stage: askTarget.name }),
          });
          setProbe({ answer, question });
        });
      }}
      onRefresh={() => {
        void run("刷新", async () => {
          await memory.refetch();
          await graph.refetch();
        });
      }}
    />
  );
}
