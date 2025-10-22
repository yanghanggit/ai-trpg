from typing import Final, final
from pydantic import BaseModel


@final
class ServerConfiguration(BaseModel):
    game_server_port: int = 8000
    azure_openai_chat_server_port: int = 8100
    deepseek_chat_server_port: int = 8200
    image_generation_server_port: int = 8300
    chat_api_endpoint: str = "/api/chat/v1/"
    chat_rag_api_endpoint: str = "/api/chat/rag/v1/"
    chat_undefined_api_endpoint: str = "/api/chat/undefined/v1/"
    chat_mcp_api_endpoint: str = "/api/chat/mcp/v1/"


# 给一个默认的！
server_configuration: Final[ServerConfiguration] = ServerConfiguration()
