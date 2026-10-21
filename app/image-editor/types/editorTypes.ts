// ─────────────────────────────────────────────────────────────
//  Image Editor — Shared Types
// ─────────────────────────────────────────────────────────────

export type TabId = 'resize' | 'crop' | 'compress' | 'enhance';
export type PreviewMode = 'split' | 'side';
export type SizeUnit = 'KB' | 'MB';

/** Image dimensions in pixels */
export interface ImgDimensions {
  width: number;
  height: number;
}

/** State that drives the status bar display */
export interface StatusBarState {
  originalDimensions: string;
  outputDimensions:   string;
  originalFormat:     string;
  editedFormat:       string;
  originalFileSize:   string;
  editedFileSize:     string;
  imageLoaded:        boolean;
  hasEdited:          boolean;
}

/** All resize-related state passed to ResizePanel */
export interface ResizeState {
  resizeWidth:      number;
  setResizeWidth:   (v: number) => void;
  resizeHeight:     number;
  setResizeHeight:  (v: number) => void;
  lockRatio:        boolean;
  setLockRatio:     (fn: (prev: boolean) => boolean) => void;
  scale:            number;
  setScale:         (v: number) => void;
  resampleMethod:   string;
  setResampleMethod:(v: string) => void;
  outputFormat:     string;
  setOutputFormat:  (v: string) => void;
  targetSize:       number;
  setTargetSize:    (v: number) => void;
  targetSizeUnit:   SizeUnit;
  setTargetSizeUnit:(v: SizeUnit) => void;
  targetResizing:   boolean;
  resizeToTargetSize: () => Promise<void>;
  imgDimensions:    ImgDimensions;
  imageLoaded:      boolean;
}

/** All compress-related state passed to CompressPanel */
export interface CompressState {
  quality:             number;
  setQuality:          (v: number) => void;
  compressFormat:      string;
  setCompressFormat:   (v: string) => void;
  stripMeta:           string;
  setStripMeta:        (v: string) => void;
  compressTargetSize:  number;
  setCompressTargetSize:(v: number) => void;
  compressTargetUnit:  SizeUnit;
  setCompressTargetUnit:(v: SizeUnit) => void;
  applyCompress:       () => Promise<void>;
  imageLoaded:         boolean;
}

/** All enhance-related state passed to EnhancePanel */
export interface EnhanceState {
  brightness:    number;
  setBrightness: (v: number) => void;
  contrast:      number;
  setContrast:   (v: number) => void;
  saturation:    number;
  setSaturation: (v: number) => void;
  sharpness:     number;
  setSharpness:  (v: number) => void;
}
