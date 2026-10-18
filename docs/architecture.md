# Architecture

This document describes how the Smart Bin system fits together and who owns each part. The diagrams use [Mermaid](https://mermaid.js.org/), which renders automatically on GitHub.

## 1. System overview

Arrows are labelled with what is sent, and they point from the side that **initiates** the connection to the side that receives it.

```mermaid
flowchart LR
    subgraph BIN["Smart bin (ESP32 firmware)"]
        direction TB
        S1["Load cell<br/>(weight)"]
        S2["Distance sensor<br/>(fill level)"]
        S3["Limit switches +<br/>lid interlock"]
        LOGIC["State machine<br/>(fullness + compaction logic)"]
        MOTOR["Motor driver +<br/>compactor"]
        NET["Network client<br/>(Wi-Fi, offline buffer)"]

        S1 --> LOGIC
        S2 --> LOGIC
        S3 --> LOGIC
        LOGIC --> MOTOR
        LOGIC --> NET
    end

    subgraph SERVER["Backend"]
        direction TB
        INGEST["Ingest<br/>(validate against schema)"]
        ALERTS["Alert logic<br/>(full / jammed / offline)"]
        DB[("Database<br/>bins + status history")]
        API["REST API"]

        INGEST --> DB
        INGEST --> ALERTS
        ALERTS --> DB
        DB --> API
    end

    APP["Staff app<br/>(dashboard)"]
    PUSH["Push notification service<br/>(optional)"]
    SIM["tools/simulator<br/>(fake bins)"]

    NET -- "telemetry (MQTT or HTTP)" --> INGEST
    SIM -. "fake telemetry" .-> INGEST
    APP -- "requests bin data" --> API
    ALERTS -. "alert events" .-> PUSH
    PUSH -.-> APP
```

**Reading the diagram**

- Solid arrows are the main data path. Dotted arrows are optional or development-only.
- Telemetry flows bin → backend → app. The bin never talks to the app directly.
- Safety logic (motor limits, interlock) lives entirely inside the firmware box. The server is never in the safety path.

## 2. Telemetry and alert flow

```mermaid
sequenceDiagram
    participant Bin as ESP32 bin
    participant BE as Backend
    participant DB as Database
    participant App as Staff app

    loop every N seconds
        Bin->>BE: telemetry (fill_pct, weight_kg, state, ...)
        BE->>BE: validate against contract schema
        BE->>DB: store status
        BE->>BE: evaluate alert rules
    end

    Note over Bin: Fill threshold reached
    Bin->>Bin: run compaction cycle
    Bin->>BE: telemetry (state = compacting)

    Note over Bin: Fill no longer drops after cycles
    Bin->>BE: telemetry (state = full_uncompressible)
    BE->>DB: mark bin as needs emptying
    BE-->>App: push notification (optional)

    App->>BE: GET /bins
    BE->>DB: query current status
    DB-->>BE: bin list
    BE-->>App: bin list with statuses
```

If the bin loses Wi-Fi, the firmware buffers readings locally and sends them when the connection returns. The backend marks a bin **offline** if it hasn't reported within an expected window.

## 3. Firmware state machine

The state machine lives in `firmware/bin_firmware/src/logic/` and has no Arduino dependencies, so it can be unit-tested on a laptop.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Compacting: fill above threshold
    Compacting --> Idle: cycle done and fill reduced
    Compacting --> FullUncompressible: cycle done and fill not reduced
    Compacting --> Fault: timeout, stall, or sensor error
    Idle --> DoorOpen: lid interlock opened
    Compacting --> DoorOpen: lid interlock opened (motor stops)
    DoorOpen --> Idle: lid closed
    FullUncompressible --> Idle: bin emptied
    Fault --> Idle: manual reset
```

The state names match the `state` values in the telemetry contract (`idle`, `compacting`, `full_uncompressible`, `fault`, `door_open`).

## 4. Components and ownership

| Component | Location | Responsibility | Owner |
| --- | --- | --- | --- |
| Firmware | `firmware/` | Sensing, compaction control, safety, telemetry | Person_1 |
| Backend | `backend/` | Ingest, alert rules, storage, REST API | Person_2 |
| Staff app | `app/` | Bin list, detail, alerts, history | Person_3 |
| Contract | `contract/` | Telemetry schema and examples | All |
| Simulator | `tools/simulator/` | Fake bins for development without hardware | Person_1 |

## 5. Interfaces between components

| Interface | Direction | Defined in |
| --- | --- | --- |
| Telemetry | Bin → Backend | `contract/telemetry.schema.json` |
| Bin data API | App → Backend | `docs/api-contract.md` |
| Push alerts (optional) | Backend → App | `docs/api-contract.md` |

Each part only depends on these interfaces, which is what lets the three people work independently and test against the simulator.

## 6. Open decisions

- [ ] Transport: MQTT (broker) or plain HTTP POST
- [ ] Backend stack and hosting
- [ ] App platform (web, mobile, or both)
- [ ] Real-time updates in the app: polling, WebSockets, or realtime subscriptions
- [ ] Reporting interval and offline window
- [ ] Whether the backend ever sends commands back to the bin (e.g. remote compact)

Implementation decisions that we still need to agree on and update in `docs/decisions/`.