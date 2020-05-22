import * as path from "path";
import * as fs from "fs";

export function fileStats(loc: string): Promise<fs.Stats | null> {
  return new Promise<fs.Stats | null>((res, rej) =>
    fs.stat(loc, (err, stat) => {
      if (err && err.code === "ENOENT") return res(null);
      if (err) return rej(err);
      res(stat);
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
