import fs from "fs";
import { request } from "https";
import { files } from "./files";

export type MockHTTPOption = {
  head?: () => {
    status?: number;
    headers: Record<string, string>;
  };
  get?: (range: [number, number]) => {
    status?: number;
    headers: Record<string, string>;
    body: Buffer;
  };
};
export function createMockHTTP(mockOpts: MockHTTPOption) {
  return ((_, opts, cb) => {
    let endCb: (e?: any) => void;
    let closeCb: (e?: any) => void;

    process.nextTick(() => {
      if (cb && opts.method === "HEAD") {
        const headOpts = mockOpts.head?.();

        cb({
          statusCode: headOpts?.status ?? 200,
          headers: headOpts?.headers ?? {},
          on(name: string, cb: (e?: any) => void) {
            if (name === "end") endCb = cb;
            if (name === "close") closeCb = cb;
            if (name === "error")
              process.nextTick(() => {
                closeCb();
                endCb();
              });
          },
        } as any);
      } else if (cb) {
        if (!mockOpts.get)
          throw new Error(
            "createMockHTTP mockOpts.get is not provided but getting GET request!"
          );

        const [rangeStart, rangeEnd] = (opts.headers?.["Range"] as string)
          ?.split("=")
          .at(1)
          ?.split("-")
          ?.map((r) => parseInt(r, 10)) ?? [0, 0];

        const getOpts = mockOpts.get([rangeStart, rangeEnd]);
        let pipeOk = false;
        let dataOk = false;

        const markComplete = () =>
          process.nextTick(() => {
            if (!pipeOk || !dataOk) return;

            closeCb();
            endCb();
          });

        cb({
          statusCode: getOpts.status ?? 206,
          headers: getOpts.headers,
          pipe(dest: fs.WriteStream) {
            dest.write(getOpts.body);
            dest.end(() => {
              pipeOk = true;
              markComplete();
            });
          },
          on(name: string, cb: (e?: any) => void) {
            if (name === "end") endCb = cb;
            if (name === "close") closeCb = cb;
            if (name === "data") {
              process.nextTick(() => {
                cb(getOpts.body);
                dataOk = true;
                markComplete();
              });
            }
          },
        } as any);
      }
    });

    return {
      on() {},
      end() {},
      destroy() {},
    } as any;
  }) as typeof request;
}

export const mockResumableRequest = (file = files["100Mb"]) =>
  createMockHTTP({
    head() {
      return {
        headers: {
          "accept-ranges": "bytes",
          "content-length": `${file.size}`,
        },
      };
    },
    get([start, end]) {
      if (end === 0) throw new Error("Not expecting to have 0 end range");
      return {
        body: file.file.subarray(start, end + 1),
        headers: {
          "content-length": `${end - start + 1}`,
        },
      };
    },
  });

export const mockFailedRequest = () =>
  createMockHTTP({
    get() {
      return { status: 503, body: Buffer.from(""), headers: {} };
    },
  });
