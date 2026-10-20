# Contract

The agreed interface between the **firmware**, **backend** and **simulator**. If it is not in here, do not rely on it.

> **Changing anything in this folder needs approval from all three owners.** Update the schema, the examples and this README in the same PR.

## Direction of data

Bins **publish only**. For now the ESP receives no commands or instructions from the app or backend. There are no downlink topics.

```
ESP32 bin  --publish-->  MQTT broker  --subscribe-->  Backend  --REST-->  Staff app
```

## MQTT topics

| Topic | Published by | Payload | QoS | Retained |
| --- | --- | --- | --- | --- |
| `bins/<bin_id>/telemetry` | Bin | JSON, see below | 1 | yes |
| `bins/<bin_id>/status` | Bin (and the broker via Last Will) | `online` or `offline` (plain text) | 1 | yes |

The backend subscribes to `bins/+/telemetry` and `bins/+/status`.

**Retained** means a backend that connects or restarts immediately receives each bin's latest message instead of waiting for the next one.

**`status`** is the standard MQTT way to detect a dead bin. On connect the bin publishes `online`. It also registers a Last Will of `offline` when connecting, so the broker publishes `offline` for it if the bin vanishes without disconnecting cleanly (power cut, Wi-Fi drop). This is an addition beyond the four telemetry fields, so drop it if you would rather detect offline bins by missing heartbeats only.

## Telemetry payload

Schema: [`telemetry.schema.json`](telemetry.schema.json)

| Field | Type | Meaning |
| --- | --- | --- |
| `bin_id` | string | Unique bin ID, e.g. `bin-014`. Must equal the `<bin_id>` in the topic |
| `state` | `idle` \| `compacting` \| `full` | `full` means the contents can no longer be compressed and staff need to empty the bin |
| `compactions_since_empty` | integer >= 0 | Completed compaction cycles since the bin was last emptied |
| `weight` | number, kg | Current contents weight |

Example:

```json
{
  "bin_id": "bin-067",
  "state": "idle",
  "compactions_since_empty": 2,
  "weight": 6.4
}
```

More examples are in [`examples/`](examples/). The files in [`examples/invalid/`](examples/invalid/) must be **rejected** by the backend (useful as test cases).

## Rules

1. **Publish on every state change**, and also as a heartbeat every **30 seconds** while running, even if nothing changed. The heartbeat is how the backend knows the bin is alive.
2. **No timestamp in the payload.** The backend stamps each message with its own receive time.
3. **The backend must discard** (and log) any message that fails the schema, or whose `bin_id` does not match the topic.
4. **Emptying:** when staff empty the bin, the firmware sets `state` back to `idle` and `compactions_since_empty` to `0`. How the firmware detects emptying (e.g. weight drops to near zero, or lid opened and closed) is still to be decided, see Open items.
5. **Unknown fields are not allowed** (`additionalProperties: false`). To add a field, change the schema first.

## Open items

- [ ] Broker choice and hosting (Mosquitto, EMQX, a hosted service)
- [ ] Whether the backend will ever send commands to the bin (would need a new topic, e.g. `bins/<bin_id>/cmd`, and a contract update)
