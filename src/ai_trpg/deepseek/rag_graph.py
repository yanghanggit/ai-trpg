"""
RAG (Retrieval-Augmented Generation) 工作流实现

基于 LangGraph 的 RAG 检索增强生成工作流,结合向量检索和 LLM 生成提供准确回答。

工作流程:
    [START] → retrieval → enhancement → llm → [END]

核心特性:
    - 三阶段处理: 检索 → 上下文增强 → LLM生成
    - 完整消息上下文: messages 保留所有历史对话
    - 外层错误处理: 节点专注业务逻辑,异常由执行层统一处理
    - 响应追踪: llm_response 字段记录最终 AI 响应

主要 API:
    - create_rag_workflow(): 创建并编译工作流状态图
    - execute_rag_workflow(): 执行工作流并返回 AI 响应
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

from .document_retriever import DocumentRetriever


############################################################################################################
# 配置常量
############################################################################################################
# 相似度阈值（低于此值的文档将被过滤）
# 注意：使用 1/(1+distance) 转换公式时，相似度通常在 0.04-0.15 之间
# 因此阈值设置为 0.05 较为合理，可以过滤掉完全不相关的文档
DEFAULT_SIMILARITY_SCORE: Final[float] = 0.05

# 检索文档数量（预留给后续真实检索使用）
DEFAULT_RETRIEVAL_LIMIT: Final[int] = 3


############################################################################################################
class RAGState(TypedDict, total=False):
    """RAG 工作流状态定义

    Attributes:
        messages: 完整消息列表(历史+当前),使用 add_messages 自动合并
        llm: DeepSeek LLM 实例
        document_retriever: 文档检索器实例
        retrieved_docs: 检索到的文档列表
        enhanced_context: 增强后的上下文提示词
        similarity_scores: 文档相似度分数
        similarity_threshold: 相似度过滤阈值
        retrieval_limit: 检索文档数量上限
        llm_response: LLM 生成的响应消息
    """

    messages: Annotated[List[BaseMessage], add_messages]
    llm: ChatDeepSeek
    document_retriever: DocumentRetriever
    retrieved_docs: List[str]
    enhanced_context: str
    similarity_scores: List[float]
    similarity_threshold: float
    retrieval_limit: int
    llm_response: AIMessage


############################################################################################################
def _retrieval_node(state: RAGState) -> RAGState:
    """向量检索节点

    从文档库中检索与用户查询相关的文档,并按相似度过滤和排序。

    Args:
        state: RAG状态对象

    Returns:
        更新后的状态,包含 retrieved_docs 和 similarity_scores
    """
    logger.info("🔍 [RETRIEVAL] 开始向量语义检索...")

    # 提取用户查询
    messages = state.get("messages", [])
    assert len(messages) > 0, "消息列表不能为空"
    if not messages:
        logger.warning("🔍 [RETRIEVAL] 消息列表为空")
        return {
            "messages": [],
            "retrieved_docs": [],
            "similarity_scores": [],
        }

    last_message = messages[-1]
    assert isinstance(
        last_message, HumanMessage
    ), "最后一条消息必须是 HumanMessage 类型"
    user_query = str(last_message.content)
    logger.info(f"🔍 [RETRIEVAL] 用户查询: {user_query}")

    # 从状态中获取配置值，如果没有则使用默认值
    min_threshold = state.get("similarity_threshold", DEFAULT_SIMILARITY_SCORE)
    top_k = state.get("retrieval_limit", DEFAULT_RETRIEVAL_LIMIT)

    logger.info(
        f"🔍 [RETRIEVAL] 使用配置 - 相似度阈值: {min_threshold}, Top-K: {top_k}"
    )

    # 获取文档检索器实例
    document_retriever = state["document_retriever"]
    logger.info(f"🔍 [RETRIEVAL] 使用检索器: {type(document_retriever).__name__}")

    retrieved_docs, similarity_scores = document_retriever.retrieve_documents(
        user_query=user_query, top_k=top_k, min_similarity=min_threshold
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

    # ✅ 保持所有必要字段，确保状态完整传递到下一个节点
    return {
        "messages": state.get("messages", []),
        "llm": state["llm"],
        "document_retriever": state["document_retriever"],
        "similarity_threshold": state.get(
            "similarity_threshold", DEFAULT_SIMILARITY_SCORE
        ),
        "retrieval_limit": state.get("retrieval_limit", DEFAULT_RETRIEVAL_LIMIT),
        "retrieved_docs": filtered_docs,  # 新增字段
        "similarity_scores": filtered_scores,  # 新增字段
    }


############################################################################################################
def _context_enhancement_node(state: RAGState) -> RAGState:
    """上下文增强节点

    将检索到的文档和相似度信息构建为结构化的增强提示词。

    Args:
        state: RAG状态对象

    Returns:
        更新后的状态,包含 enhanced_context
    """
    logger.info("📝 [ENHANCEMENT] 开始增强上下文...")

    # 从消息列表中提取用户查询
    retrieved_docs = state.get("retrieved_docs", [])
    similarity_scores = state.get("similarity_scores", [])

    # 构建文档列表（按相似度排序）
    doc_list_items = []
    if similarity_scores and len(similarity_scores) == len(retrieved_docs):
        # 将文档和相似度分数配对，并按相似度降序排序
        doc_score_pairs = list(zip(retrieved_docs, similarity_scores))
        doc_score_pairs.sort(key=lambda x: x[1], reverse=True)

        for i, (doc, score) in enumerate(doc_score_pairs, 1):
            doc_list_items.append(f"{i}. [相似度: {score:.3f}] {doc}")
    else:
        # 回退到原来的格式（没有相似度信息）
        for i, doc in enumerate(retrieved_docs, 1):
            doc_list_items.append(f"{i}. {doc}")

    docs_section = "\n".join(doc_list_items)

    enhanced_context = f"""# 根据用户输入，查询到以下相关信息：

