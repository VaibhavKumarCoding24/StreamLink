import os from "node:os";
import Bonjour, { Service } from "bonjour-service";
import { STREAMLINK_MDNS_DOMAIN, STREAMLINK_MDNS_PROTOCOL, STREAMLINK_MDNS_TYPE } from "@streamlink/shared";

type MdnsAdvertisementOptions = {
  name: string;
  port: number;
};

const sanitizeInstanceName = (value: string) => value.replace(/[^\w\- .]/g, "").trim() || "StreamLink Host";

export class MdnsService {
  private bonjour: Bonjour | null = null;
  private publishedService: Service | null = null;

  start(options: MdnsAdvertisementOptions) {
    this.stop();

    this.bonjour = new Bonjour();
    this.publishedService = this.bonjour.publish({
      name: sanitizeInstanceName(options.name),
      type: STREAMLINK_MDNS_TYPE,
      protocol: STREAMLINK_MDNS_PROTOCOL,
      port: options.port,
      txt: {
        app: "streamlink",
        version: "1",
        serverName: options.name,
        wsPath: "/socket.io",
        pairing: "pin4",
        hostname: os.hostname()
      }
    });
  }

  stop() {
    this.publishedService?.stop?.();
    this.publishedService = null;
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();
    this.bonjour = null;
  }

  getSummary(port: number) {
    return {
      type: `_${STREAMLINK_MDNS_TYPE}._${STREAMLINK_MDNS_PROTOCOL}`,
      domain: STREAMLINK_MDNS_DOMAIN,
      port
    };
  }
}
