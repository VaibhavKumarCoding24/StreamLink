# Architecture

## Monorepo layout

```text
apps/
  server/
  web/
  mobile/
packages/
  shared/
```

## Server responsibilities

- Maintain authoritative playback state
- Deduplicate commands
- Broadcast state snapshots
- Manage pairing and trusted devices
- Initialize file transfers and emit progress

## Web responsibilities

- Render premium glass UI
- Mirror shared playback state
- Host the actual HTML audio playback engine
- Emit transport-agnostic commands through Socket.IO

## Mobile responsibilities

- Mirror the same playback UI logic with shared tokens
- Emit commands only, not direct playback in phase 1
- Support pairing and file transfer initiation

## Shared package responsibilities

- Event contracts for Socket.IO
- Playback and transfer domain types
- Theme tokens and motion constants

## Command lifecycle

```text
Android/Web action
  -> Socket command event
  -> Server validation and dedupe
  -> State mutation + version increment
  -> Broadcast SYNC_STATE
  -> Web audio engine reconciles actual playback
  -> Android/Web mirror UI updates
```

## Reliability rules

- Commands must carry `commandId`
- State must carry `version`
- Clients ignore stale snapshots
- Reconnect always triggers sync
- Queue and playback state should eventually persist beyond memory in production

## Bluetooth production plan

- Keep WiFi as the default transport
- Add a desktop companion for laptop-side Bluetooth support
- Add a native Android Bluetooth module for file and control fallback
- Reuse the same shared command and transfer contracts
- See `BLUETOOTH_COMPANION.md` for the detailed strategy