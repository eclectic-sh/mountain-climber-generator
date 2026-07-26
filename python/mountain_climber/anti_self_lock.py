"""
Vanilla fill only asks whether a location is reachable given everything the
player will eventually hold, which lets the Hookshot end up behind a gap that
needs the Hookshot. To make it so items can't lock behind themselves, we strip
all randomized copies of the item's capability group out of the state, then ask
whether the location is still reachable. If it isn't, the spot is rejected.
"""

from __future__ import annotations

import contextlib
import logging
from collections import Counter
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from typing import Any

PROTECTED_GROUPS: dict[str, frozenset[str]] = {
    "mirror": frozenset({"Magic Mirror"}),
    "bow": frozenset({"Bow", "Progressive Bow", "Progressive Bow (Alt)"}),
    "hookshot": frozenset({"Hookshot"}),
    "gloves": frozenset({"Power Glove", "Titans Mitts", "Progressive Glove"}),
    "flute": frozenset({"Ocarina"}),
    "fire-rod": frozenset({"Fire Rod"}),
    "ice-rod": frozenset({"Ice Rod"}),
    "somaria": frozenset({"Cane of Somaria"}),
    "hammer": frozenset({"Hammer"}),
    "moon-pearl": frozenset({"Moon Pearl"}),
    "flippers": frozenset({"Flippers"}),
    "book": frozenset({"Book of Mudora"}),
    "cape": frozenset({"Cape"}),
    "byrna": frozenset({"Cane of Byrna"}),
    "mushroom": frozenset({"Mushroom"}),
    "powder": frozenset({"Magic Powder"}),
    "shovel": frozenset({"Shovel"}),
    "bug-net": frozenset({"Bug Catching Net"}),
    "blue-boomerang": frozenset({"Blue Boomerang"}),
    "red-boomerang": frozenset({"Red Boomerang"}),
    "bombos": frozenset({"Bombos"}),
    "ether": frozenset({"Ether"}),
    "quake": frozenset({"Quake"}),
    "sword": frozenset(
        {
            "Progressive Sword",
            "Fighter Sword",
            "Master Sword",
            "Tempered Sword",
            "Golden Sword",
        }
    ),
    "shield": frozenset(
        {
            "Progressive Shield",
            "Blue Shield",
            "Red Shield",
            "Mirror Shield",
        }
    ),
}

_GROUP_BY_ITEM = {
    item_name: group for group, item_names in PROTECTED_GROUPS.items() for item_name in item_names
}


def protected_group(item_name: str) -> str | None:
    if item_name.startswith("Bottle"):
        return "bottle"
    return _GROUP_BY_ITEM.get(item_name)


def _is_removed_item(item: Any, group: str, player: int) -> bool:
    return item is not None and item.player == player and protected_group(item.name) == group


def _counterfactual_state(
    world: Any,
    base_state: Any,
    pool: Sequence[Any],
    group: str,
    player: int,
    excluded_location: Any | None = None,
) -> Any:
    # A fresh state retains only the mode's guaranteed precollected inventory.
    # Reusing maximum_exploration_state would retain regions and events reached
    # with the randomized capability that this test is removing.
    state = type(base_state)(world)
    for item in pool:
        if not _is_removed_item(item, group, player):
            state.collect(item, True)

    allowed_events = [
        location
        for location in world.get_filled_locations()
        if location is not excluded_location and not _is_removed_item(location.item, group, player)
    ]
    state.sweep_for_events(locations=allowed_events)
    return state


def placement_is_counterfactually_reachable(
    world: Any,
    base_state: Any,
    pool: Sequence[Any],
    location: Any,
    item: Any,
    excluded_location: Any | None = None,
) -> bool:
    """Check the location is reachable without any randomized copy of the group."""
    group = protected_group(item.name)
    if group is None or item.player != location.player:
        return True
    state = _counterfactual_state(
        world,
        base_state,
        pool,
        group,
        item.player,
        excluded_location,
    )
    return location.can_reach(state)


@dataclass(slots=True)
class AntiSelfLockStats:
    rejections: Counter[str] = field(default_factory=Counter)
    accepted_placements: set[tuple[str, str, str]] = field(default_factory=set)
    pseudo_boots_rejections: int = 0


@dataclass(slots=True)
class _FillContext:
    base_state: Any
    pool: Sequence[Any]
    stats: AntiSelfLockStats
    states: dict[tuple[int, int, str, int], Any] = field(default_factory=dict)

    def allows(self, world: Any, location: Any, item: Any) -> bool:
        group = protected_group(item.name)
        if group is None or item.player != location.player:
            return True
        key = (
            len(self.pool),
            len(world.get_filled_locations()),
            group,
            item.player,
        )
        state = self.states.get(key)
        if state is None:
            state = _counterfactual_state(
                world,
                self.base_state,
                self.pool,
                group,
                item.player,
            )
            self.states[key] = state
        if location.can_reach(state):
            self.stats.accepted_placements.add((item.name, group, location.name))
            return True
        self.stats.rejections[group] += 1
        logging.getLogger("").debug(
            "Anti-self-lock rejected %s (%s) at %s",
            item.name,
            group,
            location.name,
        )
        return False


