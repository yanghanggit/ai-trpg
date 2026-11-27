import Dialog from "../../../components/Dialog";

/** 道具行是原样透传的：这里按已知字段读，读不到就不显示，不做类型收窄。 */
type ItemRow = Record<string, unknown>;

type Props = {
  item?: ItemRow;
  onClose: () => void;
};

const AFFIX_TRIGGERS = ["strike", "cleave", "use", "fit"] as const;
const TRIGGER_LABELS: Record<string, string> = {
  strike: "命中",
  cleave: "横扫",
  use: "使用",
  fit: "穿戴",
};

/**
 * 道具弹窗：叠在图谱之上，Esc 只关这一层。
 *
 * 正文放能直接读的字段，底部可展开原始 JSON——两边都要，是因为排查时既想看懂、也想对照。
 */
export default function ItemDialog({ item, onClose }: Props) {
  return (
    <Dialog open={item !== undefined} onClose={onClose} title={str(item, "name") || "道具"}>
      {item === undefined ? null : (
        <>
          <p className="muted">{str(item, "description")}</p>

          <dl className="facts">
            <div>
              <dt>kind</dt>
              <dd>{str(item, "kind") || "—"}</dd>
            </div>
            <div>
              <dt>数量</dt>
              <dd>{num(item, "count") ?? 1}</dd>
            </div>
            <div>
              <dt>key</dt>
              <dd>
                <code>{str(item, "key") || "—"}</code>
              </dd>
            </div>
            {str(item, "kind") === "weapon" ? (
              <div>
                <dt>maxTargets</dt>
                <dd>{num(item, "maxTargets") ?? "—"}</dd>
              </div>
            ) : null}
          </dl>

          {statsOf(item).length === 0 ? null : (
            <>
              <h3>属性</h3>
              <dl className="facts">
                {statsOf(item).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {affixesOf(item).length === 0 ? null : (
            <>
              <h3>词缀</h3>
              <ul className="item-affixes">
                {affixesOf(item).map((affix) => (
                  <li key={`${affix.trigger}:${affix.name}`}>
                    <span className="badge">{TRIGGER_LABELS[affix.trigger] ?? affix.trigger}</span>
                    <strong>{affix.name}</strong>
                    <p className="muted">{affix.content}</p>
                  </li>
                ))}
              </ul>
            </>
          )}

          <details className="raw">
            <summary>原始数据</summary>
            <pre className="json">{JSON.stringify(item, null, 2)}</pre>
          </details>
        </>
      )}
    </Dialog>
  );
}

function str(row: ItemRow | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

function num(row: ItemRow, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

function statsOf(item: ItemRow): [string, number][] {
  const stats = item.stats;
  if (typeof stats !== "object" || stats === null) {
    return [];
  }
  return Object.entries(stats).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0,
  );
}

function affixesOf(item: ItemRow): { trigger: string; name: string; content: string }[] {
  const triggers = item.affixes;
  if (typeof triggers !== "object" || triggers === null) {
    return [];
  }
  const found: { trigger: string; name: string; content: string }[] = [];
  for (const trigger of AFFIX_TRIGGERS) {
    const list = (triggers as Record<string, unknown>)[trigger];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const affix of list) {
      if (typeof affix !== "object" || affix === null) {
        continue;
      }
      const row = affix as ItemRow;
      found.push({
        trigger,
        name: str(row, "name"),
        content: str(row, "content"),
      });
    }
  }
  return found;
}
