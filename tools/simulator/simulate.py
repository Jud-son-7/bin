#!/usr/bin/env python3
"""Smart Bin simulator.

Pretends to be one or more bins publishing telemetry over MQTT, following the
contract in contract/telemetry.schema.json. Lets the backend and app be built
and tested without the real ESP32.

Examples:
    python simulate.py --scenario scenarios/normal_fill.yaml
    python simulate.py -s scenarios/fast_demo.yaml --host 192.168.1.10
    python simulate.py -s scenarios/multi_bin.yaml --speed 60      # 1 real sec = 1 sim minute
    python simulate.py -s scenarios/fast_demo.yaml --dry-run       # no broker needed, prints only
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path

import yaml

try:
    import paho.mqtt.client as mqtt
except ImportError:  # only needed when not using --dry-run
    mqtt = None

try:
    from jsonschema import Draft202012Validator
except ImportError:  # only needed for payload validation
    Draft202012Validator = None

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "contract" / "telemetry.schema.json"
TELEMETRY_TOPIC = "bins/{bin_id}/telemetry"
STATUS_TOPIC = "bins/{bin_id}/status"
TICK_S = 1.0  # real seconds per loop iteration

# Every value can be overridden per scenario ("defaults:") and per bin.
DEFAULTS = {
    "fill_rate_pct_per_min": 3.0,   # how fast rubbish is added (% of bin volume per minute)
    "weight_per_pct_kg": 0.12,      # kg of rubbish per 1% of volume (before compaction)
    "start_volume_pct": 0.0,        # initial fill level
    "compact_trigger_pct": 85.0,    # start compacting when volume reaches this
    "compact_duration_s": 20.0,     # length of one crush cycle
    "base_efficiency": 0.30,        # first compaction removes 30% of volume
    "efficiency_decay": 0.80,       # each later compaction is 80% as effective
    "min_gain_pct": 3.0,            # if a cycle frees less than this, the bin is "full"
    "max_weight_kg": 30.0,          # also "full" above this weight
    "jitter": 0.25,                 # random +/- variation on fill rate and efficiency
}


class SimBin:
    """Hidden volume model: weight only goes up, but compaction frees up volume
    until it can't any more, at which point the bin reports 'full'."""

    def __init__(self, bin_id, cfg, rng):
        self.id = bin_id
        self.cfg = cfg
        self.rng = rng
        self.state = "idle"
        self.volume_pct = cfg["start_volume_pct"]
        self.weight_kg = cfg["start_volume_pct"] * cfg["weight_per_pct_kg"]
        self.compactions = 0
        self.compact_left = 0.0
        self.volume_before = 0.0
        self.last_publish = None
        self.silent_until = -1.0

    def payload(self):
        return {
            "bin_id": self.id,
            "state": self.state,
            "compactions_since_empty": self.compactions,
            "weight": round(self.weight_kg, 1),
        }

    def empty(self):
        self.state = "idle"
        self.volume_pct = 0.0
        self.weight_kg = 0.0
        self.compactions = 0
        self.compact_left = 0.0

    def step(self, dt):
        """Advance the bin by dt simulated seconds. Returns True if state changed."""
        c = self.cfg
        j = c["jitter"]
        if self.state == "idle":
            added = c["fill_rate_pct_per_min"] * dt / 60.0 * self.rng.uniform(1 - j, 1 + j)
            self.volume_pct += added
            self.weight_kg += added * c["weight_per_pct_kg"]
            if self.weight_kg >= c["max_weight_kg"]:
                self.state = "full"
                return True
            if self.volume_pct >= c["compact_trigger_pct"]:
                self.state = "compacting"
                self.compact_left = c["compact_duration_s"]
                self.volume_before = self.volume_pct
                return True
        elif self.state == "compacting":
            self.compact_left -= dt
            if self.compact_left <= 0:
                eff = c["base_efficiency"] * (c["efficiency_decay"] ** self.compactions)
                eff *= self.rng.uniform(1 - j / 2, 1 + j / 2)
                self.volume_pct = self.volume_before * (1 - eff)
                gain = self.volume_before - self.volume_pct
                self.compactions += 1
                self.state = "full" if gain < c["min_gain_pct"] else "idle"
                return True
        return False


class DryRunPublisher:
    def publish(self, bin_id, payload):
        print(f"  {TELEMETRY_TOPIC.format(bin_id=bin_id)} {json.dumps(payload)}")

    def close(self):
        pass


class MqttPublisher:
    """One MQTT client per bin, like the real hardware (own connection, own Last Will)."""

    def __init__(self, bin_ids, host, port, username, password):
        if mqtt is None:
            sys.exit("paho-mqtt is not installed: pip install -r requirements.txt (or use --dry-run)")
        self.clients = {}
        for bin_id in bin_ids:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"sim-{bin_id}")
            if username:
                client.username_pw_set(username, password)
            status = STATUS_TOPIC.format(bin_id=bin_id)
            client.will_set(status, "offline", qos=1, retain=True)
            try:
                client.connect(host, port, keepalive=30)
            except OSError as exc:
                sys.exit(f"Could not connect to MQTT broker at {host}:{port} ({exc}).\n"
                         "Start a broker (e.g. mosquitto) or run with --dry-run.")
            client.loop_start()
            client.publish(status, "online", qos=1, retain=True)
            self.clients[bin_id] = client

    def publish(self, bin_id, payload):
        topic = TELEMETRY_TOPIC.format(bin_id=bin_id)
        self.clients[bin_id].publish(topic, json.dumps(payload), qos=1, retain=True)
        print(f"  {topic} {json.dumps(payload)}")

    def close(self):
        for bin_id, client in self.clients.items():
            info = client.publish(STATUS_TOPIC.format(bin_id=bin_id), "offline", qos=1, retain=True)
            info.wait_for_publish(timeout=2)
            client.loop_stop()
            client.disconnect()


