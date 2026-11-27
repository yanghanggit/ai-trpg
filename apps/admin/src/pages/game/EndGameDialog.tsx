import { useState } from "react";
import Dialog from "../../components/Dialog";
import Hint from "../../components/Hint";
import type { GamePageActions } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  actions: GamePageActions;
};

/**
 * 强制结束本局：给这一局落一个结局标签，故事就此收尾。
 *
 * 叫「强制」是因为它绕开剧情自己往下走的办法：落下去之后，服务端会拒掉之后所有回合。
 * 它跟「删除」不是一回事：数据全留着，只是不再往下推，所以留在控制台（剧情层）；
 * 删除是库存操作，在局列表那一页——那里才答得准要删哪一局。
 */
export default function EndGameDialog({ open, onClose, actions }: Props) {
  const [outcome, setOutcome] = useState("");
  const [message, setMessage] = useState("");

  const canEnd = outcome.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <>
          强制结束本局
          <Hint text="强制：不等剧情自己走到结局，直接给这一局落结局标签。落下去之后新的回合会被服务端拒掉（游戏已结束），数据一条不删；想接着跑只能另建一局，所以它只做一次。" />
        </>
      }
    >
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
          强制结束
        </button>
      </form>
    </Dialog>
  );
}
