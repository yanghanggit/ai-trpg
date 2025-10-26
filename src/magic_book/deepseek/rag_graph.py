from dotenv import load_dotenv


# 加载 .env 文件中的环境变量
load_dotenv()

import traceback
from typing import Annotated, Any, Dict, List, Optional

from langchain.schema import AIMessage, HumanMessage
from langchain_core.messages import BaseMessage
from langchain_deepseek import ChatDeepSeek
from langgraph.graph import StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict
from loguru import logger


############################################################################################################
# 配置常量
############################################################################################################
# 相似度阈值（低于此值的文档将被过滤）
MIN_SIMILARITY_THRESHOLD = 0.3

# 检索文档数量（预留给后续真实检索使用）
TOP_K_DOCUMENTS = 5


############################################################################################################
def _get_mock_retrieval_data(user_query: str) -> tuple[List[str], List[float]]:
    """
    生成 Mock 检索数据（用于测试RAG流程）

    Args:
        user_query: 用户查询文本

    Returns:
        (检索文档列表, 相似度分数列表)

    Note:
        这是临时测试函数，后续会接入真实的ChromaDB检索
    """
    logger.info("🎭 [MOCK] 使用Mock数据模拟检索")

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


############################################################################################################
class State(TypedDict, total=False):
    messages: Annotated[List[BaseMessage], add_messages]
    llm: Optional[ChatDeepSeek]  # DeepSeek LLM实例，整个流程共享


############################################################################################################
class RAGState(TypedDict, total=False):
    messages: Annotated[List[BaseMessage], add_messages]
    llm: Optional[ChatDeepSeek]  # DeepSeek LLM实例，整个RAG流程共享
    user_query: str  # 用户原始查询
    retrieved_docs: List[str]  # 检索到的文档
    enhanced_context: str  # 增强后的上下文
    similarity_scores: List[float]  # 相似度分数（用于调试和分析）


############################################################################################################
############################################################################################################
############################################################################################################
def retrieval_node(state: RAGState) -> Dict[str, Any]:
    """
    向量检索节点

    功能：
    1. 使用 Mock 数据进行测试检索
    2. 相似度过滤和排序
    3. 完整的错误处理和日志记录

    Args:
        state: RAG状态对象

    Returns:
        包含检索结果的字典：
        - user_query: 用户查询
        - retrieved_docs: 检索到的文档列表
        - similarity_scores: 对应的相似度分数列表

    Note:
        当前使用 Mock 数据，后续会接入真实的 ChromaDB 检索
    """
    try:
        logger.info("🔍 [RETRIEVAL] 开始向量语义检索...")
        logger.info("🔍 [RETRIEVAL] 检索模式: Mock测试模式")

        # 提取用户查询
        user_query = state.get("user_query", "")
        if not user_query:
            # 从最新消息中提取查询
            if state["messages"]:
                last_message = state["messages"][-1]
                if isinstance(last_message, HumanMessage):
                    content = last_message.content
                    user_query = content if isinstance(content, str) else str(content)

        logger.info(f"🔍 [RETRIEVAL] 用户查询: {user_query}")

        # 使用 Mock 数据进行检索
        retrieved_docs, similarity_scores = _get_mock_retrieval_data(user_query)

        # 过滤低相似度结果
        filtered_docs = []
        filtered_scores = []

        for doc, score in zip(retrieved_docs, similarity_scores):
            if score >= MIN_SIMILARITY_THRESHOLD:
                filtered_docs.append(doc)
                filtered_scores.append(score)

        # 如果过滤后没有文档，至少保留最高分的文档
        if not filtered_docs and retrieved_docs:
            filtered_docs = [retrieved_docs[0]]
            filtered_scores = [similarity_scores[0]]
            logger.info(
                f"🔍 [RETRIEVAL] 所有结果低于阈值({MIN_SIMILARITY_THRESHOLD})，"
                f"保留最高分文档 (相似度: {similarity_scores[0]:.3f})"
            )

        logger.success(f"🔍 [RETRIEVAL] 检索完成，共返回 {len(filtered_docs)} 个文档")

        # 记录详细信息
        for i, (doc, score) in enumerate(zip(filtered_docs, filtered_scores), 1):
            logger.info(f"  📄 [{i}] 相似度: {score:.3f}, 内容: {doc[:60]}...")

        return {
            "user_query": user_query,
            "retrieved_docs": filtered_docs,
            "similarity_scores": filtered_scores,
        }

    except Exception as e:
        logger.error(f"🔍 [RETRIEVAL] 检索节点错误: {e}\n{traceback.format_exc()}")
        return {
            "user_query": state.get("user_query", ""),
            "retrieved_docs": ["检索过程中发生错误，将使用默认回复。"],
            "similarity_scores": [0.0],
        }


