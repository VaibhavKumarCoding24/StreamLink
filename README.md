# StreamLink

StreamLink is a personal cross-platform media control and file sharing system built as a monorepo. It is designed to feel like Spotify Connect plus AirDrop for your own devices on a local network.

## Apps

- `apps/server`: Node.js + Express + Socket.IO realtime backend
- `apps/web`: React web app that hosts the actual playback engine on the laptop
- `apps/mobile`: React Native Android controller with LAN pairing and file transfer
- `apps/companion`: desktop companion scaffold for Bluetooth fallback
- `packages/shared`: shared theme tokens, event contracts, and types

## What works locally now

- Laptop web host self-registers as a trusted device
- Android app can connect to a laptop LAN URL
- PIN pairing persists trusted devices on the laptop server
- Realtime playback commands sync through Socket.IO
- File upload and download work through the server
- Trusted devices and transfer history persist across server restarts

## Local run

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server on your laptop

```bash
npm run dev:server
```

The server listens on port `4000` and binds to `0.0.0.0` for LAN access.

### 3. Start the web host on your laptop

```bash
npm run dev:web
```

Open the web app in your browser. It will:
- register the laptop host as a trusted device
- show LAN IP addresses you can use from the phone
- generate a pairing PIN for the phone
- let you upload/download shared files

### 4. Start the Android app

```bash
npm run dev:mobile
```

In the app:
- enter the laptop server URL like `http://192.168.0.110:4000`
- tap `Test LAN Connection`
- enter the PIN shown on the laptop web host
- tap `Pair This Phone`
- use playback controls and file sharing

## Validation status

- `npm install`: completed
- Server typecheck: passed
- Server build: passed
- Web typecheck: passed
- Web production build: passed
- Mobile typecheck: passed
- Companion typecheck: passed
- Companion build: passed
- Local server smoke test: passed
- Realtime socket sync smoke test: passed
- Pairing persistence smoke test: passed
- File upload/download smoke test: passed

## Important local note

Bluetooth fallback is not implemented yet. The repository now includes `apps/companion` as the first scaffold for that path, but your local usable path today is WiFi/LAN.

## Production roadmap

### Current MVP hardening

- Add mobile-side download-to-device storage flow instead of browser handoff
- Add transfer targeting to specific devices in the UI
- Replace in-memory playback state with persisted session state if desired
- Add proper auth middleware to REST transfer routes

### Bluetooth fallback

- Extend `apps/companion` into a real desktop bridge
- Add native Android Bluetooth transport module
- Route control-plane and file transfers through the companion when LAN is unavailable
- Keep the same shared event contract between mobile, web, server, and companion

## Deployment

### Server

- Dockerize `apps/server`
- Reverse proxy with Caddy or Nginx
- Enable HTTPS for secure pairing and camera APIs

### Web

- Build with Vite and serve statically behind the same domain as the API

### Mobile

- Build APK/AAB with Expo or React Native bare workflow if native Bluetooth modules are added