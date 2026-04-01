"""Exception hierarchy for OpenHarness."""


class OpenHarnessError(Exception):
    """Base exception for all OpenHarness errors."""


class ProviderError(OpenHarnessError):
    """Error communicating with an LLM provider."""


class ProviderNotFoundError(OpenHarnessError):
    """Requested provider is not registered."""


class ModelNotFoundError(OpenHarnessError):
    """Requested model is not available."""


class ToolError(OpenHarnessError):
    """Error during tool execution."""


class ToolNotFoundError(OpenHarnessError):
    """Requested tool is not registered."""


class PermissionDeniedError(OpenHarnessError):
    """Tool execution was denied by the permission gate."""


class ConfigError(OpenHarnessError):
    """Error loading or parsing configuration."""


class SessionError(OpenHarnessError):
    """Error with session persistence."""


class BudgetExceededError(OpenHarnessError):
    """Session cost has exceeded the configured budget."""
