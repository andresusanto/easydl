import https from "https";

import { hashFile } from "./utils/hash";
import { files, createTmpFile } from "./utils/files";

import EasyDl from "../src";
import { createMockHTTP } from "./utils/mock-http";

beforeEach(() => jest.restoreAllMocks());

export const mockNonResumableRequest = (file = files["100Mb"]) =>
  createMockHTTP({
    head() {
      return {
        headers: {
          "content-length": `${file.size}`,
        },
      };
    },
    get() {
      return {
        body: file.file,
        headers: {
          "content-length": `${file.size}`,
        },
      };
    },
  });

export const mockNonResumableRequestWithUnknownSize = (file = files["100Mb"]) =>
  createMockHTTP({
    get() {
      return {
        body: file.file,
        headers: {},
      };
    },
  });

it("should download a file with known size and combine it correctly", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockNonResumableRequest());

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
      chunks: [],
      isResume: false,
      resumable: false,
      size: files["100Mb"].size,
    })
  );

  expect(onProgress).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenNthCalledWith(
    1,
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
    { method: "GET" },
    expect.any(Function)
  );
  expect(request).toHaveBeenCalledTimes(2);
});

it("should download a file with unknown size and combine it correctly", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockNonResumableRequestWithUnknownSize());

  const onMetadata = jest.fn();

  const { fullFileLocation } = createTmpFile();

  await new EasyDl("https://susan.to", fullFileLocation)
    .on("metadata", onMetadata)
    .wait();

  expect(hashFile(fullFileLocation)).toBe(files["100Mb"].fileHash);

  // metadata is expected to be called once only
  expect(onMetadata).toHaveBeenCalledTimes(1);
  expect(onMetadata).toHaveBeenCalledWith(
    expect.objectContaining({
      chunks: [],
      isResume: false,
      resumable: false,
      size: 0,
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
    { method: "GET" },
    expect.any(Function)
  );
  expect(request).toHaveBeenCalledTimes(2);
});
