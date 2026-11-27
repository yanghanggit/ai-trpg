import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatAt, formatNumber } from "../../lib/format";
import type { GamePromptBundleData, GamePromptFile } from "./types";

type Props = {
  data: GamePromptBundleData;
  onSelect: (path: string) => void;
  onRefresh: () => void;
};

const KIND_LABEL: Record<GamePromptFile["kind"], string> = {
  world: "世界",
  function: "职能",
  stage: "舞台",
  actor: "角色",
};

const KIND_ORDER: GamePromptFile["kind"][] = ["world", "function", "stage", "actor"];

function groups(files: readonly GamePromptFile[]) {
  return KIND_ORDER.map((kind) => ({
    kind,
    files: files.filter((file) => file.kind === kind),
  })).filter((group) => group.files.length > 0);
}

function kb(bytes: number): string {
  return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/**
 * 一份导出的正文：左边是文件，右边是那个文件逐字写了什么。
 *
 * 不渲染 markdown：审的是系统提示词原文，多一层渲染就多一层解释。
 */
export default function GamePromptBundlePage({ data, onSelect, onRefresh }: Props) {
  const files = data.bundle?.files ?? [];
  const current = files.find((file) => file.path === data.file) ?? files[0];
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);

  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "局", to: "/games" },
          { label: data.slug, to: `/g/${encodeURIComponent(data.slug)}` },
          { label: "系统提示词", to: `/g/${encodeURIComponent(data.slug)}/prompts` },
          {
            label: data.bundle?.createdAt === undefined ? data.id : formatAt(data.bundle.createdAt),
          },
        ]}
        title={<code>{data.id}</code>}
        onRefresh={onRefresh}
      />

      {data.bundleError === undefined ? null : <p className="form-error">{data.bundleError}</p>}

      {data.bundle === undefined ? (
        <section className="panel">
          <p className="muted">{data.bundleError === undefined ? "读取中…" : null}</p>
        </section>
      ) : (
        <>
          <dl className="facts facts--page">
            <div>
              <dt>建局时间</dt>
              <dd>{formatAt(data.bundle.createdAt)}</dd>
            </div>
            <div>
              <dt>世界</dt>
              <dd>{data.bundle.world}</dd>
            </div>
            <div>
              <dt>内容版本</dt>
              <dd>
                <code>{data.bundle.contentVersion}</code>
              </dd>
            </div>
            <div>
              <dt>文件</dt>
              <dd>{formatNumber(files.length)} 份</dd>
            </div>
            <div>
              <dt>合计</dt>
              <dd>{kb(bytes)}</dd>
            </div>
          </dl>

          <section className="panel">
            <h2>
              原文
              <Hint text="文件清单来自 manifest.json，正文原样显示。同一个 agent 的系统提示词就是这一段；它下面接的 memory、可见事件与工具清单不在导出范围内。" />
            </h2>
            <div className="prompt-viewer">
              <nav className="prompt-viewer__list" aria-label="导出里的文件">
                {groups(files).map((group) => (
                  <div key={group.kind} className="prompt-group">
                    <p className="prompt-group__label">
                      {KIND_LABEL[group.kind]} · {formatNumber(group.files.length)}
                    </p>
                    {group.files.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={
                          file.path === current?.path
                            ? "prompt-file prompt-file--on"
                            : "prompt-file"
                        }
                        aria-current={file.path === current?.path ? "true" : undefined}
                        onClick={() => onSelect(file.path)}
                      >
                        <span className="prompt-file__name">{file.name}</span>
                        <span className="prompt-file__size">{kb(file.bytes)}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
              <div className="prompt-viewer__body">
                {current === undefined ? (
                  <p className="muted">左边选一份。</p>
                ) : (
                  <>
                    <p className="muted prompt-viewer__path">
                      <code>{current.path}</code> · {formatNumber(current.content.length)} 字
                    </p>
                    <pre className="json json--tall">{current.content}</pre>
                  </>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
