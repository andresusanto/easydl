/*
 *  You can import this module by using:
 *     import { clean } from "easydl/utils";
 *                 or
 *    const { clean } = require('easydl/utils');
 */
import { clean } from "../dist/utils";

// import EasyDl from "easydl";
import EasyDl from "../dist";

// All downloaded chunks are kept until the download has finished.
// If you decide to abort the download and do not plan to resume, you
// can use the cleaning utility provided by easydl to delete all temporary chunk files

function createDownload(output: string) {
  const dl = new EasyDl(
    "http://www.ovh.net/files/10Mio.dat",
    `/tmp/${output}.dat`
  ).on("progress", ({ total }) => {
    // stop the download at 50% so that we have chunk files left
    if (total.percentage >= 50) dl.destroy();
  });
  return dl;
}

(async () => {
  // let's create some chunk files
  const dl1 = createDownload("1");
  const dl2 = createDownload("2");
  const dl3 = createDownload("3");
  const dl4 = createDownload("4");

  console.log("downloading ...");
  await Promise.all([dl1.wait(), dl2.wait(), dl3.wait(), dl4.wait()]);
  // we should have chunk files from 4 downloads at "/tmp" now

  // this will delete chunks belonging to the first download only
  const deletedChunks1 = await clean("/tmp/1.dat");
  console.log(deletedChunks1);

  // this will delete all remaining chunks in /tmp directory
  const deletedChunks2 = await clean("/tmp");
  console.log(deletedChunks2);
})();
