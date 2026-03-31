"""Tests for openharness.tools.bash."""

import pytest

from openharness.core.types import RiskLevel
from openharness.tools.base import ToolContext
from openharness.tools.bash import BashTool


@pytest.fixture
def tool():
    return BashTool()


@pytest.fixture
def ctx(tmp_path):
    return ToolContext(working_dir=tmp_path)


class TestBashTool:
    @pytest.mark.asyncio
    async def test_echo(self, tool, ctx):
        result = await tool.execute({"command": "echo hello"}, ctx)
        assert not result.is_error
        assert "hello" in result.output

    @pytest.mark.asyncio
    async def test_nonzero_exit_code(self, tool, ctx):
        result = await tool.execute({"command": "exit 1"}, ctx)
        assert result.is_error

    @pytest.mark.asyncio
    async def test_empty_command_validation(self, tool, ctx):
        err = await tool.validate_input({"command": ""}, ctx)
        assert err is not None
        assert "empty" in err.lower()

    @pytest.mark.asyncio
    async def test_timeout(self, tool, ctx):
        result = await tool.execute({"command": "sleep 10", "timeout": 1}, ctx)
        assert result.is_error
        assert "timed out" in result.output.lower()

    def test_is_read_only(self, tool):
        assert tool.is_read_only({}) is False

    def test_risk_level(self, tool):
        assert tool.risk_level == RiskLevel.HIGH
