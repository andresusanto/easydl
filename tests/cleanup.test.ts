import fs from "fs";
import https from "https";
import { mockResumableRequest } from "./utils/mock-http";
import { createTmpFile } from "./utils/files";

import EasyDl from "../src";
import { clean } from "../src/utils";

beforeEach(() => jest.restoreAllMocks());

it("should clean-up destroyed files", async () => {
  const request = jest
    .spyOn(https, "request")
    .mockImplementation(mockResumableRequest());

  const { dir, fullFileLocation } = createTmpFile();

  const dl1 = new EasyDl("https://susan.to", `${fullFileLocation}.1`, {
    connections: 2,
  }).on("progress", () => {
    dl1.destroy();
  });

  const dl2 = new EasyDl("https://susan.to", `${fullFileLocation}.2`, {
    connections: 2,
  }).on("progress", () => {
    dl2.destroy();
  });

  const dl3 = new EasyDl("https://susan.to", `${fullFileLocation}.3`, {
    connections: 2,
  }).on("progress", () => {
    dl3.destroy();
  });

  await expect(dl1.wait()).resolves.toBe(false);
  await expect(dl2.wait()).resolves.toBe(false);
  await expect(dl3.wait()).resolves.toBe(false);

  expect(fs.readdirSync(dir)).toHaveLength(6);

  await expect(clean(`${fullFileLocation}.3`)).resolves.toEqual(
    expect.arrayContaining([expect.stringMatching(/\.3\.\$\$[0-9](\$PART)?/)])
  );

  expect(fs.readdirSync(dir)).toHaveLength(4);

  await expect(clean(dir)).resolves.toHaveLength(4);

  expect(fs.readdirSync(dir)).toHaveLength(0);
});

it("should handle invalid file/directory", async () => {
  await expect(clean("a")).rejects.toThrow("Invalid location");
});
