import { type ReactNode, useEffect, useRef } from "react";

type Props = {
  /** 弹窗标题：可以是纯文字，也可以带 `<Hint>`。 */
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 宽版：图谱这类要画布又要点选的弹窗用。 */
  wide?: boolean;
  /** 额外类名：比宽版窄、比默认宽的那种中间尺寸由使用方自己给。 */
  className?: string;
  /**
   * ESC 的另一种含义：层级里的「退一级」。
   *
   * 不传就是关闭；传了之后，关闭仍走右上角与点遮罩——键盘退一级、按钮退到底。
   */
  onCancel?: () => void;
};

/**
 * 弹窗：原生 `<dialog>`。
 *
 * 用原生元素而不是自绘遮罩，是因为焦点陷阱、ESC 关闭与 `::backdrop` 都由浏览器给。
 * 只认「用户主动关闭」的两个入口：关闭按钮与 ESC / 点遮罩；不监听 `close` 事件——
 * 卸载时我们自己也会 close，那个事件会把「被关掉的」误当成用户操作。
 */
export default function Dialog({
  title,
  open,
  onClose,
  children,
  wide,
  className,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

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

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 点遮罩关闭是鼠标的便利；键盘走 ESC（原生 cancel）。
    <dialog
      ref={ref}
      className={["dialog", wide === true ? "dialog--wide" : "", className ?? ""]
        .filter((value) => value.length > 0)
        .join(" ")}
      onCancel={(event) => {
        event.preventDefault();
        (onCancel ?? onClose)();
      }}
      onClick={(event) => {
        // 点到的就是 dialog 本身（遮罩或内边距）时关闭；点内容不关。
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <header className="dialog__head">
        <h2>{title}</h2>
        <button type="button" className="button button--ghost" onClick={onClose}>
          关闭
        </button>
      </header>
      {children}
    </dialog>
  );
}
