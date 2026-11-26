import { useState } from "react";
import type { TurnRequest } from "../../../features/turns/api";

/** 这一版给玩家的四种动作；其余种类按同一套形状陆续补齐。 */
type Draft =
  | { kind: "say"; target: string; message: string }
  | { kind: "inspect"; target: string }
  | { kind: "move"; to: string }
  | { kind: "wait" };

const DRAFT_KINDS: { kind: Draft["kind"]; label: string }[] = [
  { kind: "say", label: "说" },
  { kind: "inspect", label: "看" },
  { kind: "move", label: "走" },
  { kind: "wait", label: "等" },
];

export type ActionTarget = { actorId: string; name: string; ref: string | undefined };

function requestOf(draft: Draft, actor: string): TurnRequest | null {
  switch (draft.kind) {
    case "say": {
      const message = draft.message.trim();
      return message.length === 0 || draft.target.length === 0
        ? null
        : { kind: "player", actor, action: { kind: "say", target: draft.target, message } };
    }
    case "inspect":
      return draft.target.length === 0
        ? null
        : { kind: "player", actor, action: { kind: "inspect", target: draft.target } };
    case "move":
      return draft.to.length === 0
        ? null
        : { kind: "player", actor, action: { kind: "move", to: draft.to } };
    case "wait":
      return { kind: "player", actor, action: { kind: "wait" } };
  }
}

/**
 * 一个动作的表单：选做什么、对谁、说什么，然后提交。
 *
 * 只组装一个动作——一个回合一个动作是引擎的形状，界面不该暗示可以攒着做。
 * 目标是从外层传进来的「已换成引用」的名单：换不出引用的那一项在这里不可选。
 */
export default function ActionForm({
  actor,
  targets,
  exits,
  disabled,
  onSubmit,
}: {
  /** 提交时的 actor 引用：真名，与 CLI 同一个入口。 */
  actor: string;
  targets: readonly ActionTarget[];
  exits: readonly { stageId: string; name: string; ref: string }[];
  disabled: boolean;
  onSubmit: (request: TurnRequest) => void;
}) {
  const [kind, setKind] = useState<Draft["kind"]>("say");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [to, setTo] = useState(exits[0]?.ref ?? "");

  const draft: Draft =
    kind === "say"
      ? { kind: "say", target, message }
      : kind === "inspect"
        ? { kind: "inspect", target }
        : kind === "move"
          ? { kind: "move", to }
          : { kind: "wait" };
  const request = requestOf(draft, actor);

  return (
    <>
      <div className="field">
        <span>做什么</span>
        <div className="game__actions">
          {DRAFT_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              className="action"
              aria-pressed={kind === item.kind}
              onClick={() => setKind(item.kind)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {kind === "say" || kind === "inspect" ? (
        <label className="field">
          对谁
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">（选一个在场的人）</option>
            {targets.map((item) => (
              <option key={item.actorId} value={item.ref ?? ""} disabled={item.ref === undefined}>
                {item.name}
                {item.ref === undefined ? "（只有称呼，不能指定）" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {kind === "say" ? (
        <label className="field">
          说什么
          <input value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
      ) : null}

      {kind === "move" ? (
        <label className="field">
          去哪
          <select value={to} onChange={(event) => setTo(event.target.value)}>
            {exits.map((exit) => (
              <option key={exit.stageId} value={exit.ref}>
                {exit.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button
        type="button"
        className="button"
        disabled={request === null || disabled}
        onClick={() => {
          if (request !== null) {
            onSubmit(request);
          }
        }}
      >
        {disabled ? "这一回合在跑…" : "提交这一回合"}
      </button>
    </>
  );
}
