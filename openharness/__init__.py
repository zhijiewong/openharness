"""OpenHarness — Open-source agent harness framework.

Public API:
    from openharness import AgentLoop, PermissionGate
    from openharness import BaseTool, BaseProvider
    from openharness import Message, ToolCall, ToolResult, ToolSpec
"""

__version__ = "0.1.0"

from openharness.agent.loop import AgentLoop
from openharness.agent.permissions import PermissionGate
from openharness.core.config import AgentConfig, ProviderConfig
from openharness.core.events import (
    CostUpdate,
    ErrorEvent,
    Event,
    TextDelta,
    ToolCallEnd,
    ToolCallStart,
    TurnComplete,
)
from openharness.core.session import Session
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
from openharness.providers.base import BaseProvider
from openharness.tools.base import BaseTool, ToolContext
from openharness.tools.registry import ToolRegistry

__all__ = [
    "__version__",
    "AgentConfig",
    "AgentLoop",
    "BaseProvider",
    "BaseTool",
    "CostUpdate",
    "ErrorEvent",
    "Event",
    "Message",
    "ModelInfo",
    "PermissionGate",
    "PermissionResult",
    "ProviderConfig",
    "RiskLevel",
    "Role",
    "Session",
    "TextDelta",
    "ToolCall",
    "ToolCallEnd",
    "ToolCallStart",
    "ToolContext",
    "ToolRegistry",
    "ToolResult",
    "ToolSpec",
    "TurnComplete",
]
