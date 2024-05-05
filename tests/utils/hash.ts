import fs from "fs";
import { BinaryLike, createHash } from "node:crypto";

export function hash(data: BinaryLike | BinaryLike[]) {
  const hasher = createHash("sha256");

  if (Array.isArray(data)) {
    data.forEach(hasher.update);
  } else {
    hasher.update(data);
  }

  return hasher.digest("hex");
}

export function hashFile(location: string | string[]) {
  if (Array.isArray(location)) {
    return hash(location.map((f) => fs.readFileSync(f)));
  } else {
    return hash(fs.readFileSync(location));
  }
}
