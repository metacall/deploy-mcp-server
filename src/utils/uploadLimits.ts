import type { Readable } from "node:stream";

// Protocol 0.1.35 describes a 150mb upload limit. Use decimal bytes conservatively;
// the local FaaS upload controller does not enforce its own file-size limit.
export const MAX_UPLOAD_BYTES = 150_000_000;
export const MAX_UPLOAD_BASE64_LENGTH = 4 * Math.ceil(MAX_UPLOAD_BYTES / 3);

export const assertUploadSize = (size: number, maxBytes = MAX_UPLOAD_BYTES): void => {
  if (size > maxBytes) throw new Error(`Upload exceeds the ${maxBytes}-byte limit.`);
};

export const decodeZipBase64 = (encoded: string, maxBytes = MAX_UPLOAD_BYTES): Buffer => {
  if (encoded.length > 4 * Math.ceil(maxBytes / 3)) {
    throw new Error(`zipBase64 exceeds the ${maxBytes}-byte upload limit.`);
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1 ||
      (padding > 0 && encoded.length % 4 !== 0)) {
    throw new Error("zipBase64 must contain valid base64.");
  }
  assertUploadSize(Math.floor(encoded.length * 3 / 4) - padding, maxBytes);
  const bytes = Buffer.from(encoded, "base64");
  assertUploadSize(bytes.length, maxBytes);
  return bytes;
};

export const bufferUpload = async (stream: Readable, maxBytes = MAX_UPLOAD_BYTES): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    assertUploadSize(size, maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
};
