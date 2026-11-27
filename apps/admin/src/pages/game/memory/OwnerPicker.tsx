import { useId, useState } from "react";
import { KIND_LABEL, type MemoryTarget, matchTargets } from "./targets";

type Props = {
  targets: readonly MemoryTarget[];
  /** 只让某几类可被选中（探针只认舞台与角色）。 */
  kinds?: readonly MemoryTarget["kind"][];
  onSelect: (target: MemoryTarget) => void;
  placeholder: string;
};

/**
 * 记忆目标的搜索框：直接模糊搜，选中之后类型只是补充显示。
 *
 * 先选 owner 类型再输名字，等于让调用方先声明判据再看结果；这里反过来——
 * 名字、key、id 一起搜，一个 `@` 就把全部列出来。
 */
export default function OwnerPicker({ targets, kinds, onSelect, placeholder }: Props) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const pool =
    kinds === undefined ? targets : targets.filter((target) => kinds.includes(target.kind));
  const options = matchTargets(pool, query);
  const cursor = options.length === 0 ? undefined : options[Math.min(active, options.length - 1)];

  function choose(target: MemoryTarget) {
    onSelect(target);
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  return (
    <div className="picker">
      <input
        className="picker__input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && cursor ? `${listId}-${cursor.id}` : undefined}
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            if (open && cursor !== undefined) {
              event.preventDefault();
              choose(cursor);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {open && options.length > 0 ? (
        <div className="picker__menu" id={listId} role="listbox" aria-label={placeholder}>
          {options.map((target, index) => (
            <button
              key={target.id}
              type="button"
              role="option"
              id={`${listId}-${target.id}`}
              aria-selected={index === active}
              className={index === active ? "picker__option picker__option--on" : "picker__option"}
              // 按下鼠标时别让输入框先失焦：失焦会先关掉清单。
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(target)}
            >
              <span className="picker__name">{target.name}</span>
              <span className="picker__kind">{KIND_LABEL[target.kind]}</span>
              <span className="picker__key">{target.key}</span>
            </button>
          ))}
        </div>
      ) : null}

      {open && options.length === 0 ? <p className="picker__empty">没有匹配的名字。</p> : null}
    </div>
  );
}
