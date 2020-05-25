import * as fs from "fs";
import * as path from "path";
import { rm, ls, fileStats } from "./fs";

/**
 * Delete all downloaded chunks permanently.
 *
 * @param loc {string} Target file/directory to be cleaned.
 * If directory is given, it will delete all EasyDl chunks in the given directory.
 * Otherwise, it will only delete chunks belonging to the given file.
 */
async function clean(loc: string): Promise<string[]> {
  let targetFile: string | null = null;
  let stats: fs.Stats | null = null;
  let targetFolder = loc;

  stats = await fileStats(loc);
  if (!stats) {
    const parsed = path.parse(loc);
    targetFile = parsed.base;
    targetFolder = parsed.dir;
    stats = await fileStats(parsed.dir);
  }

  if (!stats || !stats.isDirectory())
    throw new Error(`Invalid location ${loc}.`);

  const files = await ls(targetFolder);
  const deleted: string[] = [];
  const regex = /(.+)\.\$\$[0-9]+(\$PART)?$/;

  for (let file of files) {
    const cap = regex.exec(file);
    if (!cap || (targetFile !== null && cap[1] !== targetFile)) continue;
    const fullPath = path.join(targetFolder, file);
    await rm(fullPath);
    deleted.push(fullPath);
  }

  return deleted;
}

export { clean };
