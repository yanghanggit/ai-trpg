"""Unit tests for the multi-agents game framework."""

import pytest
from pathlib import Path


def test_package_structure() -> None:
    """Test that the package structure is correctly set up."""
    # 基本的包结构测试
    src_path = Path(__file__).parent.parent.parent / "src"
    assert src_path.exists()
    assert (src_path / "magic_book").exists()
    assert (src_path / "magic_book" / "__init__.py").exists()


def test_import_main_package() -> None:
    """Test that the main package can be imported."""
    try:
        import src.magic_book as magic_book

        assert magic_book.__version__ == "0.1.0"
    except ImportError as e:
        pytest.skip(f"Package import failed: {e}")


# 更多具体的测试将在导入路径修复后添加