@contextlib.contextmanager
def anti_self_lock_extension(upstream: Any) -> Iterator[AntiSelfLockStats]:
    """Patch the fill routines for the duration of the block, then put them back."""
    fill = upstream.fill
    original_fill_restrictive = fill.fill_restrictive
    original_item_list_fill_restrictive = upstream.item_list.fill_restrictive
    original_verify = fill.verify_spot_to_fill
    original_find = fill.find_spot_for_item
    original_fast_fill = fill.fast_fill
    contexts: list[_FillContext] = []
    stats = AntiSelfLockStats()

    def fill_restrictive(
        world: Any,
        base_state: Any,
        locations: list[Any],
        itempool: list[Any],
        key_pool: Any = None,
        single_player_placement: bool = False,
        vanilla: bool = False,
    ) -> Any:
        contexts.append(_FillContext(base_state, itempool, stats))
        try:
            return original_fill_restrictive(
                world,
                base_state,
                locations,
                itempool,
                key_pool,
                single_player_placement,
                vanilla,
            )
        finally:
            contexts.pop()

    def verify_spot_to_fill(
        location: Any,
        item_to_place: Any,
        max_exp_state: Any,
        single_player_placement: bool,
        perform_access_check: bool,
        key_pool: Any,
        world: Any,
    ) -> Any:
        result = original_verify(
            location,
            item_to_place,
            max_exp_state,
            single_player_placement,
            perform_access_check,
            key_pool,
            world,
        )
        if result is None or not contexts:
            return result
        return result if contexts[-1].allows(world, result, item_to_place) else None

    def find_spot_for_item(
        item_to_place: Any,
        locations: list[Any],
        world: Any,
        base_state: Any,
        pool: list[Any],
        keys_in_itempool: Any = None,
        single_player_placement: bool = False,
    ) -> Any:
        remaining = list(locations)
        while remaining:
            result = original_find(
                item_to_place,
                remaining,
                world,
                base_state,
                pool,
                keys_in_itempool,
                single_player_placement,
            )
            if result is None:
                return None
            if placement_is_counterfactually_reachable(
                world,
                base_state,
                pool,
                result,
                item_to_place,
                excluded_location=result,
            ):
                group = protected_group(item_to_place.name)
                if group is not None:
                    stats.accepted_placements.add((item_to_place.name, group, result.name))
                return result
            group = protected_group(item_to_place.name)
            if group is not None:
                stats.rejections[group] += 1
                logging.getLogger("").debug(
                    "Anti-self-lock rejected swap of %s (%s) at %s",
                    item_to_place.name,
                    group,
                    result.name,
                )
            remaining.remove(result)
        return None

    def fast_fill(
        world: Any,
        item_pool: list[Any],
        fill_locations: list[Any],
    ) -> None:
        context = _FillContext(world.state, item_pool, stats)
        while item_pool and fill_locations:
            item_to_place = item_pool.pop()
            if item_to_place.name == "Pseudo Boots":
                state = _counterfactual_state(
                    world,
                    world.state,
                    item_pool,
                    "__pseudo-boots-accessibility__",
                    item_to_place.player,
                )
                spot_to_fill = next(
                    (
                        location
                        for location in reversed(fill_locations)
                        if location.player == item_to_place.player and location.can_reach(state)
                    ),
                    None,
                )
                if spot_to_fill is None:
                    raise RuntimeError("No reachable fast-fill location for Pseudo Boots")
                skipped = sum(
                    1
                    for location in fill_locations[fill_locations.index(spot_to_fill) + 1 :]
                    if location.player == item_to_place.player
                )
                stats.pseudo_boots_rejections += skipped
                fill_locations.remove(spot_to_fill)
            elif protected_group(item_to_place.name) is None:
                spot_to_fill = fill_locations.pop()
            else:
                spot_to_fill = next(
                    (
                        location
                        for location in reversed(fill_locations)
                        if context.allows(world, location, item_to_place)
                    ),
                    None,
                )
                if spot_to_fill is None:
                    raise RuntimeError(
                        f"No counterfactually reachable fast-fill location for {item_to_place.name}"
                    )
                fill_locations.remove(spot_to_fill)
            world.push_item(spot_to_fill, item_to_place, False)

    fill.fill_restrictive = fill_restrictive
    upstream.item_list.fill_restrictive = fill_restrictive
    fill.verify_spot_to_fill = verify_spot_to_fill
    fill.find_spot_for_item = find_spot_for_item
    fill.fast_fill = fast_fill
    try:
        yield stats
    finally:
        fill.fill_restrictive = original_fill_restrictive
        upstream.item_list.fill_restrictive = original_item_list_fill_restrictive
        fill.verify_spot_to_fill = original_verify
        fill.find_spot_for_item = original_find
        fill.fast_fill = original_fast_fill


def audit_world(world: Any) -> list[tuple[str, str, str]]:
    """Return protected placements that were never accepted during the fill."""
    violations: list[tuple[str, str, str]] = []
    accepted = getattr(world, "anti_self_lock_accepted_placements", set())
    randomized_items = {id(item) for item in world.itempool}
    filled_locations = world.get_filled_locations()
    for location in filled_locations:
        item = location.item
        group = protected_group(item.name) if item is not None else None
        if group is None or item.player != location.player or id(item) not in randomized_items:
            continue
        proof = (item.name, group, location.name)
        if proof not in accepted:
            violations.append(proof)
    return violations
