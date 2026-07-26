from __future__ import annotations

from collections import Counter
from typing import Any

from .protocol import Mode

FORBIDDEN_OBTAINABLE = {
    "Piece of Heart",
    "Boss Heart Container",
    "Sanctuary Heart Container",
    "Magic Upgrade (1/2)",
    "Magic Upgrade (1/4)",
    "Red Mail",
    "Silver Arrows",
    "Pegasus Boots",
}
EXPECTED_START = Counter(
    {
        "Power Glove": 1,
        "Hookshot": 1,
        "Moon Pearl": 1,
        "Hammer": 1,
        "Boss Heart Container": 5,
    }
)


def assert_world_invariants(world: Any, mode: Mode) -> dict[str, Any]:
    assert world.players == 1
    assert world.mode[1] == "standard"
    assert world.logic[1] == "noglitches"
    assert world.goal[1] == "ganon"
    assert world.crystals_needed_for_ganon[1] == 7
    assert world.crystals_needed_for_gt[1] == 7
    assert world.doorShuffle[1] == "vanilla"
    assert world.shuffle[1] == ("dungeonssimple" if mode == "mountain-climber-ex" else "vanilla")
    assert world.can_beat_game()
    assert len(world.get_locations()) == 308
    assert len(world.get_filled_locations()) == 308
    assert not world.get_unfilled_locations()
    assert len(world.itempool) == 153

    start = Counter(item.name for item in world.precollected_items)
    assert start == EXPECTED_START

    obtainable = Counter(
        location.item.name for location in world.get_filled_locations() if location.item is not None
    )
    assert not (FORBIDDEN_OBTAINABLE & set(obtainable))
    assert obtainable["Blue Mail"] == 3
    assert obtainable["Progressive Sword"] == 6
    assert obtainable["Progressive Glove"] == 2
    assert obtainable["Titans Mitts"] == 0
    assert obtainable["Pseudo Boots"] == 2

    crystals = {
        location.item.name
        for location in world.get_filled_locations()
        if location.item is not None and location.item.name.startswith("Crystal ")
    }
    assert crystals == {f"Crystal {number}" for number in range(1, 8)}
    assert world.spoiler.playthrough

    return {
        "beatable": True,
        "startingHearts": 3 + start["Boss Heart Container"],
        "maximumHearts": 3 + start["Boss Heart Container"],
        "startingInventory": dict(sorted(start.items())),
        "blueMailCount": obtainable["Blue Mail"],
        "progressiveSwordCount": obtainable["Progressive Sword"],
        "progressiveGloveCount": obtainable["Progressive Glove"],
        "pseudoBootsCount": obtainable["Pseudo Boots"],
        "crystalCount": len(crystals),
        "filledLocationCount": len(world.get_filled_locations()),
        "itemPoolCount": len(world.itempool),
        "entranceShuffle": world.shuffle[1],
        "doorShuffle": world.doorShuffle[1],
    }
