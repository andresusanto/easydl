import http from "http";
import https from "https";

import { hashFile } from "./utils/hash";
import { files, createTmpFile } from "./utils/files";

import EasyDl from "../src";
import { mockFailedRequest, mockResumableRequest } from "./utils/mock-http";

beforeEach(() => jest.restoreAllMocks());

it("should download a file and combine it correctly", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest());

  const onMetadata = jest.fn();
  const onProgress = jest.fn();
  const onBuild = jest.fn();

  const { fullFileLocation } = createTmpFile();

  await new EasyDl("https://susan.to", fullFileLocation)
    .on("metadata", onMetadata)
    .on("progress", onProgress)
    .on("build", onBuild)
    .wait();

  expect(hashFile(fullFileLocation)).toBe(files["100Mb"].fileHash);

  // it has to reach 100%
  expect(onBuild).toHaveBeenCalledWith({ percentage: 100 });

  // metadata is expected to be called once only
  expect(onMetadata).toHaveBeenCalledTimes(1);
  expect(onMetadata).toHaveBeenCalledWith(
    expect.objectContaining({
      resumable: true,
      size: files["100Mb"].size,
    })
  );

  expect(onProgress).toHaveBeenCalledTimes(10);
  expect(onProgress).toHaveBeenNthCalledWith(
    10,
    expect.objectContaining({
      total: expect.objectContaining({
        percentage: 100,
        bytes: files["100Mb"].size,
      }),
    })
  );

  // first request should be a HEAD request
  expect(request).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({ method: "HEAD" }),
    expect.any(Function)
  );

  // remaining request should be GET requests
  expect(request).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    { method: "GET", headers: { Range: expect.any(String) } },
    expect.any(Function)
  );
  expect(request).toHaveBeenCalledTimes(11);
});

it("should automatically retry failed request", async () => {
  const request = jest
    .spyOn(https, "request")
    // first request is the initial HEAD request
    .mockImplementationOnce(mockResumableRequest())
    // simulate a failure for the second and third request
    .mockImplementationOnce(mockFailedRequest())
    .mockImplementationOnce(mockFailedRequest())
    // serve successful request for the rest
    .mockImplementation(mockResumableRequest());
  const onRetry = jest.fn();

  const { fullFileLocation } = createTmpFile();

  await new EasyDl("https://susan.to", fullFileLocation, { retryDelay: 5 })
    .on("retry", onRetry)
    .wait();

  // failure for the second and third request (twice)
  expect(onRetry).toHaveBeenCalledTimes(2);
  expect(onRetry).toHaveBeenCalledWith(
    expect.objectContaining({
      attempt: 1,
      error: expect.objectContaining({
        message: expect.stringContaining(
          "Got HTTP Status code 503 when downloading chunk"
        ),
      }),
    })
  );

  expect(hashFile(fullFileLocation)).toBe(files["100Mb"].fileHash);
  expect(request).toHaveBeenCalledTimes(13);
});

it("should not retry if reached maximum retry attempt", async () => {
  const request = jest
    .spyOn(https, "request")
    // first request is the initial HEAD request
    .mockImplementationOnce(mockResumableRequest())
    // allow first 3 parts to be downloaded
    .mockImplementationOnce(mockResumableRequest())
    .mockImplementationOnce(mockResumableRequest())
    .mockImplementationOnce(mockResumableRequest())
    // serve fail requests for the rest
    .mockImplementation(mockFailedRequest());

  const { fullFileLocation } = createTmpFile();

  const onRetry = jest.fn();
  const onError = jest.fn();

  await expect(() =>
    new EasyDl("https://susan.to", fullFileLocation, {
      connections: 2,
      maxRetry: 2,
      retryDelay: 5,
    })
      .on("retry", onRetry)
      .on("error", onError)
      .wait()
  ).rejects.toThrow("Failed to download chunk");

  // number of parallel connections * number of maxRetry
  expect(onRetry).toHaveBeenCalledTimes(4);

  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining("Failed to download chunk"),
    })
  );
});

