import { useState } from "react";
import { describeApiError } from "../../api/describeApiError";
import type { CreateGameHandler, EntryPageData } from "./types";

type Props = {
  data: EntryPageData;
  onCreate: CreateGameHandler;
};

/** 入口页：只吃数据与一个建局回调，不直接触网。 */
export default function EntryPage({ data, onCreate }: Props) {
  const [seed, setSeed] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const packs = data.packs ?? [];
  const selectedSeed = seed === "" ? (packs[0] ?? "") : seed;
  const canSubmit = selectedSeed !== "" && !pending && data.packsError === undefined;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await onCreate({ seed: selectedSeed, slug: slug.trim() });
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="launch">
      <div className="launch__inner">
        <header className="launch__header">
          <p className="launch__eyebrow">AI TRPG</p>
          <h1>入口</h1>
          <p className="launch__lead">开发期入口：身份固定为演示用户，选一个内容包开一局。</p>
        </header>

        <section className="panel">
          <dl className="facts">
            <div>
              <dt>身份</dt>
              <dd>
                {data.identity === undefined
                  ? "…"
                  : `${data.identity.username}（${data.identity.displayName}）`}
              </dd>
            </div>
            <div>
              <dt>内容包</dt>
              <dd>
                {data.packsError !== undefined
                  ? data.packsError
                  : data.packs === undefined
                    ? "读取中…"
                    : `${data.packs.length} 个`}
              </dd>
            </div>
          </dl>

          <form className="entry-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>内容包</span>
              <select
                value={selectedSeed}
                onChange={(event) => setSeed(event.target.value)}
                disabled={packs.length === 0}
              >
                {packs.map((pack) => (
                  <option key={pack} value={pack}>
                    {pack}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>slug（可选，留空自动生成）</span>
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="例如 crow-run-2"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            {error === undefined ? null : (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="button" disabled={!canSubmit}>
              {pending ? "建局中…" : "开始游戏"}
            </button>
          </form>
        </section>

        <footer className="launch__footer">
          下一阶段：局内页面（回合、动作、事件流）。现在建局成功只会跳到占位页。
        </footer>
      </div>
    </main>
  );
}
