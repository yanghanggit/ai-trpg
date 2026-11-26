import { ApiError } from "@ai-trpg/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { describeApiError } from "../../api/describeApiError";
import {
  useActionOrder,
  useCompleteActionOrder,
  useCreateActionOrder,
  useRemoveActionOrder,
} from "../../features/action-order/useActionOrder";
import type { GameView } from "../../features/games/useGameView";
import { advanceOnce, createAdvancePort } from "../../features/turns/advance";
import { passTurn } from "../../features/turns/api";
import { strictTargetRef } from "../../features/turns/targets";
import { outcomeOf, type TurnJob } from "../../features/turns/turnJob";
import { useTakeControl } from "../../features/turns/useTakeControl";
import { useActiveTurnJobs, useStartTurn } from "../../features/turns/useTurnJob";
import Dialog from "./Dialog";
import ActionForm from "./panels/ActionForm";
import OrderPanel from "./panels/OrderPanel";

/**
 * 撞上「已有回合在跑」时给一句能照着做的话。
 *
 * 其余错误照旧由传输层翻成人话——这里只补契约里已经能分辨的那一种（按错误码，不看文本）。
 */
function hintOf(error: unknown): string {
  const code =
    error instanceof ApiError && typeof error.body === "object" && error.body !== null
      ? (error.body as { error?: unknown }).error
      : undefined;
  if (code === "invalid_state") {
    return "这一局已有回合在跑，等它结束再试（顶部的提示会告诉你进度）";
  }
  return describeApiError(error);
}

function progressText(job: TurnJob): string {
  if (job.status === "pending") {
    return "排队中…";
  }
  const step = job.progress?.step;
  const detail = job.progress?.detail;
  const label =
    step === "planning"
      ? "模型在写"
      : step === "applying"
        ? "落账中"
        : step === "finalizing"
          ? "收尾"
          : "执行中";
  return detail === undefined ? label : `${label}（${detail}）`;
}

/**
 * 一个回合的入口：先确认由谁来动，再把这一回合提交出去。
 *
 * 提交的是「一个动作」，不是一串：一个回合只有一个动作是引擎的形状，界面不该暗示可以攒着做。
 * 结果只认作业终态，终态后重读投影与顺位——页面不自己推断世界变了什么。
 */
