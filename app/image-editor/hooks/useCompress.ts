import { getBlobSizeFromCanvas } from './canvasUtils';

export default function useCompress() {
  const compressToTargetSize = (
    imgEl: HTMLImageElement,
    targetKB: number,
    fmt: string,
    canvas: HTMLCanvasElement,
  ): Promise<string> =>
    new Promise((resolve, reject) => {
      const mimeType = fmt === 'jpg' ? 'image/jpeg' : fmt === 'png' ? 'image/png' : 'image/webp';
      const targetBytes = targetKB * 1024;
      canvas.width = imgEl.width;
      canvas.height = imgEl.height;
      canvas.getContext('2d')?.drawImage(imgEl, 0, 0);
      let lo = 0.01,
        hi = 0.99;
      const tryQ = (q: number) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject('blob failed');
            return;
          }
          if (blob.size <= targetBytes || hi - lo < 0.01) {
            resolve(URL.createObjectURL(blob));
          } else if (blob.size > targetBytes) {
            hi = q;
            tryQ((lo + hi) / 2);
          } else {
            lo = q;
            tryQ((lo + hi) / 2);
          }
        }, mimeType, q);
      };
      tryQ(0.85);
    });

  const applyCompress = async (
    previewUrl: string,
    canvas: HTMLCanvasElement,
    targetKB: number,
    fmt: string,
  ) => {
    const img = new window.Image();
    return await new Promise<{ url: string; size: number; width: number; height: number }>((res, rej) => {
      img.onload = async () => {
        try {
          const url = await compressToTargetSize(img, targetKB, fmt, canvas);
          const blob = await (await fetch(url)).blob();
          res({ url, size: blob.size, width: img.width, height: img.height });
        } catch (err) {
          rej(err);
        }
      };
      img.src = previewUrl;
    });
  };

  return { compressToTargetSize, applyCompress };
}
