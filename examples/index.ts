/*
 *  You can import this module by using:
 *     import EasyDl from "easydl";
 *                 or
 *    const EasyDl = require('easydl');
 */
import EasyDl from "../dist";

/*
 * Files to be downlaoded.
 *  You can see other sizes here:
 *  http://www.ovh.net/files
 */
const files = [
  // Files without redirection:
  ["http://www.ovh.net/files/100Mio.dat", "./100Mio.dat"],
  ["http://www.ovh.net/files/1Mio.dat", "./1Mio.dat"],

  // Files with redirects:
  ["https://github.com/torvalds/linux/archive/v5.7-rc6.zip", "./Redirect.dat"],
  [
    "https://github.com/electron/electron/releases/download/v10.0.0-beta.1/electron-v10.0.0-beta.1-darwin-x64-symbols.zip",
    "./Redirect2.dat",
  ],
];

(async () => {
  for (let file of files) {
    console.log("Downloading:", file[0]);
    const res = await new EasyDl(file[0], file[1], {
      connections: 3,
      chunkSize: (s) => {
        return s / 10;
      },
    })
      .on("metadata", (data) => {
        console.log("metadata", data);
      })
      .on("progress", ({ total }) => {
        console.log(total);
      })
      .on("retry", (data) => console.log("[retry]", data))
      .on("error", (err) => console.log("[error]", err))
      .wait();

    if (res) console.log("file is downloaded!");
    else console.log("file not downloaded!");
  }
})();
