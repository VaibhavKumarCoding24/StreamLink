import http2 from "node:http2";
import { MediaStreamService } from "./mediaStream.service";

type Http2MediaServerOptions = {
  port: number;
  host?: string;
};

export class Http2MediaServer {
  private server: http2.Http2Server | null = null;

  constructor(private readonly mediaStreamService: MediaStreamService) {}

  start(options: Http2MediaServerOptions) {
    if (this.server) {
      return;
    }

    this.server = http2.createServer();
    this.server.on("stream", (stream, headers) => {
      const method = headers[http2.constants.HTTP2_HEADER_METHOD];
      const pathHeader = headers[http2.constants.HTTP2_HEADER_PATH];
      const requestPath = typeof pathHeader === "string" ? pathHeader : "";

      if (method !== "GET" || !requestPath) {
        stream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 404 });
        stream.end();
        return;
      }

      const url = new URL(requestPath, "http://streamlink.local");
      const match = url.pathname.match(/^\/media\/([^/]+)\/stream$/);
      if (!match) {
        stream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 404 });
        stream.end();
        return;
      }

      const plan = this.mediaStreamService.buildPlan(match[1], {
        range: typeof headers.range === "string" ? headers.range : undefined
      }, requestPath);

      if (!plan) {
        stream.respond({ [http2.constants.HTTP2_HEADER_STATUS]: 404 });
        stream.end(JSON.stringify({ error: "Media file not found" }));
        return;
      }

      stream.respond({
        [http2.constants.HTTP2_HEADER_STATUS]: plan.statusCode,
        ...plan.headers
      });

      const fileStream = this.mediaStreamService.createReadStream(plan);
      fileStream.on("error", () => {
        if (!stream.closed) {
          stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
        }
      });
      stream.on("close", () => {
        fileStream.destroy();
      });
      fileStream.pipe(stream);
    });

    this.server.listen(options.port, options.host ?? "0.0.0.0");
  }

  stop(callback?: () => void) {
    if (!this.server) {
      callback?.();
      return;
    }

    const server = this.server;
    this.server = null;
    server.close(() => {
      callback?.();
    });
  }
}
