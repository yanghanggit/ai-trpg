import { useGameMessages } from "../../features/games/useGameMessages";
import HistoryDrawer from "./HistoryDrawer";

/**
 * 「记录」：打开才取数的右侧板。
 *
 * 它显示的是公共事件流（上帝视角、带名字），所以页脚明确写出这一点——
 * 角色自己的感知在主页的「感知日志」里，两者不是一回事。
 */
export default function HistoryDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const history = useGameMessages(slug, true);

  return (
    <HistoryDrawer
      history={history}
      onClose={onClose}
      note={
        <p className="muted">
          全上下文事件流（上帝视角）：这里能看到本角色并未亲历、也未被遮蔽名字的事件。
        </p>
      }
    />
  );
}
