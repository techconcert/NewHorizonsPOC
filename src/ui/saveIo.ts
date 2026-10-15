import { parseSaveFile, SAVE_FILE_MAX_BYTES, type SaveFileResult } from '../shared/saveFile';

/** Browser glue for save export and import (M8, D-148). The checks themselves are in shared/saveFile.ts. */

/** Offer `text` as a downloaded file. */
export function downloadTextFile(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Read a chosen file and check it. Never throws; the error text is ready for the player. */
export async function readSaveFile(file: File): Promise<SaveFileResult> {
  if (file.size > SAVE_FILE_MAX_BYTES) {
    return {
      ok: false,
      error: `The file is too large to be a save (over ${SAVE_FILE_MAX_BYTES / (1024 * 1024)} MB).`,
    };
  }
  try {
    return parseSaveFile(await file.text());
  } catch {
    return { ok: false, error: 'The file could not be read.' };
  }
}
