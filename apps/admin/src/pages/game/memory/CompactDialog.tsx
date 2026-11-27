import Dialog from "../../../components/Dialog";
import Hint from "../../../components/Hint";
import { KIND_LABEL, type MemoryTarget } from "./targets";

type Props = {
  open: boolean;
  /** 当前读的那一份；没选就只剩「全部」。 */
  target?: MemoryTarget;
  onClose: () => void;
  onCompact: (target: MemoryTarget | "all") => void;
};

/**
 * 压缩确认：它会调模型、改写记忆，而且没有撤销。
 *
 * 所以放在弹窗里一次问清楚，不做「点了就跑」的按钮。
 */
export default function CompactDialog({ open, target, onClose, onCompact }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <>
          压缩记忆
          <Hint text="压缩把历史压成叙事摘要，旧消息归档成可递归展开的树；system prompt 不动。要调用模型，慢，而且不撤销。" />
        </>
      }
    >
      <p className="muted">
        压缩之后旧消息仍在归档里，只是不再进上下文。世界、舞台、角色各有一份记忆，可以只压当前这一份。
      </p>
      <div className="inline-form">
        <button
          type="button"
          className="button"
          disabled={target === undefined}
          onClick={() => {
            if (target !== undefined) {
              onCompact(target);
            }
          }}
        >
          压缩当前{target === undefined ? "" : `（${KIND_LABEL[target.kind]} · ${target.name}）`}
        </button>
        <button type="button" className="button button--ghost" onClick={() => onCompact("all")}>
          压缩全部
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          取消
        </button>
      </div>
      {target === undefined ? <p className="muted">先在页面上选一份记忆，才能只压它。</p> : null}
    </Dialog>
  );
}
