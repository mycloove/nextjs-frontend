import ToolRouteGate from '@/components/tools/ToolRouteGate'

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