"""Tests for openharness.harness.cost."""

import pytest

from openharness.harness.cost import CostTracker, estimate_cost


class TestCostTracker:
    def test_record_and_totals(self):
        ct = CostTracker()
        ct.record("openai", "gpt-4o", 1000, 500, 0.05)
        ct.record("openai", "gpt-4o", 2000, 300, 0.03)
        assert ct.total_cost == pytest.approx(0.08)
        assert ct.total_input_tokens == 3000
        assert ct.total_output_tokens == 800

    def test_by_provider(self):
        ct = CostTracker()
        ct.record("openai", "gpt-4o", 100, 50, 0.01)
        ct.record("anthropic", "claude-sonnet-4-6", 100, 50, 0.02)
        bp = ct.by_provider()
        assert bp["openai"] == pytest.approx(0.01)
        assert bp["anthropic"] == pytest.approx(0.02)

    def test_by_model(self):
        ct = CostTracker()
        ct.record("openai", "gpt-4o", 100, 50, 0.01)
        ct.record("openai", "gpt-4o-mini", 100, 50, 0.005)
        bm = ct.by_model()
        assert "gpt-4o" in bm
        assert "gpt-4o-mini" in bm

    def test_budget_enforcement(self):
        ct = CostTracker(budget=0.10)
        assert not ct.is_over_budget()
        ct.record("openai", "gpt-4o", 1000, 500, 0.10)
        assert ct.is_over_budget()

    def test_no_budget_never_over(self):
        ct = CostTracker(budget=0.0)
        ct.record("openai", "gpt-4o", 1000, 500, 999.0)
        assert not ct.is_over_budget()

    def test_save_load_roundtrip(self, tmp_path):
        ct = CostTracker(budget=1.0)
        ct.record("openai", "gpt-4o", 1000, 500, 0.05)
        path = tmp_path / "cost.json"
        ct.save(path)

        loaded = CostTracker.load(path)
        assert loaded.total_cost == pytest.approx(0.05)
        assert loaded.budget == 1.0
        assert loaded.total_input_tokens == 1000
        assert len(loaded.events) == 1

    def test_format_summary_returns_string(self):
        ct = CostTracker()
        ct.record("openai", "gpt-4o", 100, 50, 0.01)
        summary = ct.format_summary()
        assert isinstance(summary, str)
        assert "$" in summary


class TestEstimateCost:
    def test_known_model(self):
        cost = estimate_cost("gpt-4o", 1_000_000, 1_000_000)
        assert cost == pytest.approx(12.50)  # 2.50 + 10.00

    def test_unknown_model_returns_zero(self):
        assert estimate_cost("unknown-model", 1000, 1000) == 0.0

    def test_local_model_free(self):
        assert estimate_cost("llama3", 1_000_000, 1_000_000) == 0.0
