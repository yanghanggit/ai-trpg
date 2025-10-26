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

# 将 src 目录添加到模块搜索路径
sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
)

# 导入必要的模块
from langchain.schema import HumanMessage
from loguru import logger

from magic_book.deepseek.rag_graph import (
    State,
    create_rag_compiled_graph,
    stream_rag_graph_updates,
)
from magic_book.deepseek.client import create_deepseek_llm

def main() -> None:
   
    try:

        # 步骤2: 创建RAG状态图
        rag_compiled_graph = create_rag_compiled_graph()

        # 步骤3: 初始化聊天历史
        

        llm = create_deepseek_llm()
        chat_history_state: State = {"messages": [], "llm": llm}



        # 步骤4: 开始交互循环
        while True:
            try:
                print("\n" + "=" * 60)
                user_input = input("User: ")

                if user_input.lower() in ["/quit", "/exit", "/q"]:
                    print("Goodbye!")
                    break

                # 用户输入
                user_input_state: State = {
                    "messages": [HumanMessage(content=user_input)],
                    "llm": llm,  # 使用同一个LLM实例
                }

                # 执行RAG流程
                update_messages = stream_rag_graph_updates(
                    rag_compiled_graph=rag_compiled_graph,
                    chat_history_state=chat_history_state,
                    user_input_state=user_input_state,
                )

                # 更新聊天历史
                chat_history_state["messages"].extend(user_input_state["messages"])
                chat_history_state["messages"].extend(update_messages)

                # 显示最新的AI回复
                if update_messages:
                    latest_response = update_messages[-1]
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
    main()
