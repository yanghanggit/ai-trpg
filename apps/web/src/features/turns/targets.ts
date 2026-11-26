/** 契约里的名字表：玩家认得的名字与它对应的编号。 */
export type KnownName = { name: string; token: string };

/**
 * 目标引用只收两种：签名编号（`#n`）或真名。
 *
 * 旁人称呼不是引用——那是扮演信息，属于「认不认识」这一层记忆机制，不是调度命令的寻址。
 * 所以这里只做一件事：把玩家认得的名字换成它背后的签名编号；换不出来就不给提交，
 * 而不是把昵称发上去让服务端猜。
 */
export function strictTargetRef(
  actor: { token: string },
  names: readonly KnownName[],
): string | undefined {
  if (actor.token.startsWith("#")) {
    return actor.token;
  }
  const known = names.find((entry) => entry.name === actor.token);
  return known === undefined ? undefined : known.token;
}
