import * as path from "path";
import * as fs from "fs";

export function rm(loc: string): Promise<void> {
  return new Promise((res, rej) =>
    fs.unlink(loc, (err) => {
      if (err) return rej(err);
      res();
    })
  );
}

export function ls(loc: string): Promise<string[]> {
  return new Promise((res, rej) =>
    fs.readdir(loc, (err, result) => {
      if (err) return rej(err);
      res(result);
    })
  );
}

export function fileStats(loc: string): Promise<fs.Stats | null> {
  return new Promise<fs.Stats | null>((res, rej) =>
    fs.stat(loc, (err, stat) => {
      if (err && err.code === "ENOENT") return res(null);
      if (err) return rej(err);
      res(stat);
    })
  );
}

export function rename(oldPath: string, newPath: string): Promise<void> {
  return new Promise<void>((res, rej) =>
    fs.rename(oldPath, newPath, (err) => {
      if (err) return rej(err);
      res();
    })
  );
}

export async function validate(loc: string): Promise<boolean> {
  const parsed = path.parse(loc);
  try {
    const stat = await fileStats(parsed.dir);
    if (!stat) return false;
    return stat.isDirectory();
  } catch (e) {
    return false;
  }
}
