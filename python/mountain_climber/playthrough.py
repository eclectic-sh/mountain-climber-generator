"""Fallback for an upstream playthrough-pruning failure.

Upstream computes a minimal playthrough by greedily removing items and
re-testing. With this item pool, that search sometimes reports the game as
unbeatable even though it is. When that specific error shows up and the world
is actually beatable, fall back to plain logical spheres.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class PlaythroughStatus:
    fallback_used: bool = False


def _build_full_progression_playthrough(upstream: Any, old_world: Any) -> None:
    """Build the logical spheres without upstream's greedy item minimization."""
    world = upstream.main.copy_world(old_world)
    state = upstream.main.CollectionState(world)
    candidates = [
        location for location in world.get_filled_locations() if location.item.advancement
    ]
    optional_locations = {
        "Trench 1 Switch",
        "Trench 2 Switch",
        "Ice Block Drop",
        "Skull Star Tile",
    }
    collection_spheres: list[list[Any]] = []

    while candidates:
        state.sweep_for_events(key_only=True)
        sphere = sorted(
            (
                location
                for location in candidates
                if state.can_reach(location) and state.not_flooding_a_key(world, location)
            ),
            key=lambda location: (location.name, location.player),
        )
        if not sphere:
            required = [
                location
                for location in candidates
                if location.name not in optional_locations
                and world.accessibility[location.item.player] != "none"
            ]
            if required:
                raise RuntimeError(
                    world.fish.translate(
                        "cli",
                        "cli",
                        "cannot.reach.progression",
                    )
                )
            old_world.spoiler.unreachables = candidates.copy()
            break
        for location in sphere:
            candidates.remove(location)
            state.collect(location.item, True, location)
        collection_spheres.append(sphere)

    if not world.has_beaten_game(state):
        raise RuntimeError(world.fish.translate("cli", "cli", "cannot.reach.required"))

    old_world.required_locations = [
        (location.name, location.player) for sphere in collection_spheres for location in sphere
    ]
    old_world.spoiler.paths = {}
    old_world.spoiler.playthrough = {
        "0": [str(item) for item in world.precollected_items if item.advancement]
    }
    for n, sphere in enumerate(collection_spheres, start=1):
        old_world.spoiler.playthrough[str(n)] = {
            location.gen_name(): str(location.item) for location in sphere
        }


@contextlib.contextmanager
def playthrough_fallback_extension(
    upstream: Any,
) -> Iterator[PlaythroughStatus]:
    """Catch the one known pruning failure and fall back, re-raise anything else."""
    original = upstream.main.create_playthrough
    status = PlaythroughStatus()

    def create_playthrough(world: Any) -> None:
        try:
            original(world)
        except RuntimeError as error:
            expected = world.fish.translate(
                "cli",
                "cli",
                "cannot.reach.required",
            )
            if str(error) != expected or not world.can_beat_game():
                raise
            logging.getLogger("").warning(
                "Minimal playthrough pruning failed, using full logical spheres"
            )
            _build_full_progression_playthrough(upstream, world)
            status.fallback_used = True

    upstream.main.create_playthrough = create_playthrough
    try:
        yield status
    finally:
        upstream.main.create_playthrough = original
