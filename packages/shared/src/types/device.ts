export type DeviceType = "web" | "android" | "server" | "companion";

export type TrustedDevice = {
  id: string;
  name: string;
  type: DeviceType;
  fingerprint: string;
  trustedAt: number;
  lastSeenAt: number;
  isHost?: boolean;
};

export type PairedDevice = TrustedDevice & {
  accessToken: string;
};

export type PairingSession = {
  pin: string;
  expiresAt: number;
  deviceName: string;
  createdAt: number;
};

export type PairDevicePayload = {
  deviceName: string;
  deviceType: Extract<DeviceType, "web" | "android">;
  fingerprint: string;
  pin: string;
};

export type RegisterHostPayload = {
  deviceName: string;
  fingerprint: string;
};

export type VerifyDevicePayload = {
  deviceId: string;
  accessToken: string;
};