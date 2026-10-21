import { getBlobSizeFromCanvas } from './canvasUtils';

export default function useResize() {
  const resizeImage = async (
    img: HTMLImageElement,
    canvas: HTMLCanvasElement,
    finalWidth: number,
    finalHeight: number,
  ) => {
    canvas.width = finalWidth;
    canvas.height = finalHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0, finalWidth, finalHeight);
    const newUrl = canvas.toDataURL('image/png');
    const size = await getBlobSizeFromCanvas(canvas);
    return { newUrl, size, width: finalWidth, height: finalHeight };
  };

  const resizeToTargetSize = async (
    previewUrl: string,
    canvas: HTMLCanvasElement,
    targetBytes: number,
  ) => {
    const img = new window.Image();
    return await new Promise<{ finalUrl: string; fw: number; fh: number; size: number }>((res, rej) => {
      img.onload = async () => {
        try {
          let lo = 0.05,
            hi = 1.0,
            bestScale = 1.0;
          for (let i = 0; i < 15; i++) {
            const mid = (lo + hi) / 2;
            const w = Math.round(img.width * mid);
            const h = Math.round(img.height * mid);
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
            // get blob
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'));
            if (blob.size <= targetBytes) {
              bestScale = mid;
              lo = mid;
            } else hi = mid;
          }
          const fw = Math.round(img.width * bestScale);
          const fh = Math.round(img.height * bestScale);
          canvas.width = fw;
          canvas.height = fh;
          canvas.getContext('2d')?.drawImage(img, 0, 0, fw, fh);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const finalBlob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'));
          const finalUrl = URL.createObjectURL(finalBlob);
          res({ finalUrl, fw, fh, size: finalBlob.size });
        } catch (err) {
          rej(err);
        }
      };
      img.src = previewUrl;
    });
  };

  return { resizeImage, resizeToTargetSize };
}
