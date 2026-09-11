import { toFile } from "@imagekit/nodejs";

/**
 * Normalises the `file` given to `imagekit.files.upload` into something the SDK
 * actually sends as a file.
 *
 * `@imagekit/nodejs` v7 recognises a File/Blob, a Response, an async iterable
 * or a string (base64 / URL). A Node `Buffer` looks like none of those, so the
 * SDK's form encoder treats it as a plain object and appends **one form field
 * per byte** — no `file` part at all. ImageKit answers that with a 400, after
 * a request ~90× the size of the image has been built and sent. Both
 * onboarding upload routes shipped exactly that on 2026-09-10 (see
 * docs/obsidian/Bugs.md); `tests/imagekit-uploadable.test.ts` captures the
 * wire format to prove it.
 *
 * Binary input becomes a real `File` (no base64 inflation); anything else is
 * passed through untouched, since strings and files already work.
 */
export async function toUploadable(file: unknown, fileName: string, type?: string): Promise<unknown> {
  if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) {
    return toFile(file as ArrayBuffer | Uint8Array, fileName, type ? { type } : undefined);
  }
  return file;
}
