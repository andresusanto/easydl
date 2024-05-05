import https from "https";

import { hashFile } from "./utils/hash";
import { files, createTmpFile } from "./utils/files";

import EasyDl from "../src";
import { createMockHTTP } from "./utils/mock-http";

beforeEach(() => jest.restoreAllMocks());

export const mockDenyHEAD = () =>
  createMockHTTP({
    head() {
      return {
        status: 401,
        headers: {},
      };
    },
    get([start, end]) {
      return {
        body: files["100Mb"].file.subarray(start, end + 1),
        headers: {
          "accept-ranges": "bytes",
          "content-length": `${end - start + 1}`,
          "content-range": `bytes ${start}-${end}/${files["100Mb"].size}`,
        },
      };
    },
  });

it("should use GET method to get metadata if methodFallback = true", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockDenyHEAD());

  const onMetadata = jest.fn();

  const { fullFileLocation } = createTmpFile();

  const dl = new EasyDl("https://s3.aws.susan.to", fullFileLocation, {
    methodFallback: true,
  });

  await expect(dl.on("metadata", onMetadata).wait()).resolves.toBe(true);
  expect(onMetadata).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(11);
  expect(request).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({ method: "GET", headers: { Range: "bytes=0-0" } }),
    expect.any(Function)
  );
  // remaining request should be GET requests
  expect(request).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    { method: "GET", headers: { Range: expect.any(String) } },
    expect.any(Function)
  );

  expect(hashFile(fullFileLocation)).toEqual(files["100Mb"].fileHash);
});
