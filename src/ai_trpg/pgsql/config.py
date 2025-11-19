from typing import Final, final
from pydantic import BaseModel


@final
class PostgreSQLConfig(BaseModel):
    host: str = "localhost"
    port: int = 5432
    database: str = "ai-trpg-db"
    user: str = "postgres"

    @property
    def connection_string(self) -> str:
        return f"postgresql://{self.user}@{self.host}:{self.port}/{self.database}"


"""
PostgreSQLConfig() - 默认 localhost:5432
PostgreSQLConfig(host="192.168.1.50") - 本机局域网地址
PostgreSQLConfig(host="192.168.1.100", port=5433) - 自定义端口
"""

# 默认配置实例
postgresql_config: Final[PostgreSQLConfig] = PostgreSQLConfig()
