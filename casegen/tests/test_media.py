import json

from alibi_casegen.media import produce_media
from tests.test_prover import TINY


class FakeImages:
    def __init__(self):
        self.prompts = []

    def generate(self, prompt, *, width=1024, height=1024):
        self.prompts.append(prompt)
        return b"PNG"


class FakeTts:
    def __init__(self):
        self.calls = []

    def synthesize(self, text, voice_id):
        self.calls.append(voice_id)
        return b"MP3"


class FakeUploader:
    def __init__(self):
        self.keys = {}

    def upload(self, key, data, content_type):
        self.keys[key] = content_type


def test_media_renders_art_and_voices_and_points_the_case_at_them(tmp_path):
    case = json.loads(TINY.read_text(encoding="utf-8"))
    images, tts, up = FakeImages(), FakeTts(), FakeUploader()
    out = produce_media(case, images=images, tts=tts, uploader=up, cache_dir=tmp_path)

    cid = case["meta"]["id"]
    assert f"assets/cases/{cid}/cover.png" in up.keys
    assert f"assets/cases/{cid}/harold.png" in up.keys
    assert f"assets/cases/{cid}/{case['evidence'][0]['image']}" in up.keys
    assert all(a["audioUrl"] == f"audio/{a['id']}.mp3" for a in out["anchors"])
    assert up.keys[f"assets/cases/{cid}/audio/a_cold_open.mp3"] == "audio/mpeg"
    assert out["victim"]["portrait"] == "margaret.png"
    assert all("ink and gouache" in p for p in images.prompts)
    assert len(set(s["voiceId"] for s in out["suspects"])) == len(out["suspects"])


def test_media_reuses_cached_files_instead_of_paying_twice(tmp_path):
    case = json.loads(TINY.read_text(encoding="utf-8"))
    first = FakeImages()
    produce_media(case, images=first, tts=FakeTts(), uploader=FakeUploader(), cache_dir=tmp_path)
    again = FakeImages()
    produce_media(case, images=again, tts=FakeTts(), uploader=FakeUploader(), cache_dir=tmp_path)
    assert first.prompts and again.prompts == []
