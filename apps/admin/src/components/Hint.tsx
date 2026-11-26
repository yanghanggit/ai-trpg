import type { ReactNode } from "react";

type Props = {
  /** 解释文本：只在悬停或聚焦时出现，正文不占地方。 */
  text: string;
  /** 无障碍名称；默认「说明」。 */
  label?: string;
};

/**
 * 面板标题旁的说明入口。
 *
 * 判据：正文只放读数和当场必须看见的东西（错误、空态、危险确认），口径与教学一律进这里。
 * 所以别在面板里写「这三个数分别怎么读」——那类话每屏只需要看一次，不该每天占着版面。
 *
 * 用 `<button>` 而不是带 `tabIndex` 的 `<span>`：键盘要能聚焦、读屏要能念，这两件事
 * 都要求它本来就是个可交互元素。`aria-label` 带完整文本，提示框只是视觉上的同一句话。
 */
export default function Hint({ text, label = "说明" }: Props): ReactNode {
  return (
    <button type="button" className="hint" aria-label={`${label}：${text}`}>
      ?
      <span className="hint__tip" role="tooltip" aria-hidden="true">
        {text}
      </span>
    </button>
  );
}
