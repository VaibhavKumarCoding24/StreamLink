# Bluetooth Companion Strategy

## Goal

Provide a production-grade Bluetooth fallback for StreamLink when WiFi or local LAN transfer is unavailable, without breaking the existing Socket.IO and shared-event architecture.

## Why a desktop companion is needed

A browser-hosted web app cannot reliably provide full Bluetooth file transfer and trusted device behavior across laptop environments. For dependable Android-to-laptop Bluetooth transport, StreamLink should add a lightweight desktop companion.

## Proposed architecture

```text
Android App
  |- React Native UI
  |- Native Bluetooth transport module
  |- Pairing + encryption keys
  |- File chunk sender/receiver

Desktop Companion
  |- Local tray/background app
  |- Bluetooth RFCOMM or BLE transport
  |- Secure pairing store
  |- Local HTTP/WebSocket bridge to web app

Web App
  |- UI and playback host
  |- Uses localhost bridge exposed by desktop companion
  |- Same shared command and transfer contracts
```

## Desktop companion responsibilities

- Discover and pair with trusted Android devices over Bluetooth
- Maintain a secure local trust store
- Expose a localhost bridge for the web app at `http://127.0.0.1:4310`
- Forward playback commands between Bluetooth and the existing session model
- Receive and send file chunks over Bluetooth
- Emit local transfer and device-status events to the web app
- Buffer and resume interrupted file transfers

## Recommended desktop technology

### Best option

Use Tauri for the desktop companion.

Why:
- Smaller footprint than Electron
- Strong Rust support for Bluetooth/native system integration
- Easy local HTTP/WebSocket bridge
- Good Windows support for a laptop-first personal system

### Acceptable alternative

Use Electron if you want faster JavaScript-only prototyping and easier shared tooling with the web stack.

## Recommended transport split

### Control plane

- Bluetooth Low Energy for small control messages where available
- Fallback to RFCOMM/Bluetooth Classic if needed on Windows/Android combinations
- Messages use the same command schema as Socket.IO playback commands

### Data plane

- Bluetooth Classic RFCOMM or OBEX-style chunk transport for files
- Chunk size with checksum and retry window
- Resume support keyed by `transferId`

## Security model

- Pairing begins with QR or PIN from the web app
- Web app asks companion to start pairing mode
- Companion generates device challenge
- Android signs challenge with locally stored keypair
- Companion stores trusted device fingerprint and public key
- All Bluetooth payloads are encrypted or signed at the application layer, not only trusted to link-level pairing

## Local bridge API

The companion should expose these localhost endpoints or websocket channels for the web app:

### HTTP

- `GET /health`
- `GET /devices`
- `POST /pairing/start`
- `POST /pairing/confirm`
- `POST /transfers/send`
- `POST /transfers/cancel`

### WebSocket events

- `BT_DEVICE_DISCOVERED`
- `BT_DEVICE_CONNECTED`
- `BT_DEVICE_DISCONNECTED`
- `BT_TRANSFER_PROGRESS`
- `BT_TRANSFER_COMPLETED`
- `BT_TRANSFER_FAILED`
- `BT_COMMAND_RECEIVED`

## Integration with existing StreamLink server

### When WiFi exists

- Android talks to Node server directly over Socket.IO
- File transfer uses WiFi path first
- Companion stays idle unless Bluetooth is explicitly selected

### When WiFi is unavailable

- Android talks to desktop companion over Bluetooth
- Companion forwards playback commands to the local web app bridge
- Companion mirrors command events into the same shared playback model
- File transfers terminate at companion storage and are handed to the web app or saved locally

## Failure handling

- Persist incomplete transfers on both Android and desktop
- Retry with exponential backoff for reconnect
- Fall back from BLE control to Classic transport when throughput or MTU is insufficient
- Surface transport source in UI: `WiFi`, `Bluetooth`, `Reconnecting`

## Suggested repo expansion

```text
apps/
  companion/
    src/
      bridge/
      bluetooth/
      pairing/
      transfers/
      storage/
```

## Companion milestones

1. Create `apps/companion` with localhost bridge and tray shell
2. Implement device trust store and QR/PIN pairing handshake
3. Add Bluetooth control-channel transport for playback commands
4. Add chunked Bluetooth file transfer with checksum and resume
5. Connect web app to localhost companion bridge as fallback transport
6. Add UI transport badges and manual transport selection

## Practical recommendation

For the fastest route to a real product:
- Keep WiFi/LAN as the default path
- Add the desktop companion for Bluetooth fallback
- Preserve the same shared command and transfer contracts so mobile, web, and companion stay aligned