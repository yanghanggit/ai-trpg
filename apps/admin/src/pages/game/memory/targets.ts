import type { GameGraph } from "../../../features/games/useGameGraph";

/**
 * 带记忆的实体：世界一个，舞台与角色各若干。
 *
 * 清单来自世界图谱那一份投影，不为这一页再开一个只列名字的端点——
 * 名字、key 与 id 本来就是图谱要读的东西，搜索判据也正好是它们。
 */
export type MemoryTargetKind = "actor" | "stage" | "world";

export type MemoryTarget = {
  kind: MemoryTargetKind;
  id: string;
  name: string;
  /** 内容层的稳定键：舞台与角色有，世界用内容版本。 */
  key: string;
};

export const KIND_LABEL: Record<MemoryTargetKind, string> = {
  world: "世界",
  stage: "舞台",
  actor: "角色",
};

export function memoryTargets(graph: GameGraph): MemoryTarget[] {
  return [
    { kind: "world", id: graph.world.id, name: graph.world.name, key: graph.world.contentKey },
    ...graph.stages.map((stage) => ({
      kind: "stage" as const,
      id: stage.id,
      name: stage.name,
      key: stage.key,
    })),
    ...graph.actors.map((actor) => ({
      kind: "actor" as const,
      id: actor.id,
      name: actor.name,
      key: actor.key,
    })),
  ];
}

/**
 * 输入框的匹配：先搜再定，`@` 只是「都列出来」的引子。
 *
 * 判据是名字 / key / id 的子串，不区分大小写；空输入就是全部，
 * 所以想通览时不打 `@` 也一样，打了只是不会被当成搜索词。
 */
export function matchTargets(targets: readonly MemoryTarget[], query: string): MemoryTarget[] {
  const needle = query.trim().replace(/^@+/, "").trim().toLowerCase();
  if (needle.length === 0) {
    return [...targets];
  }
  return targets.filter((target) =>
    [target.name, target.key, target.id].some((value) => value.toLowerCase().includes(needle)),
  );
}

/** URL 里带的是 kind + name：人看得懂，解析回来也够用。 */
export function findTarget(
  targets: readonly MemoryTarget[],
  kind: string | null,
  name: string | null,
): MemoryTarget | undefined {
  if (kind === null) {
    return undefined;
  }
  return targets.find(
    (target) => target.kind === kind && (kind === "world" || target.name === name),
  );
}
