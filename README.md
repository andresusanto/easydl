# EasyDl

[![Install via NPM](https://nodei.co/npm/easydl.png)](https://www.npmjs.com/package/easydl)

Easily download a file and save it to a local disk. It supports resuming previously downloaded files, multi-connection/parallel downloads, and retry on failure out of the box!

### Features

- Resumes previous downloads, even after the program has terminated.
- Faster download speed with multiple concurrent connections.
- Automatic retry on failure.
- Supports HTTP redirects with redirect loop detection.
- No native, 100% Javascript code with zero dependency.
- Runs on Node.js, Electron, NW.js
- Easy! Dead simple API, but highly configurable when you need it.

## Install

```bash
npm i -S easydl
```

or if you use `yarn`

```bash
yarn add easydl
```

## Quickstart

`EasyDl` is an [EventEmitter](https://nodejs.org/api/events.html#events_class_eventemitter), but it also provides Promise APIs for ease of use:

```js
try {
  const completed = await new EasyDl(
    "http://www.ovh.net/files/1Gio.dat",
    "/tmp/1GB.zip",
    { connections: 10, maxRetry: 5 }
  ).wait();
  console.log("Downloaded?", completed);
} catch (err) {
  console.log("[error]", err);
}
```

or if you prefer using the `Promise` chain:

```js
const EasyDl = require("easydl");

new EasyDl("http://www.ovh.net/files/10Gio.dat", "~/Downloads")
  .wait()
  .then((completed) => {
    console.log("Downloaded?", completed);
  })
  .catch((err) => {
    console.log("[error]", err);
  });
```

- See all available options [here](#constructor).
- See all examples [here](https://github.com/andresusanto/easydl/tree/master/examples).

---

<details>
<summary>
<b>Getting the Metadata</b>
</summary>
If you want to get the metadata of the current download, such as file size, HTTP response header, etc. You can get one by using:

```ts
try {
  const dl = new EasyDl(url, dest, options);
  const metadata = await dl.metadata();
  console.log("[metadata]", metadata);

  const success = await dl.wait();
  console.log("download complete.");
} catch (err) {
  console.log("[error]", err);
}
```

Alternatively, you can also listen to the `metadata` event:

```ts
try {
  const dl = new EasyDl(url, dest, options);
  await dl
    .on("metadata", (metadata) => {
      // do something with the metadata
    })
    .wait();
} catch (err) {
  console.log("[error]", err);
}
```

And you will get something like this:

```ts
{
  size: 104857600,                      // file size
  chunks: [10485760, 10485760 ....],    // size of each chunks
  isResume: true,                       // whether the current download resumes previous download (using detected chunks)
  progress: [100, 0, 100 .....],        // current progress of each chunk, values should be 0 or 100
  finalAddress: 'http://www.ovh.net/files/100Mio.dat', // final address of the file, if redirection occured, it will be different from the original url
  parallel: true,                        // whether multi-connection download is supported
  resumable: true,                      // whether the download can be stopped and resumed back later on (some servers do not support/allow it)
  headers: {
    ....
    // some http headers
    ....
  },
  savedFilePath: '/tmp/100Mio.dat'      // final file path. it may be different if you supplied directory as the dest param or you use "new_file" as the existBehavior
}
```

- Details of the metadata can be seen at [the metadata section](#Metadata).
- Related example [can be found here](examples/metadata.ts).

</details>

<details>
<summary>
<b>Using Progress Status</b>
</summary>

```ts
try {
  const dl = new EasyDl(url, dest);
  await dl
    .on("progress", ({ details, total }) => {
      // do something with the progress
      console.log("[details]", details);
      // you will get an array:
      //[
      //   { speed: 0, bytes: 0, percentage: 0 },
      //   { speed: 0, bytes: 0, percentage: 0 },
      //   ....
      //   {
      //     speed: 837509.8149186764,
      //     bytes: 7355193,
      //     percentage: 70.14458656311035
      //   },
      //   {
      //     speed: 787249.3573264781,
      //     bytes: 7507833,
      //     percentage: 71.60027503967285
      //   },
      //   ...
      //]

      console.log("[total]", total);
      // You will get:
      // {
      //   speed: 4144377.1053382815,
      //   bytes: 41647652,
      //   percentage: 39.71829605102539
      // }
    })
    .wait();
} catch (err) {
  console.log("[error]", err);
}
```

**Note:**

- `details` - Array containing progress information for each file chunks.
- `total` - The total download progress of the file.

More info: See On Progress

</details>

<details>
<summary>
<b>Pausing/Resuming Downloads</b>
</summary>
EasyDl is a resilient downloader designed to survive even in the event of abrupt program termination. It can automaticaly recover the already downloaded parts of files (chunks) and resume the download instead of starting from scratch. As a result, to pause/stop the download, all you need to do is destroying the `EasyDl` instances. You will be able to resume them by creating new `EasyDl` instances later on.

```ts
try {
  const dl = new EasyDl(url, dest, opts);
  const downloaded = await dl.wait();

  // somewhere in the app you call: dl.destroy();
  // afterwards, dl.wait() will resolve and
  // this "downloaded" will be false
  console.log("[downloaded]", downloaded);
} catch (err) {
  console.log("[error]", err);
}

// later on, you decide to resume the download.
// all you need to do, is simply creating a new
// EasyDl instance with the same chunk size as before (if you're not using the default one)
try {
  // if some complete chunks of file are available, they would not be re-downloaded twice.
  const dl = new EasyDl(url, dest, opts);
  const downloaded = await dl.wait();

  console.log("[downloaded]", downloaded);
} catch (err) {
  console.log("[error]", err);
}
```

- More example [can be found here](examples/pause-resume.ts).
- Learn more about EasyDl file chunking: [Chunks](#Chunks).

</details>

<details>
<summary>
<b>Without using Promise</b>
</summary>

`EasyDl` is an EventEmitter, so if you need to, you can listen to its events instead of using the Promise APIs.

```ts
let downloaded = false;
const dl = new EasyDl(url, dest, opts)
  .on("end", () => {
    console.log("download success!");
    downloaded = true;
  })
  .on("close", () => {
    console.log(
      "this close event will be fired after when instance is stopped (destroyed)"
    );
    console.log(
      "If the download is complete (not cancelled), the .on(end) event will be fired before this event."
    );
    console.log("otherwise, only this event will be fired.");

    // downloaded will be true if .on('end') is fired
    console.log("[downloaded]", downloaded);
  })
  .on("error", (err) => {
    console.log("[error]", err);
    // handle some error here
  })
  .start(); // download will not be started unless you call .start()
```

</details>

## CLI

<img src="https://user-images.githubusercontent.com/7076809/82736366-a0525300-9d6c-11ea-9ec5-e22dda09131f.png" alt="Demo CLI" width="600"/>

A CLI version of `EasyDl` is available as a separate package [easydl-cli](https://github.com/andresusanto/easydl-cli).

## API

### Constructor

```js
new EasyDl(url, dest, options);
```

**`url`** - the URL of the file

**`dest`** - where to save the file. It can be a file name or an existing folder. If you supply a folder location (for example `~/`) the file name will be derrived from the url.

**`options`** - (Object) optional configurable options:

- `connections` - Number of maximum parallel connections. Defaults to `5`.
- `existBehavior` - What to do if the destination file already exists. Possible values:
  - `new_file` **(default)** - create a new file by appending `(COPY)` to the file name.
  - `overwrite` - overwrite the file. Proceed with caution.
  - `error` - throws error.
  - `ignore` - ignore and skip this download
- `followRedirect` - (Boolean) Whether `EasyDl` should follow HTTP redirection. Defaults to `true`
- `httpOptions` - Options passed to the http client. You can modify the HTTP methods, Auth, Headers, Proxy, etc here. See [Node.js docs](https://nodejs.org/api/http.html#http_http_request_url_options_callback) for more information.
- `chunkSize` - The maximum size of chunks (bytes) of the file. It accepts a fixed `number` or a `function` which let you calculate the chunk size dynamically based on the file size.

  - the default value of `chunkSize` is this function:

  ```ts
  function(size) {
      return Math.min(size / 10, 10 * 1024 * 1024);
  }
  ```

  - Using chunk size that is too small may lead to slower download speed due to the nature of TCP connections, but using chunk size that is too big will make resume ineffective due to many incomplete chunks.

- `maxRetry` - Maximum number of retries (for each chunks) when error occured. Defaults to `3`.
- `retryDelay` - Delay in ms before attempting a retry. Defaults to `2000`.
- `retryBackoff` - Incremental back-off in ms for each failed retries. Defaults to `3000`.
- `reportInterval` - Set how frequent `progress` event emitted by `EasyDL`. Defaults to `2500`.

### Metadata

You can get the metadata by using the `.metadata()` function or listening to the `.on('metadata')` event.

<details>
<summary>
<b>Example</b>
</summary>

```ts
{
  size: 104857600,
  chunks: [10485760, 10485760 ....],
  isResume: true,
  progress: [100, 0, 100 .....],
  finalAddress: 'http://www.ovh.net/files/100Mio.dat',
  parallel: true,
  resumable: true,
  headers: {
    ....
    // some http headers
    ....
  },
  savedFilePath: '/tmp/100Mio.dat'
}
```

</details>

**`size`** - Size of the file in bytes. **Note:** If there is no information given about file size by the server, the value would be `0`.

**`chunks`** - An array containing the size of each chunk in bytes.

**`isResume`** - A boolean indicating whether the current download resumes previous download (using detected chunks).

**`progress`** - Current progress of each chunk. Valid values are `0` and `100`. (Incomplete chunks are discarded)

**`finalAddress`** - The final URL of the file being downloaded. If redirection occured, it will be different from the original url.

**`parallel`** - A boolean indicating whether multi-connection download is supported.

**`resumable`** - A boolean indicating whether the download can be stopped and resumed back later on (some servers do not support/allow it).

**`headers`** - Raw http headers from the server

**`savedFilePath`** - The final file path. It may be different if you supplied directory as the `dest` param or you use `new_file` as the `existBehavior`.

### Chunks

- When a file is being downloaded, it will be divided into chunks.
- When all chunks are downloaded, it will be merged into a single file.
- When the download is stopped, and later resumed, all completed chunks will be kept while incomplete chunks will be discarded and re-downloaded.
- Using chunk size that is too small may lead to slower download speed due to the nature of TCP connections, but using chunk size that is too big will make resume ineffective due to many incomplete chunks.

### Clean-up

All downloaded chunks are kept until the download has finished. If you decide to abort the download and do not plan to resume it, you can use the cleaning utility provided by `EasyDl` to delete all temporary chunk files.

```ts
import { clean } from "easydl/utils";

try {
  // this will delete chunks belonging to the 100Mb.dat file
  const deletedChunks1 = await clean("/tmp/100Mb.dat");
  console.log(deletedChunks1);

  // this will delete all remaining chunks in /tmp directory
  const deletedChunks2 = await clean("/tmp");
  console.log(deletedChunks2);
} catch (err) {
  console.log("error when cleaning-up", err);
}
```

See [clean-up examples](examples/cleanup.ts) for more detail.

### .wait() `:async`

The `.wait()` method will be resolved after the instance has finished and destoryed. It returns a boolean value `true` if the file is downloaded and saved to the destination, or `false` otherwise.

### .metadata() `:async`

The `.metadata()` method will be resolved after the metadata for the download is ready. It returns the [Metadata](#Metadata) object.

### .on(`'error'`, function (`err`) {})

The `error` event is emitted when errors occured. An error object will be passed to the callback function.

### .on(`'end'`, function () {})

The `end` event is emitted after the download had finished and the file being downloaded is ready.

### .on(`'close'`, function () {})

Emitted when the `EasyDl` instance is closed and being destroyed.

### .on(`'metadata'`, function (`metadata`) {})

The `metadata` event will be emitted after the metadata for the download is ready. It will pass the [Metadata](#Metadata) object to its callback function.

### .on(`'retry'`, function (`retryInfo`) {})

The `metadata` event will be emitted after the metadata for the download is ready. It will pass the [Metadata](#Metadata) object to its callback function.

### .on(`'progress'`, function (`progressReport`) {})

The `progress` event is emitted when the file is being transferred from the server. A `progressReport` object is given to the callback function:

```ts
{
  details: {
    { speed: 0, bytes: 0, percentage: 0 },
    { speed: 0, bytes: 0, percentage: 0 },
    ...
    {
      speed: 727088.6075949367, // bytes per second
      bytes: 6511840,
      percentage: 62.10174560546875 // 0 - 100%
    },
    {
      speed: 961224.5116403532,
      bytes: 9179673,
      percentage: 87.5441837310791
    }
  },
  total: {
    speed: 4144377.1053382815,
    bytes: 41647652,
    percentage: 39.71829605102539
  }
}
```

### .on(`'build'`, function (`progress`) {})

The `build` event is emitted when all chunks are downloaded and the file is being built by merging chunks together. This event will be fired after [progress](#onprogress-function-progressreport-) event reached `100%`. When the build process has completed, the [end](#onend-function--) event will be emitted.

This `progress` object is given in the callback:

```ts
{
  percentage: 0; // values between 0 - 100
}
```