export default function TurnDialog({
  slug,
  view,
  onClose,
}: {
  slug: string;
  view: GameView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const order = useActionOrder(slug);
  const createOrder = useCreateActionOrder(slug);
  const completeOrder = useCompleteActionOrder(slug);
  const removeOrder = useRemoveActionOrder(slug);
  const takeControl = useTakeControl(slug);
  const activeJobs = useActiveTurnJobs(slug);
  const [advancing, setAdvancing] = useState(false);
  const [passing, setPassing] = useState(false);
  const [advanceNote, setAdvanceNote] = useState<string | null>(null);

  const turn = useStartTurn(slug, {
    onTerminal: (job) => {
      void queryClient.invalidateQueries({ queryKey: ["games", slug, "view"] });
      void queryClient.invalidateQueries({ queryKey: ["games", slug, "action-order"] });
      if (outcomeOf(job).ok) {
        onClose();
      }
    },
  });

  const currentOrder = order.data ?? null;
  const self = currentOrder?.entries.find((entry) => entry.actorId === view.viewer.actorId);

  // 打开时这一局已经有回合在跑（刷新前发起的、或别人发起的）：接上它，别发第二个。
  const activeJobId = activeJobs.data?.[0]?.jobId ?? null;
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (activeJobId === null || turn.job !== null || adopted.current === activeJobId) {
      return;
    }
    adopted.current = activeJobId;
    turn.adopt(activeJobId);
  }, [activeJobId, turn]);

  // 目标引用只认编号或真名：认得的名字先换成签名编号，换不出来就不给选。
  const others = view.stage.actors
    .filter((actor) => !actor.self && actor.alive)
    .map((actor) => ({ ...actor, ref: strictTargetRef(actor, view.names) }));
  const outcome = turn.job === null ? null : outcomeOf(turn.job);
  const error = turn.error === undefined || turn.error === null ? null : hintOf(turn.error);

  /** 空回合：这一趟我没动手，记一条事实，别把自己堵在队首。 */
  async function pass() {
    setPassing(true);
    setAdvanceNote(null);
    try {
      await passTurn(slug, [view.viewer.name]);
      await queryClient.invalidateQueries({ queryKey: ["games", slug, "action-order"] });
      await queryClient.invalidateQueries({ queryKey: ["games", slug, "view"] });
      setAdvanceNote("记了一条空回合");
    } catch (passError) {
      setAdvanceNote(describeApiError(passError));
    } finally {
      setPassing(false);
    }
  }

  async function advance() {
    setAdvancing(true);
    setAdvanceNote(null);
    try {
      const result = await advanceOnce(createAdvancePort(slug));
      await queryClient.invalidateQueries({ queryKey: ["games", slug, "view"] });
      await queryClient.invalidateQueries({ queryKey: ["games", slug, "action-order"] });
      setAdvanceNote(
        result.kind === "advanced"
          ? `推了 ${result.steps.join(" + ")}`
          : result.kind === "player"
            ? result.actorName === view.viewer.name
              ? "轮到你了：在上面选一个动作"
              : `轮到 ${result.actorName}：等他决定这一回合做什么`
            : result.kind === "no-order"
              ? "没有进行中的顺位"
              : result.reason,
      );
    } catch (pushError) {
      setAdvanceNote(describeApiError(pushError));
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <Dialog title="动作" onClose={onClose}>
      {order.isPending ? <p className="muted">读取顺位…</p> : null}
      {order.isError ? (
        <p className="form-error" role="alert">
          {describeApiError(order.error)}
        </p>
      ) : null}

      {currentOrder === null ? (
        <>
          <p className="muted">这一局还没有行动顺位；先开一条，才知道轮到谁。</p>
          <button
            type="button"
            className="button"
            disabled={createOrder.isPending}
            onClick={() => createOrder.mutate()}
          >
            开一条顺位
          </button>
        </>
      ) : null}

      {currentOrder === null ? null : (
        <>
          <OrderPanel order={currentOrder} selfActorId={view.viewer.actorId} />
          <div className="game__actions">
            <button
              type="button"
              className="action"
              disabled={advancing}
              onClick={() => {
                void advance();
              }}
            >
              {advancing ? "推进中…" : "推进一步"}
            </button>
            {self !== undefined && self.control === "player" ? (
              <button
                type="button"
                className="action"
                disabled={passing}
                onClick={() => {
                  void pass();
                }}
              >
                {passing ? "记录中…" : "这一趟我空过"}
              </button>
            ) : null}
            <button
              type="button"
              className="action"
              disabled={completeOrder.isPending}
              onClick={() => completeOrder.mutate(currentOrder.id)}
            >
              完成这一轮
            </button>
            <button
              type="button"
              className="action"
              disabled={removeOrder.isPending}
              onClick={() => removeOrder.mutate(currentOrder.id)}
            >
              删掉顺位
            </button>
          </div>
          {advanceNote === null ? null : <p className="muted">{advanceNote}</p>}
        </>
      )}

      {self !== undefined && self.control === "agent" ? (
        <>
          <p className="muted">
            {view.viewer.name} 现在由 agent 驱动（名次 {self.position}
            ）。接管之后，这一角色的回合由你决定。
          </p>
          <button
            type="button"
            className="button"
            disabled={takeControl.isPending}
            onClick={() => takeControl.mutate(view.viewer.name)}
          >
            接管
          </button>
        </>
      ) : null}

      {self !== undefined && self.control === "player" ? (
        <>
          <ActionForm
            actor={view.viewer.name}
            targets={others}
            exits={view.stage.exits}
            disabled={turn.isRunning}
            onSubmit={(request) => {
              void turn.start(request).catch(() => undefined);
            }}
          />
          {turn.job !== null && turn.isRunning ? (
            <p className="muted">{progressText(turn.job)}</p>
          ) : null}
        </>
      ) : null}

      {self === undefined && currentOrder !== null ? (
        <p className="muted">你不在这一轮的顺位里；下一轮开顺位时会算进来。</p>
      ) : null}

      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {outcome !== null && !outcome.ok ? (
        <p className="form-error" role="alert">
          {outcome.code}：{outcome.message}
        </p>
      ) : null}
    </Dialog>
  );
}
