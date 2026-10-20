"""Stage 6: portraits, evidence art and a cover in one house style (Venice image API)."""

from __future__ import annotations

import base64

import httpx

from ..pipeline import Draft, PipelineDeps

HOUSE_STYLE = (
    "Illustrated case-file art in ink and gouache on warm textured paper. Confident ink linework, flat gouache washes, "
    "muted palette of ochre, slate blue and oxblood with one warm accent, visible brush texture, soft paper grain. "
    "Consistent hand-drawn storybook style for a detective game. Not a photograph."
)
NEGATIVE = "photo, photograph, photorealistic, realistic skin, 3d render, CGI, glossy, lens blur, text, letters, watermark, logo, signature"

PORTRAIT = (768, 1024)
SQUARE = (1024, 1024)
COVER = (1280, 768)


class VeniceImages:
    def __init__(self, *, api_key: str, model: str, base_url: str = "https://api.venice.ai/api/v1", http: httpx.Client | None = None):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.http = http or httpx.Client(timeout=180)

    def generate(self, prompt: str, *, width: int = 1024, height: int = 1024) -> bytes:
        res = self.http.post(
            f"{self.base_url}/image/generate",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "prompt": prompt,
                "negative_prompt": NEGATIVE,
                "width": width,
                "height": height,
                "format": "png",
                "safe_mode": True,
                "hide_watermark": True,
                "return_binary": False,
            },
        )
        res.raise_for_status()
        return base64.b64decode(res.json()["images"][0])


def subjects(case: dict, plot: dict | None) -> list[tuple[str, str, tuple[int, int]]]:
    """(file name, subject description, size) for every picture the case needs."""
    looks = {s["name"].lower(): s.get("look", "") for s in (plot or {}).get("suspects", [])}
    setting = case["meta"]["setting"]
    out = [("cover.png", f"Cover illustration for a mystery: {case['meta']['title']}. {setting} No people in focus, a still life of the scene.", COVER)]
    v = case["victim"]
    out.append((f"{v['id']}.png", f"Head-and-shoulders portrait of {v['name']}, {v['role']}. {v.get('description', '')}", PORTRAIT))
    for s in case["suspects"]:
        look = looks.get(s["name"].lower()) or ", ".join(s["persona"]["traits"])
        out.append((s["portrait"], f"Head-and-shoulders portrait of {s['name']}, the {s['role']}: {look}. Plain background.", PORTRAIT))
    for e in case["evidence"]:
        out.append((e["image"], f"Evidence still life: {e['name']}. {e['description']} Isolated object on a case-file card.", SQUARE))
    return out


def run(draft: Draft, deps: PipelineDeps) -> None:
    if deps.images is None:
        draft.notes.append("art skipped")
        return
    case = draft.case or {}
    for name, subject, (w, h) in subjects(case, draft.plot):
        data = deps.images.generate(f"{HOUSE_STYLE} {subject}", width=w, height=h)
        draft.assets[name] = deps.storage.put_asset(case["meta"]["id"], name, data, "image/png")
