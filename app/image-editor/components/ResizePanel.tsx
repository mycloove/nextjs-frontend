// "use client";

// import React from 'react';

// type Props = any;

// export default function ResizePanel(props: Props) {
//   const {
//     imageLoaded,
//     imgDimensions,
//     resizeWidth,
//     setResizeWidth,
//     resizeHeight,
//     setResizeHeight,
//     lockRatio,
//     setLockRatio,
//     scale,
//     setScale,
//     resampleMethod,
//     setResampleMethod,
//     outputFormat,
//     setOutputFormat,
//     targetSize,
//     setTargetSize,
//     targetSizeUnit,
//     setTargetSizeUnit,
//     targetResizing,
//     resizeToTargetSize,
//   } = props;

//   return (
//     <>
//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Dimensions (px)</label>
//         <div className="ie-dim-row">
//           <input type="number" value={resizeWidth}
//             onChange={e => {
//               const w = Number(e.target.value);
//               setResizeWidth(w);
//               if (lockRatio && imgDimensions.width)
//                 setResizeHeight(Math.round(w / (imgDimensions.width / imgDimensions.height)));
//             }}
//             className="ie-num-input" />
//           <button onClick={() => setLockRatio((l: boolean) => !l)}
//             className={`ie-lock-btn ${lockRatio ? 'locked' : ''}`} title="Toggle aspect ratio lock">
//             {lockRatio ? (
//               <svg viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
//                 <rect x="2" y="7" width="10" height="8" rx="1.5" />
//                 <path d="M4 7V5a3 3 0 0 1 6 0v2" />
//               </svg>
//             ) : (
//               <svg viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
//                 <rect x="2" y="7" width="10" height="8" rx="1.5" />
//                 <path d="M4 7V5a3 3 0 0 1 5.7-1" />
//               </svg>
//             )}
//           </button>
//           <input type="number" value={resizeHeight}
//             onChange={e => {
//               const h = Number(e.target.value);
//               setResizeHeight(h);
//               if (lockRatio && imgDimensions.height)
//                 setResizeWidth(Math.round(h * (imgDimensions.width / imgDimensions.height)));
//             }}
//             className="ie-num-input" />
//         </div>
//         <span className="ie-hint">Ratio {lockRatio ? 'locked 🔒' : 'unlocked 🔓'}</span>
//       </div>

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Quick presets</label>
//         <div className="ie-pills">
//           {[
//             { label: '720p',   w: 1280, h: 720  },
//             { label: '1080p',  w: 1920, h: 1080 },
//             { label: '4K',     w: 3840, h: 2160 },
//             { label: 'Square', w: 1080, h: 1080 },
//             { label: 'Thumb',  w: 320,  h: 240  },
//           ].map(({ label, w, h }) => (
//             <button key={label}
//               onClick={() => { setResizeWidth(w); setResizeHeight(h); }}
//               className={`ie-pill ${resizeWidth === w && resizeHeight === h ? 'active' : ''}`}>
//               {label}
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">
//           Scale <span className="ie-ctrl-val">{scale}%</span>
//         </label>
//         <input type="range" min="10" max="200" value={scale}
//           onChange={e => {
//             const s = Number(e.target.value);
//             setScale(s);
//             setResizeWidth(Math.round(imgDimensions.width * s / 100));
//             setResizeHeight(Math.round(imgDimensions.height * s / 100));
//           }}
//           className="ie-slider" />
//         <div className="ie-slider-ticks">
//           <span>10%</span><span>100%</span><span>200%</span>
//         </div>
//       </div>

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Resampling</label>
//         <select value={resampleMethod}
//           onChange={e => setResampleMethod(e.target.value)} className="ie-select">
//           <option value="lanczos">Lanczos (best quality)</option>
//           <option value="bicubic">Bicubic</option>
//           <option value="bilinear">Bilinear</option>
//           <option value="nearest">Nearest neighbor (fastest)</option>
//         </select>
//       </div>

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Output format</label>
//         <div className="ie-segs">
//           {['same', 'PNG', 'JPG', 'WEBP'].map((f: string) => (
//             <button key={f} onClick={() => setOutputFormat(f)}
//               className={`ie-seg ${outputFormat === f ? 'active' : ''}`}>{f}</button>
//           ))}
//         </div>
//       </div>

