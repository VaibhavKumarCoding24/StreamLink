import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { BluetoothBridge } from "./bluetooth/BluetoothBridge";
import { PairingRegistry } from "./pairing/PairingRegistry";
import { TransferRegistry } from "./transfers/TransferRegistry";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/bridge" });

const pairingRegistry = new PairingRegistry();
const transferRegistry = new TransferRegistry();
const bluetoothBridge = new BluetoothBridge();

app.use(express.json());
app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: "companion-scaffold", ts: Date.now() });
});
app.get("/devices", (_req, res) => {
  res.json(pairingRegistry.listDevices());
});
app.post("/pairing/start", (req, res) => {
  res.json(pairingRegistry.start(req.body?.deviceName ?? "Android Device"));
});
app.post("/transfers/send", (req, res) => {
  const transfer = transferRegistry.queueTransfer(req.body);
  res.status(202).json(transfer);
});

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "BT_COMPANION_READY", ts: Date.now() }));
  socket.on("message", (data) => {
    bluetoothBridge.handleBridgeMessage(data.toString());
  });
});

const port = Number(process.env.COMPANION_PORT ?? 4310);
server.listen(port, "127.0.0.1", () => {
  console.log(`streamlink companion scaffold listening on http://127.0.0.1:${port}`);
});