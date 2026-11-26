import { useEffect, useRef, useState } from "react";
import Hint from "../../components/Hint";
import type { GamePageActions } from "./types";

type Props = {
  slug: string;
  open: boolean;
  onClose: () => void;
  actions: GamePageActions;
};

/**
 * 危险操作弹窗：结束一局与删除一局。
 *
 * 这两件事在一局的生命里只做一次，留在主页面等于每屏都在提醒「可以毁掉它」。
 * 弹窗本身就是那一次确认：按下去就执行，失败原因回主页面显示。
 */
export default function DangerDialog({ slug, open, onClose, actions }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [outcome, setOutcome] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const canEnd = outcome.trim().length > 0;
  const canDelete = confirmation.trim() === slug;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 点遮罩关闭是鼠标的便利；键盘走 ESC（原生 cancel）。
    <dialog
      ref={ref}
      className="dialog"
      aria-label="危险操作"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // 点遮罩（事件落在 dialog 自身）关掉；点面板里的任何东西不关。
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <h2>
        危险操作
        <Hint text="结束一局留结局标签，删除一局级联清场且不可恢复——都只做一次，所以不摆在主页面上。" />
      </h2>

      <h3>结束一局</h3>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canEnd) {
            return;
          }
          void actions.endGame({
            outcome: outcome.trim(),
            ...(message.trim() === "" ? {} : { message: message.trim() }),
          });
          setOutcome("");
          setMessage("");
          onClose();
        }}
      >
        <label className="field">
          <span>结局标签</span>
          <input
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>正文（可选）</span>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="button button--danger" type="submit" disabled={!canEnd}>
          结束
        </button>
      </form>

      <h3>删除一局</h3>
      <p className="muted">级联清场，不可恢复。输入 slug 确认。</p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canDelete) {
            return;
          }
          void actions.deleteGame();
          setConfirmation("");
          onClose();
        }}
      >
        <label className="field">
          <span>确认 slug</span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={slug}
            autoComplete="off"
          />
        </label>
        <button className="button button--danger" type="submit" disabled={!canDelete}>
          删除
        </button>
      </form>

      <div className="dialog__foot">
        <button type="button" className="button button--ghost" onClick={onClose}>
          关闭
        </button>
      </div>
    </dialog>
  );
}
