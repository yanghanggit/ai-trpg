from typing import Dict, Set
from fastapi import APIRouter, HTTPException, status
from loguru import logger
from ..game.tcg_game import TCGGame
from .game_server_depends import GameServerInstance
from ..models import (
    HomeGamePlayRequest,
    HomeGamePlayResponse,
    HomeTransDungeonRequest,
    HomeTransDungeonResponse,
    SpeakAction,
    AllyComponent,
    Dungeon,
    DungeonComponent,
    KickOffMessageComponent,
    EnemyComponent,
    Combat,
)
from ..entitas import Matcher, Entity

###################################################################################################################################################################
home_gameplay_api_router = APIRouter()


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
async def _validate_home_game_preconditions(
    user_name: str,
    game_server: GameServerInstance,
) -> TCGGame:
    """
    验证家园操作的前置条件，包括房间检查、游戏检查和游戏状态检查

    Args:
        user_name: 用户名
        game_server: 游戏服务器实例

    Returns:
        WebTCGGame: 验证通过的游戏实例

    Raises:
        HTTPException: 当验证失败时抛出相应的HTTP异常
    """
    # 是否有房间？！！
    # room_manager = game_server.room_manager
    if not game_server.has_room(user_name):
        logger.error(f"{user_name} has no room, please login first.")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="没有登录，请先登录",
        )

    # 是否有游戏？！！
    current_room = game_server.get_room(user_name)
    assert current_room is not None
    if current_room._tcg_game is None:
        logger.error(f"{user_name} has no game, please login first.")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="没有游戏，请先登录",
        )

    web_game = current_room._tcg_game
    assert web_game is not None
    assert isinstance(web_game, TCGGame)

    # 判断游戏状态，不是Home状态不可以推进。
    # if web_game.current_game_state != TCGGameState.HOME:
    if not web_game.is_player_at_home:
        logger.error(f"{user_name} game state error !!!!! not in home state.")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只能在营地中使用",
        )

    return web_game


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
async def _handle_advancing_action(web_game: TCGGame) -> HomeGamePlayResponse:
    """
    处理推进游戏的动作

    Args:
        web_game: 游戏实例

    Returns:
        HomeGamePlayResponse: 包含客户端消息的响应
    """
    # 推进一次。
    web_game.player_session.session_messages.clear()
    await web_game.npc_home_pipeline.process()

    # 返回消息
    return HomeGamePlayResponse(
        client_messages=web_game.player_session.session_messages,
    )


###################################################################################################################################################################
###################################################################################################################################################################
# TODO, 临时添加行动, 逻辑。
def _player_add_speak_action(tcg_game: TCGGame, target: str, content: str) -> bool:

    # assert target != "", "target is empty"
    assert content != "", "content is empty"
    logger.debug(f"activate_speak_action: {target} => \n{content}")

    # if content == "":
    #     logger.error("内容不能为空！")
    #     return False

    target_entity = tcg_game.get_actor_entity(target)
    # assert target_entity is not None, "target_entity is None"
    if target_entity is None:
        logger.error(f"目标角色: {target} 不存在！")
        return False

    player_entity = tcg_game.get_player_entity()
    assert player_entity is not None
    # data: Dict[str, str] = {target: content}
    player_entity.replace(SpeakAction, player_entity.name, {target: content})

    return True


#######################################################################################################################################
# TODO, 进入地下城！
def _dungeon_advance(
    tcg_game: TCGGame, dungeon: Dungeon, heros_entities: Set[Entity]
) -> bool:
    """
    地下城关卡推进的主协调函数

    Args:
        dungeon: 地下城实例
        heros_entities: 英雄实体集合

    Returns:
        bool: 是否成功推进到下一关卡
    """
    # 1. 验证前置条件
    # 是否有可以进入的关卡？
    upcoming_dungeon = dungeon.get_current_stage()
    if upcoming_dungeon is None:
        logger.error(
            f"{tcg_game.current_dungeon.name} 没有下一个地下城！position = {tcg_game.current_dungeon.current_stage_index}"
        )
        return False

    # 下一个关卡实体, 没有就是错误的。
    stage_entity = tcg_game.get_stage_entity(upcoming_dungeon.name)
    if stage_entity is None or not stage_entity.has(DungeonComponent):
        logger.error(f"{upcoming_dungeon.name} 没有对应的stage实体！")
        return False

    # 集体准备传送
    if len(heros_entities) == 0:
        logger.error(f"没有英雄不能进入地下城!= {stage_entity.name}")
        return False

    logger.debug(
        f"{tcg_game.current_dungeon.name} = [{tcg_game.current_dungeon.current_stage_index}]关为：{stage_entity.name}，可以进入！！！！"
    )

    # 2. 生成并发送传送提示消息
    # 准备提示词
    if dungeon.current_stage_index == 0:
        trans_message = (
            f"""# 提示！你将要开始一次冒险，准备进入地下城: {stage_entity.name}"""
        )
    else:
        trans_message = (
            f"""# 提示！你准备继续你的冒险，准备进入下一个地下城: {stage_entity.name}"""
        )

    for hero_entity in heros_entities:
        tcg_game.append_human_message(hero_entity, trans_message)  # 添加故事

    # 3. 执行场景传送
    tcg_game.stage_transition(heros_entities, stage_entity)

    # 4. 设置KickOff消息
    # 需要在这里补充设置地下城与怪物的kickoff信息。
    stage_kick_off_comp = stage_entity.get(KickOffMessageComponent)
    assert stage_kick_off_comp is not None
    logger.debug(
        f"当前 {stage_entity.name} 的kickoff信息: {stage_kick_off_comp.content}"
    )

    # 获取场景内角色的外貌信息
    actors_appearances_mapping: Dict[str, str] = tcg_game.get_stage_actor_appearances(
        stage_entity
    )

    # 重新组织一下
    actors_appearances_info = []
    for actor_name, appearance in actors_appearances_mapping.items():
        actors_appearances_info.append(f"{actor_name}: {appearance}")
    if len(actors_appearances_info) == 0:
        actors_appearances_info.append("无")

    # 生成追加的kickoff信息
    append_kickoff_message = f"""# 场景内角色
{"\n".join(actors_appearances_info)}"""

    # 设置组件
    stage_entity.replace(
        KickOffMessageComponent,
        stage_kick_off_comp.name,
        stage_kick_off_comp.content + "\n" + append_kickoff_message,
    )
    logger.debug(
        f"更新设置{stage_entity.name} 的kickoff信息: {stage_entity.get(KickOffMessageComponent).content}"
    )

    # 设置怪物的kickoff信息
    actors = tcg_game.get_alive_actors_on_stage(stage_entity)
    for actor in actors:
        if actor.has(EnemyComponent):
            monster_kick_off_comp = actor.get(KickOffMessageComponent)
            assert monster_kick_off_comp is not None
            logger.debug(
                f"需要设置{actor.name} 的kickoff信息: {monster_kick_off_comp.content}"
            )

    # 5. 初始化战斗状态
    dungeon.engagement.start_combat(Combat(name=stage_entity.name))

    return True


