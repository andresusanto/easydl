import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";

import { delay } from "./helpers";
import { fileStats, validate } from "./fs";
import Request, { followRedirect, requestHeader } from "./request";

interface Options {
  connections?: number;
  existBehavior?: "overwrite" | "new_file" | "ignore";
  followRedirect?: boolean;
  httpOptions?: http.RequestOptions;
  chunkSize?: number | { (size: number): number };
  maxRetry?: number;
  retryDelay?: number;
  retryBackoff?: number;
  reportInterval?: number;
}

interface ReadyData {
  finalAddress: string;
  paralel: boolean;
  resumable: boolean;
}

interface RetryInfo {
  chunkId: number;
  attempt: number;
  error: Error;
}

interface Progress {
  speed?: number;
  bytes?: number;
  percentage: number;
}

interface ProgressReport {
  total: Progress;
  details: Progress[];
}

interface SpeedStat {
  time: number;
  bytes: number;
}

interface Metadata {
  chunks: number[];
  isResume: boolean;
  progress: number[];
  finalAddress: string;
  paralel: boolean;
  resumable: boolean;
  headers: http.IncomingHttpHeaders | null;
  savedFilePath: string;
}

interface EasyDl extends EventEmitter {
  addListener(
    event: "progress",
    listener: (data: ProgressReport) => void
  ): this;
  addListener(event: "build", listener: (progress: Progress) => void): this;
  addListener(event: "metadata", listener: (data: Metadata) => void): this;
  addListener(event: "retry", listener: (data: RetryInfo) => void): this;
  addListener(event: "ready", listener: (data: ReadyData) => void): this;
  addListener(event: "close", listener: () => void): this;
  addListener(event: "data", listener: (chunk: any) => void): this;
  addListener(event: "end", listener: () => void): this;
  addListener(event: "error", listener: (err: Error) => void): this;

  emit(event: "build", data: Progress): boolean;
  emit(event: "metadata", data: Metadata): boolean;
  emit(event: "progress", data: ProgressReport): boolean;
  emit(event: "retry", data: RetryInfo): boolean;
  emit(event: "ready", data: ReadyData): boolean;
  emit(event: "close"): boolean;
  emit(event: "data", chunk: Buffer): boolean;
  emit(event: "end"): boolean;
  emit(event: "error", err: Error): boolean;

  on(event: "build", listener: (progress: Progress) => void): this;
  on(event: "metadata", listener: (data: Metadata) => void): this;
  on(event: "progress", listener: (data: ProgressReport) => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "ready", listener: (data: ReadyData) => void): this;
  on(event: "retry", listener: (data: RetryInfo) => void): this;

  once(event: "build", listener: (progress: Progress) => void): this;
  once(event: "metadata", listener: (data: Metadata) => void): this;
  once(event: "progress", listener: (data: ProgressReport) => void): this;
  once(event: "retry", listener: (data: RetryInfo) => void): this;
  once(event: "ready", listener: (data: ReadyData) => void): this;
  once(event: "close", listener: () => void): this;
  once(event: "data", listener: (chunk: any) => void): this;
  once(event: "end", listener: () => void): this;
  once(event: "error", listener: (err: Error) => void): this;

  prependListener(event: "build", listener: (progress: Progress) => void): this;
  prependListener(event: "metadata", listener: (data: Metadata) => void): this;
  prependListener(
    event: "progress",
    listener: (data: ProgressReport) => void
  ): this;
  prependListener(event: "retry", listener: (data: RetryInfo) => void): this;
  prependListener(event: "close", listener: () => void): this;
  prependListener(event: "data", listener: (chunk: any) => void): this;
  prependListener(event: "end", listener: () => void): this;
  prependListener(event: "error", listener: (err: Error) => void): this;
  prependListener(event: "ready", listener: (data: ReadyData) => void): this;

  prependOnceListener(
    event: "build",
    listener: (progress: Progress) => void
  ): this;
  prependOnceListener(
    event: "metadata",
    listener: (data: Metadata) => void
  ): this;
  prependOnceListener(
    event: "progress",
    listener: (data: ProgressReport) => void
  ): this;
  prependOnceListener(
    event: "retry",
    listener: (data: RetryInfo) => void
  ): this;
  prependOnceListener(event: "close", listener: () => void): this;
  prependOnceListener(event: "data", listener: (chunk: any) => void): this;
  prependOnceListener(event: "end", listener: () => void): this;
  prependOnceListener(event: "error", listener: (err: Error) => void): this;
  prependOnceListener(
    event: "ready",
    listener: (data: ReadyData) => void
  ): this;

