import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";

import { delay, safeRun } from "./helpers";
import { fileStats, validate, rename } from "./fs";
import Request, { followRedirect, requestHeader } from "./request";

/** The configurable download options. */
interface Options {
  /** Number of parallel connections */
  connections?: number;
  /** What to do if the destination file exists:
   * - `overwrite` will overwrite existing file (you will lost the current file)
   * -`new_file` will append a `(COPY)` name to the downloaded file until the file does not exist
   * -`ignore` will stop this current download
   */
  existBehavior?: "overwrite" | "new_file" | "ignore" | "error";
  /** Whether `EasyDl` should follow HTTP redirection. */
  followRedirect?: boolean;
  /** Options passed to the http client */
  httpOptions?: http.RequestOptions;
  /** The size of chunks of the file. It accepts a static value (number), or a function with this signature: `(size: number) => number` */
  chunkSize?: number | { (size: number): number };
  /** Maximum number of retries when error occured */
  maxRetry?: number;
  /** Delay before attempting to retry in ms  */
  retryDelay?: number;
  /** Incremental back-off after each retry in ms */
  retryBackoff?: number;
  /** Set how frequent `progress` event emitted by `EasyDL`  */
  reportInterval?: number;
  /** Use GET method instead of HEAD for requesting headers */
  methodFallback?: boolean;
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
  /** Size of the file in bytes */
  size: number;
  /** Array containing the size of each chunks */
  chunks: number[];
  /** Indicates if this instance is using previously downloaded chunks */
  isResume: boolean;
  /** Current progress of each chunks in percent. Values should be 0 or 100 only. */
  progress: number[];
  /** Final URL address of the file. It will be different from the supplied URL param if there is some redirection. */
  finalAddress: string;
  /** Indicates if this instance uses multiple-connection to perform downloads */
  parallel: boolean;
  /** Indicates if the server supports resuming. Some servers simply don't support/allow it. */
  resumable: boolean;
  /** Raw HTTP response headers */
  headers: http.IncomingHttpHeaders | null;
  /** The final file path. It may be different from the supplied dest param
   * if you supplied directory as the dest param or you use "new_file" as the existBehavior.  */
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
  addListener(event: "close", listener: () => void): this;
  addListener(event: "end", listener: () => void): this;
  addListener(event: "error", listener: (err: Error) => void): this;

  emit(event: "build", data: Progress): boolean;
  emit(event: "metadata", data: Metadata): boolean;
  emit(event: "progress", data: ProgressReport): boolean;
  emit(event: "retry", data: RetryInfo): boolean;
  emit(event: "close"): boolean;
  emit(event: "end"): boolean;
  emit(event: "error", err: Error): boolean;

  /** Emitted when all chunks are downloaded and the file is being built by merging chunks together. */
  on(event: "build", listener: (progress: Progress) => void): this;
  /** Emitted when the download metadata is ready to be used */
  on(event: "metadata", listener: (data: Metadata) => void): this;
  /** The current download progress */
  on(event: "progress", listener: (data: ProgressReport) => void): this;
  /** Emitted when the instance is closed and being destroyed */
  on(event: "close", listener: () => void): this;
  /** The `end` event is emitted after the download had finished and the file being downloaded is ready. */
  on(event: "end", listener: () => void): this;
  /** Emitted when an error occured */
  on(event: "error", listener: (err: Error) => void): this;
  /** Emitted when EasyDL performed a retry */
  on(event: "retry", listener: (data: RetryInfo) => void): this;

  once(event: "build", listener: (progress: Progress) => void): this;
  once(event: "metadata", listener: (data: Metadata) => void): this;
  once(event: "progress", listener: (data: ProgressReport) => void): this;
  once(event: "retry", listener: (data: RetryInfo) => void): this;
  once(event: "close", listener: () => void): this;
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
  prependListener(event: "end", listener: () => void): this;
  prependListener(event: "error", listener: (err: Error) => void): this;

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
  prependOnceListener(event: "end", listener: () => void): this;
  prependOnceListener(event: "error", listener: (err: Error) => void): this;

