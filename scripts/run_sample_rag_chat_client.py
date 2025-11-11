#!/usr/bin/env python3
"""
ChromaDB增强版RAG聊天系统启动脚本

功能：
1. 初始化ChromaDB向量数据库
2. 加载SentenceTransformer模型
3. 支持语义搜索和关键词搜索回退
4. 提供交互式聊天界面

使用方法：
    python scripts/run_deepseek_rag_chat_client.py

或者在项目根目录下：
    python -m scripts.run_deepseek_rag_chat_client
"""

import os
import sys
from typing import List

# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

# 导入必要的模块
from langchain.schema import HumanMessage, BaseMessage
from loguru import logger

from ai_trpg.deepseek import (
    create_rag_workflow,
    execute_rag_workflow,
    create_deepseek_llm,
)
from ai_trpg.rag.chroma_game_retriever import ChromaGameDocumentRetriever


async def main() -> None:

    try:

        # 初始化：聊天历史、LLM实例和检索器实例
        chat_history: List[BaseMessage] = []
        llm_instance = create_deepseek_llm()
        retriever_instance = ChromaGameDocumentRetriever()

        # 步骤4: 开始交互循环
        while True:
            try:
                print("\n" + "=" * 60)
                user_input = input("User: ")

                if user_input.lower() in ["/quit", "/exit", "/q"]:
                    print("Goodbye!")
                    break

                # 执行RAG流程
                rag_response = await execute_rag_workflow(
                    work_flow=create_rag_workflow(),
                    context=chat_history,
                    request=HumanMessage(content=user_input),
                    llm=llm_instance,
                    document_retriever=retriever_instance,
                )

                # 更新聊天历史
                chat_history.append(HumanMessage(content=user_input))
                chat_history.extend(rag_response)

                # 显示最新的AI回复
                if rag_response:
                    latest_response = rag_response[-1]
                    print(f"\nDeepSeek: {latest_response.content}")
                    logger.success(f"✅ RAG回答: {latest_response.content}")

                logger.debug("=" * 60)

            except KeyboardInterrupt:
                logger.info("🛑 [MAIN] 用户中断程序")
                break
            except Exception as e:
                logger.error(
                    f"❌ RAG流程处理错误: {e}\n" f"Traceback: {sys.exc_info()}"
                )
                print("抱歉，处理您的请求时发生错误，请重试。")

    except Exception as e:
        logger.error(f"❌ [MAIN] 系统启动失败: {e}")
        print("系统启动失败，请检查环境配置。")

    finally:
        logger.info("🔒 [MAIN] 清理系统资源...")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
