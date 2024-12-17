import https from "https";
import path from "path";
import { createMockHTTP } from "./utils/mock-http";
import { files, createTmpFile } from "./utils/files";
import EasyDl from "../src";

beforeEach(() => jest.restoreAllMocks());

const mockHttpWithContentDisposition = (contentDisposition?: string) => {
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-length": `${files["100Kb"].size}`,
  };

  if (contentDisposition) {
    headers["content-disposition"] = contentDisposition;
  }

  return createMockHTTP({
    head() {
      return {
        status: 200,
        headers,
      };
    },
    get([start, end]) {
      const getHeaders = {
        ...headers,
        "content-length": `${end - start + 1}`,
        "content-range": `bytes ${start}-${end}/${files["100Kb"].size}`,
      };

      return {
        body: files["100Kb"].file.subarray(start, end + 1),
        headers: getHeaders,
      };
    },
  });
};

describe("content-disposition filename handling", () => {
  it("should use filename from Content-Disposition when downloading to directory", async () => {
    const request = jest
      .spyOn(https, "request")
      .mockImplementation(mockHttpWithContentDisposition('attachment; filename="test-file.dat"'));

    const { dir } = createTmpFile();
    const dl = new EasyDl("https://example.com/download", dir);

    await dl.metadata();
    await expect(dl.wait()).resolves.toBe(true);
    expect(dl.savedFilePath).toEqual(path.resolve(dir, "test-file.dat"));

    request.mockRestore();
  });

  it("should handle quoted and unquoted filenames in Content-Disposition", async () => {
    const request = jest
      .spyOn(https, "request")
      .mockImplementation(mockHttpWithContentDisposition("attachment; filename=unquoted.dat"));

    const { dir } = createTmpFile();
    const dl = new EasyDl("https://example.com/download", dir);

    await dl.metadata();
    await expect(dl.wait()).resolves.toBe(true);
    expect(dl.savedFilePath).toEqual(path.resolve(dir, "unquoted.dat"));

    request.mockRestore();
  });

  it("should handle UTF-8 encoded filenames in Content-Disposition", async () => {
    const request = jest
      .spyOn(https, "request")
      .mockImplementation(mockHttpWithContentDisposition(
        "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%96%87%E4%BB%B6.dat"
      ));

    const { dir } = createTmpFile();
    const dl = new EasyDl("https://example.com/download", dir);

    await dl.metadata();
    await expect(dl.wait()).resolves.toBe(true);
    expect(dl.savedFilePath).toEqual(path.resolve(dir, "测试文件.dat"));

    request.mockRestore();
  });

  it("should fallback to URL basename when Content-Disposition is missing", async () => {
    const request = jest
      .spyOn(https, "request")
      .mockImplementation(mockHttpWithContentDisposition());

    const { dir } = createTmpFile();
    const dl = new EasyDl("https://example.com/original-name.dat", dir);

    await dl.metadata();
    await expect(dl.wait()).resolves.toBe(true);
    expect(dl.savedFilePath).toEqual(path.resolve(dir, "original-name.dat"));

    request.mockRestore();
  });

  it("should fallback to URL basename when Content-Disposition filename is invalid", async () => {
    const request = jest
      .spyOn(https, "request")
      .mockImplementation(mockHttpWithContentDisposition(
        "attachment; filename*=UTF-8''%invalid"
      ));

    const { dir } = createTmpFile();
    const dl = new EasyDl("https://example.com/fallback.dat", dir);

    await dl.metadata();
    await expect(dl.wait()).resolves.toBe(true);
    expect(dl.savedFilePath).toEqual(path.resolve(dir, "fallback.dat"));

    request.mockRestore();
  });
});
