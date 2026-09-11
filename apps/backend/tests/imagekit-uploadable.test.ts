import { describe, expect, it } from "vitest";
import ImageKit from "@imagekit/nodejs";
import { toUploadable } from "@/lib/imagekit-uploadable";

/**
 * What `files.upload` actually puts on the wire, captured with an injected
 * `fetch` — no network.
 *
 * The SDK (v7) recognises a File/Blob, a Response, an async iterable or a
 * string as the file. A Node `Buffer` is none of those: it falls through to the
 * SDK's generic "object" branch, which appends every byte as its own form
 * field (`file[0]`, `file[1]`, …). A 200KB image became ~200,000 fields and a
 * 19MB body with no `file` field at all, which ImageKit rejects with a 400 —
 * after the tenant has waited for the whole inflated request to go out. That
 * shipped in both onboarding upload routes on 2026-09-10.
 */
async function captureUpload(file: unknown) {
  let body: FormData | null = null;
  const client = new ImageKit({
    privateKey: "test_key",
    maxRetries: 0,
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = init?.body as FormData;
      return new Response(JSON.stringify({ url: "https://ik.imagekit.io/x/p.jpg", fileId: "f1", filePath: "/p.jpg" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  await client.files.upload({ file: file as never, fileName: "p.jpg" });
  const form = body as unknown as FormData;
  return { keys: [...form.keys()], file: form.get("file") };
}

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

describe("toUploadable", () => {
  it("documents the trap: a raw Buffer is sent as one form field per byte, with no file part", async () => {
    const { keys, file } = await captureUpload(IMAGE);
    expect(file).toBeNull();
    expect(keys.filter((k) => k.startsWith("file["))).toHaveLength(IMAGE.length);
  });

  it("turns a Buffer into a single file part carrying the same bytes, name and type", async () => {
    const uploadable = await toUploadable(IMAGE, "aadhaar.webp", "image/webp");
    const { keys, file } = await captureUpload(uploadable);

    expect(keys.filter((k) => k === "file" || k.startsWith("file["))).toEqual(["file"]);
    expect(file).toBeInstanceOf(Blob);
    const sent = file as File;
    expect(sent.name).toBe("aadhaar.webp");
    expect(sent.type).toBe("image/webp");
    expect(Buffer.from(await sent.arrayBuffer())).toEqual(IMAGE);
  });

  it("accepts a Uint8Array the same way", async () => {
    const { file } = await captureUpload(await toUploadable(new Uint8Array(IMAGE), "p.jpg"));
    expect(Buffer.from(await (file as File).arrayBuffer())).toEqual(IMAGE);
  });

  it("leaves strings (base64, URLs) and files untouched", async () => {
    expect(await toUploadable("aGVsbG8=", "x")).toBe("aGVsbG8=");
    const f = new File([IMAGE], "p.jpg", { type: "image/jpeg" });
    expect(await toUploadable(f, "p.jpg")).toBe(f);
  });
});
