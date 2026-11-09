import { type AddressLookup, mentionOf } from "../addressing";
import { MEMORY_KINDS } from "../constants";
import { withAppearances } from "./text";
import type { CallObservation, CommunicationObservation, ObservationView, StageRef } from "./types";

/**
 * 沟通文案：耳语只有对方视角，公开宣告没有目标，跨场景传音只写给目标。
 *
 * 传音不渲染发起人：发起者的身份只能由台词自己披露，结构层不替它宣布。
 */

/** 跨场景传音：只有目标听见；不渲染发起人，避免结构层泄露来源。 */
export function renderCall(stage: StageRef, observation: CallObservation): ObservationView {
  return {
    content: `# 你听见\n一个声音隔空对你说话（你在${stage.name}）：${observation.message}`,
    metadata: {
      kind: MEMORY_KINDS.communicationObservation,
      visibility: "private",
      communicationKind: "call",
      dialogue: observation.message,
      stageId: stage.id,
      targetActorId: observation.target.id,
    },
  };
}

/** 沟通观察：耳语只有对方视角，公开宣告没有目标。 */
export function renderCommunication(
  stage: StageRef,
  observation: CommunicationObservation,
  observerId: string,
  address: AddressLookup,
): ObservationView {
  const { source, message } = observation;
  const sourceAddress = address(source.id);
  const sourceRef = mentionOf(sourceAddress);
  const targetAddress = observation.kind === "announce" ? null : address(observation.target.id);

  if (observation.kind === "whisper") {
    return {
      content: withAppearances(
        `# 你听见\n${sourceRef}对你耳语（场景：${stage.name}）：${message}`,
        [sourceAddress],
      ),
      metadata: {
        kind: MEMORY_KINDS.communicationObservation,
        visibility: "private",
        communicationKind: "whisper",
        dialogue: message,
        stageId: stage.id,
        sourceActorId: source.id,
        targetActorId: observation.target.id,
      },
    };
  }

  const heardByTarget = observation.kind !== "announce" && observerId === observation.target.id;
  const heard =
    observation.kind === "announce"
      ? `${sourceRef}公开说`
      : heardByTarget
        ? `${sourceRef}对你说`
        : `${sourceRef}对${mentionOf(address(observation.target.id))}说`;

  return {
    content: withAppearances(`# 你听见\n${heard}（场景：${stage.name}）：${message}`, [
      sourceAddress,
      ...(heardByTarget || targetAddress === null ? [] : [targetAddress]),
    ]),
    metadata: {
      kind: MEMORY_KINDS.communicationObservation,
      visibility: "stage",
      communicationKind: observation.kind,
      dialogue: message,
      stageId: stage.id,
      sourceActorId: source.id,
      ...(observation.kind === "announce" ? {} : { targetActorId: observation.target.id }),
    },
  };
}
