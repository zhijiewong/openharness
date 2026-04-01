"""WebFetchTool — fetch URL content with basic HTML stripping."""

from __future__ import annotations

import re
from typing import Any

from openharness.core.types import RiskLevel, ToolResult

from .base import BaseTool, ToolContext

MAX_CONTENT_BYTES = 50_000
TIMEOUT_SECONDS = 30


class WebFetchTool(BaseTool):
    """Fetch a URL and return its text content."""

    @property
    def name(self) -> str:
        return "WebFetch"

    @property
    def description(self) -> str:
        return (
            "Fetch the contents of a URL. Returns the text content, "
            "stripping HTML tags if present. Max 50KB content, 30s timeout."
        )

    @property
    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch.",
                },
                "prompt": {
                    "type": "string",
                    "description": "Optional hint about what information to extract from the page.",
                },
            },
            "required": ["url"],
        }

    @property
    def risk_level(self) -> RiskLevel:
        return RiskLevel.MEDIUM

    def is_read_only(self, arguments: dict[str, Any]) -> bool:
        return True

    def is_concurrency_safe(self, arguments: dict[str, Any]) -> bool:
        return True

    async def validate_input(self, arguments: dict[str, Any], context: ToolContext) -> str | None:
        url = arguments.get("url", "")
        if not url:
            return "URL is required."
        # Scheme check
        if not url.startswith(("http://", "https://")):
            return "Only http:// and https:// URLs are allowed."
        # Block private/internal IPs (SSRF protection)
        from urllib.parse import urlparse
        import ipaddress
        hostname = urlparse(url).hostname or ""
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return f"Access to private/internal address {hostname} is blocked."
        except ValueError:
            # Not an IP literal — check common internal hostnames
            if hostname in ("localhost", "metadata.google.internal"):
                return f"Access to {hostname} is blocked."
            if hostname.endswith(".internal") or hostname.endswith(".local"):
                return f"Access to internal hostname {hostname} is blocked."
        return None

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        url = arguments["url"]
        prompt = arguments.get("prompt", "")

        try:
            import httpx
        except ImportError:
            return ToolResult(
                call_id="",
                output="Error: httpx is not installed. Install it with: pip install httpx",
                is_error=True,
            )

        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=TIMEOUT_SECONDS) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.TimeoutException:
            return ToolResult(
                call_id="",
                output=f"Error: Request timed out after {TIMEOUT_SECONDS}s: {url}",
                is_error=True,
            )
        except httpx.HTTPStatusError as exc:
            return ToolResult(
                call_id="",
                output=f"Error: HTTP {exc.response.status_code} for {url}",
                is_error=True,
            )
        except Exception as exc:
            return ToolResult(call_id="", output=f"Error fetching URL: {exc}", is_error=True)

        content = response.text

        # Basic HTML tag stripping
        content_type = response.headers.get("content-type", "")
        if "html" in content_type or content.strip().startswith("<!") or content.strip().startswith("<html"):
            content = _strip_html(content)

        # Truncate to max size
        if len(content) > MAX_CONTENT_BYTES:
            content = content[:MAX_CONTENT_BYTES] + "\n\n... (truncated to 50KB)"

        # Clean up excessive whitespace
        content = re.sub(r"\n{3,}", "\n\n", content).strip()

        result = f"URL: {url}\n\n{content}"
        if prompt:
            result = f"URL: {url}\nExtraction hint: {prompt}\n\n{content}"

        return ToolResult(call_id="", output=result)


def _strip_html(html: str) -> str:
    """Remove HTML tags and decode common entities for basic readability."""
    # Remove script and style blocks
    text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)

    # Remove all HTML tags
    text = re.sub(r"<[^>]+>", " ", text)

    # Decode common HTML entities
    entities = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
        "&apos;": "'",
        "&nbsp;": " ",
    }
    for entity, char in entities.items():
        text = text.replace(entity, char)

    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()
