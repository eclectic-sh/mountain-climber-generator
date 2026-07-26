"""
Runs the Door Randomizer and normalizes what comes back. Upstream hands over a
mutable world object and a dict of ROM writes; the browser needs a versioned,
JSON-safe result. The Pseudo Boots pickup, item code overrides, and
anti-self-lock fill rules are applied here because upstream has no setting for
any of them.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import logging
import platform
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .anti_self_lock import anti_self_lock_extension
from .playthrough import playthrough_fallback_extension
from .protocol import GenerateRequest, ProtocolError
from .settings import (
    item_code_overrides,
    item_pool_substitution,
    pseudo_boots_config,
    settings_for_mode,
)
from .upstream import VENDOR_REVISION, load_upstream, vendor_working_directory

ROM_SIZE = 2 * 1024 * 1024
ProgressCallback = Callable[[str], None]

_LOG_PROGRESS = {
    "Shuffling the World about": "entrance-shuffle",
    "Generating Item Pool": "item-pool",
    "Fill the world": "item-fill",
    "Patching ROM": "patch",
    "Calculating Playthrough": "logical-validation",
    "Creating Spoiler": "spoiler",
}

PSEUDO_BOOTS_RECEIPT_TARGET = 0x100D66
PSEUDO_BOOTS_RECEIPT_PALETTE = 0x100C1B
PSEUDO_BOOTS_DASH_READ = 0x121029
PSEUDO_BOOTS_INVENTORY_READ = 0x06E7D4
PSEUDO_BOOTS_INVENTORY_GFX = 0x06F829
PSEUDO_BOOTS_GLOBAL_CONFIG = 0x18008E


@dataclass(slots=True)
class GenerationArtifacts:
    result: dict[str, Any]
    world: Any
    rom: Any


def _make_args(request: GenerateRequest) -> Any:
    upstream = load_upstream()
    with vendor_working_directory():
        args = upstream.cli.parse_cli([])

    for key, value in settings_for_mode(request.mode).items():
        if key == "customitemarray":
            args.customitemarray = {1: value}
            continue
        if not hasattr(args, key):
            raise RuntimeError(f"preset contains unsupported upstream setting: {key}")
        current = getattr(args, key)
        setattr(args, key, {1: value} if isinstance(current, dict) and 1 in current else value)

    args.bps = False
    args.create_spoiler = True
    args.jsonout = True
    args.mystery = False
    args.outputpath = None
    args.race = request.race
    args.securerandom = False
    args.skip_playthrough = False
    args.suppress_meta = True
    args.suppress_rom = False
    return args


def _normalize_patch(patches: Any) -> list[dict[str, Any]]:
    if not isinstance(patches, dict):
        raise ProtocolError("upstream patch must be an object")

    records: list[dict[str, Any]] = []
    previous_end = 0
    for raw_offset, raw_bytes in sorted(patches.items(), key=lambda item: int(item[0])):
        try:
            offset = int(raw_offset)
        except (TypeError, ValueError) as error:
            raise ProtocolError("patch offset is not an integer") from error
        if isinstance(raw_offset, str) and str(offset) != raw_offset:
            raise ProtocolError("patch offset is not canonically encoded")
        if offset < previous_end:
            raise ProtocolError("patch records overlap")
        if not isinstance(raw_bytes, list) or not raw_bytes:
            raise ProtocolError("patch bytes must be a nonempty array")
        if any(
            isinstance(byte, bool) or not isinstance(byte, int) or not 0 <= byte <= 255
            for byte in raw_bytes
        ):
            raise ProtocolError("patch contains an invalid byte")
        end = offset + len(raw_bytes)
        if offset < 0 or end > ROM_SIZE:
            raise ProtocolError("patch write is outside the 2 MiB output")
        records.append({"offset": offset, "bytes": raw_bytes.copy()})
        previous_end = end
    return records


def _patch_digest(records: list[dict[str, Any]]) -> str:
    canonical = json.dumps(records, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _apply_item_code_overrides(world: Any, rom: Any) -> None:
    """Rewrite pickup codes, leaving the upstream logic names alone."""
    overrides = item_code_overrides()
    for location in world.get_filled_locations():
        item = location.item
        if item is None or item.name not in overrides:
            continue
        if location.crystal:
            raise ProtocolError(f"cannot override a crystal pickup: {location.name}")
        if location.type.name in {"Pot", "Drop"}:
            raise ProtocolError(
                f"item code override does not support {location.type.name} locations"
            )
        if location.address is None or not isinstance(location.address, int):
            raise ProtocolError(f"cannot override pickup at {location.name}")
        item.code = overrides[item.name]
        rom.write_byte(location.address, item.code)


def _apply_pseudo_boots_rom_patch(rom: Any) -> None:
    """Point the Boots receipt and display code at the per-save flag."""
    save_flag = pseudo_boots_config()["saveFlag"]
    flag_address = [save_flag & 0xFF, (save_flag >> 8) & 0xFF, save_flag >> 16]

    # Receipt $4B normally writes $01 to the real Boots inventory byte at $7EF355.
    rom.write_bytes(PSEUDO_BOOTS_RECEIPT_TARGET, flag_address[:2])
    rom.write_byte(PSEUDO_BOOTS_RECEIPT_PALETTE, 0x02)
    # The existing Fake Boots movement hook reads a global ROM option; point it
    # at this save file's flag and disable the old seed-wide option below.
    rom.write_bytes(
        PSEUDO_BOOTS_DASH_READ,
        [0xAF, *flag_address, 0xC9, 0x01],
    )
    rom.write_bytes(PSEUDO_BOOTS_INVENTORY_READ, [0xAF, *flag_address])
    rom.write_bytes(
        PSEUDO_BOOTS_INVENTORY_GFX,
        [0x29, 0x2C, 0x2A, 0x2C, 0x2B, 0x2C, 0x2C, 0x2C],
    )
    rom.write_byte(PSEUDO_BOOTS_GLOBAL_CONFIG, 0x00)


@contextlib.contextmanager
def _pseudo_boots_extension(upstream: Any) -> Any:
    """Register Pseudo Boots with the generator for the duration of the block."""
    config = pseudo_boots_config()
    substitution = item_pool_substitution()
    item_name = substitution["add"]
    previous_item = upstream.items.item_table.get(item_name)
    original_pool_builder = upstream.item_list.make_custom_item_pool

    upstream.items.item_table[item_name] = (
        False,
        True,
        None,
        config["itemCode"],
        250,
        "Dash with A,\nbut not through\nBoots checks.",
        "and the almost-boots",
        "the mountain-running kid",
        "almost-boots for sale",
        "shrooms for careful speed",
        "climber boy dashes again",
        "the Pseudo Boots",
    )

    def make_custom_item_pool(*args: Any, **kwargs: Any) -> Any:
        result = original_pool_builder(*args, **kwargs)
        pool = result[0]
        replaced = 0
        for i, name in enumerate(pool):
            if name == substitution["remove"] and replaced < substitution["count"]:
                pool[i] = item_name
                replaced += 1
        if replaced != substitution["count"]:
            raise RuntimeError("could not substitute the Pseudo Boots pickup")
        return result

    upstream.item_list.make_custom_item_pool = make_custom_item_pool
    try:
        yield
    finally:
        upstream.item_list.make_custom_item_pool = original_pool_builder
        if previous_item is None:
            upstream.items.item_table.pop(item_name, None)
        else:
            upstream.items.item_table[item_name] = previous_item


def generate_with_artifacts(
    request: GenerateRequest | dict[str, Any],
    progress: ProgressCallback | None = None,
) -> GenerationArtifacts:
    if isinstance(request, dict):
        request = GenerateRequest.from_dict(request)
    if not isinstance(request, GenerateRequest):
        raise ProtocolError("request must be GenerateRequest or an object")

    upstream = load_upstream()
    args = _make_args(request)
    captured: list[Any] = []
    base_json_rom = upstream.rom.JsonRom

    class CapturingJsonRom(base_json_rom):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            captured.append(self)

    previous_json_rom = upstream.main.JsonRom
    upstream.main.JsonRom = CapturingJsonRom
    upstream.race_random.use_secure(False)

    class ProgressHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            if progress is None:
                return
            stage = _LOG_PROGRESS.get(record.getMessage())
            if stage is not None:
                progress(stage)

    handler = ProgressHandler()
    root_logger = logging.getLogger()
    previous_log_level = root_logger.level
    if progress is not None:
        root_logger.setLevel(logging.INFO)
    root_logger.addHandler(handler)
    try:
        if progress is not None:
            progress("world-build")
        with (
            vendor_working_directory(),
            contextlib.redirect_stdout(io.StringIO()),
            _pseudo_boots_extension(upstream),
            anti_self_lock_extension(upstream) as anti_self_lock_stats,
            playthrough_fallback_extension(upstream) as playthrough_status,
        ):
            world = upstream.main.main(
                args=args,
                seed=request.seed,
                fish=upstream.babel_fish(lang="en"),
            )
        world.anti_self_lock_rejections = dict(anti_self_lock_stats.rejections)
        world.anti_self_lock_accepted_placements = frozenset(
            anti_self_lock_stats.accepted_placements
        )
        world.pseudo_boots_accessibility_rejections = anti_self_lock_stats.pseudo_boots_rejections
        world.playthrough_fallback_used = playthrough_status.fallback_used
    finally:
        root_logger.removeHandler(handler)
        root_logger.setLevel(previous_log_level)
        upstream.main.JsonRom = previous_json_rom
        upstream.race_random.use_secure(False)

    if len(captured) != 1:
        raise ProtocolError(f"expected one JsonRom, captured {len(captured)}")
    rom = captured[0]
    _apply_item_code_overrides(world, rom)
    _apply_pseudo_boots_rom_patch(rom)
    records = _normalize_patch(rom.patches)

    hash_string = world.spoiler.hashes.get((1, 0))
    if not isinstance(hash_string, str):
        raise ProtocolError("upstream did not produce a five-item hash")
    hash_items = hash_string.split(", ")
    if len(hash_items) != 5 or any(not item for item in hash_items):
        raise ProtocolError("upstream hash must contain five item names")

    if progress is not None:
        progress("spoiler")
    spoiler = json.loads(world.spoiler.to_json())
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "seed": request.seed,
        "mode": request.mode,
        "race": request.race,
        "settingsVersion": request.settings_version,
        "generatorVersion": f"{upstream.main.__version__}+{VENDOR_REVISION[:12]}",
        "pythonVersion": platform.python_version(),
        "hash": hash_items,
        "patch": records,
        "patchDigest": _patch_digest(records),
        "warnings": [],
    }
    if not request.race:
        result["spoiler"] = spoiler

    return GenerationArtifacts(result=result, world=world, rom=rom)


def generate(
    request: GenerateRequest | dict[str, Any],
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    return generate_with_artifacts(request, progress=progress).result
