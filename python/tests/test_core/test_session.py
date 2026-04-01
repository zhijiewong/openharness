"""Tests for openharness.core.session."""

from openharness.core.session import Session
from openharness.core.types import Role, ToolCall


class TestSession:
    def test_create_and_add_messages(self):
        s = Session()
        s.add_user_message("hello")
        s.add_assistant_message("hi there")
        assert len(s.messages) == 2
        assert s.messages[0].role == Role.USER
        assert s.messages[1].role == Role.ASSISTANT

    def test_add_tool_result(self):
        s = Session()
        msg = s.add_tool_result("call-1", "output data", is_error=False)
        assert msg.role == Role.TOOL
        assert msg.content == "output data"
        assert len(msg.tool_results) == 1
        assert msg.tool_results[0].call_id == "call-1"

    def test_save_load_roundtrip(self, tmp_path):
        s = Session(provider="openai", model="gpt-4o")
        s.add_user_message("test question")
        s.add_assistant_message("test answer")
        s.save(session_dir=tmp_path)

        loaded = Session.load(s.id, session_dir=tmp_path)
        assert loaded.id == s.id
        assert loaded.provider == "openai"
        assert len(loaded.messages) == 2
        assert loaded.messages[0].content == "test question"

    def test_list_all(self, tmp_path):
        s1 = Session(id="aaa")
        s1.add_user_message("m1")
        s1.save(session_dir=tmp_path)

        s2 = Session(id="bbb")
        s2.add_user_message("m2")
        s2.add_assistant_message("m3")
        s2.save(session_dir=tmp_path)

        listing = Session.list_all(session_dir=tmp_path)
        assert len(listing) == 2
        ids = {item["id"] for item in listing}
        assert ids == {"aaa", "bbb"}

    def test_list_all_empty_dir(self, tmp_path):
        assert Session.list_all(session_dir=tmp_path / "nope") == []

    def test_messages_with_tool_calls_serialize(self, tmp_path):
        s = Session()
        tc = ToolCall(id="tc1", tool_name="Bash", arguments={"command": "echo hi"})
        s.add_assistant_message("running command", tool_calls=(tc,))
        s.save(session_dir=tmp_path)

        loaded = Session.load(s.id, session_dir=tmp_path)
        msg = loaded.messages[0]
        assert len(msg.tool_calls) == 1
        assert msg.tool_calls[0].tool_name == "Bash"
        assert msg.tool_calls[0].arguments == {"command": "echo hi"}
