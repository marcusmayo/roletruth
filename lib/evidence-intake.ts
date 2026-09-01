import { sha256Hex } from "./roletruth-engine";
import { validatePublicUrl } from "./url-security";

export const MAX_URLS = 3;
export const MAX_SCREENSHOTS = 8;
export const MAX_SOURCES = 8;
export const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;
export const MAX_TOTAL_SCREENSHOT_BYTES = 20 * 1024 * 1024;

export interface ScreenshotInput {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
  sha256: string;
}

export interface EvidenceRequestInput {
  urls: string[];
  screenshots: ScreenshotInput[];
}

function detectImageMime(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png" as const;
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg" as const;
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp" as const;
  }
  return null;
}

function parseUrls(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("URLs must be a JSON array.");
  return parsed.map(validatePublicUrl);
}

export async function parseEvidenceRequest(
  request: Request,
): Promise<EvidenceRequestInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    const body = (await request.json()) as { urls?: unknown };
    if (!Array.isArray(body.urls)) {
      throw new Error("Provide at least one public URL or screenshot.");
    }
    const urls = body.urls.map(validatePublicUrl);
    if (urls.length === 0) {
      throw new Error("Provide at least one public URL or screenshot.");
    }
    if (urls.length > MAX_URLS) {
      throw new Error(`RoleTruth accepts at most ${MAX_URLS} URLs per run.`);
    }
    return { urls, screenshots: [] };
  }

  const form = await request.formData();
  const urls = parseUrls(form.get("urls"));
  if (urls.length > MAX_URLS) {
    throw new Error(`RoleTruth accepts at most ${MAX_URLS} URLs per run.`);
  }

  const fileEntries = form.getAll("screenshots");
  if (fileEntries.length > MAX_SCREENSHOTS) {
    throw new Error(
      `RoleTruth accepts at most ${MAX_SCREENSHOTS} screenshots per run.`,
    );
  }
  if (urls.length + fileEntries.length > MAX_SOURCES) {
    throw new Error(`RoleTruth accepts at most ${MAX_SOURCES} total sources.`);
  }

  const screenshots: ScreenshotInput[] = [];
  let totalBytes = 0;
  for (const entry of fileEntries) {
    if (typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
      throw new Error("Every screenshot entry must be an uploaded file.");
    }
    if (entry.size === 0 || entry.size > MAX_SCREENSHOT_BYTES) {
      throw new Error(
        `${entry.name || "Screenshot"} must be between 1 byte and 6 MB.`,
      );
    }
    totalBytes += entry.size;
    if (totalBytes > MAX_TOTAL_SCREENSHOT_BYTES) {
      throw new Error("The combined screenshot upload may not exceed 20 MB.");
    }

    const bytes = new Uint8Array(await entry.arrayBuffer());
    const mimeType = detectImageMime(bytes);
    if (!mimeType) {
      throw new Error(
        `${entry.name || "Screenshot"} is not a valid PNG, JPEG, or WebP image.`,
      );
    }
    screenshots.push({
      name: entry.name || `screenshot-${screenshots.length + 1}`,
      mimeType,
      bytes,
      sha256: await sha256Hex(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    });
  }

  if (urls.length === 0 && screenshots.length === 0) {
    throw new Error("Provide at least one public URL or screenshot.");
  }

  return { urls, screenshots };
}
