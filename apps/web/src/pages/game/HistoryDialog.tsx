import { useGameMessages } from "../../features/games/useGameMessages";
import Dialog from "./Dialog";
import HistoryPanel from "./panels/HistoryPanel";

/**
 * 「记录」浮窗：打开才取数。
 *
 * 它显示的是公共事件流（上帝视角、带名字），所以页脚明确写出这一点——
 * 角色自己的感知在主页的「感知日志」里，两者不是一回事。
 */
export default function HistoryDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const history = useGameMessages(slug, true);

  return (
    <Dialog title="记录" onClose={onClose}>
      <HistoryPanel history={history} />
      <p className="muted">
        全上下文事件流（上帝视角）：这里能看到本角色并未亲历、也未被遮蔽名字的事件。
      </p>
    </Dialog>
  );
}
