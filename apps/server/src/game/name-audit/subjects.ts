import type { NameAuditActor, NameAuditSignatureName, NameLeakScope } from "./types";

/**
 * 主体分组：把「同一个真名的所有 actor」归成一组，并标出这个观察者还没用真名称呼过谁。
 *
 * 分组的理由是重名合法（两个卫兵都叫「卫兵」）：命中一个名字要能同时指向多个 actor，
 * 长度优先则保证 `Abrar` 比 `Abr` 先匹配，避免短名吃掉长名。
 */

export type SubjectGroup = {
  name: string;
  /** 观察者没有在记忆里使用该主体真名的主体；同名角色可能多个。 */
  unknown: NameAuditActor[];
};

export function subjectGroups(input: {
  actors: readonly NameAuditActor[];
  observerId: string;
  signatureNames: readonly NameAuditSignatureName[];
  nameScope: NameLeakScope;
  signatureActor: ReadonlyMap<string, string>;
  allowNames: ReadonlySet<string>;
}): SubjectGroup[] {
  const namedTrueName = (subject: NameAuditActor): boolean =>
    input.signatureNames.some(
      (row) =>
        input.signatureActor.get(row.signatureId) === subject.id &&
        (input.nameScope === "ever" || row.signatureId === subject.currentSignatureId) &&
        row.name === subject.name,
    );

  const byName = new Map<string, NameAuditActor[]>();
  for (const subject of input.actors) {
    if (subject.id === input.observerId) {
      continue;
    }
    if (subject.name.length === 0 || input.allowNames.has(subject.name)) {
      continue;
    }
    const list = byName.get(subject.name) ?? [];
    list.push(subject);
    byName.set(subject.name, list);
  }

  return [...byName.entries()]
    .map(([name, subjects]) => {
      const unknown = subjects.filter((subject) => !namedTrueName(subject));
      return {
        name,
        unknown,
      };
    })
    .sort((a, b) => b.name.length - a.name.length);
}
