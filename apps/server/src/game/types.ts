export type WorldSeed = {
  contentVersion: string;
  worldName: string;
  campaignSetting: string;
  systemRules: string;
  initialNarration?: string;
  stages: readonly StageSeed[];
  connections: readonly ConnectionSeed[];
  actor: ActorSeed;
  item: ItemSeed;
};

export type StageSeed = {
  key: string;
  name: string;
  profile: string;
  environment: string;
  narrative: string;
};

export type ConnectionSeed = {
  from: string;
  to: string;
};

export type ActorSeed = {
  stageKey: string;
  name: string;
  profile: string;
  appearance: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
};

export type ItemSeed = {
  name: string;
  description: string;
  kind: string;
};

export type CreateGameInput = {
  username: string;
  name?: string;
  slug?: string;
  seed: WorldSeed;
};

export type MoveActionInput = {
  type: "move";
  to: string;
};

export type GameActionInput = MoveActionInput;

export type ItemState = {
  id: string;
  name: string;
  description: string;
  kind: string;
};

export type ActorState = {
  id: string;
  name: string;
  profile: string;
  appearance: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  items: ItemState[];
};

export type StageState = {
  id: string;
  name: string;
  profile: string;
  environment: string;
  narrative: string;
  ordinal: number;
  actors: ActorState[];
};

export type ConnectionState = {
  id: string;
  fromStageId: string;
  toStageId: string;
};

export type MessageState = {
  id: string;
  sequence: number;
  kind: string;
  speakerActorId: string | null;
  content: string;
  createdAt: string;
};

export type PlayerState = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
};

export type GameState = {
  game: {
    id: string;
    ownerId: string;
    name: string;
    slug: string;
    status: string;
    contentVersion: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  player: PlayerState;
  world: {
    id: string;
    name: string;
    campaignSetting: string;
    systemRules: string;
    stages: StageState[];
    connections: ConnectionState[];
  };
  messages: MessageState[];
};
