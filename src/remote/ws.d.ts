declare module 'ws' {
  import { EventEmitter } from 'node:events';
  import { IncomingMessage, Server as HttpServer } from 'node:http';
  import { Duplex } from 'node:stream';

  class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readyState: number;
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    on(event: 'message', cb: (data: Buffer) => void): this;
    on(event: 'close', cb: () => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
  }

  class WebSocketServer extends EventEmitter {
    constructor(options: { noServer?: boolean; server?: HttpServer; port?: number });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (ws: WebSocket) => void,
    ): void;
  }

  export { WebSocket, WebSocketServer };
}
