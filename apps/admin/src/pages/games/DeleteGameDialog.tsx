import { useState } from "react";
import { describeApiError } from "../../api/describeApiError";
import Dialog from "../../components/Dialog";
import Hint from "../../components/Hint";
import type { GameSummary } from "../../features/games/useGames";

type Props = {
  game: GameSummary;
  onClose: () => void;
  /** 删成功之后重读列表；失败由本弹窗自己说原因。 */
  onDelete: (slug: string) => Promise<void>;
};

/**
 * 删除一局：整张表里唯一一个会毁掉东西的动作，所以它问的是「哪一局」。
 *
 * 放在局列表而不是控制台，是因为删除不是「对这一局做什么」，而是「这一局不该存在了」——
 * 后者只有在能看见全部局的那一页才答得准。确认手势也就有了内容：在多行里把它指出来。
 */
export default function DeleteGameDialog({ game, onClose, onDelete }: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const canDelete = confirmation.trim() === game.slug && !busy;

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          删除一局
          <Hint text="级联清场、不可恢复：舞台、角色、事件流、记忆、顺位与回合账都随这一行一起删。logs/ 下的快照、故事、系统提示词与轨迹不删，但删完之后界面上再没有入口，要一起清得手动删目录。" />
        </>
      }
    >
      <p>
        要删的是 <strong>{game.name}</strong>（<code>{game.slug}</code>，局主{" "}
        <code>{game.ownerUsername}</code>，第 {game.clock} 刻）。
      </p>
      <p className="muted">级联清场，不可恢复。输入 slug 确认。</p>

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canDelete) {
            return;
          }
          setBusy(true);
          setError(undefined);
          void (async () => {
            try {
              await onDelete(game.slug);
              onClose();
            } catch (caught) {
              setError(describeApiError(caught));
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label className="field">
          <span>确认 slug</span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={game.slug}
            autoComplete="off"
          />
        </label>
        <button className="button button--danger" type="submit" disabled={!canDelete}>
          {busy ? "删除中…" : "删除"}
        </button>
      </form>

      {error === undefined ? null : <p className="form-error">{error}</p>}
    </Dialog>
  );
}
