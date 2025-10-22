from fastapi import APIRouter, HTTPException, status
from loguru import logger
from .game_server_depends import GameServerInstance
from ..models import (
    HomeStateResponse,
)

###################################################################################################################################################################
home_state_api_router = APIRouter()


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
@home_state_api_router.get(
    path="/api/homes/v1/{user_name}/{game_name}/state", response_model=HomeStateResponse
)
async def get_home_state(
    game_server: GameServerInstance,
    user_name: str,
    game_name: str,
) -> HomeStateResponse:

    logger.info(f"/homes/v1/{user_name}/{game_name}/state: {user_name}, {game_name}")
    try:

        # 是否有房间？！！
        if not game_server.has_room(user_name):
            logger.error(f"view_home: {user_name} has no room")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="没有房间",
            )

        # 是否有游戏？！！
        current_room = game_server.get_room(user_name)
        assert current_room is not None
        if current_room._tcg_game is None:
            logger.error(f"view_home: {user_name} has no game")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="没有游戏",
            )

        # 获取游戏
        web_game = current_room._tcg_game

        # 获取当前地图
        mapping_data = web_game.get_stage_actor_distribution_mapping()
        logger.info(f"view_home: {user_name} mapping_data: {mapping_data}")

        # 返回。
        return HomeStateResponse(
            mapping=mapping_data,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"服务器错误: {str(e)}",
        )


###################################################################################################################################################################
###################################################################################################################################################################
###################################################################################################################################################################
