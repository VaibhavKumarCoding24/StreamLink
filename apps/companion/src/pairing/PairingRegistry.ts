type CompanionDevice = {
  id: string;
  name: string;
  startedAt: number;
};

export class PairingRegistry {
  private devices: CompanionDevice[] = [];

  start(deviceName: string) {
    const record = {
      id: `pair-${Date.now()}`,
      name: deviceName,
      startedAt: Date.now()
    };
    this.devices.unshift(record);
    return record;
  }

  listDevices() {
    return this.devices;
  }
}