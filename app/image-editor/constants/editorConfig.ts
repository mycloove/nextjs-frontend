// ─────────────────────────────────────────────────────────────
//  Image Editor — Static Configuration
//  All static data lives here. Import from page / components as needed.
// ─────────────────────────────────────────────────────────────

export type TabId = 'resize' | 'crop' | 'compress' | 'enhance';

export const NAV_LINKS = [
  { href: '/',              label: 'Home'         },
  { href: '/about-us',     label: 'About Us'     },
  { href: '/contact-us',   label: 'Contact Us'   },
  { href: '/image-editor', label: 'Image Editor' },
] as const;

export const TAB_META: Record<TabId, { label: string; desc: string }> = {
  resize:   { label: 'Resize',   desc: 'Change image dimensions'  },
  crop:     { label: 'Crop',     desc: 'Crop to a region'         },
  compress: { label: 'Compress', desc: 'Reduce file size'         },
  enhance:  { label: 'Enhance',  desc: 'Adjust tone & colour'     },
};

export const TABS: { id: TabId }[] = [
  { id: 'resize'   },
  { id: 'crop'     },
  { id: 'compress' },
  { id: 'enhance'  },
];

export const RESIZE_PRESETS = [
  { label: '720p',   w: 1280, h: 720  },
  { label: '1080p',  w: 1920, h: 1080 },
  { label: '4K',     w: 3840, h: 2160 },
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Thumb',  w: 320,  h: 240  },
] as const;

export const RESAMPLE_OPTIONS = [
  { value: 'lanczos',  label: 'Lanczos (best quality)'   },
  { value: 'bicubic',  label: 'Bicubic'                  },
  { value: 'bilinear', label: 'Bilinear'                  },
  { value: 'nearest',  label: 'Nearest neighbor (fastest)'},
] as const;

export const OUTPUT_FORMATS = ['same', 'PNG', 'JPG', 'WEBP'] as const;
export const COMPRESS_FORMATS = ['jpg', 'png', 'webp'] as const;

export const ENHANCE_SLIDERS = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast',   label: 'Contrast',   min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'sharpness',  label: 'Sharpness',  min: 0,    max: 100 },
] as const;

export const FORMAT_CHIPS = ['PNG', 'JPG', 'WEBP', 'GIF', 'SVG'] as const;

export const TOAST_DURATION_MS = 2800;
