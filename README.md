# Smart Bin

An ESP32-based bin that **automatically compacts its contents** when it detects it is full (by weight or distance from the top) and **reports its status to a server/app** so grounds staff know when it needs emptying, which is when the contents can no longer be compressed.

## How it works

1. Sensors measure fill level (ultrasonic/ToF distance) and weight (load cell).
2. When the bin is judged full, the compactor motor runs a crush cycle.
3. If repeated cycles no longer reduce the fill level (or the motor stalls), the bin is marked **full / uncompressible**.
4. The ESP32 publishes its status to the backend, and the staff dashboard shows which bins need attention.

```
 ┌──────────────┐   Wi-Fi    ┌────────────┐   REST    ┌─────────────┐
 │  ESP32 bin   │ ─────────▶ │  Backend   │ ◀──────── │  Staff app  │
 │  (firmware)  │ MQTT/HTTP  │  + database│           │ (dashboard) │
 └──────────────┘            └────────────┘           └─────────────┘
        ▲                          ▲
        │                          │
   real sensors            tools/simulator (fake bins)
```

## Repository structure

```
smart-bin/
├── contract/    # telemetry schema + example messages (source of truth)
├── docs/        # architecture, hardware, safety, API contract, decisions
├── firmware/    # Arduino sketch for ESP32 + laptop unit tests
├── backend/     # ingest, alerts, REST API, database
├── app/         # staff dashboard
└── tools/
    └── simulator/   # fake bins for developing without hardware
```

| Folder | What it contains | Owner |
| --- | --- | --- |
| `firmware/` | Sensors, compactor control, state machine, networking | Tino |
| `backend/` | Telemetry ingest, alert logic, API, DB | Yifan |
| `app/` | Bin list/map, bin detail, alerts, history | Rey |
| `contract/`, `docs/` | Shared interface and documentation | All (changes need everyone's approval) |

## The contract

All three parts communicate through a single telemetry format, defined in [`contract/telemetry.schema.json`](contract/telemetry.schema.json) and described in [`docs/api-contract.md`](docs/api-contract.md).

Example message:

```json
{
  "bin_id": "bin-067",
  "state": "full",
  "compactions_since_empty": 10,
  "weight": 21.8
}
```

`state` is one of: `idle`, `compacting`, `full_uncompressible`, `fault`, `door_open`.

> **Changing the contract:** open a PR touching `contract/` and get approval from all three owners. Update the schema, examples, and `docs/api-contract.md` together.

## Getting started

### Firmware (Arduino IDE + ESP32)

**Requirements**

- Arduino IDE 2.x
- ESP32 board package (Espressif), pinned version: _TBD_
- Libraries (install via Library Manager), pinned versions: _TBD_
  - HX711 (load cell)
  - PubSubClient (MQTT) or built-in `HTTPClient`
  - ArduinoJson

**Setup**

1. Open `firmware/bin_firmware/bin_firmware.ino`.
2. Copy `secrets.example.h` to `secrets.h` and fill in your Wi-Fi and server credentials. This file is gitignored, so never commit it.
3. Check pin assignments and thresholds in `config.h`.
4. Select your ESP32 board and port, then upload.

**Unit tests (no hardware needed)**

The decision logic in `firmware/bin_firmware/src/logic/` contains no Arduino dependencies and is tested on a laptop:

```bash
cd firmware/tests
make test
```

**No board? Use the simulator**

The firmware can run in [Wokwi](https://wokwi.com) using the shared `diagram.json` in `firmware/`. Anyone on the team can run it without hardware.

### Backend

```bash
cd backend
cp .env.example .env     # fill in values
# install and run commands: TBD (depends on chosen stack)
```

### App

```bash
cd app
cp .env.example .env     # point at the backend URL
# install and run commands: TBD (depends on chosen stack)
```

### Simulator (develop without a physical bin)

```bash
cd tools/simulator
python simulate.py --scenario scenarios/normal_fill.yaml
```

Scenarios cover normal fill cycles and bin going offline.

## Safety

The compactor is a crushing mechanism. Safety is enforced **in firmware**, never relying on the server:

- Motor run timeout and maximum cycles per hour
- Current sensing to detect stalls
- Lid/door interlock switch that cuts the motor immediately
- Safe default state on boot or fault

Details are in [`docs/safety.md`](docs/safety.md). Any change to compaction logic must be reviewed with this document.


## Roadmap

- [ ] Contract, repo setup, and simulator
- [ ] Firmware: sensor reading and telemetry publishing (no motor)
- [ ] Backend and app built against simulated data (in parallel)
- [ ] Firmware: compaction state machine and safety features
- [ ] Integration testing with real hardware
- [ ] OTA updates, power optimisation, enclosure/weatherproofing