  removeListener(event: "build", listener: (progress: Progress) => void): this;
  removeListener(event: "metadata", listener: (data: Metadata) => void): this;
  removeListener(
    event: "progress",
    listener: (data: ProgressReport) => void
  ): this;
  removeListener(event: "retry", listener: (data: RetryInfo) => void): this;
  removeListener(event: "close", listener: () => void): this;
  removeListener(event: "data", listener: (chunk: any) => void): this;
  removeListener(event: "end", listener: () => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
  removeListener(event: "ready", listener: (data: ReadyData) => void): this;
}

class EasyDl extends EventEmitter {
  private _started: boolean = false;
  private _destroyed: boolean = false;
  private _opts: Options;
  private _url: string;
  private _dest: string;

  private _reqs: Request[] = [];
  private _attempts: number[] = [];
  private _ranges: Array<[number, number]> = [];
  private _done: boolean = false;

  private _jobs: number[] = [];
  private _size: number = 0;
  private _workers: number = 0;
  private _downloadedChunks: number = 0;
  private _totalChunks: number = 0;

  private _partsSpeedRef: SpeedStat[] = [];
  private _speedRef: SpeedStat = { time: Date.now(), bytes: 0 };

  isResume: boolean = false;
  savedFilePath: string | null;
  totalProgress: Progress = { speed: 0, bytes: 0, percentage: 0 };
  partsProgress: Progress[] = [];
  finalAddress: string;
  paralel: boolean = true;
  resumable: boolean = true;
  headers: http.IncomingHttpHeaders | null = null;

  constructor(url: string, dest: string, options?: Options) {
    super();
    this._opts = Object.assign(
      {
        existBehavior: "new_file",
        followRedirect: true,
        connections: 3,
        chunkSize: 1024 * 1024,
        maxRetry: 3,
        retryDelay: 2000,
        retryBackoff: 3000,
        reportInterval: 2500,
      },
      options
    );
    this._url = url;
    this._dest = path.resolve(dest);
    this.savedFilePath = this._dest;
    this._attempts = Array(<number>this._opts.maxRetry)
      .fill(1)
      .map((v, i) => v + i);
    this._start = this._start.bind(this);

    this.finalAddress = url;
  }

  private async _ensureDest() {
    while (this.savedFilePath) {
      const stats = await fileStats(this.savedFilePath);
      if (stats && stats.isDirectory()) {
        this.savedFilePath = path.join(
          this.savedFilePath,
          path.posix.basename(this._url)
        );
      } else if (stats && this._opts.existBehavior === "new_file") {
        const loc = path.parse(this.savedFilePath);
        this.savedFilePath = path.join(loc.dir, `${loc.name}(COPY)${loc.ext}`);
      } else if (stats && this._opts.existBehavior === "ignore") {
        this.savedFilePath = null;
      } else {
        break;
      }
    }
  }

  private async _getHeaders() {
    if (this._opts.followRedirect) {
      const redirResult = await followRedirect(
        this._url,
        this._opts.httpOptions
      );
      this.finalAddress = redirResult.address;
      this.headers = redirResult.headers || null;
    } else {
      const headerResult = await requestHeader(
        this._url,
        this._opts.httpOptions
      );
      if (headerResult.statusCode !== 200 && headerResult.statusCode !== 206)
        throw new Error(`Got HTTP response ${headerResult.statusCode}`);
      this.headers = headerResult.headers;
    }
  }

  private async _buildFile() {
    if (this._destroyed) return;
    this.emit("build", { percentage: 0 });
    const dest = fs.createWriteStream(<string>this.savedFilePath);
    for (let i = 0; i < this._totalChunks; i += 1) {
      const fileName = `${this.savedFilePath}.$$${i}`;
      const source = fs.createReadStream(fileName);
      await new Promise((res, rej) => {
        source.pipe(dest, { end: false });
        source.on("error", rej);
        source.on("end", res);
      });
      source.close();
      this.emit("build", {
        percentage: 100 * (i / this._totalChunks),
      });
    }
    for (let i = 0; i < this._totalChunks; i += 1) {
      const fileName = `${this.savedFilePath}.$$${i}`;
      await new Promise((res) => fs.unlink(fileName, res));
    }
    dest.close();
    this._done = true;
    this.emit("end");
    this.destroy();
  }