############################################################################################################
def context_enhancement_node(state: RAGState) -> Dict[str, Any]:
    """
    上下文增强节点（支持相似度信息）

    功能增强：
    1. 保持原有的上下文构建逻辑
    2. 添加相似度分数信息到上下文中
    3. 提供更丰富的检索质量信息
    4. 为LLM提供更好的参考依据
    """
    try:
        logger.info("📝 [ENHANCEMENT] 开始增强上下文...")

        user_query = state.get("user_query", "")
        retrieved_docs = state.get("retrieved_docs", [])
        similarity_scores = state.get("similarity_scores", [])

        logger.info(f"📝 [ENHANCEMENT] 处理查询: {user_query}")
        logger.info(f"📝 [ENHANCEMENT] 检索到的文档数量: {len(retrieved_docs)}")

        if similarity_scores:
            avg_similarity = sum(similarity_scores) / len(similarity_scores)
            max_similarity = max(similarity_scores)
            logger.info(
                f"📝 [ENHANCEMENT] 平均相似度: {avg_similarity:.3f}, 最高相似度: {max_similarity:.3f}"
            )

        # 构建增强的上下文prompt
        context_parts = [
            "请基于以下相关信息回复用户:",
            "",
            "相关信息 (按相似度排序):",
        ]

        # 将文档和相似度分数配对，并按相似度排序
        if similarity_scores and len(similarity_scores) == len(retrieved_docs):
            doc_score_pairs = list(zip(retrieved_docs, similarity_scores))
            # 按相似度降序排序
            doc_score_pairs.sort(key=lambda x: x[1], reverse=True)

            for i, (doc, score) in enumerate(doc_score_pairs, 1):
                # 添加相似度信息到上下文中（帮助LLM理解检索质量）
                context_parts.append(f"{i}. [相似度: {score:.3f}] {doc}")
        else:
            # 回退到原来的格式（没有相似度信息）
            for i, doc in enumerate(retrieved_docs, 1):
                context_parts.append(f"{i}. {doc}")

        context_parts.extend(
            [
                "",
                f"用户问题: {user_query}",
                "",
                "请基于上述信息给出准确、有帮助的回答:",
                "- 优先使用相似度较高的信息",
                "- 如果相似度较低，请适当提醒用户",
                "- 保持回答的准确性和相关性",
            ]
        )

        enhanced_context = "\n".join(context_parts)

        logger.info("📝 [ENHANCEMENT] 上下文增强完成")
        logger.debug(f"📝 [ENHANCEMENT] 增强后的上下文:\n{enhanced_context}")

        return {"enhanced_context": enhanced_context}

    except Exception as e:
        logger.error(
            f"📝 [ENHANCEMENT] 上下文增强节点错误: {e}\n{traceback.format_exc()}"
        )
        fallback_context = f"请回答以下问题: {state.get('user_query', '')}"
        return {"enhanced_context": fallback_context}


