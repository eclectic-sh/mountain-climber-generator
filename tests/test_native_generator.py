from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mountain_climber import GenerateRequest, ProtocolError, generate_with_artifacts
from mountain_climber.anti_self_lock import (
    anti_self_lock_extension,
    audit_world,
    placement_is_counterfactually_reachable,
    protected_group,
)
from mountain_climber.invariants import assert_world_invariants
from mountain_climber.playthrough import playthrough_fallback_extension
from mountain_climber.protocol import MAX_SEED, SETTINGS_VERSION
from mountain_climber.settings import item_pool_substitution, settings_for_mode
from mountain_climber.upstream import load_upstream

WORKSPACE = Path(__file__).resolve().parents[1]


def request(mode: str, seed: int, race: bool = False) -> GenerateRequest:
    return GenerateRequest.from_dict(
        {
            "schemaVersion": 1,
            "mode": mode,
            "seed": seed,
            "race": race,
            "settingsVersion": SETTINGS_VERSION,
        }
    )


class ProtocolTests(unittest.TestCase):
    def test_request_rejects_unknown_fields(self) -> None:
        value = request("mountain-climber", 1).to_dict()
        value["unexpected"] = True
        with self.assertRaises(ProtocolError):
            GenerateRequest.from_dict(value)

    def test_request_rejects_boolean_and_out_of_range_seeds(self) -> None:
        for seed in (True, -1, 1_000_000_000):
            value = request("mountain-climber", 1).to_dict()
            value["seed"] = seed
            with self.subTest(seed=seed), self.assertRaises(ProtocolError):
                GenerateRequest.from_dict(value)