  private _onChunkCompleted(id: number) {
    if (!this._reqs[id]) return;
    this._reqs[id].destroy();
    delete this._reqs[id];
    this._report(id, true);
    this.partsProgress[id].speed = 0;
    this._workers -= 1;
    this._downloadedChunks += 1;
    if (this._downloadedChunks === this._totalChunks) return this._buildFile();
    this._processChunks();
  }

  private _processChunks() {
    while (
      !this._destroyed &&
      this._jobs.length &&
      this._workers < <number>this._opts.connections
    ) {
      const id = <number>this._jobs.pop();
      this._download(id, this._ranges[id]);
      this._workers += 1;
    }
  }

  private _report(id: number, force?: boolean) {
    if (!this._partsSpeedRef[id])
      this._partsSpeedRef[id] = { bytes: 0, time: Date.now() };

    const now = Date.now();
    const interval = <number>this._opts.reportInterval;

    if (force || now - this._partsSpeedRef[id].time > interval) {
      this.partsProgress[id].speed =
        (1000 *
          (<number>this.partsProgress[id].bytes -
            this._partsSpeedRef[id].bytes)) /
        (now - this._partsSpeedRef[id].time);

      this._partsSpeedRef[id].bytes = <number>this.partsProgress[id].bytes;
      this._partsSpeedRef[id].time = now;
    }

    if (force || now - this._speedRef.time > interval) {
      this.totalProgress.speed =
        (1000 * (<number>this.totalProgress.bytes - this._speedRef.bytes)) /
        (now - this._speedRef.time);

      this._speedRef.bytes = <number>this.totalProgress.bytes;
      this._speedRef.time = now;

      if (this.listenerCount("progress") > 0)
        this.emit("progress", {
          total: this.totalProgress,
          details: this.partsProgress,
        });
    }
  }

  private async _download(id: number, range?: [number, number]) {
    for (let attempt of this._attempts) {
      let opts = this._opts.httpOptions;
      if (opts && opts.headers && range) {
        const headers = Object.assign({}, opts.headers, {
          Range: `bytes=${range[0]}-${range[1]}`,
        });
        opts = Object.assign({}, opts, { headers });
      } else if (range) {
        opts = Object.assign({}, opts, {
          headers: {
            Range: `bytes=${range[0]}-${range[1]}`,
          },
        });
      }

      this._reqs[id] = new Request(this.finalAddress, opts);
      let size = (range && range[1] - range[0] + 1) || 0;
      const fileName = `${this.savedFilePath}.$$${id}`;
      let error: Error | null = null;

      await this._reqs[id]
        .once("ready", ({ statusCode, headers }) => {
          if (statusCode !== 206 && statusCode !== 200) {
            error = new Error(
              `Got HTTP Status code ${statusCode} when downloading chunk ${id}`
            );
            this._reqs[id].destroy();
            return;
          }

          const contentLength =
            (headers["content-length"] &&
              parseInt(headers["content-length"])) ||
            0;

          if (size && contentLength && size !== contentLength) {
            error = new Error(
              `Expecting content length of ${size} but got ${contentLength} when downloading chunk ${id}`
            );
            this._reqs[id].destroy();
            return;
          }

          if (range && statusCode !== 206) {
            error = new Error(
              `Expecting HTTP Status code 206 but got ${statusCode} when downloading chunk ${id}`
            );
            this._reqs[id].destroy();
            return;
          }

          if (!size && headers["content-length"])
            size = parseInt(headers["content-length"]);
          if (!this._size && id === 0 && headers["content-length"])
            this._size = parseInt(headers["content-length"]);
        })
        .on("data", (data) => {
          (this.partsProgress[id].bytes as number) += data.length;
          this.partsProgress[id].percentage = size
            ? (100 * <number>this.partsProgress[id].bytes) / size
            : 0;

          (this.totalProgress.bytes as number) += data.length;
          this.totalProgress.percentage = this._size
            ? (100 * <number>this.totalProgress.bytes) / this._size
            : 0;
          this._report(id);
        })
        .on("error", (err) => {
          if (this._destroyed) return;
          this.emit("error", err);
        })
        .pipe(fs.createWriteStream(fileName))
        .wait();

      if (this._destroyed) return;
      if (!error) {
        this._onChunkCompleted(id);
        return;
      }

      this.emit("retry", {
        chunkId: id,
        attempt,
        error,
      });
      await delay(
        <number>this._opts.retryDelay +
          <number>this._opts.retryBackoff * (attempt - 1)
      );
    }
    this.emit("error", new Error(`Failed to download chunk #${id} ${range}`));
  }

