/*
 *  You can import this module by using:
 *     import EasyDl from "easydl";
 *                 or
 *    const EasyDl = require('easydl');
 */
import EasyDl from "../dist";

(async () => {
  const dl = new EasyDl("http://www.ovh.net/files/100Mio.dat", "/tmp", {
    reportInterval: 3500,
  });
  const completed = await dl
    .on("progress", ({ details, total }) => {
      // do something with the progress
      console.log("[details]", details);
      // you will get an array like this:
      //[
      //   { speed: 0, bytes: 0, percentage: 0 },
      //   { speed: 0, bytes: 0, percentage: 0 },
      //   ....
      //   {
      //     speed: 837509.8149186764,
      //     bytes: 7355193,
      //     percentage: 70.14458656311035
      //   },
      //   {
      //     speed: 787249.3573264781,
      //     bytes: 7507833,
      //     percentage: 71.60027503967285
      //   },
      //   ...
      //]

      console.log("[total]", total);
      // You will get something like this:
      // {
      //   speed: 4144377.1053382815,
      //   bytes: 41647652,
      //   percentage: 39.71829605102539
      // }
    })
    .wait();

  console.log("download complete?", completed);
})();
