import { getBlobSizeFromCanvas } from './canvasUtils';

export default function useEnhance() {
  const applyEnhance = async (
    previewUrl: string,
    canvas: HTMLCanvasElement,
    brightness: number,
    contrast: number,
    saturation: number,
  ) => {
    const img = new window.Image();
    return await new Promise<{ newUrl: string; size: number; width: number; height: number }>((res, rej) => {
      img.onload = async () => {
        try {
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return rej('no ctx');
          ctx.filter = `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100}) saturate(${1 + saturation / 100})`;
          ctx.drawImage(img, 0, 0);
          ctx.filter = 'none';
          const newUrl = canvas.toDataURL('image/png');
          const size = await getBlobSizeFromCanvas(canvas);
          res({ newUrl, size, width: img.width, height: img.height });
        } catch (err) {
          rej(err);
        }
      };
      img.src = previewUrl;
    });
  };

  return { applyEnhance };
}
