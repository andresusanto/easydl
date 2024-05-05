import http from "http";
import https from "https";

import { hashFile } from "./utils/hash";
import { files, createTmpFile } from "./utils/files";

import EasyDl from "../src";
import { createMockHTTP, mockResumableRequest } from "./utils/mock-http";

beforeEach(() => jest.restoreAllMocks());

export const mockRedirect = (location = "http://new-location.com") =>
  createMockHTTP({
    head() {
      return {
        status: 302,
        headers: {
          location,
        },
      };
    },
    get() {
      return {
        body: Buffer.from(""),
        status: 302,
        headers: {
          location,
        },
      };
    },
  });

it("should not follow redirect if followRedirect = false", async () => {
  const request = jest
    .spyOn(http, "request")
    .mockImplementationOnce(mockRedirect())
    .mockImplementation(mockResumableRequest());

  const onMetadata = jest.fn();

  const { fullFileLocation } = createTmpFile();

  const dl = new EasyDl("http://using-http.susan.to", fullFileLocation, {
    followRedirect: false,
  });

  await expect(dl.on("metadata", onMetadata).wait()).rejects.toThrow(
    "Got HTTP response 302"
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(onMetadata).toHaveBeenCalledTimes(0);
  expect(() => hashFile(fullFileLocation)).toThrow("ENOENT");
});

it("should follow redirect if followRedirect = true", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementationOnce(mockRedirect("https://location-a.com"))
    .mockImplementationOnce(mockRedirect("https://location-b.com"))
    .mockImplementationOnce(mockRedirect("https://location-c.com"))
    .mockImplementation(mockResumableRequest());

  const onMetadata = jest.fn();

  const { fullFileLocation } = createTmpFile();
  const dl = new EasyDl("https://susan.to", fullFileLocation);

  await expect(dl.on("metadata", onMetadata).wait()).resolves.toBe(true);
  expect(dl.finalAddress).toBe("https://location-c.com");
  expect(hashFile(fullFileLocation)).toBe(files["100Mb"].fileHash);

  // 3 redirect + 1 HEAD + 10 Chunks
  expect(request).toHaveBeenCalledTimes(14);

  expect(onMetadata).toHaveBeenCalledTimes(1);
});

it("should detect infinite redirection", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementationOnce(mockRedirect("https://location-a.com"))
    .mockImplementationOnce(mockRedirect("https://location-b.com"))
    .mockImplementationOnce(mockRedirect("https://location-a.com"))
    .mockImplementation(mockResumableRequest());

  const onMetadata = jest.fn();

  const { fullFileLocation } = createTmpFile();
  const dl = new EasyDl("https://susan.to", fullFileLocation);

  await expect(dl.on("metadata", onMetadata).wait()).rejects.toThrow(
    "Infinite redirect is detected at https://location-a.com"
  );

  // 3 redirect and then break because of infinite redirection
  expect(request).toHaveBeenCalledTimes(3);

  expect(onMetadata).toHaveBeenCalledTimes(0);
});
