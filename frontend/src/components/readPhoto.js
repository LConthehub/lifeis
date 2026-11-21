/**
 * Reads the words off photos of a recipe, on this device.
 *
 * The reader (Tesseract, compiled to run in the page) and everything it needs are loaded from Life Is itself
 * (/ocr), so no photo, and no request at all, goes to anyone else. It is only loaded when a photo is chosen.
 */
const LONGEST_SIDE = 2400;

/** The photo, no larger than the reader needs: phone photos are far bigger than helps, and slow to read. */
async function prepared(file) {
  const picture = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, LONGEST_SIDE / Math.max(picture.width, picture.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(picture.width * scale);
  canvas.height = Math.round(picture.height * scale);
  canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
  picture.close?.();
  return canvas;
}

/** The text of each photo in turn, joined. `say` is told how it's going, in words. */
export async function readPhotos(files, say = () => {}) {
  const { createWorker } = await import('tesseract.js');
  let page = 0;
  const worker = await createWorker('eng', 1, {
    workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr/', workerBlobURL: false, gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text') say(`Reading${files.length > 1 ? ` page ${page} of ${files.length}` : ''}… ${Math.round(m.progress * 100)}%`);
      else say('Getting the reader ready…');
    },
  });
  try {
    const texts = [];
    for (const file of files) {
      page += 1;
      const { data } = await worker.recognize(await prepared(file));
      texts.push(data.text.trim());
    }
    return texts.filter(Boolean).join('\n\n');
  } finally {
    await worker.terminate();
  }
}
