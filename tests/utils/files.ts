import { randomBytes } from "node:crypto";
import { hash } from "./hash";
import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const KB = 1024;
const MB = 1024 * 1024;

function createFile(size: number) {
  const file = randomBytes(size);
  const fileHash = hash(file);
  return { file, size, fileHash };
}

export const files = {
  "100Kb": createFile(100 * KB),
  "10Mb": createFile(10 * MB),
  "100Mb": createFile(100 * MB),
};

export function createTmpFile() {
  const dir = fs.mkdtempSync(os.tmpdir());
  const fileName = crypto.randomUUID();

  return {
    dir,
    fileName,
    fullFileLocation: path.join(dir, fileName),
  };
}
