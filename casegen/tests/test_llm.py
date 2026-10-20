from alibi_casegen.llm import make_model


def test_make_model_uses_venice_base_url(monkeypatch):
    monkeypatch.delenv("ALIBI_KEY_SOURCE", raising=False)
    monkeypatch.delenv("ALIBI_WRITER_MODEL", raising=False)
    monkeypatch.delenv("ALIBI_CHECKER_MODEL", raising=False)
    monkeypatch.setenv("VENICE_API_KEY", "test-key")

    writer = make_model("writer")
    checker = make_model("checker")

    assert writer.client_args["base_url"] == "https://api.venice.ai/api/v1"
    assert writer.client_args["api_key"] == "test-key"
    assert writer.get_config()["model_id"] == "claude-sonnet-5-5"
    assert checker.get_config()["model_id"] == "claude-haiku-5-5"


def test_writer_model_can_be_overridden_from_the_environment(monkeypatch):
    monkeypatch.delenv("ALIBI_KEY_SOURCE", raising=False)
    monkeypatch.setenv("VENICE_API_KEY", "test-key")
    monkeypatch.setenv("ALIBI_WRITER_MODEL", "claude-haiku-5-5")
    assert make_model("writer").get_config()["model_id"] == "claude-haiku-5-5"


def test_thinking_is_off_except_where_configured(monkeypatch):
    from alibi_casegen.llm import model_params

    plot = model_params("writer", "plot")
    assert plot["extra_body"] == {"venice_parameters": {"disable_thinking": True}}
    assert "reasoning_effort" not in plot
    compile_ = model_params("writer", "compile")
    assert compile_["reasoning_effort"] == "low"
    assert "extra_body" not in compile_
    assert model_params("checker", "anchors-check")["temperature"] == 0.0