#######################################################################################################################################
# TODO!!! 进入地下城。
def _all_heros_launch_dungeon(tcg_game: TCGGame) -> bool:
    if tcg_game.current_dungeon.current_stage_index < 0:
        tcg_game.current_dungeon.current_stage_index = 0  # 第一次设置，第一个关卡。
        tcg_game.create_dungeon_entities(tcg_game.current_dungeon)
        heros_entities = tcg_game.get_group(Matcher(all_of=[AllyComponent])).entities
        # return tcg_game._dungeon_advance(tcg_game.current_dungeon, heros_entities)
        return _dungeon_advance(tcg_game, tcg_game.current_dungeon, heros_entities)
    else:
        # 第一次，必须是<0, 证明一次没来过。
        logger.error(
            f"launch_dungeon position = {tcg_game.current_dungeon.current_stage_index}"
        )

    return False


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
async def _handle_speak_action(
    web_game: TCGGame, target: str, content: str
) -> HomeGamePlayResponse:
    """
    处理说话动作

    Args:
        web_game: 游戏实例
        target: 说话目标
        content: 说话内容

    Returns:
        HomeGamePlayResponse: 包含客户端消息的响应
    """
    # player 添加说话的动作
    # if web_game.speak_action(target=target, content=content):
    if _player_add_speak_action(web_game, target=target, content=content):
        # 清空消息。准备重新开始 + 测试推进一次游戏
        web_game.player_session.session_messages.clear()
        await web_game.player_home_pipeline.process()

        # 返回消息
        return HomeGamePlayResponse(
            client_messages=web_game.player_session.session_messages,
        )

    # 如果说话动作激活失败，返回空消息
    return HomeGamePlayResponse(
        client_messages=web_game.player_session.session_messages,
    )


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
@home_gameplay_api_router.post(
    path="/api/home/gameplay/v1/", response_model=HomeGamePlayResponse
)
async def home_gameplay(
    payload: HomeGamePlayRequest,
    game_server: GameServerInstance,
) -> HomeGamePlayResponse:

    logger.info(f"/home/gameplay/v1/: {payload.model_dump_json()}")
    try:
        # 验证前置条件并获取游戏实例
        web_game = await _validate_home_game_preconditions(
            payload.user_name,
            game_server,
        )

        # 根据标记处理。
        match payload.user_input.tag:

            case "/advancing":
                return await _handle_advancing_action(web_game)

            case "/speak":
                return await _handle_speak_action(
                    web_game,
                    target=payload.user_input.data.get("target", ""),
                    content=payload.user_input.data.get("content", ""),
                )

            case _:
                logger.error(f"未知的请求类型 = {payload.user_input.tag}, 不能处理！")

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"未知的请求类型 = {payload.user_input.tag}, 不能处理！",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"home/gameplay/v1: {payload.user_name} failed, error: {str(e)}",
        )


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
@home_gameplay_api_router.post(
    path="/api/home/trans_dungeon/v1/", response_model=HomeTransDungeonResponse
)
async def home_trans_dungeon(
    payload: HomeTransDungeonRequest,
    game_server: GameServerInstance,
) -> HomeTransDungeonResponse:

    logger.info(f"/home/trans_dungeon/v1/: {payload.model_dump_json()}")
    try:
        # 验证前置条件并获取游戏实例
        web_game = await _validate_home_game_preconditions(
            payload.user_name,
            game_server,
        )

        # 判断地下城是否存在
        if len(web_game.current_dungeon.stages) == 0:
            logger.warning(
                "没有地下城可以传送, 全部地下城已经结束。！！！！已经全部被清空！！！！或者不存在！！！！"
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="没有地下城可以传送, 全部地下城已经结束。！！！！已经全部被清空！！！！或者不存在！！！！",
            )

        # 传送地下城执行。
        # if not web_game.launch_dungeon():
        if not _all_heros_launch_dungeon(web_game):
            logger.error("第一次地下城传送失败!!!!")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="第一次地下城传送失败!!!!",
            )
        #
        return HomeTransDungeonResponse(
            message=payload.model_dump_json(),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"home/trans_dungeon/v1: {payload.user_name} failed, error: {str(e)}",
        )


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
