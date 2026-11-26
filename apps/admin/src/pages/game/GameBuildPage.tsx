import { Link } from "react-router";
import Hint from "../../components/Hint";
import { formatNumber } from "../../lib/format";
import type { GameBuildData } from "./types";

type Props = {
  data: GameBuildData;
  onOpenConsole: () => void;
  onBack: () => void;
};

/**
 * 建局数据：这一局从内容模板一次性写下的那些行，原样展开。
 *
 * 只放建局数据，不放运行时状态：前者建完就不变、大小有底，后者每天在长。
 */
export default function GameBuildPage({ data, onOpenConsole, onBack }: Props) {
  const build = data.build;

  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <Link to="/" onClick={onBack}>
              总览
            </Link>{" "}
            /{" "}
            <Link to="/games" onClick={onBack}>
              局
            </Link>{" "}
          </p>
          <h1>
            <code>{data.slug}</code>
            <span className="page-kind">建局数据</span>
          </h1>
        </div>
        <div className="admin__actions">
          <button type="button" className="button button--ghost" onClick={onOpenConsole}>
            局控制台
          </button>
        </div>
      </header>

      <section className="panel">
        <h2>
          建局数据
          <Hint text="建局时一次性写下的行：world、stage、通路、actor 与形态、道具、玩家归属。原始列原样展开；运行时状态（clock、version、消息、记忆、作业）不在这里。" />
        </h2>

        {build === undefined ? (
          <p className="muted">{data.buildError ?? "读取中…"}</p>
        ) : (
          <>
            <p className="muted">
              {build.world === null
                ? "没有 world 行（这局建到一半）"
                : String(build.world.name ?? "world")}{" "}
              · stage {formatNumber(build.stages.length)} · 通路{" "}
              {formatNumber(build.stageConnections.length)} · actor{" "}
              {formatNumber(build.actors.length)} · 形态{" "}
              {formatNumber(build.actorSignatures.length)} · 道具{" "}
              {formatNumber(build.items.length + build.stageItems.length)}
            </p>
            <pre className="json json--tall">{JSON.stringify(build, null, 2)}</pre>
          </>
        )}
      </section>
    </main>
  );
}