  private async _syncJobs() {
    this.partsProgress = Array<Progress>(this._ranges.length);

    for (let i = 0; i < this._ranges.length; i += 1) {
      this.partsProgress[i] = {
        speed: 0,
        bytes: 0,
        percentage: 0,
      };

      const stats = await fileStats(`${this.savedFilePath}.$$${i}`);
      if (!stats) {
        this._jobs.push(i);
        continue;
      }
      const size = this._ranges[i][1] - this._ranges[i][0] + 1;
      if (stats.size > size)
        throw new Error(
          `Expecting maximum chunk size of ${size} but got: ${stats.size}`
        );
      if (stats.size === size) {
        this._downloadedChunks += 1;
        this.partsProgress[i].percentage = 100;
        this.partsProgress[i].bytes = size;
        (this.totalProgress.bytes as number) += size;
        this.totalProgress.percentage = this._size
          ? (100 * <number>this.totalProgress.bytes) / this._size
          : 0;
        this.isResume = true;
      } else {
        this._jobs.push(i);
      }
    }
  }

  private _calcRanges() {
    let chunkSize =
      typeof this._opts.chunkSize === "function"
        ? Math.floor(this._opts.chunkSize(this._size))
        : <number>this._opts.chunkSize;

    let extraSize = 0;
    if (this._size / chunkSize < <number>this._opts.connections) {
      chunkSize = Math.floor(this._size / <number>this._opts.connections);
      extraSize = this._size % <number>this._opts.connections;
    }

    const n = extraSize
      ? Math.floor(this._size / chunkSize)
      : Math.ceil(this._size / chunkSize);

    const chunks = Array(n);
    for (let i = 0; i < n; i += 1) {
      if (i < n - 1) chunks[i] = chunkSize;
      else chunks[i] = this._size - (n - 1) * chunkSize - extraSize;

      if (i < extraSize) chunks[i] += 1;
    }

    if (n > 1 && chunks[n - 1] < chunkSize / 2) {
      const diff = Math.floor(chunkSize / 2 - chunks[n - 1]);
      chunks[n - 1] += diff;
      chunks[n - 2] -= diff;
    }

    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const chunk = chunks[i];
      this._ranges.push([sum, sum + chunk - 1]);
      sum += chunk;
    }
  }

  private async _start(): Promise<void> {
    if (this._started) return;
    this._started = true;
    if (this._destroyed)
      throw new Error("Calling start() of a destroyed instance");
    await this._ensureDest();
    if (!this.savedFilePath) return;
    if (!(await validate(this.savedFilePath)))
      throw new Error(`Invalid output destination ${this._dest}`);
    await this._getHeaders();

    if (
      this._opts.connections !== 1 &&
      this.headers &&
      this.headers["content-length"] &&
      this.headers["accept-ranges"] === "bytes"
    ) {
      this._size = parseInt(this.headers["content-length"]);
      this._calcRanges();
      await this._syncJobs();
      this._totalChunks = this._ranges.length;
      if (!this._jobs.length) this._buildFile();
      else this._processChunks();
    } else {
      this.resumable = false;
      this.paralel = false;
      this.partsProgress = [
        {
          speed: 0,
          bytes: 0,
          percentage: 0,
        },
      ];
      this._totalChunks = 1;
      this._download(0);
    }

    if (this.listenerCount("metadata") > 0) {
      this.emit("metadata", <Metadata>{
        chunks: this._ranges.map(([a, b]) => b - a + 1),
        isResume: this.isResume,
        progress: this.partsProgress.map((progress) => progress.percentage),
        finalAddress: this.finalAddress,
        paralel: this.paralel,
        resumable: this.resumable,
        headers: this.headers,
        savedFilePath: this.savedFilePath,
      });
    }
  }

  async metadata(): Promise<Metadata> {
    process.nextTick(this._start);
    return await new Promise<Metadata>((res) => this.once("metadata", res));
  }

  async wait(): Promise<boolean> {
    process.nextTick(this._start);
    await new Promise((res) => this.once("close", res));
    return this._done;
  }

  start(): EasyDl {
    process.nextTick(this._start);
    return this;
  }

  destroy(): void {
    this._destroyed = true;
    for (let req of this._reqs) {
      if (!req) continue;
      try {
        req.destroy();
      } catch (e) {}
    }
    this.emit("close");
  }
}

export = EasyDl;
