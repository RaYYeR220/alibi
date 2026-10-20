from alibi_casegen.llm import make_model


def test_make_model_uses_venice_base_url(monkeypatch):
    monkeypatch.delenv("ALIBI_KEY_SOURCE", raising=False)
    monkeypatch.setenv("VENICE_API_KEY", "test-key")

    writer = make_model("writer")
    checker = make_model("checker")

    assert writer.client_args["base_url"] == "https://api.venice.ai/api/v1"
    assert writer.client_args["api_key"] == "test-key"
    assert writer.get_config()["model_id"] == "claude-sonnet-5-5"
    assert checker.get_config()["model_id"] == "claude-haiku-5-5"
