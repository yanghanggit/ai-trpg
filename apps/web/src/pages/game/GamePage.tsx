import { Link } from "react-router";
import type { GameView } from "../../features/games/useGameView";

/**
 * 局内页：只吃观看者投影，不发请求。
 *
 * 数据是角色视角——名字、在场名单、出口都按观察者渲染过，页面不做遮蔽判断。
 */
export default function GamePage({ view }: { view: GameView }) {
  const { game, viewer, stage, log, visitedStages, teleportTargets } = view;

  return (
    <main className="launch">
      <div className="launch__inner">
        <header className="launch__header">
          <p className="launch__eyebrow">
            <Link to="/">← 入口</Link>
          </p>
          <h1>{game.name}</h1>
          <p className="launch__lead">
            <code>{game.slug}</code> · {game.status} · v{game.version}
          </p>
        </header>

        <section className="panel">
          <h2>我</h2>
          <dl className="facts">
            <div>
              <dt>名字</dt>
              <dd>
                {viewer.name}
                {viewer.concealed ? <span className="chip">隐匿中</span> : null}
              </dd>
            </div>
            <div>
              <dt>此刻的样子</dt>
              <dd>{viewer.appearance}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>{stage.name}</h2>
          <p className="muted">{stage.environment}</p>

          {stage.anchors.length > 0 ? (
            <ul className="entries">
              {stage.anchors.map((anchor) => (
                <li key={anchor.key}>
                  <strong>{anchor.label}</strong>
                  {anchor.description === undefined ? null : (
                    <span className="entries__note">{anchor.description}</span>
                  )}
                  {anchor.items.length > 0 ? (
                    <span className="entries__note">
                      {anchor.items.map((item) => item.name).join("、")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">这里没有可作用的地方。</p>
          )}

          <h3>在场</h3>
          {stage.actors.length > 0 ? (
            <ul className="chips">
              {stage.actors.map((actor) => (
                <li key={actor.actorId} className={actor.alive ? "chip" : "chip chip--faded"}>
                  {actor.label}
                  {actor.self ? "（我）" : ""}
                  {actor.alive ? "" : "（已死）"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">只有我一个人。</p>
          )}

          <h3>出口</h3>
          {stage.exits.length > 0 ? (
            <ul className="chips">
              {stage.exits.map((exit) => (
                <li key={exit.stageId} className="chip">
                  {exit.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">没有出口。</p>
          )}
          {stage.sealedExits.length > 0 ? (
            <p className="muted">
              封着：
              {stage.sealedExits.map((exit) => exit.name).join("、")}
            </p>
          ) : null}
        </section>

        <section className="panel">
          <h2>感知日志</h2>
          {log.length > 0 ? (
            <ol className="entries">
              {log.map((entry) => (
                <li key={`${entry.sequence}-${entry.kind}`}>
                  <span className="entries__kind">{entry.kind}</span>
                  {entry.content}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">还没有感知到任何事。</p>
          )}
        </section>

        <section className="panel">
          <h2>地图</h2>
          <h3>去过</h3>
          <ul className="chips">
            {visitedStages.map((candidate) => (
              <li key={candidate.stageId} className="chip">
                {candidate.name}
              </li>
            ))}
          </ul>
          <h3>可传送</h3>
          {teleportTargets.length > 0 ? (
            <ul className="chips">
              {teleportTargets.map((target) => (
                <li key={target.stageId} className="chip">
                  {target.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">没有可传送的舞台。</p>
          )}
        </section>

        <footer className="launch__footer">占位页：回合与动作尚未接入。</footer>
      </div>
    </main>
  );
}
