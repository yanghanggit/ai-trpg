import type { GameGraph } from "../../../features/games/useGameGraph";
import type { QueueRow } from "./types";

type Props = {
  actor: GameGraph["actors"][number];
  entry?: QueueRow;
  onItemClick: (item: Record<string, unknown>) => void;
};

const SLOTS = ["weapon", "armor", "accessory"] as const;

/**
 * 第三层：一个 actor 身上所有的东西。
 *
 * 上帝视角，字段名照抄引擎（`maxHp`、`concealed`），不再翻译一套中文——后台的读者是运维，
 * 翻译只会让人对不上库里的行。
 */
export default function ActorInspector({ actor, entry, onItemClick }: Props) {
  const worn = new Set(SLOTS.map((slot) => actor.equipment[slot]).filter(Boolean));

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h3>{actor.name}</h3>
        <p className="muted">
          <code>#{actor.seq}</code> · <code>{actor.key}</code>
          {actor.concealed ? " · 隐匿" : ""}
          {actor.isDefaultPlayer ? " · 默认玩家" : ""}
        </p>
      </header>

      <div className="inspector__hp">
        <span>
          hp {actor.hp} / {actor.maxHp}
        </span>
        <span className="graph-node__bar" aria-hidden="true">
          <span
            className="graph-node__bar-fill"
            style={{
              width: `${actor.maxHp <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, actor.hp / actor.maxHp)) * 100)}%`,
            }}
          />
        </span>
      </div>

      <dl className="facts facts--tight">
        <div>
          <dt>顺位</dt>
          <dd>{entry === undefined ? "不在顺位上" : `${entry.position} 名`}</dd>
        </div>
        <div>
          <dt>已走回合</dt>
          <dd>{entry?.turnsTaken ?? 0}</dd>
        </div>
        <div>
          <dt>控制方</dt>
          <dd>{entry?.control ?? "—"}</dd>
        </div>
        <div>
          <dt>隐匿</dt>
          <dd>{actor.concealed ? "是" : "否"}</dd>
        </div>
      </dl>

      <h4>形态</h4>
      <p className="inspector__text">{actor.signature.form}</p>

      <h4>属性</h4>
      <dl className="facts facts--tight">
        {Object.entries(actor.stats)
          .filter((entry): entry is [string, number] => typeof entry[1] === "number")
          .map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <h4>外观</h4>
      <p className="inspector__text">{text(actor.appearance, "text") || "—"}</p>

      <h4>装备</h4>
      <ul className="inspector__list">
        {SLOTS.map((slot) => {
          const name = text(actor.equipment, slot);
          return (
            <li key={slot}>
              <span className="muted">{slot}</span>{" "}
              {name === "" ? (
                <span className="muted">空</span>
              ) : (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    const item = actor.items.find((candidate) => text(candidate, "name") === name);
                    if (item !== undefined) {
                      onItemClick(item);
                    }
                  }}
                >
                  {name}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h4>道具</h4>
      {actor.items.length === 0 ? (
        <p className="muted">身上没有东西。</p>
      ) : (
        <ul className="inspector__list">
          {actor.items.map((item) => {
            const name = text(item, "name") || "(无名)";
            return (
              <li key={text(item, "id") || text(item, "key") || name}>
                <button type="button" className="linkish" onClick={() => onItemClick(item)}>
                  {name}
                </button>
                <span className="muted">
                  {text(item, "kind")} · ×{number(item, "count") ?? 1}
                  {worn.has(name) ? " · 已穿戴" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {actor.statusEffects.length === 0 ? null : (
        <>
          <h4>状态效果</h4>
          <ul className="inspector__list">
            {actor.statusEffects.map((effect) => (
              <li key={text(effect, "key") || text(effect, "name")}>
                <strong>{text(effect, "name")}</strong>
                <span className="muted">{text(effect, "content")}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {actor.knowledgeAccess.length === 0 ? null : (
        <>
          <h4>知识标签</h4>
          <p className="inspector__chips">
            {actor.knowledgeAccess.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </p>
        </>
      )}

      {actor.actions.length === 0 ? null : (
        <>
          <h4>固有动作</h4>
          <p className="inspector__chips">
            {actor.actions.map((action) => (
              <span key={action} className="badge">
                {action}
              </span>
            ))}
          </p>
        </>
      )}
    </aside>
  );
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function number(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}
