import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  CollectionConfig,
  GeneratedStorageAdapter,
  StorageAdapterFactory,
  StorageServeMode,
  StoredFileData,
  UploadInputFile,
} from "./types.js";

function sanitizeSegment(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "." && segment !== "..")
    .join("/")
    .replace(/^\/+/, "")
    .replace(/[^\w.-/]/g, "-");
}

function sanitizeFilename(filename: string) {
  const normalized = path.posix.basename(sanitizeSegment(filename));
  return normalized || "file";
}

function sanitizeStorageKey(storageKey: string) {
  const normalized = sanitizeSegment(storageKey);
  if (!normalized) {
    throw new Error("Storage key must not be empty.");
  }

  return normalized;
}

function getLocalUploadRoot() {
  return process.env.OBOE_UPLOAD_DIR
    ? path.resolve(process.env.OBOE_UPLOAD_DIR)
    : path.resolve(process.cwd(), ".oboe", "uploads");
}

function buildStorageKey(file: UploadInputFile, prefix?: string) {
  const filename = sanitizeFilename(file.filename);
  const key = `${randomUUID()}-${filename}`;
  return prefix ? path.posix.join(sanitizeSegment(prefix), key) : key;
}

function toStoredFileData(args: {
  file: UploadInputFile;
  prefix?: string;
  storageAdapter: string;
  storageKey: string;
}): StoredFileData {
  return {
    filename: sanitizeFilename(args.file.filename),
    filesize: args.file.filesize,
    mimeType: args.file.mimeType,
    prefix: args.prefix,
    storageAdapter: args.storageAdapter,
    storageKey: args.storageKey,
  };
}

function localPathFor(storageKey: string) {
  return path.join(
    getLocalUploadRoot(),
    ...sanitizeStorageKey(storageKey).split("/")
  );
}

export const createLocalStorageAdapter: StorageAdapterFactory = ({
  prefix,
}): GeneratedStorageAdapter => ({
  async handleDelete({ file }) {
    try {
      await fs.unlink(localPathFor(file.storageKey));
    } catch (error) {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
      ) {
        throw error;
      }
    }
  },
  async handleDownload({ file }) {
    const buffer = await fs.readFile(localPathFor(file.storageKey));

    return new Response(buffer, {
      headers: {
        "content-length": String(buffer.byteLength),
        "content-type": file.mimeType,
      },
      status: 200,
    });
  },
  async handleUpload({ file }) {
    const storageKey = buildStorageKey(file, prefix);
    const targetPath = localPathFor(storageKey);

    await fs.mkdir(path.dirname(targetPath), {
      recursive: true,
    });
    await fs.writeFile(targetPath, file.buffer);

    return toStoredFileData({
      file,
      prefix,
      storageAdapter: "local",
      storageKey,
    });
  },
  name: "local",
});

export function getCollectionServeMode(
  collection: CollectionConfig
): StorageServeMode {
  return collection.storage?.serveMode ?? "proxy";
}

export function getCollectionStorageAdapter(
  collection: CollectionConfig
): GeneratedStorageAdapter {
  return (
    collection.storage?.adapter?.({
      collection,
      prefix: collection.storage.prefix,
      serveMode: getCollectionServeMode(collection),
    }) ??
    createLocalStorageAdapter({
      collection,
      prefix: collection.storage?.prefix,
      serveMode: getCollectionServeMode(collection),
    })
  );
}

export function getCollectionFileProxyPath(args: {
  collection: string;
  id: string;
}) {
  return `/api/${args.collection}/${args.id}/file`;
}
