# node-red-contrib-micro800-eip

Read and write **Rockwell / Allen-Bradley Micro800** PLC variables (Micro820, Micro830, Micro850, Micro870) from [Node-RED](https://nodered.org) over **EtherNet/IP (CIP)**.

- **Zero dependencies.** Uses only Node's built-in `net` module.
- **Built for Micro800.** No backplane or slot routing, which is what makes ControlLogix-oriented EtherNet/IP nodes fail against a Micro850.
- **One variable editor.** Define all your tags once on the PLC config node, then pick them in the read and write nodes.

> **Status:** verified against a simulated PLC (`npm test`). Hardware reports are welcome, so please open an issue with your model and firmware version, whether it works or not.

> This project is not affiliated with or endorsed by Rockwell Automation. Allen-Bradley, Micro800 and CCW are trademarks of Rockwell Automation, Inc.

---

## Why another EtherNet/IP node?

Libraries such as `st-ethernet-ip` target ControlLogix/CompactLogix. They route requests through a backplane slot, but a Micro800 has no backplane, so connections fail or time out. This package sends unconnected explicit messages straight to the controller's Message Router, which Micro800 accepts.

## Features

- Read a single variable, or all variables as one object
- Write values, with data type from the variable list or auto-detected
- Polling with an optional "only send on change"
- Array support (`Arr[3]`, or read several elements)
- Automatic reconnect, connection status shown on each node
- Requests are serialised over one TCP session, so the PLC sees a single CIP client

## Requirements

- Node-RED 2.0 or later
- Node.js 12 or later
- A Micro800 reachable on TCP port **44818**

## Installation

Pick one.

### From GitHub

```bash
cd ~/.node-red
npm install YOUR_USERNAME/node-red-contrib-micro800-eip
```

Replace `YOUR_USERNAME` with the GitHub account that hosts the repository, then restart Node-RED.

### From a release `.tgz`

Download `node-red-contrib-micro800-eip-x.y.z.tgz` from the [Releases](../../releases) page, then:

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-micro800-eip-x.y.z.tgz
```

On Windows use `cd %USERPROFILE%\.node-red` and give the full path to the file.

### From a clone

```bash
git clone https://github.com/YOUR_USERNAME/node-red-contrib-micro800-eip.git
cd ~/.node-red
npm install /path/to/node-red-contrib-micro800-eip
```

### Docker

Copy the folder (or `.tgz`) into the container's `/data` volume, then:

```bash
docker exec -it mynodered bash -c "cd /data && npm install /data/node-red-contrib-micro800-eip"
docker restart mynodered
```

### Palette Manager

The Node-RED Palette Manager installs only from the npm registry, so this package appears there only after it has been published to npm.

After installing, restart Node-RED. A **Micro800** category appears in the palette.

### Uninstall / update

```bash
cd ~/.node-red
npm uninstall node-red-contrib-micro800-eip
```

To update, run the same install command again and restart.

## Quick start

1. Drag a **micro800 read** node onto the flow and double-click it.
2. Next to **PLC**, click the pencil to add a new config node.
3. On the **Connection** tab, enter the PLC's IP address.
4. On the **Variables** tab, click **add variable** and fill in a name and the PLC tag, for example `speed` and `Motor1_Speed`. Click **Add**.
5. Back in the read node, choose **Single variable** and select `speed`. Click **Done**.
6. Wire an **inject** node into it and a **debug** node after it, then **Deploy** and click the inject button.

An importable example is in [`examples/example-flow.json`](examples/example-flow.json). Import it via menu, **Import**, then edit the config node's IP and variable list to match your PLC.

## Preparing the Micro800 in CCW

Variables are only readable over EtherNet/IP if:

1. They are **global variables**. Program-local variables are not exposed.
2. Their **External access** (visibility) is set to **Read** or **Read/Write**.
3. The project has been **rebuilt and downloaded** to the PLC after changing it.

Tag names are case-sensitive and must match exactly.

## Node reference

### micro800-config (PLC connection)

**Connection tab**

| Field | Default | Description |
|---|---|---|
| IP / Host | | PLC address |
| Port | 44818 | EtherNet/IP TCP port |
| Timeout (ms) | 5000 | Per-request timeout |
| Retry (ms) | 5000 | Reconnect interval while disconnected |

**Variables tab** is the only place tags are entered. Each row is:

| Column | Description |
|---|---|
| Name | Friendly name used by the nodes and in output objects |
| PLC tag | The tag, e.g. `Motor1_Speed`, `Arr[2]`, `Struct.Member` |
| Data type | `auto` or a fixed type (mainly matters for writes) |
| Elements | Array elements to read from the tag (1 = single value) |

Rows can be reordered by dragging. Empty rows and duplicate names are dropped on save.

### micro800-read

| Setting | Description |
|---|---|
| Read | **Single variable** or **All variables** |
| Variable | Which list entry to read (single mode) |
| Poll (ms) | Read repeatedly at this interval. `0` reads only when a message arrives |
| Only send when value changes | Applies to polling |

| Input property | Description |
|---|---|
| `msg.variable` | Optional. Variable name (or array of names) to read instead of the configured one |

| Output property | Description |
|---|---|
| `msg.payload` | The value, an array (Elements > 1), or `{ name: value }` for several variables |
| `msg.topic` | Variable name (`all` in All mode) |
| `msg.dataType` | Data type name, or an object of them for several variables |

### micro800-write

| Setting | Description |
|---|---|
| Variable | Which list entry to write |

| Input property | Description |
|---|---|
| `msg.payload` | Value to write. An array writes consecutive elements starting at the tag |
| `msg.variable` | Optional. Variable name to write instead of the configured one |

With data type `auto`, the node reads the tag once to learn its type, then caches it. Output carries `msg.topic` and `msg.dataType`.

## Tag syntax

`MyVar` &nbsp; `Struct.Member` &nbsp; `Arr[3]` &nbsp; `Arr[1,2]`

## Supported data types

`BOOL`, `SINT`, `INT`, `DINT`, `LINT`, `USINT`, `UINT`, `UDINT`, `ULINT`, `REAL`, `LREAL`, `STRING`.
Micro800 strings are normally the short form (`SSTRING` in the editor, 1-byte length). User-defined structures are not supported as a whole; add each member as its own variable (`Struct.Member`).

## Troubleshooting

| Symptom | Things to check |
|---|---|
| Status stays red / "disconnected" | Wrong IP, different subnet, firewall. Test with `nc -vz <plc-ip> 44818` |
| `CIP error 0x4` or `0x5` | Tag not found. Check spelling and case, that it is a **global** variable, and its **External access** setting. Rebuild and download from CCW |
| `CIP error 0xf` on write | Variable is read-only. Set External access to Read/Write |
| Timeouts or dropped connections | Close CCW and other EtherNet/IP clients. Micro800 allows only a few simultaneous connections. Use a polling interval of 500 ms or more |
| Wrong or garbled string values | Try the other STRING type for that variable (`SSTRING` or `STRING`) |
| `Unsupported data type 0x...` | The variable is a structure or an unsupported type. Read its members individually |

## Limitations

- Global variables only, by symbolic name.
- No tag browsing or discovery. Variables are entered by hand.
- No structure (UDT) reads, and no bit-level access syntax.
- Unconnected messaging is used for simplicity, so very high-rate polling is not the goal.

## Development

```bash
git clone https://github.com/YOUR_USERNAME/node-red-contrib-micro800-eip.git
cd node-red-contrib-micro800-eip
npm test          # runs the client against a built-in mock PLC
npm pack          # builds the installable .tgz
```

Layout:

```
lib/micro800-client.js    EtherNet/IP + CIP client (no dependencies)
nodes/                    Node-RED nodes (config, read, write) and their editor HTML
test/mock-test.js         Mock Micro800 server and client tests
examples/                 Importable example flow
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to help.

## License

[MIT](LICENSE)
