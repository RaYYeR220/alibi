"""Stage 7: cast a Polly generative voice per suspect and record every anchor line."""

from __future__ import annotations

from typing import Any

from ..pipeline import Draft, PipelineDeps

# Polly voices available on the generative engine (us-east-1), English only.
FEMALE = ["Ruth", "Danielle", "Joanna", "Salli", "Tiffany", "Amy", "Olivia", "Niamh", "Ayanda", "Kajal", "Aria"]
MALE = ["Matthew", "Stephen", "Kenneth", "Nate", "Russell", "Curtis", "Arjun"]
NARRATOR_VOICE = "Brian"


def assign_voices(suspects: list[dict]) -> dict[str, str]:
    """One distinct voice per suspect, by gender, never the narrator's."""
    pools = {"female": list(FEMALE), "male": list(MALE)}
    out: dict[str, str] = {}
    for s in suspects:
        gender = s.get("gender") if s.get("gender") in pools else "female"
        pool = pools[gender] or pools["male" if gender == "female" else "female"]
        out[s["id"]] = pool.pop(0)
    return out


class PollyTts:
    def __init__(self, client: Any) -> None:
        self.client = client

    def synthesize(self, text: str, voice_id: str) -> bytes:
        res = self.client.synthesize_speech(Engine="generative", OutputFormat="mp3", Text=text, VoiceId=voice_id)
        return res["AudioStream"].read()


def run(draft: Draft, deps: PipelineDeps) -> None:
    case = draft.case or {}
    allowed = set(FEMALE) | set(MALE)
    taken: set[str] = set()
    for s in case["suspects"]:
        if s.get("voiceId") not in allowed or s["voiceId"] in taken:
            s["voiceId"] = next(v for v in FEMALE + MALE if v not in taken)
        taken.add(s["voiceId"])
    draft.voices = {s["id"]: s["voiceId"] for s in case["suspects"]}
    draft.narrator_voice = NARRATOR_VOICE
    if deps.tts is None:
        draft.notes.append("voices skipped")
        return
    for a in case["anchors"]:
        voice = draft.voices.get(a["speakerId"], NARRATOR_VOICE)
        audio = deps.tts.synthesize(a["text"], voice)
        a["audioUrl"] = deps.storage.put_asset(case["meta"]["id"], f"audio/{a['id']}.mp3", audio, "audio/mpeg")