{docs_section}

## 响应要求

- 基于上述相关信息给出准确、有帮助的响应
- 对于确定的信息，直接自信地表达
- 对于不确定或信息不足的部分，诚实说明
- 用户的输入可能是问题、指令、对话、信息或行动描述等，请根据上下文灵活处理

## 响应原则

✅ 内容层面：保持你的角色设定和语言风格（基于历史上下文和角色人格）
✅ 格式层面：如果用户在最新输入中明确要求特定格式（如JSON、Markdown、表格等），请严格按照要求输出"""

    logger.info("📝 [ENHANCEMENT] 上下文增强完成")

    # ✅ 保持所有必要字段，确保状态完整传递到下一个节点
    return {
        "messages": state.get("messages", []),
        "llm": state["llm"],
        "document_retriever": state["document_retriever"],
        "retrieved_docs": state.get("retrieved_docs", []),
        "similarity_scores": state.get("similarity_scores", []),
        "similarity_threshold": state.get(
            "similarity_threshold", DEFAULT_SIMILARITY_SCORE
        ),
        "retrieval_limit": state.get("retrieval_limit", DEFAULT_RETRIEVAL_LIMIT),
        "enhanced_context": enhanced_context,  # 新增字段
    }


############################################################################################################
def _rag_llm_node(state: RAGState) -> RAGState:
    """LLM 生成节点

    使用完整对话上下文(messages)和增强信息调用 DeepSeek LLM 生成响应。

    Args:
        state: RAG状态对象

    Returns:
        更新后的状态,包含 messages 和 llm_response
    """
    logger.info("🤖 [LLM] 开始生成回答...")

    # 使用状态中的 DeepSeek LLM 实例
    llm = state["llm"]

    # 验证增强上下文
    enhanced_context = state.get("enhanced_context", "")
    if not enhanced_context:
        logger.error("🤖 [LLM] 增强上下文为空，RAG流程异常，无法继续")
        raise ValueError(
            "Enhanced context is empty. RAG workflow failed in context enhancement node."
        )

    # 构建完整消息列表: 保留所有历史消息(messages) + 增强信息
    enhanced_message = HumanMessage(content=enhanced_context)
    full_messages = state.get("messages", []) + [enhanced_message]

    logger.info("🤖 [LLM] 使用完整对话上下文调用DeepSeek")

    # 调用LLM
    response = llm.invoke(full_messages)
    assert isinstance(response, AIMessage), "LLM响应必须是 AIMessage 类型"
    logger.success("🤖 [LLM] DeepSeek回答生成完成")

    # ✅ 保持所有必要字段，确保状态完整传递到终点
    return {
        "messages": [response],  # add_messages 会自动合并
        "llm": llm,
        "document_retriever": state["document_retriever"],
        "retrieved_docs": state.get("retrieved_docs", []),
        "enhanced_context": state.get("enhanced_context", ""),
        "similarity_scores": state.get("similarity_scores", []),
        "similarity_threshold": state.get(
            "similarity_threshold", DEFAULT_SIMILARITY_SCORE
        ),
        "retrieval_limit": state.get("retrieval_limit", DEFAULT_RETRIEVAL_LIMIT),
        "llm_response": response,  # 新增字段
    }


############################################################################################################
def create_rag_workflow() -> CompiledStateGraph[RAGState, Any, RAGState, RAGState]:
    """创建并编译 RAG 工作流状态图"""
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
def print_full_message_chain(state: RAGState) -> None:
    """打印完整消息链路用于调试

    Args:
        state: RAG状态对象
    """
    messages = state.get("messages", [])
    logger.info(f"📜 完整消息链路 (共 {len(messages)} 条消息)")
    for i, msg in enumerate(messages, 0):
        logger.debug(
            f"[{i}] 完整内容:\n{msg.model_dump_json(indent=2, ensure_ascii=False)}\n"
        )


############################################################################################################
async def execute_rag_workflow(
    work_flow: CompiledStateGraph[RAGState, Any, RAGState, RAGState],
    context: List[BaseMessage],
    request: HumanMessage,
    llm: ChatDeepSeek,
    document_retriever: DocumentRetriever,
    similarity_threshold: float = DEFAULT_SIMILARITY_SCORE,
    retrieval_limit: int = DEFAULT_RETRIEVAL_LIMIT,
) -> List[BaseMessage]:
    """执行 RAG 工作流并返回 AI 响应

    将历史消息和用户输入合并为完整上下文,通过 RAG 三阶段流程处理,
    最终返回 LLM 生成的响应消息。

    Args:
        work_flow: 已编译的 LangGraph 状态图
        context: 历史消息列表(完整对话上下文)
        request: 用户当前输入消息
        llm: ChatDeepSeek LLM 实例
        document_retriever: 文档检索器实例
        similarity_threshold: 相似度阈值
        retrieval_limit: 检索文档数量上限

    Returns:
        包含 AI 响应的消息列表,通过 last_state["llm_response"] 获取

    Raises:
        异常会被捕获并记录,由调用方根据返回空列表判断失败
    """
    logger.info("🚀 开始执行RAG流程...")

    # 构造 RAGState: messages 包含完整历史上下文 + 当前请求
    rag_state: RAGState = {
        "messages": context + [request],
        "retrieved_docs": [],
        "enhanced_context": "",
        "similarity_scores": [],
        "llm": llm,
        "document_retriever": document_retriever,
        "similarity_threshold": similarity_threshold,
        "retrieval_limit": retrieval_limit,
    }

    logger.info(f"🚀 RAG输入状态准备完成，用户查询: {request.content}")

    ret: List[BaseMessage] = []

    try:

        last_state: Optional[RAGState] = None

        async for event in work_flow.astream(rag_state):
            for value in event.values():
                last_state = value

        # 从 last_state 中提取 llm_response
        if last_state and "llm_response" in last_state:
            assert isinstance(last_state["llm_response"], AIMessage)
            ret = [last_state["llm_response"]]
            print_full_message_chain(last_state)

    except Exception as e:
        logger.error(f"🚀 RAG流程执行错误: {e}\n{traceback.format_exc()}")

    return ret


############################################################################################################
