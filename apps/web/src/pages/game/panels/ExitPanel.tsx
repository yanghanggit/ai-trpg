type Exit = { name: string; ref: string | null; sealed: boolean };

/**
 * 「出口」浮窗：通向哪里、过不过得去。
 *
 * 现在只给事实；移动接上之后，确认与代价写在这里，而不是把卡片本身做成按钮链。
 */
export default function ExitPanel({ exit }: { exit: Exit }) {
  return (
    <dl className="rows">
      <div>
        <dt>通向</dt>
        <dd>{exit.name}</dd>
      </div>
      <div>
        <dt>编号</dt>
        <dd>{exit.ref === null ? "—" : <code>{exit.ref}</code>}</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{exit.sealed ? "封着——认得出，但过不去。" : "通着。"}</dd>
      </div>
    </dl>
  );
}
