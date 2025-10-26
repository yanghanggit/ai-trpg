"""
RAG (Retrieval-Augmented Generation) 工作流实现

本模块实现了基于 LangGraph 的 RAG 检索增强生成工作流，用于结合知识库检索和
大语言模型生成来提供更准确、更有依据的 AI 回答。

═══════════════════════════════════════════════════════════════════════════════
📊 RAG WORKFLOW 流程图
═══════════════════════════════════════════════════════════════════════════════

    ┌─────────────────────────────────────────────────────────────────────┐
    │                         RAG 工作流程                                  │
    └─────────────────────────────────────────────────────────────────────┘

    [START] 用户输入
       │
       ├─> RAGState 初始化
       │   ├─ messages: 历史对话 + 用户输入
       │   ├─ user_query: 提取的用户查询
       │   ├─ llm: DeepSeek LLM 实例
       │   ├─ min_similarity_threshold: 相似度阈值 (默认: 0.3)
       │   └─ top_k_documents: Top-K 文档数量 (默认: 5)
       │
       ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │  NODE 1: retrieval (_retrieval_node)                             │
    │  功能: 向量检索节点                                                │
    │  ─────────────────────────────────────────────────────────────── │
    │  输入: RAGState (user_query, min_similarity_threshold, top_k)    │
    │  处理:                                                            │
    │    1. 从状态中提取用户查询                                         │
    │    2. 调用检索器获取相关文档 (当前使用 Mock 数据)                   │
    │    3. 根据 min_similarity_threshold 过滤低相关度文档               │
    │    4. 限制返回文档数量为 top_k                                     │
    │  输出: {                                                          │
    │    user_query: str,              # 用户查询                       │
    │    retrieved_docs: List[str],    # 检索到的文档                   │
    │    similarity_scores: List[float] # 相似度分数                    │
    │  }                                                                │
    └──────────────────────────────────────────────────────────────────┘
       │
       ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │  NODE 2: enhancement (_context_enhancement_node)                 │
    │  功能: 上下文增强节点                                              │
    │  ─────────────────────────────────────────────────────────────── │
    │  输入: RAGState (user_query, retrieved_docs, similarity_scores)  │
    │  处理:                                                            │
    │    1. 读取检索到的文档和相似度分数                                 │
    │    2. 按相似度对文档进行排序                                       │
    │    3. 构建增强的上下文 Prompt:                                     │
    │       - 包含相似度信息的文档列表                                   │
    │       - 用户原始问题                                              │
    │       - 回答指导原则 (优先使用高相似度信息等)                      │
    │  输出: {                                                          │
    │    enhanced_context: str  # 增强后的上下文 Prompt                 │
    │  }                                                                │
    └──────────────────────────────────────────────────────────────────┘
       │
       ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │  NODE 3: llm (_rag_llm_node)                                     │
    │  功能: LLM 生成节点                                                │
    │  ─────────────────────────────────────────────────────────────── │
    │  输入: RAGState (llm, enhanced_context)                          │
    │  处理:                                                            │
    │    1. 验证 enhanced_context 存在 (不存在则抛出异常)               │
    │    2. 将增强上下文转换为 HumanMessage                             │
    │    3. 调用 DeepSeek LLM 生成回答                                  │
    │  输出: {                                                          │
    │    messages: List[BaseMessage]  # LLM 生成的回答消息              │
    │  }                                                                │
    └──────────────────────────────────────────────────────────────────┘
       │
       ▼
    [END] 返回 AI 回答


═══════════════════════════════════════════════════════════════════════════════
🔧 核心组件说明
═══════════════════════════════════════════════════════════════════════════════

1. RAGState (TypedDict):
   - 整个工作流的状态容器
   - 使用 total=False 允许部分字段更新
   - 节点间通过状态传递数据

2. 节点设计原则:
   - 输入: RAGState
   - 输出: RAGState (部分更新)
   - 职责单一: 每个节点只负责一个明确的任务
   - Fail-fast: 遇到无法处理的情况立即抛出异常

3. 配置参数:
   - min_similarity_threshold: 控制检索质量
   - top_k_documents: 控制检索数量
   - 支持运行时动态配置 (user_input_state 优先级最高)

4. 错误处理:
   - 节点内部: 捕获并记录错误，返回降级数据或抛出异常
   - 执行层: 不捕获异常，由调用方处理

═══════════════════════════════════════════════════════════════════════════════
📦 主要 API
═══════════════════════════════════════════════════════════════════════════════

- create_rag_workflow() -> CompiledStateGraph
    创建并编译 RAG 工作流状态图

- execute_rag_workflow(graph, history, input) -> List[BaseMessage]
    执行 RAG 工作流并返回 AI 回答
    注意: 异常会向上传播，由调用方处理

═══════════════════════════════════════════════════════════════════════════════
"""

