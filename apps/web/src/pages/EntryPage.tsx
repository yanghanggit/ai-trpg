import { useState } from "react";
import { useNavigate } from "react-router";
import { describeApiError } from "../api/describeApiError";
import ServerConnectionCard from "../features/connection/ServerConnectionCard";
import { readGameFacts } from "../features/games/gameState";
import { useContentPacks } from "../features/games/useContentPacks";
import { useCreateGame } from "../features/games/useCreateGame";
import { useMe } from "../features/identity/useMe";

export default function EntryPage() {
  const navigate = useNavigate();
  const me = useMe();
  const packs = useContentPacks();
  const createGame = useCreateGame();

  const [seed, setSeed] = useState("");
  const [slug, setSlug] = useState("");

  const packList = packs.data ?? [];
  const selectedSeed = seed === "" ? (packList[0] ?? "") : seed;
  const canSubmit = selectedSeed !== "" && !createGame.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    createGame.mutate(
      { seed: selectedSeed, slug: slug.trim() },
      {
        onSuccess: (state) => {
          const created = readGameFacts(state).slug;
          if (created === undefined) {
            return;
          }
          navigate(`/g/${encodeURIComponent(created)}`);
        },
      },
    );
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
                {me.data === undefined ? "…" : `${me.data.username}（${me.data.displayName}）`}
              </dd>
            </div>
            <div>
              <dt>内容包</dt>
              <dd>
                {packs.isPending
                  ? "读取中…"
                  : packs.isError
                    ? describeApiError(packs.error)
                    : `${packList.length} 个`}
              </dd>
            </div>
          </dl>

          <form className="entry-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>内容包</span>
              <select
                value={selectedSeed}
                onChange={(event) => setSeed(event.target.value)}
                disabled={packList.length === 0}
              >
                {packList.map((pack) => (
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

            {createGame.isError ? (
              <p className="form-error" role="alert">
                {describeApiError(createGame.error)}
              </p>
            ) : null}

            <button type="submit" className="button" disabled={!canSubmit}>
              {createGame.isPending ? "建局中…" : "开始游戏"}
            </button>
          </form>
        </section>

        <details className="details">
          <summary>连接详情</summary>
          <ServerConnectionCard />
        </details>

        <footer className="launch__footer">
          下一阶段：局内页面（回合、动作、事件流）。现在建局成功只会跳到占位页。
        </footer>
      </div>
    </main>
  );
}
