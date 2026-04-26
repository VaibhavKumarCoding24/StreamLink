import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Zeroconf, { ImplType } from "react-native-zeroconf";
import type { DiscoveredStreamLinkServer, StreamLinkDiscoveryTxt } from "@streamlink/shared";
import { STREAMLINK_MDNS_DOMAIN, STREAMLINK_MDNS_PROTOCOL, STREAMLINK_MDNS_TYPE } from "@streamlink/shared";

type ZeroconfService = {
  name: string;
  fullName?: string;
  host?: string;
  port: number;
  addresses?: string[];
  txt?: Record<string, string>;
};

const scanCooldownMs = 500;

const pickAddresses = (service: ZeroconfService) =>
  (service.addresses ?? []).filter((address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address));

const toDiscoveredServer = (service: ZeroconfService): DiscoveredStreamLinkServer | null => {
  const addresses = pickAddresses(service);
  const primaryAddress = addresses[0];
  if (!primaryAddress) {
    return null;
  }

  return {
    id: service.fullName ?? `${service.name}-${primaryAddress}-${service.port}`,
    name: service.name,
    host: service.host ?? primaryAddress,
    port: service.port,
    addresses,
    serverUrl: `http://${primaryAddress}:${service.port}`,
    txt: (service.txt ?? {}) as Partial<StreamLinkDiscoveryTxt>
  };
};

export function useMdnsDiscovery() {
  const zeroconfRef = useRef<Zeroconf | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [services, setServices] = useState<DiscoveredStreamLinkServer[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const replaceService = useCallback((next: DiscoveredStreamLinkServer) => {
    setServices((current) => {
      const otherServices = current.filter((item) => item.id !== next.id);
      return [next, ...otherServices].sort((left, right) => left.name.localeCompare(right.name));
    });
  }, []);

  const stopScan = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    zeroconfRef.current?.stop(ImplType.DNSSD);
    setIsScanning(false);
  }, []);

  const startScan = useCallback(() => {
    const zeroconf = zeroconfRef.current;
    if (!zeroconf) {
      return;
    }

    setScanError(null);
    setServices([]);
    setIsScanning(true);
    zeroconf.scan(STREAMLINK_MDNS_TYPE, STREAMLINK_MDNS_PROTOCOL, STREAMLINK_MDNS_DOMAIN, ImplType.DNSSD);

    timeoutRef.current = setTimeout(() => {
      stopScan();
    }, 8000);
  }, [stopScan]);

  useEffect(() => {
    const zeroconf = new Zeroconf();
    zeroconfRef.current = zeroconf;

    const handleResolved = (service: ZeroconfService) => {
      const discovered = toDiscoveredServer(service);
      if (!discovered) {
        return;
      }

      if (discovered.txt.app && discovered.txt.app !== "streamlink") {
        return;
      }

      replaceService(discovered);
    };

    const handleError = (error: Error) => {
      setScanError(error.message);
      setIsScanning(false);
    };

    const handleStop = () => {
      setIsScanning(false);
    };

    zeroconf.on("resolved", handleResolved);
    zeroconf.on("error", handleError);
    zeroconf.on("stop", handleStop);

    startScan();

    return () => {
      stopScan();
      zeroconf.removeListener("resolved", handleResolved);
      zeroconf.removeListener("error", handleError);
      zeroconf.removeListener("stop", handleStop);
      zeroconf.removeDeviceListeners();
      zeroconfRef.current = null;
    };
  }, [replaceService, startScan, stopScan]);

  const refresh = useCallback(() => {
    stopScan();
    setTimeout(() => {
      startScan();
    }, scanCooldownMs);
  }, [startScan, stopScan]);

  return useMemo(
    () => ({
      services,
      isScanning,
      scanError,
      refresh
    }),
    [isScanning, refresh, scanError, services]
  );
}