from dotenv import load_dotenv


# 加载 .env 文件中的环境变量
load_dotenv()

import traceback
from typing import Annotated, Any, Final, List, Optional
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
MIN_SIMILARITY_THRESHOLD: Final[float] = 0.3

# 检索文档数量（预留给后续真实检索使用）
TOP_K_DOCUMENTS: Final[int] = 5


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
class RAGState(TypedDict, total=False):
    messages: Annotated[List[BaseMessage], add_messages]
    llm: Optional[ChatDeepSeek]  # DeepSeek LLM实例，整个RAG流程共享
    user_query: str  # 用户原始查询
    retrieved_docs: List[str]  # 检索到的文档
    enhanced_context: str  # 增强后的上下文
    similarity_scores: List[float]  # 相似度分数（用于调试和分析）
    min_similarity_threshold: float  # 相似度阈值（低于此值的文档将被过滤）
    top_k_documents: int  # 检索文档数量


############################################################################################################
############################################################################################################
############################################################################################################
def _retrieval_node(state: RAGState) -> RAGState:
    """
    向量检索节点

    功能：
    1. 使用 Mock 数据进行测试检索
    2. 相似度过滤和排序
    3. 完整的错误处理和日志记录

    Args:
        state: RAG状态对象

    Returns:
        更新后的 RAGState，包含：
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

        # 从状态中获取配置值，如果没有则使用默认值
        min_threshold = state.get("min_similarity_threshold", MIN_SIMILARITY_THRESHOLD)
        top_k = state.get("top_k_documents", TOP_K_DOCUMENTS)

        logger.info(
            f"🔍 [RETRIEVAL] 使用配置 - 相似度阈值: {min_threshold}, Top-K: {top_k}"
        )

        # 过滤低相似度结果
        filtered_docs = []
        filtered_scores = []

        for doc, score in zip(retrieved_docs, similarity_scores):
            if score >= min_threshold:
                filtered_docs.append(doc)
                filtered_scores.append(score)

        # 如果过滤后没有文档，至少保留最高分的文档
        if not filtered_docs and retrieved_docs:
            filtered_docs = [retrieved_docs[0]]
            filtered_scores = [similarity_scores[0]]
            logger.info(
                f"🔍 [RETRIEVAL] 所有结果低于阈值({min_threshold})，"
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
def _context_enhancement_node(state: RAGState) -> RAGState:
    """
    上下文增强节点（支持相似度信息）

    功能增强：
    1. 保持原有的上下文构建逻辑
    2. 添加相似度分数信息到上下文中
    3. 提供更丰富的检索质量信息
    4. 为LLM提供更好的参考依据

    Args:
        state: RAG状态对象

    Returns:
        更新后的 RAGState，包含：
        - enhanced_context: 增强后的上下文
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
def _rag_llm_node(state: RAGState) -> RAGState:
    """
    RAG版本的LLM节点

    功能：
    使用增强后的上下文调用 DeepSeek LLM 生成回答

    Args:
        state: RAG状态对象

    Returns:
        更新后的 RAGState，包含：
        - messages: 包含LLM生成的回答消息
    """
    try:
        logger.info("🤖 [LLM] 开始生成回答...")

        # 使用状态中的 DeepSeek LLM 实例
        llm = state["llm"]
        assert llm is not None, "LLM instance is None in state"

        # 使用增强的上下文替换原始消息
        enhanced_context = state.get("enhanced_context", "")
        if not enhanced_context:
            error_msg = "🤖 [LLM] 增强上下文为空，RAG流程异常，无法继续"
            logger.error(error_msg)
            raise ValueError(
                "Enhanced context is empty. RAG workflow failed in context enhancement node."
            )

        enhanced_message = HumanMessage(content=enhanced_context)
        logger.info("🤖 [LLM] 使用增强上下文调用DeepSeek")

        # 调用LLM
        response = llm.invoke([enhanced_message])
        logger.success("🤖 [LLM] DeepSeek回答生成完成")

        return {"messages": [response]}

    except Exception as e:
        logger.error(f"🤖 [LLM] LLM节点错误: {e}\n{traceback.format_exc()}")
        error_response = AIMessage(content="抱歉，生成回答时发生错误，请稍后重试。")
        return {"messages": [error_response]}


