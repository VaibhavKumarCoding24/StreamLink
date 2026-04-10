import { randomBytes, randomInt } from "node:crypto";
import type { PairDevicePayload, PairingSession, PairedDevice, RegisterHostPayload, TrustedDevice } from "@streamlink/shared";
import { v4 as uuid } from "uuid";
import { readJsonFile, writeJsonFile } from "./jsonStore";

type DeviceStore = {
  devices: PairedDevice[];
  pairings: PairingSession[];
};

const initialStore: DeviceStore = {
  devices: [],
  pairings: []
};

export class DeviceTrustService {
  private store: DeviceStore;

  constructor(private readonly storageFile: string) {
    this.store = readJsonFile<DeviceStore>(storageFile, initialStore);
  }

  private persist() {
    writeJsonFile(this.storageFile, this.store);
  }

  private sanitize(device: PairedDevice): TrustedDevice {
    const { accessToken: _accessToken, ...safe } = device;
    return safe;
  }

  private generateToken() {
    return randomBytes(24).toString("hex");
  }

  createPairingSession(deviceName: string): PairingSession {
    const pin = String(randomInt(100000, 999999));
    const session: PairingSession = {
      pin,
      deviceName,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000
    };

    this.store.pairings = this.store.pairings.filter((item) => item.expiresAt > Date.now());
    this.store.pairings.push(session);
    this.persist();
    return session;
  }

  registerHostDevice(input: RegisterHostPayload): PairedDevice {
    const existing = this.store.devices.find((device) => device.fingerprint === input.fingerprint && device.isHost);
    if (existing) {
      existing.lastSeenAt = Date.now();
      this.persist();
      return existing;
    }

    const device: PairedDevice = {
      id: uuid(),
      name: input.deviceName,
      type: "web",
      fingerprint: input.fingerprint,
      trustedAt: Date.now(),
      lastSeenAt: Date.now(),
      isHost: true,
      accessToken: this.generateToken()
    };

    this.store.devices.push(device);
    this.persist();
    return device;
  }

  trustDevice(input: PairDevicePayload): PairedDevice {
    const pairing = this.store.pairings.find((item) => item.pin === input.pin && item.expiresAt > Date.now());
    if (!pairing) {
      throw new Error("Pairing PIN is invalid or expired");
    }

    const existing = this.store.devices.find((device) => device.fingerprint === input.fingerprint && device.type === input.deviceType);
    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.name = input.deviceName;
      this.store.pairings = this.store.pairings.filter((item) => item.pin !== input.pin);
      this.persist();
      return existing;
    }

    const device: PairedDevice = {
      id: uuid(),
      name: input.deviceName,
      type: input.deviceType,
      fingerprint: input.fingerprint,
      trustedAt: Date.now(),
      lastSeenAt: Date.now(),
      accessToken: this.generateToken()
    };

    this.store.devices.push(device);
    this.store.pairings = this.store.pairings.filter((item) => item.pin !== input.pin);
    this.persist();
    return device;
  }

  verifyDevice(deviceId: string, accessToken: string): PairedDevice | null {
    const device = this.store.devices.find((item) => item.id === deviceId && item.accessToken === accessToken);
    if (!device) return null;
    device.lastSeenAt = Date.now();
    this.persist();
    return device;
  }

  markSeen(deviceId: string): void {
    const device = this.store.devices.find((item) => item.id === deviceId);
    if (!device) return;
    device.lastSeenAt = Date.now();
    this.persist();
  }

  listTrustedDevices(): TrustedDevice[] {
    return this.store.devices.map((device) => this.sanitize(device));
  }

  findTrustedDevice(deviceId: string): TrustedDevice | null {
    const device = this.store.devices.find((item) => item.id === deviceId);
    return device ? this.sanitize(device) : null;
  }
}