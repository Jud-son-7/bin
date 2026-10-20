# Bin simulator

Publishes fake bin telemetry over MQTT using the format in [`../../contract`](../../contract), so the backend and app can be built and tested without the real ESP32.

Each simulated bin has its own MQTT connection (like a real device), publishes on every state change plus a heartbeat, and sets an `offline` Last Will on `bins/<bin_id>/status`.

## Setup

```bash
cd tools/simulator
python -m venv .venv && source .venv/bin/activate   # optional
pip install -r requirements.txt
```

## Run

You need an MQTT broker. Easiest local option:

```bash
sudo apt install mosquitto mosquitto-clients      # or: brew install mosquitto
mosquitto                                          # listens on localhost:1883
```

Then:

```bash
# terminal 1: watch everything the bins send
mosquitto_sub -t 'bins/#' -v

# terminal 2: run a scenario
python simulate.py --scenario scenarios/fast_demo.yaml
```

No broker handy? Print the messages instead:

```bash
python simulate.py -s scenarios/fast_demo.yaml --dry-run
```

## Options

| Flag | Meaning |
| --- | --- |
| `-s, --scenario` | Scenario YAML file (required) |
| `--host`, `--port` | Broker address (default `localhost:1883`) |
| `--username`, `--password` | Broker credentials, if needed |
| `--speed N` | Time multiplier. `--speed 60` makes 1 real second = 1 simulated minute (at high speeds a few brief states can pass between two messages, so some get skipped) |
| `--duration-s N` | Stop after N simulated seconds |
| `--seed N` | Repeatable random behaviour |
| `--dry-run` | Print instead of publishing |
| `--no-validate` | Skip contract schema checks (they are on by default) |

Every payload is checked against `contract/telemetry.schema.json` before it is sent, so the simulator can never drift from the contract.

## Scenarios

| File | What it does |
| --- | --- |
| `normal_fill.yaml` | One bin at a realistic pace, up to "full" |
| `fast_demo.yaml` | One bin that fills in minutes, then gets emptied |
| `multi_bin.yaml` | Five bins at different rates, for dashboard testing |
| `outage.yaml` | A bin stops reporting for 3 minutes, to test offline detection |

## Writing a scenario

```yaml
name: my_scenario
publish_interval_s: 30        # heartbeat period
duration_s: 0                 # 0 = run until Ctrl+C

defaults:                     # applies to every bin
  fill_rate_pct_per_min: 5

bins:
  - id: bin-001
  - id: bin-002
    fill_rate_pct_per_min: 12 # per-bin override

events:
  - at_s: 600                 # simulated seconds from start
    bin: bin-001              # a bin id, or "all"
    action: empty             # empty | silence
  - at_s: 120
    bin: bin-002
    action: silence
    duration_s: 90
```

Settings you can override (defaults in `simulate.py`): `fill_rate_pct_per_min`, `weight_per_pct_kg`, `start_volume_pct`, `compact_trigger_pct`, `compact_duration_s`, `base_efficiency`, `efficiency_decay`, `min_gain_pct`, `max_weight_kg`, `jitter`.

## How a bin behaves

Weight only ever goes up as rubbish is added, because compaction frees up *volume*, not weight. The simulator tracks a hidden volume level:

1. `idle`: rubbish is added. When volume reaches the trigger level, the bin goes to `compacting`.
2. `compacting`: after the cycle, volume drops, but each cycle is less effective than the last.
3. When a cycle frees up almost nothing (or the weight limit is hit), the bin goes to `full` and stays there until staff empty it.
4. Emptying resets the bin to `idle`, weight `0`, compactions `0`.

This is a simulation for exercising the backend and app, not a model of the real mechanism.