############################################################################################################
def create_rag_workflow() -> CompiledStateGraph[RAGState, Any, RAGState, RAGState]:
    """创建RAG测试版本的状态图"""
    # 创建状态图
    graph_builder = StateGraph(RAGState)

    # 添加三个节点
    graph_builder.add_node("retrieval", _retrieval_node)
    graph_builder.add_node("enhancement", _context_enhancement_node)
    graph_builder.add_node("llm", _rag_llm_node)

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


############################################################################################################
def execute_rag_workflow(
    rag_compiled_graph: CompiledStateGraph[RAGState, Any, RAGState, RAGState],
    chat_history_state: RAGState,
    user_input_state: RAGState,
) -> List[BaseMessage]:
    """
    执行RAG状态图并返回结果

    Args:
        rag_compiled_graph: 编译后的RAG状态图
        chat_history_state: 聊天历史状态
        user_input_state: 用户输入状态

    Returns:
        包含LLM回复的消息列表

    Raises:
        任何在RAG流程中发生的异常都会向上传播，由调用方处理
    """
    logger.info("🚀 开始执行RAG流程...")

    # 准备RAG状态
    user_message = (
        user_input_state["messages"][-1] if user_input_state["messages"] else None
    )
    user_query = ""
    if user_message:
        content = user_message.content
        user_query = content if isinstance(content, str) else str(content)

    # 优先使用 user_input_state 中的配置，如果没有则使用 chat_history_state，最后使用默认值
    min_threshold = user_input_state.get(
        "min_similarity_threshold",
        chat_history_state.get("min_similarity_threshold", MIN_SIMILARITY_THRESHOLD),
    )
    top_k = user_input_state.get(
        "top_k_documents",
        chat_history_state.get("top_k_documents", TOP_K_DOCUMENTS),
    )

    rag_state: RAGState = {
        "messages": chat_history_state["messages"] + user_input_state["messages"],
        "user_query": user_query,
        "retrieved_docs": [],
        "enhanced_context": "",
        "similarity_scores": [],
        "llm": user_input_state["llm"],
        "min_similarity_threshold": min_threshold,
        "top_k_documents": top_k,
    }

    logger.info(f"🚀 RAG输入状态准备完成，用户查询: {user_query}")

    # 执行RAG流程
    ret: List[BaseMessage] = []
    for event in rag_compiled_graph.stream(rag_state):
        logger.debug(f"🚀 RAG流程事件: {list(event.keys())}")
        for node_name, node_output in event.items():
            if "messages" in node_output:
                ret.extend(node_output["messages"])
                logger.info(
                    f"🚀 节点 [{node_name}] 输出消息数量: {len(node_output['messages'])}"
                )

    logger.success("🚀 RAG流程执行完成")
    return ret
