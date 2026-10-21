// "use client";

// import React from 'react';

// type Props = any;

// export default function CompressPanel(props: Props) {
//   const {
//     quality,
//     setQuality,
//     compressFormat,
//     setCompressFormat,
//     stripMeta,
//     setStripMeta,
//     compressTargetSize,
//     setCompressTargetSize,
//     compressTargetUnit,
//     setCompressTargetUnit,
//     applyCompress,
//     imageLoaded,
//   } = props;

//   return (
//     <>
//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">
//           Quality <span className="ie-ctrl-val">{quality}%</span>
//           <span className="ie-quality-tag">
//             {quality >= 85 ? 'High' : quality >= 60 ? 'Medium' : 'Low'}
//           </span>
//         </label>
//         <input type="range" min="1" max="100" value={quality}
//           onChange={e => setQuality(Number(e.target.value))} className="ie-slider" />
//         <div className="ie-slider-ticks">
//           <span>Low</span><span>Med</span><span>High</span>
//         </div>
//       </div>

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Output format</label>
//         <div className="ie-segs">
//           {['jpg', 'png', 'webp'].map((f: string) => (
//             <button key={f} onClick={() => setCompressFormat(f)}
//               className={`ie-seg ${compressFormat === f ? 'active' : ''}`}>
//               {f.toUpperCase()}
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Strip metadata</label>
//         <div className="ie-segs">
//           {['yes', 'no'].map(v => (
//             <button key={v} onClick={() => setStripMeta(v)}
//               className={`ie-seg ${stripMeta === v ? 'active' : ''}`}>
//               {v === 'yes' ? 'Yes (smaller)' : 'No (keep)'}
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="ie-section-sep" />

//       <div className="ie-ctrl-group">
//         <label className="ie-ctrl-label">Target file size</label>
//         <div className="ie-inline-row">
//           <input type="number" value={compressTargetSize} min="1"
//             onChange={e => setCompressTargetSize(Number(e.target.value))}
//             className="ie-num-input" style={{ width: '58px' }} />
//           <select value={compressTargetUnit}
//             onChange={e => setCompressTargetUnit(e.target.value as 'KB' | 'MB')}
//             className="ie-select" style={{ width: '58px', marginTop: 0 }}>
//             <option value="KB">KB</option>
//             <option value="MB">MB</option>
//           </select>
//         </div>
//         <span className="ie-hint">Quality reduced to reach this size</span>
//       </div>

//       <div className="ie-ctrl-group">
//         <button onClick={applyCompress} className="ie-inline-btn" disabled={!imageLoaded}>
//           Apply
//         </button>
//       </div>
//     </>
//   );
// }


'use client';

import { CompressState } from '../types/editorTypes';
import { COMPRESS_FORMATS } from '../constants/editorConfig';

type Props = CompressState;

export default function CompressPanel({
  quality, setQuality,
  compressFormat, setCompressFormat,
  stripMeta, setStripMeta,
  compressTargetSize, setCompressTargetSize,
  compressTargetUnit, setCompressTargetUnit,
  applyCompress, imageLoaded,
}: Props) {
  const qualityTag = quality >= 85 ? 'High' : quality >= 60 ? 'Medium' : 'Low';

  return (
    <>
      {/* ── Quality ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">
          Quality <span className="ie-ctrl-val">{quality}%</span>
          <span className="ie-quality-tag">{qualityTag}</span>
        </label>
        <input
          type="range" min="1" max="100" value={quality}
          onChange={(e) => setQuality(Number(e.target.value))}
          className="ie-slider"
        />
        <div className="ie-slider-ticks">
          <span>Low</span><span>Med</span><span>High</span>
        </div>
      </div>

      {/* ── Format ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Output format</label>
        <div className="ie-segs">
          {COMPRESS_FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => setCompressFormat(f)}
              className={`ie-seg ${compressFormat === f ? 'active' : ''}`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── Strip metadata ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Strip metadata</label>
        <div className="ie-segs">
          {(['yes', 'no'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setStripMeta(v)}
              className={`ie-seg ${stripMeta === v ? 'active' : ''}`}
            >
              {v === 'yes' ? 'Yes (smaller)' : 'No (keep)'}
            </button>
          ))}
        </div>
      </div>

      <div className="ie-section-sep" />

      {/* ── Target file size ── */}
      <div className="ie-ctrl-group">
        <label className="ie-ctrl-label">Target file size</label>
        <div className="ie-inline-row">
          <input
            type="number" value={compressTargetSize} min="1"
            onChange={(e) => setCompressTargetSize(Number(e.target.value))}
            className="ie-num-input"
            style={{ width: '58px' }}
          />
          <select
            value={compressTargetUnit}
            onChange={(e) => setCompressTargetUnit(e.target.value as 'KB' | 'MB')}
            className="ie-select"
            style={{ width: '58px', marginTop: 0 }}
          >
            <option value="KB">KB</option>
            <option value="MB">MB</option>
          </select>
        </div>
        <span className="ie-hint">Quality reduced to reach this size</span>
      </div>

      <div className="ie-ctrl-group">
        <button
          onClick={applyCompress}
          className="ie-inline-btn"
          disabled={!imageLoaded}
        >
          Apply
        </button>
      </div>
    </>
  );
}
