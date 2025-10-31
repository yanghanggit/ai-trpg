from pydantic import BaseModel, Field
from typing import List


class Attributes(BaseModel):
    """表示角色属性的模型"""

    health: int = Field(default=100, description="生命值/血量", ge=0)
    max_health: int = Field(default=100, description="最大生命值", ge=1)
    attack: int = Field(default=10, description="攻击力", ge=0)


class Actor(BaseModel):
    """表示游戏中角色状态的模型"""

    name: str = Field(description="角色名称")
    profile: str = Field(description="角色档案/设定")
    appearance: str = Field(description="外观描述")
    attributes: Attributes = Field(default_factory=Attributes, description="角色属性")


class Stage(BaseModel):
    """表示游戏中场景状态的模型"""

    name: str = Field(description="场景名称")
    profile: str = Field(description="场景档案/设定（固定背景故事）")
    environment: str = Field(description="环境描写（感官层面）")
    actors: List[Actor] = Field(description="场景中的角色")
    sub_stages: List["Stage"] = Field(default_factory=list, description="子场景")

    def find_actor(self, actor_name: str) -> Actor | None:
        """递归查找指定名称的Actor

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            找到的Actor对象，如果未找到则返回None
        """
        # 在当前场景的actors中查找
        for actor in self.actors:
            if actor.name == actor_name:
                return actor

        # 递归搜索子场景中的actors
        for stage in self.sub_stages:
            found = stage.find_actor(actor_name)
            if found:
                return found

        return None


class World(BaseModel):
    """表示游戏世界状态的模型"""

    name: str = Field(description="世界名称")
    campaign_setting: str = Field(description="战役设定/世界观描述")
    stages: List[Stage] = Field(description="世界中的场景列表")

    def find_stage(self, stage_name: str) -> Stage | None:
        """递归查找指定名称的Stage

        Args:
            stage_name: 要查找的Stage名称

        Returns:
            找到的Stage对象，如果未找到则返回None
        """

        def _recursive_find(stages: List[Stage], target_name: str) -> Stage | None:
            for stage in stages:
                if stage.name == target_name:
                    return stage
                # 递归搜索子场景
                if stage.sub_stages:
                    found = _recursive_find(stage.sub_stages, target_name)
                    if found:
                        return found
            return None

        return _recursive_find(self.stages, stage_name)

    def find_actor_with_stage(
        self, actor_name: str
    ) -> tuple[Actor | None, Stage | None]:
        """查找指定名称的Actor及其所在的Stage

        Args:
            actor_name: 要查找的Actor名称

        Returns:
            (Actor, Stage)元组,如果未找到则返回(None, None)
        """

        def _recursive_search(
            stages: List[Stage],
        ) -> tuple[Actor | None, Stage | None]:
            for stage in stages:
                # 先在当前Stage的actors中直接查找
                for actor in stage.actors:
                    if actor.name == actor_name:
                        return actor, stage

                # 递归搜索子场景
                if stage.sub_stages:
                    found_actor, found_stage = _recursive_search(stage.sub_stages)
                    if found_actor and found_stage:
                        return found_actor, found_stage

            return None, None

        return _recursive_search(self.stages)

    def get_all_actors(self) -> List[Actor]:
        """遍历获取世界中所有的Actor

        Returns:
            包含世界中所有Actor的列表
        """
        all_actors: List[Actor] = []

        def _collect_actors(stages: List[Stage]) -> None:
            for stage in stages:
                # 收集当前Stage中的所有actors
                all_actors.extend(stage.actors)
                # 递归收集子场景中的actors
                if stage.sub_stages:
                    _collect_actors(stage.sub_stages)

        _collect_actors(self.stages)
        return all_actors

    def get_all_stages(self) -> List[Stage]:
        """遍历获取世界中所有的Stage

        Returns:
            包含世界中所有Stage的列表
        """
        all_stages: List[Stage] = []

        def _collect_stages(stages: List[Stage]) -> None:
            for stage in stages:
                # 收集当前Stage
                all_stages.append(stage)
                # 递归收集子场景
                if stage.sub_stages:
                    _collect_stages(stage.sub_stages)

        _collect_stages(self.stages)
        return all_stages