def load_scenario(path):
    scenario = yaml.safe_load(Path(path).read_text())
    base = {**DEFAULTS, **(scenario.get("defaults") or {})}
    bins = []
    for entry in scenario.get("bins") or []:
        entry = dict(entry)
        bin_id = entry.pop("id")
        unknown = set(entry) - set(DEFAULTS)
        if unknown:
            sys.exit(f"Unknown setting(s) for {bin_id}: {sorted(unknown)}")
        bins.append((bin_id, {**base, **entry}))
    if not bins:
        sys.exit("Scenario defines no bins")
    ids = {b for b, _ in bins}
    events = sorted(scenario.get("events") or [], key=lambda e: e["at_s"])
    for event in events:
        if event["bin"] != "all" and event["bin"] not in ids:
            sys.exit(f"Event refers to unknown bin: {event['bin']}")
        if event["action"] not in ("empty", "silence"):
            sys.exit(f"Unknown event action: {event['action']}")
    return {
        "name": scenario.get("name", Path(path).stem),
        "publish_interval_s": float(scenario.get("publish_interval_s", 30)),
        "duration_s": float(scenario.get("duration_s", 0)),
        "bins": bins,
        "events": events,
    }


def main():
    parser = argparse.ArgumentParser(description="Smart Bin MQTT simulator")
    parser.add_argument("-s", "--scenario", required=True, help="path to a scenario YAML file")
    parser.add_argument("--host", default="localhost", help="MQTT broker host (default: localhost)")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port (default: 1883)")
    parser.add_argument("--username", help="MQTT username, if the broker needs one")
    parser.add_argument("--password", help="MQTT password")
    parser.add_argument("--speed", type=float, default=1.0, help="time multiplier (60 = 1 real sec is 1 sim minute)")
    parser.add_argument("--duration-s", type=float, help="stop after this many simulated seconds (overrides scenario)")
    parser.add_argument("--seed", type=int, help="random seed for repeatable runs")
    parser.add_argument("--dry-run", action="store_true", help="print messages instead of publishing to a broker")
    parser.add_argument("--no-validate", action="store_true", help="skip checking payloads against the contract schema")
    args = parser.parse_args()

    scenario = load_scenario(args.scenario)
    rng = random.Random(args.seed)
    bins = [SimBin(bin_id, cfg, rng) for bin_id, cfg in scenario["bins"]]
    by_id = {b.id: b for b in bins}
    interval = scenario["publish_interval_s"]
    duration = args.duration_s if args.duration_s is not None else scenario["duration_s"]

    validator = None
    if not args.no_validate:
        if Draft202012Validator is None:
            sys.exit("jsonschema is not installed: pip install -r requirements.txt (or use --no-validate)")
        validator = Draft202012Validator(json.loads(SCHEMA_PATH.read_text()))

    publisher = DryRunPublisher() if args.dry_run else MqttPublisher(
        [b.id for b in bins], args.host, args.port, args.username, args.password)

    print(f"Scenario '{scenario['name']}': {len(bins)} bin(s), heartbeat every {interval:g}s, speed x{args.speed:g}")
    print("Ctrl+C to stop.\n")

    def publish(b, now):
        payload = b.payload()
        if validator:
            errors = list(validator.iter_errors(payload))
            if errors:
                sys.exit(f"Simulator produced an invalid payload {payload}: {errors[0].message}")
        print(f"[t={now:7.0f}s]")
        publisher.publish(b.id, payload)
        b.last_publish = now

    pending = list(scenario["events"])
    now = 0.0
    try:
        while True:
            # scripted events (staff empty a bin, a bin goes quiet)
            while pending and pending[0]["at_s"] <= now:
                event = pending.pop(0)
                targets = bins if event["bin"] == "all" else [by_id[event["bin"]]]
                for b in targets:
                    if event["action"] == "empty":
                        print(f"[t={now:7.0f}s] EVENT: {b.id} emptied by staff")
                        b.empty()
                        b.last_publish = None  # force a publish
                    else:
                        until = now + float(event.get("duration_s", 60))
                        print(f"[t={now:7.0f}s] EVENT: {b.id} stops reporting until t={until:.0f}s")
                        b.silent_until = until

            for b in bins:
                # sub-step in <=1 simulated second slices so high --speed stays accurate
                changed, remaining = False, TICK_S * args.speed
                while remaining > 0:
                    slice_s = min(1.0, remaining)
                    changed |= b.step(slice_s)
                    remaining -= slice_s
                silent = now < b.silent_until
                due = b.last_publish is None or now - b.last_publish >= interval
                if (changed or due) and not silent:
                    publish(b, now)

            if duration and now >= duration:
                break
            time.sleep(TICK_S)
            now += TICK_S * args.speed
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        publisher.close()


if __name__ == "__main__":
    main()
