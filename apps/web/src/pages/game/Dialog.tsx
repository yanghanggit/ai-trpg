import { type ReactNode, useEffect, useRef } from "react";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * 尺寸变体：`grid` 只统一宽度（锚点这种带描述的浮窗用），
   * `gridfill` 再加一个固定高度（纯网格：背包、行迹、相识），
   * `drawer` 改成贴右边、吃满屏幕高度的侧板（记录这种长列表用）。
   */
  variant?: "grid" | "gridfill" | "drawer";
};

/**
 * 浮窗：原生 `<dialog>`。
 *
 * 用原生元素而不是自绘遮罩，是因为焦点陷阱、ESC 关闭与 `::backdrop` 都由浏览器给，
 * 自绘一套只会少几样。jsdom 还没实现 `showModal`，那里退化成 `open` 属性（不影响查询）。
 */
export default function Dialog({ title, onClose, children, variant }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    return () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    };
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 点遮罩关闭是鼠标的便利；键盘走 ESC（原生 cancel）。
    <dialog
      ref={ref}
      className={variant === undefined ? "sheet" : `sheet sheet--${variant}`}
      aria-label={title}
      // 只认「用户主动关闭」的三个入口：关闭按钮、点遮罩、按 ESC。
      // 不监听 `close` 事件——卸载时我们也会 close()，那个事件会把「自己关掉的」
      // 误当成用户关闭（StrictMode 的双次挂载下每次都会发生）。
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // 点到的就是 dialog 本身（遮罩或内边距）时关闭；点内容不关。
        if (event.target === ref.current) {
          onClose();
        }
      }}
    >
      <header className="sheet__header">
        <h2>{title}</h2>
        <button type="button" className="sheet__close" onClick={onClose}>
          关闭
        </button>
      </header>
      <div className="sheet__body">{children}</div>
    </dialog>
  );
}
