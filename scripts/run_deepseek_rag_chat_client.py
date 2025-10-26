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

from magic_book.deepseek import (
    RAGState,
    create_rag_workflow,
    execute_rag_workflow,
    create_deepseek_llm,
    DocumentRetriever,
)
from typing import List


############################################################################################################
# Mock 文档检索器实现（用于测试）
############################################################################################################
class MockDocumentRetriever(DocumentRetriever):
    """
    Mock 文档检索器实现

    用于测试 RAG 工作流，返回预定义的模拟文档和相似度分数。
    在真实场景中，应该使用 ChromaDBRetriever 或其他实际的检索器实现。
    """

    def retrieve_documents(
        self, user_query: str, top_k: int, min_similarity: float
    ) -> tuple[List[str], List[float]]:
        """
        返回 Mock 检索数据（用于测试 RAG 流程）

        Args:
            user_query: 用户查询文本
            top_k: 返回的最大文档数量
            min_similarity: 最小相似度阈值

        Returns:
            (检索文档列表, 相似度分数列表)
        """

        assert top_k > 0, "top_k 必须大于0"
        assert 0.0 <= min_similarity <= 1.0, "min_similarity 必须在0.0到1.0之间"

        logger.info("🎭 [MOCK] 使用 MockDocumentRetriever 模拟检索")
        logger.info(f"🎭 [MOCK] 查询: {user_query}")

        # 模拟检索到的文档（按相似度降序排列）
        mock_docs = [
            "RAG（Retrieval-Augmented Generation）是一种结合检索和生成的AI技术，通过从知识库检索相关信息来增强大语言模型的回答质量。",
            "RAG系统通常包含三个核心组件：文档检索器（使用向量数据库如ChromaDB）、上下文增强器和语言模型生成器。",
            "使用RAG技术可以让AI模型访问最新的、领域特定的知识，而无需重新训练模型，显著提升回答的准确性和时效性。",
            "向量数据库（如ChromaDB、Pinecone）在RAG系统中扮演关键角色，它们使用嵌入模型将文本转换为向量并进行语义搜索。",
            "LangGraph是一个用于构建有状态、多参与者AI应用的框架，非常适合实现复杂的RAG工作流。",
        ]

        # 模拟相似度分数（降序排列，模拟真实检索结果）
        mock_scores = [0.89, 0.76, 0.68, 0.52, 0.41]

        logger.info(f"🎭 [MOCK] 返回 {len(mock_docs)} 个模拟文档")
        for i, (doc, score) in enumerate(zip(mock_docs, mock_scores), 1):
            logger.debug(f"🎭 [MOCK] [{i}] 相似度: {score:.3f}, 内容: {doc[:50]}...")

        return mock_docs, mock_scores


def main() -> None:

    try:

        # 步骤1: 创建 Mock 文档检索器（测试用）
        mock_retriever = MockDocumentRetriever()
        logger.info("📚 [MAIN] Mock文档检索器创建完成")

        # 步骤2: 创建RAG状态图
        rag_compiled_graph = create_rag_workflow()

        # 步骤3: 初始化聊天历史
        llm = create_deepseek_llm()
        chat_history_state: RAGState = {
            "messages": [],
            "llm": llm,
            "document_retriever": mock_retriever,  # 注入检索器
        }

        # 步骤4: 开始交互循环
        while True:
            try:
                print("\n" + "=" * 60)
                user_input = input("User: ")

                if user_input.lower() in ["/quit", "/exit", "/q"]:
                    print("Goodbye!")
                    break

                # 用户输入
                user_input_state: RAGState = {
                    "messages": [HumanMessage(content=user_input)],
                    "llm": llm,  # 使用同一个LLM实例
                    "document_retriever": mock_retriever,  # 注入检索器
                }

                # 执行RAG流程
                update_messages = execute_rag_workflow(
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
