"""Tests for openharness.agent.permissions."""

import pytest

from openharness.agent.permissions import PermissionGate
from openharness.core.types import RiskLevel
from openharness.tools.base import ToolContext
from openharness.tools.bash import BashTool
from openharness.tools.file_read import FileReadTool


@pytest.fixture
def ctx(tmp_path):
    return ToolContext(working_dir=tmp_path)


class TestPermissionGate:
    @pytest.mark.asyncio
    async def test_trust_mode_allows_all(self, ctx):
        gate = PermissionGate(mode="trust")
        result = await gate.check(BashTool(), {"command": "rm -rf /"}, ctx)
        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_deny_mode_blocks_non_low_readonly(self, ctx):
        gate = PermissionGate(mode="deny")
        result = await gate.check(BashTool(), {"command": "echo hi"}, ctx)
        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_deny_mode_allows_low_readonly(self, ctx):
        gate = PermissionGate(mode="deny")
        result = await gate.check(FileReadTool(), {"file_path": "x"}, ctx)
        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_ask_mode_low_readonly_auto_approved(self, ctx):
        gate = PermissionGate(mode="ask")
        result = await gate.check(FileReadTool(), {"file_path": "x"}, ctx)
        assert result.allowed is True
        assert "auto" in result.reason

    @pytest.mark.asyncio
    async def test_ask_mode_high_risk_calls_callback(self, ctx):
        async def fake_ask(name, desc, args):
            return True

        gate = PermissionGate(mode="ask", ask_user=fake_ask)
        result = await gate.check(BashTool(), {"command": "echo hi"}, ctx)
        assert result.allowed is True
        assert result.reason == "user-approved"

    @pytest.mark.asyncio
    async def test_ask_mode_high_risk_no_callback_denied(self, ctx):
        gate = PermissionGate(mode="ask", ask_user=None)
        result = await gate.check(BashTool(), {"command": "echo hi"}, ctx)
        assert result.allowed is False
        assert "no-approval" in result.reason
