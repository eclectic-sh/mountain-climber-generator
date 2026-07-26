# Mountain Climber Generator

Mountain Climber is Standard 7/7 Ganon, eight-heart start/max.

You start with Glove/Hookshot/Pearl/Hammer. 

The item pool has extra copies of many progression items, Pseudo Boots instead of Pegasus Boots (no boots checks required), no heart upgrades and no magic upgrades. Red Mail and Silver Arrows are unavailable. Flute is activated on pickup.

Mountain Climber EX adds shuffled dungeon entrances.

This tool is provided to make generating these easier.

## Local development

Requirements:

- Node.js 24
- npm 10
- CPython 3.14

```sh
npm ci
python3.14 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm run dev
```

Vite serves the app at <http://127.0.0.1:5173/mountain-climber-generator/>.

`npm run ci` runs what CI runs: format and lint checks, the type, ROM, and
Python test suites, and a production build. `npm run build` writes a build to
`dist/` without deploying it.

Some tests need a ROM and skip without one:

```sh
MOUNTAIN_CLIMBER_TEST_ROM=/path/to/jp10.sfc npm run test:rom
```

## ROM handling

No game ROM is included or distributed here, and the project never receives one.
Players supply their own legally obtained Japanese v1.0 ROM, which is checked
against a known hash and kept in browser storage on their own machine.

## License

First-party source is available under the [MIT License](LICENSE). Vendored and
adapted components retain their own notices and licenses as described in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
