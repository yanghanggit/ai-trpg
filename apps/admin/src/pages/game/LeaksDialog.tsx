import Dialog from "../../components/Dialog";
import Hint from "../../components/Hint";

type Props = {
  open: boolean;
  result: unknown;
  error?: string;
  scanning: boolean;
  onRescan: () => void;
  onClose: () => void;
};

/**
 * 真名泄漏扫描的结果弹窗。
 *
 * 扫描是只读旁路、跑一次回一份报告：这种「点一下、看一眼」的事不值得占主页面一屏，
 * 所以按钮在顶部，报告进弹窗。
 */
export default function LeaksDialog({ open, result, error, scanning, onRescan, onClose }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <>
          真名泄漏扫描
          <Hint text="只读扫描：actor 记忆里有没有出现本不该知道的真名。跑它不改状态、不写事件。" />
        </>
      }
    >
      <div className="dialog__actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={onRescan}
          disabled={scanning}
        >
          {scanning ? "扫描中…" : "重扫"}
        </button>
      </div>

      {error !== undefined ? (
        <p className="form-error">{error}</p>
      ) : result === undefined ? (
        <p className="muted">{scanning ? "扫描中…" : "还没有结果。"}</p>
      ) : (
        <pre className="json">{JSON.stringify(result, null, 2)}</pre>
      )}
    </Dialog>
  );
}
