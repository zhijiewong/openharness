"""Tests for openharness.tools.file_read."""

import pytest

from openharness.core.types import RiskLevel
from openharness.tools.base import ToolContext
from openharness.tools.file_read import FileReadTool


@pytest.fixture
def tool():
    return FileReadTool()


@pytest.fixture
def ctx(tmp_path):
    return ToolContext(working_dir=tmp_path)


class TestFileReadTool:
    @pytest.mark.asyncio
    async def test_read_existing_file(self, tool, ctx, tmp_path):
        f = tmp_path / "hello.txt"
        f.write_text("line1\nline2\nline3\n", encoding="utf-8")
        result = await tool.execute({"file_path": str(f)}, ctx)
        assert not result.is_error
        assert "line1" in result.output
        assert "line2" in result.output

    @pytest.mark.asyncio
    async def test_read_with_offset_and_limit(self, tool, ctx, tmp_path):
        f = tmp_path / "data.txt"
        f.write_text("\n".join(f"line{i}" for i in range(1, 11)), encoding="utf-8")
        result = await tool.execute({"file_path": str(f), "offset": 3, "limit": 2}, ctx)
        assert not result.is_error
        assert "line3" in result.output
        assert "line4" in result.output
        assert "line5" not in result.output

    @pytest.mark.asyncio
    async def test_read_nonexistent(self, tool, ctx):
        result = await tool.execute({"file_path": "/no/such/file.txt"}, ctx)
        assert result.is_error
        assert "not found" in result.output.lower() or "Error" in result.output

    @pytest.mark.asyncio
    async def test_read_directory(self, tool, ctx, tmp_path):
        result = await tool.execute({"file_path": str(tmp_path)}, ctx)
        assert result.is_error

    def test_is_read_only(self, tool):
        assert tool.is_read_only({}) is True

    def test_risk_level(self, tool):
        assert tool.risk_level == RiskLevel.LOW
