import type { ChatCompletionService } from "../../llm";

/** 探针问谁：一个 actor，或一个 stage；world 没有探针入口。 */
export type ProbeTarget = { type: "actor"; actorRef: string } | { type: "stage"; stageRef: string };

export type ProbeOptions = {
  service: ChatCompletionService;
  target: ProbeTarget;
  message: string;
};

export type ProbeResult = {
  targetType: ProbeTarget["type"];
  targetName: string;
  answer: string;
  finishReason: string;
};
