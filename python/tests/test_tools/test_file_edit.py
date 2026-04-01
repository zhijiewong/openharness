"""Tests for openharness.tools.file_edit."""

import pytest

from openharness.core.types import RiskLevel
from openharness.tools.base import ToolContext
from openharness.tools.file_edit import FileEditTool


@pytest.fixture
def tool():
    return FileEditTool()


@pytest.fixture
def ctx(tmp_path):
    return ToolContext(working_dir=tmp_path)


class TestFileEditTool:
    @pytest.mark.asyncio
    async def test_replace_string(self, tool, ctx, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("hello world", encoding="utf-8")
        result = await tool.execute(
            {"file_path": str(f), "old_string": "hello", "new_string": "goodbye"}, ctx
        )
        assert not result.is_error
        assert f.read_text(encoding="utf-8") == "goodbye world"

    @pytest.mark.asyncio
    async def test_old_string_not_found(self, tool, ctx, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("hello world", encoding="utf-8")
        result = await tool.execute(
            {"file_path": str(f), "old_string": "xyz", "new_string": "abc"}, ctx
        )
        assert result.is_error
        assert "not found" in result.output.lower()

    @pytest.mark.asyncio
    async def test_not_unique_without_replace_all(self, tool, ctx, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("aaa bbb aaa", encoding="utf-8")
        result = await tool.execute(
            {"file_path": str(f), "old_string": "aaa", "new_string": "ccc"}, ctx
        )
        assert result.is_error
        assert "2 times" in result.output

    @pytest.mark.asyncio
    async def test_replace_all(self, tool, ctx, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("aaa bbb aaa", encoding="utf-8")
        result = await tool.execute(
            {"file_path": str(f), "old_string": "aaa", "new_string": "ccc", "replace_all": True},
            ctx,
        )
        assert not result.is_error
        assert f.read_text(encoding="utf-8") == "ccc bbb ccc"

    def test_is_read_only(self, tool):
        assert tool.is_read_only({}) is False

    def test_risk_level(self, tool):
        assert tool.risk_level == RiskLevel.MEDIUM
