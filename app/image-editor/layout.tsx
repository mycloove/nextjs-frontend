import ToolRouteGate from '@/components/tools/ToolRouteGate'
import { pageMetadata } from '@/lib/metadata'

export const metadata = pageMetadata(
  '/image-editor',
  'Image Editor: Crop, Resize and Compress',
  'Crop, resize, and compress images on a browser canvas. Review your changes before exporting the image.',
)

export default function ImageEditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolRouteGate toolId="image-editor" label="Image Editor">
      <main className="min-h-screen">{children}</main>
    </ToolRouteGate>
  );
}
