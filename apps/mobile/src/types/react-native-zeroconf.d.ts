declare module "react-native-zeroconf" {
  export const ImplType: {
    NSD: "NSD";
    DNSSD: "DNSSD";
  };

  export default class Zeroconf {
    constructor();
    on(event: string, listener: (...args: any[]) => void): this;
    removeListener(event: string, listener: (...args: any[]) => void): this;
    scan(type?: string, protocol?: string, domain?: string, implType?: "NSD" | "DNSSD"): void;
    stop(implType?: "NSD" | "DNSSD"): void;
    removeDeviceListeners(): void;
  }
}