it("should use specified chunk size", async () => {
  jest.spyOn(http, "request").mockImplementation(mockResumableRequest());
  const onMetadataConstant = jest.fn();
  const onMetadataFunction = jest.fn();

  const { fullFileLocation } = createTmpFile();

  await new EasyDl("http://using-http.susan.to", `${fullFileLocation}.1`, {
    chunkSize: 1024 * 1024,
  })
    .on("metadata", onMetadataConstant)
    .wait();

  await new EasyDl("http://using-http.susan.to", `${fullFileLocation}.2`, {
    chunkSize: (size) => size / 20,
  })
    .on("metadata", onMetadataFunction)
    .wait();

  expect(onMetadataConstant).toHaveBeenCalledWith(
    expect.objectContaining({
      chunks: expect.objectContaining({
        // random 25th element should have a chunk size of 1MB
        25: 1024 * 1024,

        // 100MB files should have 100 chunks
        length: 100,
      }),
    })
  );

  expect(onMetadataFunction).toHaveBeenCalledWith(
    expect.objectContaining({
      chunks: expect.objectContaining({
        // random 15th element should have a chunk size of 5MB (100 / 20)
        15: 5 * 1024 * 1024,

        // size / 20, so 20 chunks
        length: 20,
      }),
    })
  );
});

it("should generate filename if specified target is a directory", async () => {
  jest.spyOn(http, "request").mockImplementation(mockResumableRequest());
  const onMetadata = jest.fn();

  const { dir, fullFileLocation } = createTmpFile();

  const dl = new EasyDl("http://using-http.susan.to", dir, {
    chunkSize: 1024 * 1024,
  });

  await expect(dl.on("metadata", onMetadata).wait()).resolves.toBe(true);

  expect(dl.savedFilePath).not.toBe(fullFileLocation);
  expect(hashFile(dl.savedFilePath!)).toBe(files["100Mb"].fileHash);
  expect(onMetadata).toHaveBeenCalledWith(
    expect.objectContaining({
      savedFilePath: expect.stringContaining("using-http.susan.to"),
    })
  );
});

it("should stop downloading when destroy is called", async () => {
  const request = jest
    .spyOn(http, "request")
    .mockImplementation(mockResumableRequest());

  const { fullFileLocation } = createTmpFile();

  const dl = new EasyDl("http://using-http.susan.to", fullFileLocation, {
    connections: 2,
  }).on("progress", () => {
    dl.destroy();
  });

  await expect(dl.wait()).resolves.toBe(false);

  // number of connections + 1 (because of destroy being called during nextTick)
  expect(request).toHaveBeenCalledTimes(3);
  expect(dl.partsProgress).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        percentage: 100,
      }),
    ])
  );
});

it("should resume previous download", async () => {
  const request = jest
    .spyOn(http, "request")
    .mockImplementation(mockResumableRequest());
  const onMetadata = jest.fn();
  const { fullFileLocation } = createTmpFile();

  const dl = new EasyDl("http://using-http.susan.to", fullFileLocation, {
    connections: 2,
  })
    .on("metadata", onMetadata)
    .on("progress", () => {
      dl.destroy();
    });

  await expect(dl.wait()).resolves.toBe(false);
  expect(onMetadata).toHaveBeenCalledWith(
    expect.objectContaining({ resumable: true, isResume: false })
  );
  expect(request).toHaveBeenCalledTimes(3);

  request.mockRestore();
  const resumeRequest = jest
    .spyOn(http, "request")
    .mockImplementation(mockResumableRequest());
  const onMetadataResume = jest.fn();

  await expect(
    new EasyDl("http://using-http.susan.to", fullFileLocation, {
      connections: 2,
    })
      .on("metadata", onMetadataResume)
      .wait()
  ).resolves.toBe(true);

  // 1 HEAD + 9 parts (out of 10)
  expect(resumeRequest).toHaveBeenCalledTimes(10);

  expect(onMetadataResume).toHaveBeenCalledWith(
    expect.objectContaining({
      isResume: true,
      resumable: true,
      progress: expect.arrayContaining([100]),
    })
  );
});
