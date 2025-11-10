from pydantic import BaseModel, Field
from typing import List
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
    initial_context: List[BaseMessage] = Field(
        default_factory=list, description="角色初始对话上下文"
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