//       <div className="ie-section-sep" />

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Resize to target size</label>
//         <div className="ie-inline-row">
//           <input type="number" value={targetSize} min="1"
//             onChange={e => setTargetSize(Number(e.target.value))}
//             className="ie-num-input" style={{ width: '58px' }} />
//           <select value={targetSizeUnit}
//             onChange={e => setTargetSizeUnit(e.target.value as 'KB' | 'MB')}
//             className="ie-select" style={{ width: '58px', marginTop: 0 }}>
//             <option value="KB">KB</option>
//             <option value="MB">MB</option>
//           </select>
//           <button onClick={resizeToTargetSize}
//             disabled={targetResizing || !imageLoaded}
//             className="ie-inline-btn">
//             {targetResizing ? (
//               <span className="ie-inline-spinner" />
//             ) : 'Apply'}
//           </button>
//         </div>
//         <span className="ie-hint">Scales dimensions to meet target</span>
//       </div>
//     </>
//   );
// }


'use client';

import { ResizeState } from '../types/editorTypes';
import { LockIcon } from './EditorIcons';
import {
  RESIZE_PRESETS, RESAMPLE_OPTIONS, OUTPUT_FORMATS,
} from '../constants/editorConfig';

type Props = ResizeState;

export default function ResizePanel({
  imageLoaded, imgDimensions,
  resizeWidth, setResizeWidth,
  resizeHeight, setResizeHeight,
  lockRatio, setLockRatio,
  scale, setScale,
  resampleMethod, setResampleMethod,
  outputFormat, setOutputFormat,
  targetSize, setTargetSize,
  targetSizeUnit, setTargetSizeUnit,
  targetResizing, resizeToTargetSize,
}: Props) {
  return (
    <>
      {/* ── Dimensions ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Dimensions (px)</label>
        <div className="ie-dim-row">
          <input
            type="number"
            value={resizeWidth}
            className="ie-num-input"
            onChange={(e) => {
              const w = Number(e.target.value);
              setResizeWidth(w);
              if (lockRatio && imgDimensions.width)
                setResizeHeight(Math.round(w / (imgDimensions.width / imgDimensions.height)));
            }}
          />

          <button
            onClick={() => setLockRatio((l) => !l)}
            className={`ie-lock-btn ${lockRatio ? 'locked' : ''}`}
            title={lockRatio ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          >
            <LockIcon locked={lockRatio} />
          </button>

          <input
            type="number"
            value={resizeHeight}
            className="ie-num-input"
            onChange={(e) => {
              const h = Number(e.target.value);
              setResizeHeight(h);
              if (lockRatio && imgDimensions.height)
                setResizeWidth(Math.round(h * (imgDimensions.width / imgDimensions.height)));
            }}
          />
        </div>
        <span className="ie-hint">Ratio {lockRatio ? 'locked 🔒' : 'unlocked 🔓'}</span>
      </div>

      {/* ── Presets ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Quick presets</label>
        <div className="ie-pills">
          {RESIZE_PRESETS.map(({ label, w, h }) => (
            <button
              key={label}
              onClick={() => { setResizeWidth(w); setResizeHeight(h); }}
              className={`ie-pill ${resizeWidth === w && resizeHeight === h ? 'active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scale slider ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">
          Scale <span className="ie-ctrl-val">{scale}%</span>
        </label>
        <input
          type="range" min="10" max="200" value={scale}
          className="ie-slider"
          onChange={(e) => {
            const s = Number(e.target.value);
            setScale(s);
            setResizeWidth(Math.round(imgDimensions.width  * s / 100));
            setResizeHeight(Math.round(imgDimensions.height * s / 100));
          }}
        />
        <div className="ie-slider-ticks">
          <span>10%</span><span>100%</span><span>200%</span>
        </div>
      </div>

      {/* ── Resampling ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Resampling</label>
        <select
          value={resampleMethod}
          onChange={(e) => setResampleMethod(e.target.value)}
          className="ie-select"
        >
          {RESAMPLE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* ── Output format ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Output format</label>
        <div className="ie-segs">
          {OUTPUT_FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => setOutputFormat(f)}
              className={`ie-seg ${outputFormat === f ? 'active' : ''}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="ie-section-sep" />

      {/* ── Resize to target size ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Resize to target size</label>
        <div className="ie-inline-row">
          <input
            type="number" value={targetSize} min="1"
            onChange={(e) => setTargetSize(Number(e.target.value))}
            className="ie-num-input"
            style={{ width: '58px' }}
          />
          <select
            value={targetSizeUnit}
            onChange={(e) => setTargetSizeUnit(e.target.value as 'KB' | 'MB')}
            className="ie-select"
            style={{ width: '58px', marginTop: 0 }}
          >
            <option value="KB">KB</option>
            <option value="MB">MB</option>
          </select>
          <button
            onClick={resizeToTargetSize}
            disabled={targetResizing || !imageLoaded}
            className="ie-inline-btn"
          >
            {targetResizing ? <span className="ie-inline-spinner" /> : 'Apply'}
          </button>
        </div>
        <span className="ie-hint">Scales dimensions to meet target</span>
      </div>
    </>
  );
}
