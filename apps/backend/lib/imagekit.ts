import ImageKit from "@imagekit/nodejs";

const privateKey = process.env.IMAGEKIT_PRIVATE_KEY || "dummy_key";
const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/dummy";

if (!process.env.IMAGEKIT_PRIVATE_KEY && process.env.NODE_ENV !== "production") {
  console.warn("⚠️ Missing IMAGEKIT_PRIVATE_KEY environment variable. Using mock uploader.");
}

const rawImagekit = new ImageKit({
  privateKey: privateKey,
});

export const imagekit = new Proxy(rawImagekit, {
  get(target, prop, receiver) {
    if (prop === "files") {
      const originalFiles = target.files;
      return new Proxy(originalFiles, {
        get(filesTarget, filesProp, filesReceiver) {
          if (filesProp === "upload") {
            return async function(options: any) {
              if (privateKey === "dummy_key") {
                console.log("Mocking ImageKit upload in development mode...");
                let fileUrl = "https://ik.imagekit.io/dummy/mock_upload.png";
                if (options.file) {
                  if (typeof options.file === "string" && !options.file.startsWith("http")) {
                    fileUrl = `data:image/png;base64,${options.file}`;
                  } else if (typeof options.file === "string") {
                    fileUrl = options.file;
                  }
                }
                return {
                  url: fileUrl,
                  fileId: "mock_file_id_" + Date.now(),
                  name: options.fileName || "mock_file.png",
                  size: 1000,
                  filePath: "/mock_file.png",
                  isPrivateFile: false,
                  thumbnailUrl: fileUrl,
                };
              }
              const originalUpload = Reflect.get(filesTarget, filesProp, filesReceiver);
              return originalUpload.apply(filesTarget, [options]);
            };
          }
          return Reflect.get(filesTarget, filesProp, filesReceiver);
        }
      });
    }
    return Reflect.get(target, prop, receiver);
  }
}) as unknown as ImageKit;

/**
 * URL endpoint is needed for signed URL generation via helper.buildSrc().
 * The new @imagekit/nodejs v7.x SDK no longer accepts it in the constructor.
 */
export const IMAGEKIT_URL_ENDPOINT = urlEndpoint;

