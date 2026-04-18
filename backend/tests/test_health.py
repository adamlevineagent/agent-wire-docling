"""Smoke test that will be green immediately after scaffold."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app


def test_health_returns_200() -> None:
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert "docling_version" in body
    assert "tesseract_present" in body
    assert "poppler_present" in body
