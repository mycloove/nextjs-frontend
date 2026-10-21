export const getBlobSizeFromCanvas = (
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality = 0.92,
): Promise<number> =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob?.size || 0), type, quality);
  });
