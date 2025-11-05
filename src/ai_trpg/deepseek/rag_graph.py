"""
RAG (Retrieval-Augmented Generation) 工作流实现

本模块实现了基于 LangGraph 的 RAG 检索增强生成工作流，用于结合知识库检索和
大语言模型生成来提供更准确、更有依据的 AI 回答。

═══════════════════════════════════════════════════════════════════════════════
📊 RAG WORKFLOW 流程图
═══════════════════════════════════════════════════════════════════════════════

工作流程：
    [START] → retrieval → enhancement → llm → [END]

节点说明：
    - retrieval (_retrieval_node): 向量检索节点，获取相关文档
    - enhancement (_context_enhancement_node): 上下文增强节点，构建增强提示词
    - llm (_rag_llm_node): LLM生成节点，生成最终响应


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

- execute_rag_workflow(workflow, context, request, llm, retriever, ...) -> List[BaseMessage]
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
    messages: Annotated[List[BaseMessage], add_messages]
    llm: Optional[ChatDeepSeek]  # DeepSeek LLM实例，整个RAG流程共享
    document_retriever: Optional[DocumentRetriever]  # 文档检索器实例，支持依赖注入
    retrieved_docs: List[str]  # 检索到的文档
    enhanced_context: str  # 增强后的上下文
    similarity_scores: List[float]  # 相似度分数（用于调试和分析）
    min_similarity_threshold: float  # 相似度阈值（低于此值的文档将被过滤）
    top_k_documents: int  # 检索文档数量


############################################################################################################
def _extract_user_query(state: RAGState) -> str:
    """从消息列表中提取用户查询

    Args:
        state: RAG状态对象

    Returns:
        用户查询字符串，如果无法提取则返回空字符串
    """
    if state.get("messages"):
        last_message = state["messages"][-1]
        if isinstance(last_message, HumanMessage):
            content = last_message.content
            return content if isinstance(content, str) else str(content)
    return ""


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
        - retrieved_docs: 检索到的文档列表
        - similarity_scores: 对应的相似度分数列表

    Note:
        通过依赖注入的 DocumentRetriever 进行检索（支持 ChromaDBRetriever 或 MockDocumentRetriever）
    """
    try:
        logger.info("🔍 [RETRIEVAL] 开始向量语义检索...")

        # 从消息列表中提取用户查询
        user_query = _extract_user_query(state)
        logger.info(f"🔍 [RETRIEVAL] 用户查询: {user_query}")

        # 从状态中获取配置值，如果没有则使用默认值
        min_threshold = state.get("min_similarity_threshold", DEFAULT_SIMILARITY_SCORE)
        top_k = state.get("top_k_documents", DEFAULT_RETRIEVAL_LIMIT)

        logger.info(
            f"🔍 [RETRIEVAL] 使用配置 - 相似度阈值: {min_threshold}, Top-K: {top_k}"
        )

        # 获取文档检索器实例（严格检查，必须提供）
        document_retriever = state.get("document_retriever")
        if document_retriever is None:
            error_msg = (
                "🔍 [RETRIEVAL] 严重错误: 未提供 DocumentRetriever 实例！\n"
                "RAG 工作流必须注入 DocumentRetriever 实例才能运行。\n"
                "请在调用 execute_rag_workflow 时提供 'document_retriever' 参数。"
            )
            logger.error(error_msg)
            raise ValueError(
                "DocumentRetriever is required but not provided in RAGState. "
                "Please inject a DocumentRetriever instance (e.g., ChromaDBRetriever or MockDocumentRetriever) "
                "when calling execute_rag_workflow."
            )

        # 使用注入的检索器实例
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

        return {
            "retrieved_docs": filtered_docs,
            "similarity_scores": filtered_scores,
        }

    except Exception as e:
        logger.error(f"🔍 [RETRIEVAL] 检索节点错误: {e}\n{traceback.format_exc()}")
        return {
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

        # 从消息列表中提取用户查询
        user_query = _extract_user_query(state)
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

        # 使用 f-string 多行字符串构建增强上下文
        enhanced_context = f"""请基于以下相关信息响应用户:

相关信息 (按相似度排序):
{docs_section}

用户输入: {user_query}

## 响应要求
- 基于上述相关信息给出准确、有帮助的响应
- 对于确定的信息，直接自信地表达
- 对于不确定或信息不足的部分，诚实说明
- 用户的输入可能是问题、指令、对话、信息或行动描述等，请根据上下文灵活处理

## 响应原则
✅ 内容层面：保持你的角色设定和语言风格（基于历史上下文和角色人格）
✅ 格式层面：如果用户在最新输入中明确要求特定格式（如JSON、Markdown、表格等），请严格按照要求输出"""

        logger.info("📝 [ENHANCEMENT] 上下文增强完成")
        logger.debug(f"📝 [ENHANCEMENT] 增强后的上下文:\n{enhanced_context}")

        return {"enhanced_context": enhanced_context}

    except Exception as e:
        logger.error(
            f"📝 [ENHANCEMENT] 上下文增强节点错误: {e}\n{traceback.format_exc()}"
        )
        # 从消息列表中提取用户查询（用于 fallback）
        user_query = _extract_user_query(state)
        fallback_context = f"请响应用户以下输入: {user_query}\n\n注意：由于检索服务暂时不可用，请基于你的知识回答。"
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

        # 创建增强消息
        enhanced_message = HumanMessage(content=enhanced_context)

        # 构建完整消息列表：历史消息（排除最后一条用户消息）+ 增强消息
        history_messages = state.get("messages", [])[:-1]
        full_messages = history_messages + [enhanced_message]

        logger.info("🤖 [LLM] 使用完整对话上下文调用DeepSeek")

        # 调用LLM
        response = llm.invoke(full_messages)
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
async def execute_rag_workflow(
    work_flow: CompiledStateGraph[RAGState, Any, RAGState, RAGState],
    context: List[BaseMessage],
    request: HumanMessage,
    llm: ChatDeepSeek,
    document_retriever: DocumentRetriever,
    min_similarity_threshold: float = DEFAULT_SIMILARITY_SCORE,
    top_k_documents: int = DEFAULT_RETRIEVAL_LIMIT,
) -> List[BaseMessage]:
    """执行RAG工作流并返回所有响应消息

    将聊天历史和用户输入合并后，通过编译好的状态图进行RAG检索增强处理，
    收集并返回所有生成的消息。RAGState 的创建被封装在函数内部。

    Args:
        work_flow: 已编译的 LangGraph 状态图
        context: 历史消息列表
        request: 用户当前输入的消息
        llm: ChatDeepSeek LLM 实例
        document_retriever: 文档检索器实例
        min_similarity_threshold: 相似度阈值（默认使用全局配置 MIN_SIMILARITY_THRESHOLD）
        top_k_documents: 检索文档数量（默认使用全局配置 TOP_K_DOCUMENTS）

    Returns:
        包含所有生成消息的列表

    Raises:
        任何在RAG流程中发生的异常都会向上传播，由调用方处理
    """
    logger.info("🚀 开始执行RAG流程...")

    # 在内部构造 RAGState（封装实现细节）
    rag_state: RAGState = {
        "messages": context + [request],
        "retrieved_docs": [],
        "enhanced_context": "",
        "similarity_scores": [],
        "llm": llm,
        "document_retriever": document_retriever,
        "min_similarity_threshold": min_similarity_threshold,
        "top_k_documents": top_k_documents,
    }

    logger.info(f"🚀 RAG输入状态准备完成，用户查询: {request.content}")

    # 执行RAG流程
    ret: List[BaseMessage] = []
    async for event in work_flow.astream(rag_state):
        logger.debug(f"🚀 RAG流程事件: {list(event.keys())}")
        for node_name, node_output in event.items():
            if "messages" in node_output:
                ret.extend(node_output["messages"])
                logger.info(
                    f"🚀 节点 [{node_name}] 输出消息数量: {len(node_output['messages'])}"
                )

    logger.success("🚀 RAG流程执行完成")
    return ret


############################################################################################################