############################################################################################################
def rag_llm_node(state: RAGState) -> Dict[str, List[BaseMessage]]:
    """RAG版本的LLM节点"""
    try:
        logger.info("🤖 [LLM] 开始生成回答...")

        # 使用状态中的 DeepSeek LLM 实例
        llm = state["llm"]
        assert llm is not None, "LLM instance is None in state"

        # 使用增强的上下文替换原始消息
        enhanced_context = state.get("enhanced_context", "")
        if enhanced_context:
            enhanced_message = HumanMessage(content=enhanced_context)
            logger.info("🤖 [LLM] 使用增强上下文调用DeepSeek")
        else:
            # 回退到原始消息，确保转换为HumanMessage
            if state["messages"]:
                last_msg = state["messages"][-1]
                if isinstance(last_msg, HumanMessage):
                    enhanced_message = last_msg
                else:
                    # 将其他类型的消息转换为HumanMessage
                    content = (
                        last_msg.content
                        if isinstance(last_msg.content, str)
                        else str(last_msg.content)
                    )
                    enhanced_message = HumanMessage(content=content)
            else:
                enhanced_message = HumanMessage(content="Hello")
            logger.warning("🤖 [LLM] 增强上下文为空，使用原始消息")

        # 调用LLM
        response = llm.invoke([enhanced_message])
        logger.success("🤖 [LLM] DeepSeek回答生成完成")

        return {"messages": [response]}

    except Exception as e:
        logger.error(f"🤖 [LLM] LLM节点错误: {e}\n{traceback.format_exc()}")
        error_response = AIMessage(content="抱歉，生成回答时发生错误，请稍后重试。")
        return {"messages": [error_response]}


############################################################################################################
def create_rag_compiled_graph() -> (
    CompiledStateGraph[RAGState, Any, RAGState, RAGState]
):
    """创建RAG测试版本的状态图"""
    logger.info("🏗️ 构建RAG状态图...")

    try:
        # 创建状态图
        graph_builder = StateGraph(RAGState)

        # 添加三个节点
        graph_builder.add_node("retrieval", retrieval_node)
        graph_builder.add_node("enhancement", context_enhancement_node)
        graph_builder.add_node("llm", rag_llm_node)

        # 设置节点流程: retrieval → enhancement → llm
        graph_builder.add_edge("retrieval", "enhancement")
        graph_builder.add_edge("enhancement", "llm")

        # 设置入口和出口点
        graph_builder.set_entry_point("retrieval")
        graph_builder.set_finish_point("llm")

        compiled_graph = graph_builder.compile()
        logger.success("🏗️ RAG状态图构建完成")

        # 明确类型转换以满足mypy要求
        return compiled_graph  # type: ignore[return-value]

    except Exception as e:
        logger.error(f"🏗️ 构建RAG状态图失败: {e}\n{traceback.format_exc()}")
        raise


############################################################################################################
def stream_rag_graph_updates(
    rag_compiled_graph: CompiledStateGraph[RAGState, Any, RAGState, RAGState],
    chat_history_state: State,
    user_input_state: State,
) -> List[BaseMessage]:
    """执行RAG状态图并返回结果"""

    ret: List[BaseMessage] = []

    try:
        logger.info("🚀 开始执行RAG流程...")

        # 创建 DeepSeek LLM 实例
        from .client import create_deepseek_llm

        llm = create_deepseek_llm()
        logger.info("🚀 创建 DeepSeek LLM 实例完成")

        # 准备RAG状态
        user_message = (
            user_input_state["messages"][-1] if user_input_state["messages"] else None
        )
        user_query = ""
        if user_message:
            content = user_message.content
            user_query = content if isinstance(content, str) else str(content)

        rag_state: RAGState = {
            "messages": chat_history_state["messages"] + user_input_state["messages"],
            "user_query": user_query,
            "retrieved_docs": [],
            "enhanced_context": "",
            "similarity_scores": [],  # 添加相似度分数字段
            "llm": llm,  # 添加LLM实例到状态中
        }

        logger.info(f"🚀 RAG输入状态准备完成，用户查询: {user_query}")

        # 执行RAG流程
        for event in rag_compiled_graph.stream(rag_state):
            logger.debug(f"🚀 RAG流程事件: {list(event.keys())}")
            for node_name, node_output in event.items():
                if "messages" in node_output:
                    ret.extend(node_output["messages"])
                    logger.info(
                        f"🚀 节点 [{node_name}] 输出消息数量: {len(node_output['messages'])}"
                    )

        logger.success("🚀 RAG流程执行完成")

    except Exception as e:
        logger.error(f"🚀 RAG流程执行错误: {e}\n{traceback.format_exc()}")
        error_response = AIMessage(content="RAG流程执行时发生错误，请稍后重试。")
        ret = [error_response]

    return ret


# ############################################################################################################
# def main() -> None:
#     pass


# ############################################################################################################
# if __name__ == "__main__":
#     # 提示用户使用专用启动脚本
#     main()
