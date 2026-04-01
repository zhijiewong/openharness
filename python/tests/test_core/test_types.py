"""Tests for openharness.core.types."""

import pytest
from dataclasses import FrozenInstanceError

from openharness.core.types import (
    Message,
    ModelInfo,
    PermissionResult,
    RiskLevel,
    Role,
    ToolCall,
    ToolResult,
    ToolSpec,
)


class TestMessage:
    def test_create_user_message(self):
        msg = Message(role=Role.USER, content="hello")
        assert msg.role == Role.USER
        assert msg.content == "hello"
        assert msg.tool_calls == ()
        assert msg.tool_results == ()
        assert msg.uuid

    def test_create_all_roles(self):
        for role in Role:
            msg = Message(role=role, content="x")
            assert msg.role == role

    def test_message_has_timestamp(self):
        msg = Message(role=Role.ASSISTANT, content="hi")
        assert msg.timestamp is not None

    def test_message_is_meta_default_false(self):
        msg = Message(role=Role.SYSTEM, content="sys")
        assert msg.is_meta is False


class TestToolCall:
    def test_create(self):
        tc = ToolCall(id="1", tool_name="Read", arguments={"file_path": "x"})
        assert tc.id == "1"
        assert tc.tool_name == "Read"

    def test_frozen(self):
        tc = ToolCall(id="1", tool_name="Read", arguments={})
        with pytest.raises(FrozenInstanceError):
            tc.id = "2"


class TestToolResult:
    def test_create(self):
        tr = ToolResult(call_id="1", output="ok")
        assert tr.is_error is False

    def test_frozen(self):
        tr = ToolResult(call_id="1", output="ok")
        with pytest.raises(FrozenInstanceError):
            tr.output = "nope"


class TestToolSpec:
    def test_to_api_dict(self):
        spec = ToolSpec(
            name="Read",
            description="Read a file",
            parameters={"type": "object", "properties": {}},
            risk_level=RiskLevel.LOW,
        )
        d = spec.to_api_dict()
        assert d["type"] == "function"
        assert d["function"]["name"] == "Read"
        assert d["function"]["description"] == "Read a file"
        assert d["function"]["parameters"] == {"type": "object", "properties": {}}


class TestModelInfo:
    def test_defaults(self):
        m = ModelInfo(id="gpt-4o", provider="openai")
        assert m.context_window == 8192
        assert m.supports_tools is False
        assert m.supports_streaming is True
        assert m.supports_vision is False
        assert m.input_cost_per_mtok == 0.0
        assert m.output_cost_per_mtok == 0.0


class TestPermissionResult:
    def test_allowed(self):
        pr = PermissionResult(allowed=True, reason="auto-approved", risk_level=RiskLevel.LOW)
        assert pr.allowed is True

    def test_denied(self):
        pr = PermissionResult(allowed=False, reason="denied")
        assert pr.allowed is False
        assert pr.risk_level == RiskLevel.LOW  # default