  removeListener(event: "build", listener: (progress: Progress) => void): this;
  removeListener(event: "metadata", listener: (data: Metadata) => void): this;
  removeListener(
    event: "progress",
    listener: (data: ProgressReport) => void
  ): this;
  removeListener(event: "retry", listener: (data: RetryInfo) => void): this;
  removeListener(event: "close", listener: () => void): this;
  removeListener(event: "end", listener: () => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
}

/**
 * Easily download a file and save it to local disk. It supports resuming previously
 * downloaded files, multi-connection downloads, and retry on fail out of the box!
 *
 * @class
 * @remarks
 *  **Quick start** :
 *
 * To use the `EasyDl` simply use the following:
 * ```ts
 * // event based
 * const easydl = new EasyDl(url, dest)
 *   .on('error', (err) => {
 *     console.log('error!', err);
 *     // handle error
 *   })
 *   .on('end', () => {
 *     console.log('download success!');
 *   })
 *   .start();
 *
 * // async-await
 * try {
 *   const downloaded = await new EasyDl(url, dest).wait();
 *   if (downloaded) console.log('file is downloaded!');
 * } catch (e) {
 *   console.log('error', e);
 * }
 *
 * // promise
 * new EasyDl(url, dest)
 *   .then(success => {
 *      if (success) console.log('file is downloaded!');
 *   })
 *   .catch(err => {
 *      console.log('error', err);
 *   })
 * ```
 *
 * For advanced usages, such as handling progress information please see [DOCS](https://github.com/andresusanto/easydl)
 */
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
  private _workers: number = 0;
  private _downloadedChunks: number = 0;
  private _totalChunks: number = 0;

  private _partsSpeedRef: SpeedStat[] = [];
  private _speedRef: SpeedStat = { time: Date.now(), bytes: 0 };

  size: number = 0;
  isResume: boolean = false;
  savedFilePath: string | null;
  totalProgress: Progress = { speed: 0, bytes: 0, percentage: 0 };
  partsProgress: Progress[] = [];
  finalAddress: string;
  parallel: boolean = true;
  resumable: boolean = true;
  headers: http.IncomingHttpHeaders | null = null;

