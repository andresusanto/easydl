import https from "https";
import { mockResumableRequest } from "./utils/mock-http";
import { createTmpFile, files } from "./utils/files";
import EasyDl from "../src";
import { hashFile } from "./utils/hash";

beforeEach(() => jest.restoreAllMocks());

it("should not replace existing file when existBehavior = ignore", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Kb"]));

  const { fullFileLocation } = createTmpFile();

  await expect(
    new EasyDl("https://susan.to", fullFileLocation).wait()
  ).resolves.toBe(true);

  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);

  request.mockRestore();
  // mocking request with different file to get different hash
  jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Mb"]));

  await expect(
    new EasyDl("https://susan.to", fullFileLocation, {
      existBehavior: "ignore",
    }).wait()
  ).resolves.toBe(true);

  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);
});

it("should overwrite existing file when existBehavior = overwrite", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Kb"]));

  const { fullFileLocation } = createTmpFile();

  await expect(
    new EasyDl("https://susan.to", fullFileLocation).wait()
  ).resolves.toBe(true);

  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);

  request.mockRestore();
  // mocking request with different file to get different hash
  jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Mb"]));

  await expect(
    new EasyDl("https://susan.to", fullFileLocation, {
      existBehavior: "overwrite",
    }).wait()
  ).resolves.toBe(true);

  expect(hashFile(fullFileLocation)).toBe(files["100Mb"].fileHash);
});

it("should create a new file when existBehavior = new_file", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Kb"]));

  const { fullFileLocation } = createTmpFile();

  await expect(
    new EasyDl("https://susan.to", fullFileLocation).wait()
  ).resolves.toBe(true);

  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);

  request.mockRestore();
  // mocking request with different file to get different hash
  jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Mb"]));

  const dl = new EasyDl("https://susan.to", fullFileLocation, {
    existBehavior: "new_file",
  });

  await expect(dl.wait()).resolves.toBe(true);
  expect(dl.savedFilePath).not.toEqual(fullFileLocation);
  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);
  expect(hashFile(dl.savedFilePath!)).toBe(files["100Mb"].fileHash);

  request.mockRestore();
  // mocking request with different file to get different hash
  jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["10Mb"]));

  const dl2 = new EasyDl("https://susan.to", fullFileLocation, {
    existBehavior: "new_file",
  });

  await expect(dl2.wait()).resolves.toBe(true);
  expect(dl2.savedFilePath).not.toEqual(dl.savedFilePath);
  expect(dl2.savedFilePath).not.toEqual(fullFileLocation);

  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);
  expect(hashFile(dl.savedFilePath!)).toBe(files["100Mb"].fileHash);
  expect(hashFile(dl2.savedFilePath!)).toBe(files["10Mb"].fileHash);
});

it("should throw error when existBehavior = error", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Kb"]));

  const { fullFileLocation } = createTmpFile();

  await expect(
    new EasyDl("https://susan.to", fullFileLocation).wait()
  ).resolves.toBe(true);

  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);

  request.mockRestore();
  // mocking request with different file to get different hash
  jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest(files["100Mb"]));

  await expect(
    new EasyDl("https://susan.to", fullFileLocation, {
      existBehavior: "error",
    }).wait()
  ).rejects.toThrow("already exists");

  expect(hashFile(fullFileLocation)).toBe(files["100Kb"].fileHash);
});
