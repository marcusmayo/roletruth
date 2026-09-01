import type { ScreenshotInput } from "./evidence-intake";

export interface ScreenshotOcrResult {
  screenshot: ScreenshotInput;
  text: string;
  confidence: number;
  error?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} exceeded ${timeoutMs / 1000} seconds.`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function ocrScreenshots(
  screenshots: ScreenshotInput[],
): Promise<ScreenshotOcrResult[]> {
  if (screenshots.length === 0) return [];

  const { createWorker } = await import("tesseract.js");
  const worker = await withTimeout(
    createWorker("eng", undefined, {
      cachePath: "/tmp/roletruth-tesseract-cache",
    }),
    60_000,
    "OCR initialization",
  );

  try {
    const results: ScreenshotOcrResult[] = [];
    for (const screenshot of screenshots) {
      try {
        const result = await withTimeout(
          worker.recognize(Buffer.from(screenshot.bytes)),
          90_000,
          `OCR for ${screenshot.name}`,
        );
        results.push({
          screenshot,
          text: result.data.text.replace(/\r\n/g, "\n").trim(),
          confidence: Math.max(0, Math.min(100, result.data.confidence ?? 0)),
        });
      } catch (error) {
        results.push({
          screenshot,
          text: "",
          confidence: 0,
          error: error instanceof Error ? error.message : "OCR failed.",
        });
      }
    }
    return results;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
