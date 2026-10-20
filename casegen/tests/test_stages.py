import base64
import json

import httpx
import pytest

from alibi_casegen.llmjson import extract_json
from alibi_casegen.progress import DynamoJobs
from alibi_casegen.stages.anchors import claim_supported, sources_for
from alibi_casegen.stages.art import HOUSE_STYLE, VeniceImages
from alibi_casegen.stages.compile import normalize_case
from alibi_casegen.stages.voices import FEMALE, MALE, NARRATOR_VOICE, PollyTts, assign_voices
from tests.test_prover import TINY


@pytest.fixture
def tiny() -> dict:
    return json.loads(TINY.read_text(encoding="utf-8"))


def test_extract_json_from_fenced_or_bare_text():
    assert extract_json('Sure.\n```json\n{"a": [1, 2]}\n```\nDone.') == {"a": [1, 2]}
    assert extract_json('prefix {"b": {"c": "}"}} suffix') == {"b": {"c": "}"}}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_claim_is_supported_only_by_a_matching_source(tiny):
    sources = sources_for(tiny, "harold")
    assert claim_supported("Harold came in at nine to fetch garden twine.", "f_harold_twine", sources)
    # cited source must actually say it
    assert not claim_supported("A stranger in a red coat stood by the gate.", "f_harold_greenhouse", sources)
    # an uncited claim is still accepted when a source plainly states it
    assert claim_supported("The study desk is always kept locked.", None, sources)
    assert not claim_supported("Harold saw a ghost in the orchard.", None, sources)


def test_another_suspects_lie_is_not_a_source(tiny):
    harold = sources_for(tiny, "harold")
    clara = sources_for(tiny, "clara")
    claim = "Clara was curled up in the library with a novel all evening."
    assert claim_supported(claim, "lie:l_clara", clara)
    assert not claim_supported(claim, "lie:l_clara", harold)


def test_voices_are_unique_allowlisted_and_never_the_narrator():
    suspects = [{"id": f"s{i}", "gender": g} for i, g in enumerate(["female", "male", "female", "male", "female"])]
    voices = assign_voices(suspects)
    assert len(set(voices.values())) == 5
    for s in suspects:
        pool = FEMALE if s["gender"] == "female" else MALE
        assert voices[s["id"]] in pool
    assert NARRATOR_VOICE not in voices.values()


def test_normalize_fills_house_fields_and_strips_audio(tiny):
    body = json.loads(json.dumps(tiny))
    del body["meta"]["cover"]
    body["suspects"][0].pop("portrait")
    body["anchors"][0]["audioUrl"] = "https://example.com/x.mp3"
    out = normalize_case(body, case_id="custom-brooch-abc123", price_cents=0, rating="family", voices={"harold": "Matthew"})
    assert out["meta"]["id"] == "custom-brooch-abc123"
    assert out["meta"]["cover"] == "cover.png" and out["meta"]["artStyle"] == "ink-gouache"
    assert out["suspects"][0]["portrait"] == "harold.png" and out["suspects"][0]["voiceId"] == "Matthew"
    assert out["evidence"][0]["image"] == "muddy-prints.png"
    assert "audioUrl" not in out["anchors"][0]


def test_venice_image_client_sends_house_style_and_decodes():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"images": [base64.b64encode(b"PNGDATA").decode()]})

    client = VeniceImages(api_key="k", model="flux-2-pro", http=httpx.Client(transport=httpx.MockTransport(handler)))
    data = client.generate(f"{HOUSE_STYLE} a gardener", width=768, height=1024)
    assert data == b"PNGDATA"
    assert seen["url"].endswith("/image/generate")
    assert seen["auth"] == "Bearer k"
    assert seen["body"]["model"] == "flux-2-pro"
    assert seen["body"]["width"] == 768 and seen["body"]["height"] == 1024
    assert "ink and gouache" in seen["body"]["prompt"]
    assert "photo" in seen["body"]["negative_prompt"]


def test_polly_uses_the_generative_engine():
    class Body:
        def read(self):
            return b"MP3"

    class Polly:
        def synthesize_speech(self, **kw):
            self.kw = kw
            return {"AudioStream": Body()}

    polly = Polly()
    assert PollyTts(polly).synthesize("Hello there.", "Ruth") == b"MP3"
    assert polly.kw == {"Engine": "generative", "OutputFormat": "mp3", "Text": "Hello there.", "VoiceId": "Ruth"}


def test_dynamo_jobs_patch_the_job_map():
    class Table:
        def __init__(self):
            self.updates = []

        def update_item(self, **kw):
            self.updates.append(kw)

        def get_item(self, **kw):
            return {"Item": {"pk": "JOB#j1", "sk": "JOB", "job": {"jobId": "j1", "householdId": "hh", "input": {"names": ["A"]}}}}

    table = Table()
    jobs = DynamoJobs(table, clock=lambda: 1234)
    jobs.update("j1", "plot", 15)
    kw = table.updates[-1]
    assert kw["Key"] == {"pk": "JOB#j1", "sk": "JOB"}
    assert kw["ExpressionAttributeValues"][":status"] == "running"
    assert kw["ExpressionAttributeValues"][":stage"] == "plot"
    assert kw["ExpressionAttributeValues"][":percent"] == 15
    assert kw["ExpressionAttributeValues"][":now"] == 1234
    jobs.failed("j1", "prove", "not_unique")
    assert table.updates[-1]["ExpressionAttributeValues"][":error"] == "not_unique"
    jobs.done("j1", "custom-x")
    assert table.updates[-1]["ExpressionAttributeValues"][":caseId"] == "custom-x"
    assert jobs.get("j1")["householdId"] == "hh"
