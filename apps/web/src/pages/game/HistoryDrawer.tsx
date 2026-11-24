import type { ReactNode } from "react";
import Dialog from "./Dialog";
import HistoryPanel, { type HistoryState } from "./panels/HistoryPanel";

/**
 * 「记录」的壳：右侧板 + 事件流。纯 props，不取数——取数由 `HistoryDialog`（真）或 mock 的 fixture 提供。
 *
 * 用侧板而不是居中浮窗，是因为它记的是整局的公共事件流：条目只会越来越多，
 * 居中浮窗再长也长不过屏幕，而侧板的高度就是屏幕高度，读起来像一条时间线。
 */
export default function HistoryDrawer({
  history,
  note,
  onClose,
}: {
  history: HistoryState;
  note?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog title="记录" onClose={onClose} variant="drawer">
      <HistoryPanel history={history} />
      {note}
    </Dialog>
  );
}
