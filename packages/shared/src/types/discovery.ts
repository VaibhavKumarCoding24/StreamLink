export const STREAMLINK_MDNS_TYPE = "streamlink";
export const STREAMLINK_MDNS_PROTOCOL = "tcp";
export const STREAMLINK_MDNS_DOMAIN = "local.";

export type StreamLinkDiscoveryTxt = {
  app: "streamlink";
  version: string;
  serverName: string;
  wsPath: string;
  pairing: "pin4";
};

export type DiscoveredStreamLinkServer = {
  id: string;
  name: string;
  host: string;
  port: number;
  addresses: string[];
  serverUrl: string;
  txt: Partial<StreamLinkDiscoveryTxt>;
};
