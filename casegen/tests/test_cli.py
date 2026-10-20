import json

from alibi_casegen.cli import validate_main
from tests.test_prover import TINY


def test_validate_ok_exits_zero(capsys):
    assert validate_main([str(TINY)]) == 0
    assert "ok" in capsys.readouterr().out


def test_validate_broken_case_exits_one(tmp_path, capsys):
    case = json.loads(TINY.read_text(encoding="utf-8"))
    case["solution"]["culprit"] = "harold"
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(case), encoding="utf-8")
    assert validate_main([str(bad)]) == 1
    assert "wrong_culprit" in capsys.readouterr().out
