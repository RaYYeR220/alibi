"""Stage 1: the plot, as a structured plan the compiler can expand."""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..llmjson import ask_json
from ..pipeline import Draft, PipelineDeps

TONES = {
    "cozy": "Warm and funny, low stakes, the kind of mystery a family solves over cake. Affectionate, never cruel.",
    "classic": "A fair-play puzzle in the golden-age manner: a closed circle of people, a clock, a map of rooms. Measured, period voices.",
    "noir": "Hard-boiled and wry. A city at night, rain, smoke, people with debts. Short sentences, sharp edges, no gore.",
}

RATINGS = {
    "family": "Family rating: the crime is a theft, a sabotage or a disappearance in which everyone turns out safe. No murder, no injuries, no romance beyond a crush.",
    "teen": "Teen rating: a death may have happened off-page. No gore, no sexual content, no slurs.",
    "mature": "Mature rating: darker motives are fine. Still no gore for its own sake.",
}

SYSTEM = """You plot detective cases for Alibi, a game played aloud: players question suspects by voice,
search places, find physical clues, confront suspects with them, send one item to a lab overnight, then accuse.

Write a plot that plays fair:
- One culprit. Motive, means and opportunity must each be provable from what players can find or force out of people.
- Every other suspect is a believable candidate AND is cleared by one solid, discoverable fact
  (an alibi someone can confirm, a lack of means, or a motive that turns out to be false).
- One red herring: a suspect who looks guilty for a good part of the game and is cleared by a clue or a broken lie.
- At least two suspects lie about where they were or what they did. Each lie is exposed by one specific physical clue
  found in a place. Once exposed, the liar admits the truth in one or two sentences.
- One clue is sent to the lab; its result (hours later) proves something about the culprit, usually the means.
- Two clues together are the minimal proof against the culprit. Without them, nobody could prove it.
- Talking alone must never be enough to prove the culprit.
- Clues are physical objects in named places. Every place in the list is somewhere a player can search.

Writing:
- Specific and human. Every suspect has a distinct voice, a job, a quirk, and something small to hide.
- Period details that fit the setting. Plain, concrete words. Wit over atmosphere.
- Avoid stock phrases: "tapestry", "delve", "a testament to", "web of lies", "shrouded in mystery", "little did they know".
- Cast every name the household gave as the victim (the wronged party) or a suspect. Invent the rest of the cast.

Reply with one JSON object only, in exactly this shape:
{
  "title": "...", "tagline": "one line, under 90 characters",
  "setting": "two or three sentences a narrator could read: where, when, what went wrong",
  "crime": "theft|sabotage|disappearance|death",
  "victim": {"name": "...", "role": "...", "description": "one sentence"},
  "places": ["the study", "..."],
  "suspects": [{"name": "...", "role": "...", "gender": "female|male", "age": "40s",
                "look": "what a portrait painter would see", "personality": "three traits",
                "speech": "how they talk, with a habit or tic", "secret": "what they hide and why"}],
  "culprit": "<suspect name>",
  "motive": "...", "means": "...", "opportunity": "...",
  "red_herring": "<suspect name>: why they look guilty and what clears them",
  "timeline": [{"time": "9:15 pm", "event": "..."}],
  "clues": [{"name": "...", "where": "<one of places>", "reveals": "...", "lab": false}],
  "lies": [{"suspect": "<name>", "claim": "what they say", "truth": "what really happened", "exposed_by": "<clue name>"}]
}"""


class PlotSuspect(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    role: str
    gender: Literal["female", "male"]
    look: str = ""
    personality: str = ""
    speech: str = ""
    secret: str = ""


class Plot(BaseModel):
    model_config = ConfigDict(extra="allow")
    title: str
    tagline: str
    setting: str
    victim: dict
    places: list[str] = Field(min_length=2)
    suspects: list[PlotSuspect] = Field(min_length=3, max_length=5)
    culprit: str
    motive: str
    means: str
    opportunity: str
    clues: list[dict] = Field(min_length=3)
    lies: list[dict] = Field(min_length=1)


def request_for(draft: Draft) -> str:
    job = draft.job
    lines = [
        f"Names from the household: {', '.join(job.names)}",
        f"Occasion: {job.occasion or 'none given'}",
        f"Setting: {job.setting or 'your choice, suited to the occasion'}",
        f"Tone: {job.tone}. {TONES[job.tone]}",
        RATINGS[job.rating],
        f"Suspects: {job.suspects or 4}.",
    ]
    if job.notes:
        lines.append(f"Author's notes: {job.notes}")
    return "\n".join(lines)


def run(draft: Draft, deps: PipelineDeps) -> None:
    plot = ask_json(deps.llm, "writer", "plot", SYSTEM, request_for(draft), validate=Plot.model_validate)
    draft.plot = json.loads(plot.model_dump_json())