  /**
   * @param {string} url URL of the file to be downloaded
   * @param {string} dest A local file/folder as the output of the download. If a folder is supplied (for example `~/`),
   * it will add the file name automaticaly.
   * @param {Options} options Configurable download options:
   * - `connections` - Number of parallel connections
   * - `existBehavior` - What to do if the destination file exists ([details](https://github.com/andresusanto/easydl))
   * - `followRedirect` - Whether `EasyDl` should follow HTTP redirection.
   * - `httpOptions` - Options passed to the http client
   * - `chunkSize` - The size of chunks of the file. ([details](https://github.com/andresusanto/easydl))
   * - `maxRetry` - Maximum number of retries when error occured
   * - `retryDelay` - Delay before attempting to retry in ms
   * - `retryBackoff` - Incremental back-off after each retry in ms
   * - `reportInterval` - Set how frequent `progress` event emitted by `EasyDL`
   */
  constructor(url: string, dest: string, options?: Options) {
    super();
    this._opts = Object.assign(
      <Options>{
        existBehavior: "new_file",
        followRedirect: true,
        connections: 5,
        chunkSize: (size) => {
          return Math.min(size / 10, 10 * 1024 * 1024);
        },
        maxRetry: 3,
        retryDelay: 2000,
        retryBackoff: 3000,
        reportInterval: 2500,
        methodFallback: false,
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

  private _getFilenameFromContentDisposition(header: string | undefined): string | null {
    if (!header) return null;

    // Try filename* parameter first (handles UTF-8 encoding)
    const filenameStarMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (filenameStarMatch) {
      try {
        return decodeURIComponent(filenameStarMatch[1]);
      } catch {
        // If decoding fails, continue to try other methods
      }
    }

    // Try filename parameter
    const filenameMatch = header.match(/filename="([^"]+)"|filename=([^;]+)/i);
    if (filenameMatch) {
      return filenameMatch[1] || filenameMatch[2];
    }

    return null;
  }

  private async _ensureDest() {
    while (this.savedFilePath) {
      const stats = await fileStats(this.savedFilePath);
      if (stats && stats.isDirectory()) {
        // If headers are available and contain Content-Disposition, try to get filename from it
        let filename = this.headers ?
          this._getFilenameFromContentDisposition(this.headers["content-disposition"] as string) :
          null;

        // Fall back to URL basename if no filename found in Content-Disposition
        if (!filename) {
          filename = path.posix.basename(this._url);
        }

        this.savedFilePath = path.join(
          this.savedFilePath,
          filename
        );
      } else if (stats && this._opts.existBehavior === "new_file") {
        const loc = path.parse(this.savedFilePath);
        this.savedFilePath = path.join(loc.dir, `${loc.name}(COPY)${loc.ext}`);
      } else if (stats && this._opts.existBehavior === "ignore") {
        this.savedFilePath = null;
      } else if (stats && this._opts.existBehavior === "error") {
        throw new Error(`Destination ${this.savedFilePath} already exists.`);
      } else {
        break;
      }
    }
  }

  private async _getHeaders() {
    if (this._opts.followRedirect) {
      const redirResult = await followRedirect(
        this._url,
        this._opts.httpOptions,
        this._opts.methodFallback
      );
      this.finalAddress = redirResult.address;
      this.headers = redirResult.headers || null;
    } else {
      const headerResult = await requestHeader(
        this._url,
        this._opts.httpOptions,
        this._opts.methodFallback
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
    try {
      for (let i = 0; i < this._totalChunks; i += 1) {
        const fileName = `${this.savedFilePath}.$$${i}`;
        const source = fs.createReadStream(fileName);
        await new Promise<void>((res, rej) => {
          source.pipe(dest, { end: false });
          source.on("error", rej);
          dest.on("error", rej);
          source.on("end", () => {
            dest.removeListener("error", rej);
            res();
          });
        });

        source.destroy();
        this.emit("build", {
          percentage: 100 * ((i + 1) / this._totalChunks),
        });
      }
      for (let i = 0; i < this._totalChunks; i += 1) {
        const fileName = `${this.savedFilePath}.$$${i}`;
        await new Promise((res) => fs.unlink(fileName, res));
      }
      dest.destroy();
      this._done = true;
      this.emit("end");
      this.destroy();
    } catch (err) {
      safeRun(dest.destroy);
      this.emit("error", err as Error);
      this.destroy();
    }
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

  private _getSizeFromIncomingHttpHeaders(headers: http.IncomingHttpHeaders) {
    if (!(headers["content-length"] || headers["content-range"])) return 0;
    if (this._opts.methodFallback && headers["content-range"])
      return parseInt(headers["content-range"].split("/").at(1) ?? "0");
    if (headers["content-length"]) return parseInt(headers["content-length"]);
    return 0;
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
      const fileName = `${this.savedFilePath}.$$${id}$PART`;
      let error: Error | null = null;
      const dest = fs.createWriteStream(fileName);
      dest.on("error", (err) => {
        if (this._destroyed) return;
        this.emit("error", err);
      });

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
            size = this._getSizeFromIncomingHttpHeaders(headers);
          if (!this.size && id === 0 && headers["content-length"])
            this.size = this._getSizeFromIncomingHttpHeaders(headers);
        })
        .on("data", (data) => {
          (this.partsProgress[id].bytes as number) += data.length;
          this.partsProgress[id].percentage = size
            ? (100 * <number>this.partsProgress[id].bytes) / size
            : 0;

          (this.totalProgress.bytes as number) += data.length;
          this.totalProgress.percentage = this.size
            ? (100 * <number>this.totalProgress.bytes) / this.size
            : 0;
          this._report(id);
        })
        .on("error", (err) => {
          dest.destroy();
          if (this._destroyed) return;
          this.emit("error", err);
        })
        .pipe(dest)
        .wait();

      safeRun(dest.destroy);
      if (this._destroyed) return;
      if (!error) {
        await rename(
          `${this.savedFilePath}.$$${id}$PART`,
          `${this.savedFilePath}.$$${id}`
        );
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
    this.destroy();
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
        this.totalProgress.percentage = this.size
          ? (100 * <number>this.totalProgress.bytes) / this.size
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
        ? Math.floor(this._opts.chunkSize(this.size))
        : <number>this._opts.chunkSize;

    let extraSize = 0;
    if (this.size / chunkSize < <number>this._opts.connections) {
      chunkSize = Math.floor(this.size / <number>this._opts.connections);
      extraSize = this.size % <number>this._opts.connections;
    }

    const n = extraSize
      ? Math.floor(this.size / chunkSize)
      : Math.ceil(this.size / chunkSize);

    const chunks = Array(n);
    for (let i = 0; i < n; i += 1) {
      if (i < n - 1) chunks[i] = chunkSize;
      else chunks[i] = this.size - (n - 1) * chunkSize - extraSize;

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

    try {
      // Get headers first so we can use them for filename determination
      await this._getHeaders();

      await this._ensureDest();
      if (!this.savedFilePath) {
        this._done = true;
        this.emit("close");
        return;
      }
      if (!(await validate(this.savedFilePath)))
        throw new Error(`Invalid output destination ${this._dest}`);

      if (
        this._opts.connections !== 1 &&
        this.headers &&
        this.headers["content-length"] &&
        this.headers["accept-ranges"] === "bytes"
      ) {
        this.size = this._getSizeFromIncomingHttpHeaders(this.headers);
        this._calcRanges();
        await this._syncJobs();
        this._totalChunks = this._ranges.length;
        if (!this._jobs.length) this._buildFile();
        else this._processChunks();
      } else {
        if (this.headers && this.headers["content-length"])
          this.size = this._getSizeFromIncomingHttpHeaders(this.headers);
        this.resumable = false;
        this.parallel = false;
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
          size: this.size,
          chunks: this._ranges.map(([a, b]) => b - a + 1),
          isResume: this.isResume,
          progress: this.partsProgress.map((progress) => progress.percentage),
          finalAddress: this.finalAddress,
          parallel: this.parallel,
          resumable: this.resumable,
          headers: this.headers,
          savedFilePath: this.savedFilePath,
        });
      }
    } catch (err) {
      this.emit("error", err as Error);
      this.destroy();
    }
  }

  /**
   * Start the downloads and wait for its metadata.
   *
   * @async
   * @returns {Metadata} Metadata object for the current download
   * @remarks
   * Using async await
   * ```ts
   * const metadata = await new EasyDl('url', './').metadata();
   * ```
   *
   * Using promise
   * ```ts
   * new EasyDl('url', './')
   *    .metadata()
   *    .then(meta => {
   *        // do something
   *    })
   * ```
   */
  async metadata(): Promise<Metadata> {
    process.nextTick(this._start);
    if (this._destroyed)
      throw new Error("Calling metadata() on destroyed instance.");
    return await new Promise<Metadata>((res, rej) => {
      this.once("error", rej);
      this.once("metadata", res);
    });
  }

  /**
   * Wait until the download has finished, failed, or cancelled.
   *
   * @async
   * @returns {boolean} `true` indicates that the download is success, `false` is
   * returned if the download is cancelled by user.
   * @throws {Error} when download failed.
   */
  async wait(): Promise<boolean> {
    process.nextTick(this._start);
    if (this._destroyed) return this._done;
    await new Promise<void>((res, rej) => {
      this.once("error", rej);
      this.once("close", res);
    });
    return this._done;
  }

  start(): EasyDl {
    process.nextTick(this._start);
    return this;
  }

  destroy(): void {
    if (this._destroyed) return;
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
