import * as http from "http";
import * as https from "https";
import { EventEmitter } from "events";

interface Engine {
  request: {
    (
      options: string | http.RequestOptions | URL,
      callback?: ((res: http.IncomingMessage) => void) | undefined
    ): http.ClientRequest;
    (
      url: string | URL,
      options: http.RequestOptions,
      callback?: ((res: http.IncomingMessage) => void) | undefined
    ): http.ClientRequest;
    (
      url: string | URL,
      options: https.RequestOptions,
      callback?: ((res: http.IncomingMessage) => void) | undefined
    ): http.ClientRequest;
  };
}

interface RequestReadyData {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
}

interface Request extends EventEmitter {
  addListener(event: "ready", listener: (data: RequestReadyData) => void): this;
  addListener(event: "close", listener: () => void): this;
  addListener(event: "data", listener: (chunk: any) => void): this;
  addListener(event: "end", listener: () => void): this;
  addListener(event: "error", listener: (err: Error) => void): this;

  emit(event: "ready", data: RequestReadyData): boolean;
  emit(event: "close"): boolean;
  emit(event: "data", chunk: Buffer): boolean;
  emit(event: "end"): boolean;
  emit(event: "error", err: Error): boolean;

  on(event: "close", listener: () => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "ready", listener: (data: RequestReadyData) => void): this;

  once(event: "ready", listener: (data: RequestReadyData) => void): this;
  once(event: "close", listener: () => void): this;
  once(event: "data", listener: (chunk: any) => void): this;
  once(event: "end", listener: () => void): this;
  once(event: "error", listener: (err: Error) => void): this;

  prependListener(event: "close", listener: () => void): this;
  prependListener(event: "data", listener: (chunk: any) => void): this;
  prependListener(event: "end", listener: () => void): this;
  prependListener(event: "error", listener: (err: Error) => void): this;
  prependListener(
    event: "ready",
    listener: (data: RequestReadyData) => void
  ): this;

  prependOnceListener(event: "close", listener: () => void): this;
  prependOnceListener(event: "data", listener: (chunk: any) => void): this;
  prependOnceListener(event: "end", listener: () => void): this;
  prependOnceListener(event: "error", listener: (err: Error) => void): this;
  prependOnceListener(
    event: "ready",
    listener: (data: RequestReadyData) => void
  ): this;

  removeListener(event: "close", listener: () => void): this;
  removeListener(event: "data", listener: (chunk: any) => void): this;
  removeListener(event: "end", listener: () => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
  removeListener(
    event: "ready",
    listener: (data: RequestReadyData) => void
  ): this;
}

class Request extends EventEmitter {
  destroyed: boolean;
  address: string;
  options: http.RequestOptions;
  private _end: boolean;
  private _engine: Engine;
  private _req?: http.ClientRequest;

  constructor(address: string, options?: http.RequestOptions) {
    super();
    this.destroyed = false;
    this.address = address;
    this._end = false;
    this.options = Object.assign(
      {
        method: "GET",
      },
      options
    );

    if (address.startsWith("https")) {
      this._engine = https;
    } else {
      this._engine = http;
    }
  }

  end(): Request {
    if (this.destroyed)
      throw new Error("Calling start() with a destroyed Request.");

    this._req = this._engine.request(this.address, this.options, (res) => {
      this.emit("ready", {
        statusCode: res.statusCode || 500,
        headers: res.headers,
      });
      res.on("close", () => this.emit("close"));
      res.on("end", () => {
        this._end = true;
        this.emit("end");
      });
      res.on("data", (chunk) => this.emit("data", chunk));
      res.on("error", (error) => this.emit("error", error));
    });
    this._req.on("error", (error) => this.emit("error", error));
    process.nextTick(() => (<http.ClientRequest>this._req).end());
    return this;
  }

  async wait(): Promise<boolean> {
    await new Promise((res) => this.once("close", res));
    return this._end;
  }

  pipe(dest: NodeJS.WritableStream): Request {
    if (this.destroyed)
      throw new Error("Calling start() with a destroyed Request.");

    this._req = this._engine.request(this.address, this.options, (res) => {
      this.emit("ready", {
        statusCode: res.statusCode || 500,
        headers: res.headers,
      });
      res.pipe(dest);
      res.on("close", () => this.emit("close"));
      res.on("end", () => {
        this._end = true;
        this.emit("end");
      });
      res.on("data", (chunk) => this.emit("data", chunk));
      res.on("error", (error) => this.emit("error", error));
    });
    this._req.on("error", (error) => this.emit("error", error));
    process.nextTick(() => (<http.ClientRequest>this._req).end());
    return this;
  }

  destroy(): void {
    this.destroyed = true;
    if (!this._req) return;
    this._req.destroy();
  }
}

export async function followRedirect(
  address: string,
  opts?: http.RequestOptions
): Promise<{ address: string; headers?: http.IncomingHttpHeaders }> {
  const visited = new Set<string>();
  let currentAddress = address;
  while (true) {
    if (visited.has(currentAddress))
      throw new Error(`Infinite redirect is detected at ${currentAddress}`);
    visited.add(currentAddress);

    const { headers, statusCode } = await requestHeader(currentAddress, opts);
    if (statusCode === 200 || statusCode === 206) {
      return {
        address: currentAddress,
        headers,
      };
    } else if (statusCode > 300 && statusCode < 400) {
      if (!headers) throw new Error("No header data");
      if (!headers.location)
        throw new Error(
          `HTTP Response code is ${statusCode} but "location" is not in headers`
        );
      currentAddress = headers.location;
    } else {
      if (currentAddress !== address) return { address: currentAddress };
      throw new Error(`Got HTTP Response code ${statusCode}`);
    }
  }
}

export async function requestHeader(
  address: string,
  options?: http.RequestOptions
): Promise<RequestReadyData> {
  let req = new Request(
    address,
    Object.assign({}, options, { method: "HEAD" })
  ).end();

  let res = await Promise.race([
    new Promise<RequestReadyData>((res) => req.once("ready", res)),
    new Promise<Error>((res) => req.once("error", res)),
  ]);

  let code = (<RequestReadyData>res).statusCode;
  if (code === 403) {
    req = new Request(
      address,
      Object.assign({}, options, { method: "GET" })
    ).end();

    res = await Promise.race([
      new Promise<RequestReadyData>((res) => req.once("ready", res)),
      new Promise<Error>((res) => req.once("error", res)),
    ]);

    code = (<RequestReadyData>res).statusCode;
  }

  if (code) {
    return <RequestReadyData>res;
  }
  throw res;
}

export default Request;
