"""MCP client — connects to MCP servers via stdio transport using JSON-RPC 2.0."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from openharness.core.exceptions import OpenHarnessError

from .types import MCPResource, MCPServerConfig, MCPTool, MCPToolResult

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 30.0  # seconds


class MCPError(OpenHarnessError):
    """Error communicating with MCP server."""


class MCPClient:
    """Connect to MCP servers via stdio transport.

    Implements the MCP protocol for tool discovery and execution.
    """

    def __init__(self) -> None:
        self._servers: dict[str, _MCPConnection] = {}

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self, config: MCPServerConfig) -> None:
        """Connect to an MCP server by spawning its process."""
        if config.name in self._servers:
            raise MCPError(f"Already connected to server '{config.name}'")

        env = config.env if config.env else None
        try:
            process = await asyncio.create_subprocess_exec(
                config.command,
                *config.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
        except OSError as exc:
            raise MCPError(f"Failed to spawn MCP server '{config.name}': {exc}") from exc

        conn = _MCPConnection(config, process)
        await conn.start()

        # MCP initialize handshake
        try:
            result = await conn.send_request(
                "initialize",
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "openharness", "version": "0.1.0"},
                },
            )
            logger.info(
                "Connected to MCP server '%s' (protocol %s)",
                config.name,
                result.get("protocolVersion", "unknown"),
            )
            # Send initialized notification (no id, no response expected)
            await conn.send_notification("notifications/initialized")
        except Exception as exc:
            await conn.close()
            raise MCPError(f"Initialize handshake failed for '{config.name}': {exc}") from exc

        self._servers[config.name] = conn

    async def disconnect(self, server_name: str) -> None:
        """Disconnect from a server."""
        conn = self._servers.pop(server_name, None)
        if conn is None:
            raise MCPError(f"Not connected to server '{server_name}'")
        await conn.close()

    async def disconnect_all(self) -> None:
        """Disconnect from all servers."""
        names = list(self._servers.keys())
        for name in names:
            try:
                await self.disconnect(name)
            except MCPError:
                pass

    # ------------------------------------------------------------------
    # Tool operations
    # ------------------------------------------------------------------

    async def list_tools(self, server_name: str | None = None) -> list[MCPTool]:
        """Get tools from connected server(s).

        If *server_name* is ``None``, returns tools from all connected servers.
        """
        if server_name is not None:
            return await self._list_tools_for(server_name)

        tools: list[MCPTool] = []
        for name in self._servers:
            tools.extend(await self._list_tools_for(name))
        return tools

    async def _list_tools_for(self, server_name: str) -> list[MCPTool]:
        conn = self._get_connection(server_name)
        result = await conn.send_request("tools/list")
        return [
            MCPTool(
                name=t["name"],
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
                server_name=server_name,
            )
            for t in result.get("tools", [])
        ]

    async def call_tool(
        self, server_name: str, tool_name: str, arguments: dict[str, Any],
    ) -> MCPToolResult:
        """Execute a tool on an MCP server."""
        conn = self._get_connection(server_name)
        result = await conn.send_request(
            "tools/call",
            {"name": tool_name, "arguments": arguments},
        )
        # MCP returns content as a list of content blocks
        content_blocks = result.get("content", [])
        text_parts = [
            block.get("text", "") for block in content_blocks if block.get("type") == "text"
        ]
        content = "\n".join(text_parts) if text_parts else json.dumps(content_blocks)
        is_error = result.get("isError", False)
        return MCPToolResult(content=content, is_error=is_error)

    # ------------------------------------------------------------------
    # Resource operations
    # ------------------------------------------------------------------

    async def list_resources(self, server_name: str) -> list[MCPResource]:
        """Get resources from a server."""
        conn = self._get_connection(server_name)
        result = await conn.send_request("resources/list")
        return [
            MCPResource(
                uri=r["uri"],
                name=r.get("name", ""),
                description=r.get("description", ""),
                mime_type=r.get("mimeType", ""),
            )
            for r in result.get("resources", [])
        ]

    async def read_resource(self, server_name: str, uri: str) -> str:
        """Read a resource by URI."""
        conn = self._get_connection(server_name)
        result = await conn.send_request("resources/read", {"uri": uri})
        contents = result.get("contents", [])
        if contents:
            return contents[0].get("text", "")
        return ""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @property
    def connected_servers(self) -> list[str]:
        """Names of currently connected servers."""
        return list(self._servers.keys())

    def _get_connection(self, server_name: str) -> _MCPConnection:
        try:
            return self._servers[server_name]
        except KeyError:
            raise MCPError(f"Not connected to server '{server_name}'") from None


# ======================================================================
# Internal connection class
# ======================================================================


class _MCPConnection:
    """Manages a single MCP server connection via stdio JSON-RPC 2.0."""

    def __init__(self, config: MCPServerConfig, process: asyncio.subprocess.Process) -> None:
        self.config = config
        self.process = process
        self._request_id: int = 0
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._reader_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the background reader loop."""
        self._reader_task = asyncio.create_task(self._read_loop())

    # ------------------------------------------------------------------
    # Sending
    # ------------------------------------------------------------------

    async def send_request(
        self, method: str, params: dict[str, Any] | None = None, *, timeout: float = _DEFAULT_TIMEOUT,
    ) -> Any:
        """Send a JSON-RPC request and wait for the matching response."""
        self._request_id += 1
        rid = self._request_id

        request = {
            "jsonrpc": "2.0",
            "id": rid,
            "method": method,
            "params": params or {},
        }

        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending[rid] = future

        self._write(request)

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            raise MCPError(
                f"Request '{method}' to '{self.config.name}' timed out after {timeout}s"
            )

    async def send_notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        """Send a JSON-RPC notification (no id, no response expected)."""
        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
        }
        self._write(notification)

    def _write(self, message: dict[str, Any]) -> None:
        """Write a JSON-RPC message to the server's stdin."""
        stdin = self.process.stdin
        if stdin is None:
            raise MCPError(f"stdin not available for server '{self.config.name}'")
        data = json.dumps(message) + "\n"
        stdin.write(data.encode())

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    async def _read_loop(self) -> None:
        """Continuously read JSON-RPC responses from stdout."""
        stdout = self.process.stdout
        if stdout is None:
            return

        try:
            while True:
                line = await stdout.readline()
                if not line:
                    break  # EOF — process exited

                line_str = line.decode().strip()
                if not line_str:
                    continue

                try:
                    message = json.loads(line_str)
                except json.JSONDecodeError:
                    logger.debug("Non-JSON line from '%s': %s", self.config.name, line_str)
                    continue

                rid = message.get("id")
                if rid is not None and rid in self._pending:
                    future = self._pending.pop(rid)
                    if "error" in message:
                        err = message["error"]
                        future.set_exception(
                            MCPError(f"Server error {err.get('code')}: {err.get('message')}")
                        )
                    else:
                        future.set_result(message.get("result", {}))
                else:
                    # Notification or unknown id — log and ignore
                    logger.debug("Unhandled message from '%s': %s", self.config.name, line_str)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Reader loop error for '%s'", self.config.name)

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    async def close(self) -> None:
        """Terminate the server process and cancel the reader."""
        if self._reader_task is not None:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass

        # Reject any pending requests
        for future in self._pending.values():
            if not future.done():
                future.set_exception(MCPError("Connection closed"))
        self._pending.clear()

        if self.process.returncode is None:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
