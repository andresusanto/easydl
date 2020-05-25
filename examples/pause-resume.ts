/*
 *  You can import this module by using:
 *     import EasyDl from "easydl";
 *                 or
 *    const EasyDl = require('easydl');
 */
import EasyDl from "../dist";

(async () => {
  const dl = new EasyDl("http://www.ovh.net/files/100Mio.dat", "/tmp/100.dat", {
    chunkSize: 10 * 1024 * 1024, // 10 MB chunk
  });

  const metadata = await dl.metadata();
  console.log("got metadata", metadata);
  doSomethingElseSomewhere(dl);

  // if the downlaod had been destroyed before it's completed,
  // the returned value from .wait() will be false.
  const completed = await dl.wait();
  console.log("downloaded?", completed);

  otherPartOfTheApp();
})();

function doSomethingElseSomewhere(dl: EasyDl) {
  // Somewhere in your program, if you want to stop/pause the download
  // you must keep a reference to the created EasyDl object
  // and call the .destroy() method

  // for this example, let's stop the download when we have 5 complete chunks
  dl.on("progress", (progress) => {
    if (
      progress.details.filter((detail) => detail.percentage === 100).length ===
      5
    ) {
      console.log(
        `stopping the download at ${progress.total.percentage.toFixed(2)}%`
      );
      dl.destroy();
    }
  });
}

async function otherPartOfTheApp() {
  // later when you decide to resume the download, you just need to create
  // a new EasyDl instance with the same url and same destination file.
  // It will detect previous attempts of download and use the previously
  // downloaded chunks instead of re-downloading already downloaded chunks.

  const otherDl = new EasyDl(
    "http://www.ovh.net/files/100Mio.dat",
    "/tmp/100.dat",
    {
      // chunk size must remain the same with the previous download if
      // you want to resume it.
      chunkSize: 10 * 1024 * 1024, // 10 MB chunk
    }
  );
  const metadata = await otherDl.metadata();
  // you will see if the download used the previously downloaded chunks
  // at the metadata of the file
  console.log("is resume:", metadata.isResume);

  // Downloads should start from 50% since we have 5 (out of 10) complete chunks
  console.log(
    "initial progress:",
    metadata.progress.reduce((p, c) => p + c, 0) / metadata.progress.length
  );
  await otherDl.wait();
  console.log("done!");
}
