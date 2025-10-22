"""
SentenceTransformer 模型加载工具模块

提供统一的模型加载接口，优先使用本地缓存，支持离线使用。
"""

from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional, Union
from loguru import logger
from .config import SENTENCE_TRANSFORMERS_CACHE

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer  # noqa: F401


# def find_project_root() -> Path:
#     """通过寻找项目标志文件来确定项目根目录"""
#     current = Path(__file__).resolve()

#     # 寻找包含这些标志文件的目录
#     markers = ["pyproject.toml", "Makefile", ".git", "README.md"]

#     for parent in [current] + list(current.parents):
#         if any((parent / marker).exists() for marker in markers):
#             return parent

#     # 如果找不到，回退到当前工作目录
#     return Path.cwd()


class ModelLoader:
    """统一的模型加载器"""

    def __init__(self, cache_dir: Optional[Path] = None):
        """
        初始化模型加载器

        Args:
            cache_dir: 模型缓存目录
        """
        # self.project_root = find_project_root()

        if cache_dir is None:
            self.cache_dir = SENTENCE_TRANSFORMERS_CACHE  # self.project_root / ".cache" / "sentence_transformers"
        else:
            self.cache_dir = Path(cache_dir)

        # 创建缓存目录
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def load_model(self, model_name: str, force_online: bool = False) -> Optional[Any]:
        """
        加载 SentenceTransformer 模型

        Args:
            model_name: 模型名称
            force_online: 是否强制从网络加载

        Returns:
            SentenceTransformer 模型实例
        """
        try:
            from sentence_transformers import SentenceTransformer

            # 检查本地缓存
            if not force_online:
                model_cache_path = self.cache_dir / model_name
                if model_cache_path.exists():
                    logger.info(f"从本地缓存加载模型: {model_name}")
                    return SentenceTransformer(str(model_cache_path))

            # 直接从 Hugging Face 加载
            logger.info(f"从网络加载模型: {model_name}")
            model = SentenceTransformer(model_name, cache_folder=str(self.cache_dir))
            return model

        except Exception as e:
            logger.error(f"加载模型失败 {model_name}: {e}")
            return None

    def is_model_cached(self, model_name: str) -> bool:
        """检查模型是否已缓存"""
        model_cache_path = self.cache_dir / model_name
        return model_cache_path.exists()

    def get_model_cache_path(self, model_name: str) -> Optional[Path]:
        """获取模型缓存路径"""
        model_cache_path = self.cache_dir / model_name
        return model_cache_path if model_cache_path.exists() else None


def load_sentence_transformer(
    model_name: str,
    force_online: bool = False,
    cache_dir: Optional[Union[str, Path]] = None,
) -> Optional[Any]:
    """
    便捷函数：加载 SentenceTransformer 模型

    Args:
        model_name: 模型名称
        force_online: 是否强制从网络加载
        cache_dir: 自定义缓存目录

    Returns:
        SentenceTransformer 模型实例

    Examples:
        >>> # 加载多语言模型（优先使用本地缓存）
        >>> model = load_sentence_transformer("paraphrase-multilingual-MiniLM-L12-v2")

        >>> # 强制从网络加载
        >>> model = load_sentence_transformer("all-MiniLM-L6-v2", force_online=True)
    """
    if cache_dir:
        loader = ModelLoader(Path(cache_dir))
    else:
        loader = ModelLoader()

    return loader.load_model(model_name, force_online)


def is_model_cached(
    model_name: str, cache_dir: Optional[Union[str, Path]] = None
) -> bool:
    """
    检查模型是否已缓存

    Args:
        model_name: 模型名称
        cache_dir: 自定义缓存目录

    Returns:
        是否已缓存
    """
    if cache_dir:
        loader = ModelLoader(Path(cache_dir))
    else:
        loader = ModelLoader()

    return loader.is_model_cached(model_name)


# 项目常用模型的便捷加载函数
def load_basic_model(force_online: bool = False) -> Optional[Any]:
    """加载基础英文模型 (all-MiniLM-L6-v2)"""
    return load_sentence_transformer("all-MiniLM-L6-v2", force_online)


def load_multilingual_model(force_online: bool = False) -> Optional[Any]:
    """加载多语言模型 (paraphrase-multilingual-MiniLM-L12-v2)"""
    return load_sentence_transformer(
        "paraphrase-multilingual-MiniLM-L12-v2", force_online
    )


# if __name__ == "__main__":
#     # 测试模块功能
#     print("🧪 测试模型加载工具...")

#     loader = ModelLoader()

#     print(f"缓存目录: {loader.cache_dir}")

#     # 检查模型缓存状态
#     models_to_check = ["all-MiniLM-L6-v2", "paraphrase-multilingual-MiniLM-L12-v2"]

#     for model_name in models_to_check:
#         cached = is_model_cached(model_name)
#         status = "✅ 已缓存" if cached else "❌ 未缓存"
#         print(f"{model_name}: {status}")

#     print("\n💡 使用 scripts/download_sentence_transformers_models.py 来下载模型")
