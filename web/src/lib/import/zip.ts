import { ImportError } from "./types";

export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const readU16 = (view: DataView, offset: number): number => view.getUint16(offset, true);
const readU32 = (view: DataView, offset: number): number => view.getUint32(offset, true);

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === "undefined") {
    throw new ImportError("Compressed zip entries are not supported in this browser.");
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * Minimal ZIP reader for export vaults: stored (0) and deflate (8) entries only.
 * Skips directories; returns file path → bytes. No external dependency.
 */
export const readZipEntries = async (buffer: ArrayBuffer): Promise<ZipEntry[]> => {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // EOCD is at least 22 bytes and may be preceded by a comment of up to 64 KiB.
  let eocdOffset = -1;
  const scanStart = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= scanStart; offset -= 1) {
    if (readU32(view, offset) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new ImportError("Not a valid zip archive.");
  }

  const entryCount = readU16(view, eocdOffset + 10);
  const centralOffset = readU32(view, eocdOffset + 16);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || readU32(view, offset) !== CENTRAL_SIGNATURE) {
      throw new ImportError("Corrupted zip central directory.");
    }
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith("/")) continue;

    if (localOffset + 30 > bytes.length || readU32(view, localOffset) !== LOCAL_SIGNATURE) {
      throw new ImportError(`Corrupted zip entry: ${path}`);
    }
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    let content: Uint8Array;
    if (method === 0) {
      content = raw;
    } else if (method === 8) {
      content = await inflateRaw(raw);
    } else {
      // Unsupported compression: skip rather than failing the whole vault.
      continue;
    }
    entries.push({ path, bytes: content });
  }

  return entries;
};
