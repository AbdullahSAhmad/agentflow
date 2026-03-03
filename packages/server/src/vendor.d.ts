declare module 'ws' {
  import { EventEmitter } from 'events';
  class WebSocket extends EventEmitter {
    constructor(address: string | URL, options?: object);
    send(data: string | Buffer | ArrayBuffer, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    readonly readyState: number;
    static readonly OPEN: number;
  }
  export { WebSocket };
  export default WebSocket;
}
