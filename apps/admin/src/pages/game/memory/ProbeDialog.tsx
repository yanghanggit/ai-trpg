import { useState } from "react";
import Dialog from "../../../components/Dialog";
import Hint from "../../../components/Hint";
import { formatNumber } from "../../../lib/format";
import type { GameProbeAnswer } from "../types";
import { KIND_LABEL, type MemoryTarget } from "./targets";

type Props = {
  open: boolean;
  /** 问的是页面上选中的那一份；world 没有探针入口。 */
  target?: MemoryTarget;
  probe?: { answer: GameProbeAnswer; question: string };
  error?: string;
  busy?: boolean;
  onAsk: (question: string) => void;
  onClose: () => void;
};

/**
 * 探针：拿选中的那份记忆回一句话——那句话可以是问题，也可以是一句判断。
 *
 * 它不写记忆、不产生事件，所以放弹窗里连问几次都不留痕；
 * 答复留在弹窗里，问与答对得上，关掉就回记忆本身。
 */
export default function ProbeDialog({ open, target, probe, error, busy, onAsk, onClose }: Props) {
  const [question, setQuestion] = useState("");
  const askable = target !== undefined && target.kind !== "world";
  const canAsk = askable && !busy && question.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="dialog--probe"
      title={
        <>
          探针
          <Hint text="对选中那份记忆说一句话：它只能说出自己被写进去的东西，所以答不上来也是结论。不写记忆、不产生事件、不改状态。要选一个舞台或角色才发得出去，world 没有探针入口。" />
        </>
      }
    >
      {askable ? (
        <p className="muted">
          {KIND_LABEL[target.kind]} · {target.name}
        </p>
      ) : null}

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAsk) {
            onAsk(question.trim());
          }
        }}
      >
        <label className="field">
          <span>一句话</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={
              askable ? "对它说一句：可以是问题，也可以是一句判断" : "先选一个舞台或角色"
            }
            disabled={!askable || busy === true}
            autoComplete="off"
          />
        </label>
        <button className="button button--ghost" type="submit" disabled={!canAsk}>
          {busy === true ? "发送中…" : "发送"}
        </button>
      </form>

      {error === undefined ? null : <p className="form-error">{error}</p>}

      {probe === undefined ? null : (
        <>
          <dl className="facts facts--tight">
            <div>
              <dt>目标</dt>
              <dd>
                {KIND_LABEL[probe.answer.targetType === "stage" ? "stage" : "actor"]} ·{" "}
                {probe.answer.targetName}
              </dd>
            </div>
            <div>
              <dt>结束原因</dt>
              <dd>
                <code>{probe.answer.finishReason ?? "—"}</code>
              </dd>
            </div>
            <div>
              <dt>答复字数</dt>
              <dd>{formatNumber(probe.answer.answer.length)}</dd>
            </div>
          </dl>
          <p className="muted memory__question">{probe.question}</p>
          <pre className="json json--tall">{probe.answer.answer}</pre>
        </>
      )}
    </Dialog>
  );
}
