from pydantic import BaseModel, Field
from typing import List, Optional
from langchain.schema import BaseMessage


class Attributes(BaseModel):
    """表示角色属性的模型"""

    health: int = Field(default=100, description="生命值/血量", ge=0)
    max_health: int = Field(default=100, description="最大生命值", ge=1)
    attack: int = Field(default=10, description="攻击力", ge=0)


class Effect(BaseModel):
    """效果模型"""

    name: str = Field(description="效果名称")
    description: str = Field(description="效果描述")


class Actor(BaseModel):
    """表示游戏中角色状态的模型"""

    name: str = Field(description="角色名称")
    profile: str = Field(description="角色档案/设定")
    appearance: str = Field(description="外观描述")
    attributes: Attributes = Field(default_factory=Attributes, description="角色属性")
    effects: List[Effect] = Field(default_factory=list, description="角色当前效果状态")
    context: List[BaseMessage] = Field(
        default_factory=list, description="角色的LLM对话上下文"
    )


class Stage(BaseModel):
    """表示游戏中场景状态的模型"""

    name: str = Field(description="场景名称")
    profile: str = Field(description="场景档案/设定（固定背景故事）")
    environment: str = Field(description="环境描写（感官层面）")
    actors: List[Actor] = Field(description="场景中的角色")
    narrative: str = Field(description="场景叙事")
    actor_states: str = Field(description="场景中角色状态描述")
    connections: str = Field(
        default="",
        description="场景连通性：描述本场景与其他场景的连接关系、通道位置及通行条件",
    )
    stage_connections: List[str] = Field(
        default_factory=list,
        description="与当前场景连接的目标场景名称列表（用于图遍历和寻路算法）",
    )
    context: List[BaseMessage] = Field(
        default_factory=list, description="场景的LLM对话上下文"
    )

    def find_actor(self, actor_name: str) -> Actor | None:
        """查找指定名称的Actor

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            找到的Actor对象，如果未找到则返回None
        """
        # 在当前场景的actors中查找
        for actor in self.actors:
            if actor.name == actor_name:
                return actor

        return None


class World(BaseModel):
    """表示游戏世界状态的模型"""

    name: str = Field(description="世界名称")
    campaign_setting: str = Field(description="战役设定/世界观描述")
    stages: List[Stage] = Field(description="世界中的场景列表")
    context: List[BaseMessage] = Field(
        default_factory=list, description="世界的LLM对话上下文"
    )

    def find_stage(self, stage_name: str) -> Stage | None:
        """查找指定名称的Stage

        Args:
            stage_name: 要查找的Stage名称

        Returns:
            找到的Stage对象，如果未找到则返回None
        """
        for stage in self.stages:
            if stage.name == stage_name:
                return stage
        return None

    def find_actor_with_stage(
        self, actor_name: str
    ) -> tuple[Actor | None, Stage | None]:
        """查找指定名称的Actor及其所在的Stage

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            (Actor, Stage)元组,如果未找到则返回(None, None)
        """
        for stage in self.stages:
            # 在当前Stage的actors中直接查找
            for actor in stage.actors:
                if actor.name == actor_name:
                    return actor, stage

        return None, None

    def get_all_actors(self) -> List[Actor]:
        """遍历获取世界中所有的Actor

        Returns:
            包含世界中所有Actor的列表
        """
        all_actors: List[Actor] = []
        for stage in self.stages:
            # 收集当前Stage中的所有actors
            all_actors.extend(stage.actors)
        return all_actors

    def get_all_stages(self) -> List[Stage]:
        """遍历获取世界中所有的Stage

        Returns:
            包含世界中所有Stage的列表
        """
        return self.stages.copy()

    def move_actor_to_stage(
        self, actor_name: str, target_stage_name: str
    ) -> Optional[Stage]:
        """将角色从当前场景移动到目标场景

        这是一个纯粹的数据操作方法，只负责在 World 的数据结构中移动 Actor 对象。
        不涉及任何游戏逻辑验证（如场景连通性检查）或状态更新（如 actor_states）。
        这些逻辑应该由调用方或 LLM 代理负责。

        Args:
            actor_name: 要移动的角色名称
            target_stage_name: 目标场景名称

        Returns:
            Stage | None:
                - 成功：返回目标场景对象
                - 失败：返回 None（角色不存在或目标场景不存在）
        """
        # 1. 查找角色及其当前场景
        actor, source_stage = self.find_actor_with_stage(actor_name)
        if not actor or not source_stage:
            return None  # 角色不存在

        # 2. 查找目标场景
        target_stage = self.find_stage(target_stage_name)
        if not target_stage:
            return None  # 目标场景不存在

        # 3. 如果已在目标场景，直接返回目标场景（幂等性）
        if source_stage.name == target_stage.name:
            return target_stage

        # 4. 执行移动：从源场景移除，添加到目标场景
        source_stage.actors.remove(actor)
        target_stage.actors.append(actor)

        # 5. 返回目标场景表示成功
        return target_stage