class ProtocolParityTests(unittest.TestCase):
    """The browser declares the protocol a second time in TypeScript.

    Nothing at build time reconciles the two, and a mismatch only shows up as a
    rejected request inside the worker, so compare the declarations directly.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.typescript = (WORKSPACE / "src" / "generator" / "protocol.ts").read_text(
            encoding="utf-8"
        )

    def constant(self, name: str) -> str:
        match = re.search(rf"export const {name} = ([^;]+?)(?: as const)?;", self.typescript)
        if match is None:
            self.fail(f"{name} is not exported from protocol.ts")
        return match.group(1).strip().strip('"')

    def test_settings_version_matches(self) -> None:
        self.assertEqual(self.constant("SETTINGS_VERSION"), SETTINGS_VERSION)

    def test_max_seed_matches(self) -> None:
        self.assertEqual(int(self.constant("MAX_SEED").replace("_", "")), MAX_SEED)

    def test_world_invariants_interface_matches(self) -> None:
        interface = re.search(
            r"export interface WorldInvariants \{(.*?)\n\}", self.typescript, re.DOTALL
        )
        if interface is None:
            self.fail("WorldInvariants is not declared in protocol.ts")
        declared = set(re.findall(r"^\s*(\w+)\??:", interface.group(1), re.MULTILINE))

        source = (WORKSPACE / "python" / "mountain_climber" / "invariants.py").read_text(
            encoding="utf-8"
        )
        returned = re.search(r"\n    return \{(.*?)\n    \}", source, re.DOTALL)
        if returned is None:
            self.fail("assert_world_invariants does not end in a dict literal")
        produced = set(re.findall(r'"(\w+)":', returned.group(1)))

        self.assertEqual(produced, declared)


class SettingsTests(unittest.TestCase):
    def test_modes_differ_only_by_entrance_shuffle(self) -> None:
        standard = settings_for_mode("mountain-climber")
        ex = settings_for_mode("mountain-climber-ex")
        self.assertEqual(standard.pop("shuffle"), "vanilla")
        self.assertEqual(ex.pop("shuffle"), "dungeonssimple")
        self.assertEqual(standard, ex)
        self.assertEqual(standard["door_shuffle"], "vanilla")

    def test_current_item_pool_settings(self) -> None:
        settings = settings_for_mode("mountain-climber")
        pool = settings["customitemarray"]
        self.assertEqual(pool["heartpiece"], 0)
        self.assertEqual(pool["heartcontainer"], 0)
        self.assertEqual(pool["sancheart"], 0)
        self.assertEqual(pool["halfmagic"], 0)
        self.assertEqual(pool["quartermagic"], 0)
        self.assertEqual(pool["mail3"], 0)
        self.assertEqual(pool["silversupgrade"], 0)
        self.assertEqual(pool["boots"], 0)
        self.assertEqual(pool["progressivesword"], 6)
        self.assertEqual(pool["progressiveglove"], 2)
        self.assertEqual(pool["titansmitt"], 0)
        self.assertEqual(pool["bomb3"], 23)
        self.assertTrue(settings["startinventory"].startswith("Power Glove,"))
        self.assertNotIn("Titans Mitts", settings["startinventory"])
        self.assertEqual(
            item_pool_substitution(),
            {"remove": "Bombs (3)", "add": "Pseudo Boots", "count": 2},
        )


class GeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.standard = generate_with_artifacts(request("mountain-climber", 42))
        cls.ex = generate_with_artifacts(request("mountain-climber-ex", 42))
        cls.fixtures = json.loads(
            (WORKSPACE / "tests" / "fixtures" / "test-v0.81.json").read_text(encoding="utf-8")
        )

    def test_both_modes_satisfy_current_invariants(self) -> None:
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                invariants = assert_world_invariants(artifacts.world, mode)
                self.assertEqual(invariants["startingHearts"], 8)
                self.assertEqual(invariants["maximumHearts"], 8)

    def test_progressive_glove_upgrades_the_power_glove_start(self) -> None:
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                glove_locations = [
                    location
                    for location in artifacts.world.get_filled_locations()
                    if location.item is not None and location.item.name == "Progressive Glove"
                ]
                self.assertEqual(len(glove_locations), 2)
                state = artifacts.world.state.copy()
                self.assertTrue(state.has("Power Glove", 1))
                self.assertFalse(state.has("Titans Mitts", 1))
                state.collect(glove_locations[0].item, True, glove_locations[0])
                self.assertTrue(state.has("Titans Mitts", 1))

    def test_progressive_glove_counterfactual_keeps_only_the_starting_tier(
        self,
    ) -> None:
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                glove = next(
                    location.item
                    for location in artifacts.world.get_filled_locations()
                    if location.item is not None and location.item.name == "Progressive Glove"
                )
                all_items = [
                    location.item
                    for location in artifacts.world.get_filled_locations()
                    if location.item is not None
                ]
                light_rock = SimpleNamespace(
                    player=1,
                    can_reach=lambda state: state.can_lift_rocks(1),
                )
                heavy_rock = SimpleNamespace(
                    player=1,
                    can_reach=lambda state: state.can_lift_heavy_rocks(1),
                )
                self.assertTrue(
                    placement_is_counterfactually_reachable(
                        artifacts.world,
                        artifacts.world.state,
                        all_items,
                        light_rock,
                        glove,
                    )
                )
                self.assertFalse(
                    placement_is_counterfactually_reachable(
                        artifacts.world,
                        artifacts.world.state,
                        all_items,
                        heavy_rock,
                        glove,
                    )
                )

    def test_duplicate_items_do_not_bypass_counterfactual_access(self) -> None:
        artifacts = self.standard
        all_items = [
            location.item
            for location in artifacts.world.get_filled_locations()
            if location.item is not None
        ]
        mirrors = [item for item in all_items if item.name == "Magic Mirror"]
        self.assertEqual(len(mirrors), 2)
        mirror_only = SimpleNamespace(
            player=1,
            can_reach=lambda state: state.has_Mirror(1),
        )
        alternate_route = SimpleNamespace(
            player=1,
            can_reach=lambda state: state.has_Mirror(1) or state.has("Hammer", 1),
        )
        self.assertFalse(
            placement_is_counterfactually_reachable(
                artifacts.world,
                artifacts.world.state,
                mirrors,
                mirror_only,
                mirrors[0],
            )
        )
        self.assertFalse(
            placement_is_counterfactually_reachable(
                artifacts.world,
                artifacts.world.state,
                all_items,
                artifacts.world.get_location("Floating Island", 1),
                mirrors[0],
            )
        )
        bow = next(item for item in all_items if item.name == "Bow")
        self.assertFalse(
            placement_is_counterfactually_reachable(
                artifacts.world,
                artifacts.world.state,
                all_items,
                artifacts.world.get_location("Eastern Palace - Boss", 1),
                bow,
            )
        )
        self.assertTrue(
            placement_is_counterfactually_reachable(
                artifacts.world,
                artifacts.world.state,
                mirrors,
                alternate_route,
                mirrors[0],
            )
        )

    def test_fixed_worlds_have_no_protected_self_locks(self) -> None:
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                self.assertEqual(audit_world(artifacts.world), [])
                self.assertGreater(sum(artifacts.world.anti_self_lock_rejections.values()), 0)

    def test_swap_search_cannot_bypass_counterfactual_access(self) -> None:
        artifacts = self.standard
        all_items = [
            location.item
            for location in artifacts.world.get_filled_locations()
            if location.item is not None
        ]
        mirror = next(item for item in all_items if item.name == "Magic Mirror")
        floating_island = artifacts.world.get_location("Floating Island", 1)
        links_house = artifacts.world.get_location("Link's House", 1)
        upstream = load_upstream()
        with anti_self_lock_extension(upstream):
            selected = upstream.fill.find_spot_for_item(
                mirror,
                [floating_island, links_house],
                artifacts.world,
                artifacts.world.state,
                all_items,
            )
        self.assertIs(selected, links_house)

    def test_protected_group_registry_handles_resolved_items(self) -> None:
        self.assertEqual(protected_group("Progressive Glove"), "gloves")
        self.assertEqual(protected_group("Titans Mitts"), "gloves")
        self.assertEqual(protected_group("Bottle (Good Bee)"), "bottle")
        self.assertIsNone(protected_group("Pseudo Boots"))

    def test_every_ocarina_uses_the_activated_flute_pickup_code(self) -> None:
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                ocarinas = [
                    location
                    for location in artifacts.world.get_filled_locations()
                    if location.item is not None and location.item.name == "Ocarina"
                ]
                self.assertEqual(len(ocarinas), 3)
                self.assertEqual({location.item.code for location in ocarinas}, {0x4A})
                patch_bytes = {
                    record["offset"] + i: byte
                    for record in artifacts.result["patch"]
                    for i, byte in enumerate(record["bytes"])
                }
                self.assertTrue(all(patch_bytes[location.address] == 0x4A for location in ocarinas))
                state = artifacts.world.state.copy()
                for location in artifacts.world.get_filled_locations():
                    if location.item.name != "Ocarina":
                        state.collect(location.item, True, location)
                self.assertFalse(state.has("Ocarina", 1))
                self.assertFalse(state.can_flute(1))
                state.collect(ocarinas[0].item, True, ocarinas[0])
                self.assertTrue(state.has("Ocarina", 1))
                self.assertTrue(state.can_flute(1))

    def test_two_pseudo_boots_are_non_logical_and_not_real_boots(self) -> None:
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                pseudo_boots = [
                    location
                    for location in artifacts.world.get_filled_locations()
                    if location.item is not None and location.item.name == "Pseudo Boots"
                ]
                self.assertEqual(len(pseudo_boots), 2)
                for location in pseudo_boots:
                    self.assertFalse(location.item.advancement)
                    self.assertTrue(location.item.priority)
                    self.assertEqual(location.item.code, 0x4B)
                self.assertFalse(artifacts.world.state.has_Boots(1))
                state = artifacts.world.state.copy()
                state.collect(pseudo_boots[0].item, True, pseudo_boots[0])
                self.assertFalse(state.has_Boots(1))
                obtainable = [
                    location.item.name
                    for location in artifacts.world.get_filled_locations()
                    if location.item is not None
                ]
                self.assertNotIn("Pegasus Boots", obtainable)
                self.assertEqual(obtainable.count("Bombs (3)"), 21)

    def test_pseudo_boots_avoid_real_boots_only_locations(self) -> None:
        artifacts = generate_with_artifacts(request("mountain-climber", 4))
        locations = [
            location
            for location in artifacts.world.get_filled_locations()
            if location.item is not None and location.item.name == "Pseudo Boots"
        ]
        forbidden = {
            "Bonk Rock Cave",
            "Desert Palace - Torch",
            "Ganons Tower - Bob's Torch",
            "King's Tomb",
            "Library",
            "Lumberjack Tree",
        }
        self.assertEqual(len(locations), 2)
        for location in locations:
            self.assertNotIn(location.name, forbidden)

    def test_minimal_playthrough_failure_uses_full_spheres(self) -> None:
        message = "Cannot reach required progression"
        world = SimpleNamespace(
            can_beat_game=lambda: True,
            fish=SimpleNamespace(translate=lambda *_args: message),
        )
        upstream = SimpleNamespace(
            main=SimpleNamespace(
                create_playthrough=lambda _world: (_ for _ in ()).throw(RuntimeError(message))
            )
        )

        with patch("mountain_climber.playthrough._build_full_progression_playthrough") as build:
            with playthrough_fallback_extension(upstream) as status:
                upstream.main.create_playthrough(world)

        self.assertTrue(status.fallback_used)
        build.assert_called_once_with(upstream, world)

    def test_pseudo_boots_patch_uses_a_dedicated_save_flag(self) -> None:
        expected = {
            0x100D66: [0xF1, 0xF3],
            0x100C1B: [0x02],
            0x121029: [0xAF, 0xF1, 0xF3, 0x7E, 0xC9, 0x01],
            0x06E7D4: [0xAF, 0xF1, 0xF3, 0x7E],
            0x06F829: [0x29, 0x2C, 0x2A, 0x2C, 0x2B, 0x2C, 0x2C, 0x2C],
            0x18008E: [0x00],
        }
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                patch_bytes = {
                    record["offset"] + i: byte
                    for record in artifacts.result["patch"]
                    for i, byte in enumerate(record["bytes"])
                }
                for offset, values in expected.items():
                    self.assertEqual(
                        [patch_bytes[offset + index] for index in range(len(values))],
                        values,
                    )

    def test_patch_is_normalized_and_bounded(self) -> None:
        for artifacts in (self.standard, self.ex):
            previous_end = 0
            for record in artifacts.result["patch"]:
                self.assertGreaterEqual(record["offset"], previous_end)
                previous_end = record["offset"] + len(record["bytes"])
                self.assertLessEqual(previous_end, 2 * 1024 * 1024)

    def test_fixed_seed_is_reproducible(self) -> None:
        for mode, first in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                second = generate_with_artifacts(request(mode, 42))
                self.assertEqual(first.result["patchDigest"], second.result["patchDigest"])
                self.assertEqual(first.result["hash"], second.result["hash"])
                self.assertEqual(first.result["patch"], second.result["patch"])

    def test_fixed_seed_matches_recorded_fixtures(self) -> None:
        fixtures = {
            (fixture["mode"], fixture["seed"]): fixture for fixture in self.fixtures["fixtures"]
        }
        for mode, artifacts in (
            ("mountain-climber", self.standard),
            ("mountain-climber-ex", self.ex),
        ):
            with self.subTest(mode=mode):
                expected = fixtures[(mode, 42)]
                invariants = assert_world_invariants(artifacts.world, mode)
                self.assertEqual(artifacts.result["patchDigest"], expected["patchDigest"])
                self.assertEqual(artifacts.result["hash"], expected["hash"])
                self.assertEqual(
                    len(artifacts.world.spoiler.playthrough),
                    expected["playthroughSpheres"],
                )
                for key, value in self.fixtures["selectedSpoilerAssertions"].items():
                    self.assertEqual(invariants[key], value)

    def test_modes_change_the_patch(self) -> None:
        self.assertNotEqual(
            self.standard.result["patchDigest"],
            self.ex.result["patchDigest"],
        )

    def test_race_result_suppresses_spoiler_and_changes_patch(self) -> None:
        race = generate_with_artifacts(request("mountain-climber", 42, race=True))
        self.assertNotIn("spoiler", race.result)
        self.assertNotIn("antiSelfLock", race.result)
        self.assertEqual(race.result["warnings"], [])
        self.assertNotEqual(self.standard.result["patchDigest"], race.result["patchDigest"])


if __name__ == "__main__":
    unittest.main()
