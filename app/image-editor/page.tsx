//last update 10 may///////////////////////////////
'use client';

import { useState, useRef, useEffect, useCallback, DragEvent } from 'react';
import './editor2.css';
import EditorTopbar   from './components/EditorTopbar';
import EditorSidebar  from './components/EditorSidebar';
import EditorToolbar  from './components/EditorToolbar';
import EditorCanvas   from './components/EditorCanvas';
import EditorStatusBar from './components/EditorStatusBar';
import EditorPanel    from './components/EditorPanel';
import ResizePanel    from './components/ResizePanel';
import CompressPanel  from './components/CompressPanel';
import EnhancePanel   from './components/EnhancePanel';
import CropPanel      from './components/CropPanel';
import useResize   from './hooks/useResize';
import useCompress from './hooks/useCompress';
import useEnhance  from './hooks/useEnhance';
import { getBlobSizeFromCanvas } from './hooks/canvasUtils';
import { TabId, TOAST_DURATION_MS } from './constants/editorConfig';
import { PreviewMode }from './types/editorTypes';
import {formatFileSize,getSavingsPercent,getExportExtension,}from './utils/editorUtils';

export default function ImageEditorPage() {
  // ── Editor-local theme (independent of site theme) ──────────
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('smilepdf-theme-editor');
      if (saved === 'dark' || saved === 'light') {
        requestAnimationFrame(() => setIsDark(saved === 'dark'));
      }
    } catch { /* ignore */ }
  }, []);

  const handleThemeToggle = useCallback((nextIsDark: boolean) => {
    setIsDark(nextIsDark);
  }, []);

  // ── UI state ─────────────────────────────────────────────────
  const [activeTab,       setActiveTab]       = useState<TabId>('resize');
  const [imageLoaded,     setImageLoaded]     = useState(false);
  const [isPanelCollapsed,setIsPanelCollapsed]= useState(false);
  const [isDragging,      setIsDragging]      = useState(false);
  const [isApplying,      setIsApplying]      = useState(false);
  const [previewMode,     setPreviewMode]     = useState<PreviewMode>('side');
  const [toastMsg,        setToastMsg]        = useState<string | null>(null);

  // ── Image state ───────────────────────────────────────────────
  const [originalFile,       setOriginalFile]       = useState<File | null>(null);
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState<string | null>(null);
  const [previewUrl,         setPreviewUrl]         = useState<string | null>(null);
  const [imgDimensions,      setImgDimensions]      = useState({ width: 0, height: 0 });

  // ── Status bar state ──────────────────────────────────────────
  const [originalDimensions, setOriginalDimensions] = useState('—');
  const [outputDimensions,   setOutputDimensions]   = useState('—');
  const [originalFormat,     setOriginalFormat]     = useState('—');
  const [editedFormat,       setEditedFormat]       = useState('—');
  const [originalFileSize,   setOriginalFileSize]   = useState('—');
  const [editedFileSize,     setEditedFileSize]     = useState('—');
  const [hasEdited,          setHasEdited]          = useState(false);
  const [history,            setHistory]            = useState<string[]>([]);

  // ── Refs ──────────────────────────────────────────────────────
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Resize state ──────────────────────────────────────────────
  const [resizeWidth,    setResizeWidth]    = useState(800);
  const [resizeHeight,   setResizeHeight]   = useState(600);
  const [lockRatio,      setLockRatio]      = useState(true);
  const [scale,          setScale]          = useState(100);
  const [resampleMethod, setResampleMethod] = useState('lanczos');
  const [outputFormat,   setOutputFormat]   = useState('same');
  const [targetSize,     setTargetSize]     = useState(500);
  const [targetSizeUnit, setTargetSizeUnit] = useState<'KB' | 'MB'>('KB');
  const [targetResizing, setTargetResizing] = useState(false);

  // ── Compress state ────────────────────────────────────────────
  const [quality,            setQuality]            = useState(85);
  const [compressFormat,     setCompressFormat]     = useState('jpg');
  const [stripMeta,          setStripMeta]          = useState('yes');
  const [compressTargetSize, setCompressTargetSize] = useState(500);
  const [compressTargetUnit, setCompressTargetUnit] = useState<'KB' | 'MB'>('KB');

  // ── Enhance state ─────────────────────────────────────────────
  const [brightness, setBrightness] = useState(0);
  const [contrast,   setContrast]   = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [sharpness,  setSharpness]  = useState(0);

  // ── Hooks ─────────────────────────────────────────────────────
  const { resizeImage, resizeToTargetSize: hookResizeToTarget } = useResize();
  const { applyCompress: hookApplyCompress }                     = useCompress();
  const { applyEnhance:  hookApplyEnhance  }                     = useEnhance();

  // ── Toast ─────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), TOAST_DURATION_MS);
  };

  // ── History ───────────────────────────────────────────────────
  const pushHistory = (url: string) => setHistory((p) => [...p, url]);

  // ── File upload ───────────────────────────────────────────────
  const handleFileUpload = (file: File) => {
    if (!file) return;
    setOriginalFile(file);
    const format = file.type.split('/')[1]?.toUpperCase() || '—';
    setOriginalFormat(format);
    setEditedFormat(outputFormat === 'same' ? format : outputFormat);
    setOriginalFileSize(formatFileSize(file.size));
    setEditedFileSize(formatFileSize(file.size));
    const url = URL.createObjectURL(file);
    setOriginalPreviewUrl(url);
    setPreviewUrl(url);
    setHasEdited(false);
    setHistory([]);
    const img = new window.Image();
    img.onload = () => {
      const { width, height } = img;
      setImgDimensions({ width, height });
      setOriginalDimensions(`${width} × ${height}`);
      setOutputDimensions(`${width} × ${height}`);
      setResizeWidth(width);
      setResizeHeight(height);
      setImageLoaded(true);
      showToast('Image loaded successfully');
    };
    img.src = url;
  };

  // ── Drag & drop ───────────────────────────────────────────────
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) handleFileUpload(file);
  };
  const onDragOver  = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);

  // ── Apply: Resize ─────────────────────────────────────────────
  const applyResize = async () => {
    if (!previewUrl) return;
    setIsApplying(true);
    const img = new window.Image();
    img.onload = async () => {
      let fh = resizeHeight;
      if (lockRatio) fh = Math.round(resizeWidth / (img.width / img.height));
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { newUrl, size, width, height } = await resizeImage(img, canvas, resizeWidth, fh);
      pushHistory(previewUrl!);
      setPreviewUrl(newUrl);
      setOutputDimensions(`${width} × ${height}`);
      setImgDimensions({ width, height });
      setHasEdited(true);
      setEditedFileSize(formatFileSize(size));
      setEditedFormat(outputFormat === 'same' ? originalFormat : outputFormat);
      setIsApplying(false);
      showToast(`Resized to ${width} × ${height}`);
    };
    img.src = previewUrl;
  };

  const resizeToTargetSize = async () => {
    if (!previewUrl) return;
    setTargetResizing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetBytes = targetSizeUnit === 'KB' ? targetSize * 1024 : targetSize * 1024 * 1024;
    try {
      const { finalUrl, fw, fh, size } = await hookResizeToTarget(previewUrl, canvas, targetBytes);
      pushHistory(previewUrl!);
      setPreviewUrl(finalUrl);
      setOutputDimensions(`${fw} × ${fh}`);
      setImgDimensions({ width: fw, height: fh });
      setHasEdited(true);
      setEditedFileSize(formatFileSize(size));
      setEditedFormat(outputFormat === 'same' ? originalFormat : outputFormat);
      setResizeWidth(fw);
      setResizeHeight(fh);
      setTargetResizing(false);
      showToast(`Resized to fit ${targetSize}${targetSizeUnit}`);
    } catch {
      setTargetResizing(false);
      showToast('Resize to target failed');
    }
  };

  // ── Apply: Compress ───────────────────────────────────────────
  const applyCompress = async () => {
    if (!previewUrl) return;
    setIsApplying(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetKB = compressTargetUnit === 'KB' ? compressTargetSize : compressTargetSize * 1024;
    try {
      const { url, size, width, height } = await hookApplyCompress(
        previewUrl, canvas, targetKB, compressFormat,
      );
      pushHistory(previewUrl!);
      setPreviewUrl(url);
      setHasEdited(true);
      setEditedFileSize(formatFileSize(size));
      setEditedFormat(compressFormat.toUpperCase());
      setOutputDimensions(`${width} × ${height}`);
      setIsApplying(false);
      showToast('Image compressed successfully');
    } catch {
      setIsApplying(false);
      showToast('Compression failed. Try again.');
    }
  };

  // ── Apply: Enhance ────────────────────────────────────────────
  const applyEnhance = async () => {
    if (!previewUrl) return;
    setIsApplying(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const { newUrl, size } = await hookApplyEnhance(
        previewUrl, canvas, brightness, contrast, saturation,
      );
      pushHistory(previewUrl!);
      setPreviewUrl(newUrl);
      setHasEdited(true);
      setEditedFileSize(formatFileSize(size));
      setIsApplying(false);
      showToast('Enhancements applied');
    } catch {
      setIsApplying(false);
      showToast('Enhance failed');
    }
  };

  // ── Undo ──────────────────────────────────────────────────────
  const undo = async () => {
    if (!history.length) return;
    const last = history[history.length - 1];
    setHistory((p) => p.slice(0, -1));
    setPreviewUrl(last);
    const img = new window.Image();
    img.onload = async () => {
      setImgDimensions({ width: img.width, height: img.height });
      setOutputDimensions(`${img.width} × ${img.height}`);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        setEditedFileSize(formatFileSize(await getBlobSizeFromCanvas(canvas)));
      }
    };
    img.src = last;
    if (history.length === 1) setHasEdited(false);
    showToast('Undone');
  };

  // ── Reset ─────────────────────────────────────────────────────
  const reset = () => {
    setImageLoaded(false); setOriginalFile(null);
    setOriginalPreviewUrl(null); setPreviewUrl(null);
    setOriginalDimensions('—'); setOutputDimensions('—');
    setOriginalFormat('—'); setEditedFormat('—');
    setOriginalFileSize('—'); setEditedFileSize('—');
    setHasEdited(false); setHistory([]);
    setImgDimensions({ width: 0, height: 0 });
    setResizeWidth(800); setResizeHeight(600);
    setBrightness(0); setContrast(0); setSaturation(0); setSharpness(0);
    showToast('Reset to original');
  };

  // ── Export ────────────────────────────────────────────────────
  const exportImage = () => {
    if (!hasEdited || !previewUrl) return;
    const ext = getExportExtension(outputFormat, originalFile);
    const base = originalFile?.name.replace(/\.[^.]+$/, '') || 'edited_image';
    const a   = Object.assign(document.createElement('a'), {
      download: `mycloove_${base}.${ext}`,
      href:     previewUrl,
    });
    a.click();
    try {
      void fetch('/api/usage/feature-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_id: 'image-editor', event_id: crypto.randomUUID(), file_name: originalFile?.name ?? null }),
        keepalive: true,
      }).catch(() => undefined);
    } catch { /* Usage reporting never interrupts an export. */ }
    showToast('Image exported!');
  };

  // ── Apply dispatcher ──────────────────────────────────────────
  const handleApply = () => {
    if (activeTab === 'resize')   applyResize();
    if (activeTab === 'compress') applyCompress();
    if (activeTab === 'enhance')  applyEnhance();
  };

  // ── Derived ───────────────────────────────────────────────────
  const savings = getSavingsPercent(originalFileSize, editedFileSize, hasEdited);

  // ═════════════════════════════════════════════════════════════
  //  RENDER
  // ═════════════════════════════════════════════════════════════
  return (
    <>
      {/* Toast */}
      <div className={`ie-toast ${toastMsg ? 'show' : ''}`}>{toastMsg}</div>

      <div
        className={`ie-page ${isDark ? 'ie-page-dark' : 'ie-page-light'}`}
        style={{ background: isDark ? '#0F0F12' : '#F4F3F0' }}
      >
        {/* Site topbar */}
        <EditorTopbar isDark={isDark} onThemeToggle={handleThemeToggle} />

        {/* Editor shell */}
        <div className="ie-editor-wrap">
          <div className={`ie-container ${isDark ? 'ie-dark' : 'ie-light'}`}>
            <div className="ie-wrapper">

              {/* Left sidebar — tool tabs */}
              <EditorSidebar activeTab={activeTab} onTabChange={setActiveTab} />

              {/* Main column */}
              <main className="ie-main">
                <EditorToolbar
                  activeTab={activeTab}
                  imageLoaded={imageLoaded}
                  hasEdited={hasEdited}
                  historyLength={history.length}
                  isApplying={isApplying}
                  savings={savings}
                  previewMode={previewMode}
                  onPreviewMode={setPreviewMode}
                  onUndo={undo}
                  onReset={reset}
                  onExport={exportImage}
                />

                <EditorCanvas
                  imageLoaded={imageLoaded}
                  isDragging={isDragging}
                  isApplying={isApplying}
                  previewMode={previewMode}
                  originalPreviewUrl={originalPreviewUrl}
                  previewUrl={previewUrl}
                  originalDimensions={originalDimensions}
                  outputDimensions={outputDimensions}
                  originalFormat={originalFormat}
                  editedFormat={editedFormat}
                  originalFileSize={originalFileSize}
                  editedFileSize={editedFileSize}
                  fileInputRef={fileInputRef}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onFileChange={handleFileUpload}
                  onClickZone={() => fileInputRef.current?.click()}
                />

                <EditorStatusBar
                  originalDimensions={originalDimensions}
                  outputDimensions={outputDimensions}
                  originalFormat={originalFormat}
                  editedFormat={editedFormat}
                  originalFileSize={originalFileSize}
                  editedFileSize={editedFileSize}
                  imageLoaded={imageLoaded}
                />
              </main>

              {/* Right panel — controls */}
              <EditorPanel
                activeTab={activeTab}
                isCollapsed={isPanelCollapsed}
                onToggleCollapse={() => setIsPanelCollapsed((c) => !c)}
                imageLoaded={imageLoaded}
                isApplying={isApplying}
                hasEdited={hasEdited}
                historyLength={history.length}
                onApply={handleApply}
              >
                {activeTab === 'resize' && (
                  <ResizePanel
                    imageLoaded={imageLoaded}
                    imgDimensions={imgDimensions}
                    resizeWidth={resizeWidth}     setResizeWidth={setResizeWidth}
                    resizeHeight={resizeHeight}   setResizeHeight={setResizeHeight}
                    lockRatio={lockRatio}         setLockRatio={setLockRatio}
                    scale={scale}                 setScale={setScale}
                    resampleMethod={resampleMethod} setResampleMethod={setResampleMethod}
                    outputFormat={outputFormat}   setOutputFormat={setOutputFormat}
                    targetSize={targetSize}       setTargetSize={setTargetSize}
                    targetSizeUnit={targetSizeUnit} setTargetSizeUnit={setTargetSizeUnit}
                    targetResizing={targetResizing}
                    resizeToTargetSize={resizeToTargetSize}
                  />
                )}
                {activeTab === 'compress' && (
                  <CompressPanel
                    quality={quality}               setQuality={setQuality}
                    compressFormat={compressFormat} setCompressFormat={setCompressFormat}
                    stripMeta={stripMeta}           setStripMeta={setStripMeta}
                    compressTargetSize={compressTargetSize} setCompressTargetSize={setCompressTargetSize}
                    compressTargetUnit={compressTargetUnit} setCompressTargetUnit={setCompressTargetUnit}
                    applyCompress={applyCompress}
                    imageLoaded={imageLoaded}
                  />
                )}
                {activeTab === 'enhance' && (
                  <EnhancePanel
                    brightness={brightness} setBrightness={setBrightness}
                    contrast={contrast}     setContrast={setContrast}
                    saturation={saturation} setSaturation={setSaturation}
                    sharpness={sharpness}   setSharpness={setSharpness}
                  />
                )}
                {activeTab === 'crop' && <CropPanel />}
              </EditorPanel>

            </div>
          </div>
        </div>

        {/* Footer */}
        <footer
          className="ie-footer"
          style={{
            borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            color: isDark ? 'rgba(255,255,255,0.78)' : 'rgba(26,25,26,0.72)',
          }}
        >
          <p>⚡ Fast & Secure · 🔒 All processing done in your browser · 🆓 Free to use</p>
          <p style={{ marginTop: '6px' }}>© 2026 mycloove · Made with ☕ and a smile</p>
        </footer>
      </div>

      {/* Hidden canvas for image processing */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </>
  );
}

