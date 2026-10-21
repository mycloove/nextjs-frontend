// "use client";

// import React from 'react';

// type Props = any;

// export default function EnhancePanel(props: Props) {
//   const { brightness, setBrightness, contrast, setContrast, saturation, setSaturation, sharpness, setSharpness } = props;

//   return (
//     <>
//       {[
//         { label: 'Brightness', val: brightness, set: setBrightness, min: -100, max: 100 },
//         { label: 'Contrast',   val: contrast,   set: setContrast,   min: -100, max: 100 },
//         { label: 'Saturation', val: saturation, set: setSaturation, min: -100, max: 100 },
//         { label: 'Sharpness',  val: sharpness,  set: setSharpness,  min: 0,    max: 100 },
//       ].map(({ label, val, set, min, max }: any) => (
//         <div className="ie-ctrl-group" key={label}>
//           <label className="ie-ctrl-label">
//             {label}
//             <span className="ie-ctrl-val" style={{ marginLeft: '6px' }}>
//               {val > 0 ? `+${val}` : val}
//             </span>
//           </label>
//           <input type="range" min={min} max={max} value={val}
//             onChange={e => set(Number(e.target.value))} className="ie-slider" />
//           <div className="ie-slider-ticks">
//             <span>{min}</span><span>0</span><span>+{max}</span>
//           </div>
//         </div>
//       ))}
//       <button onClick={() => { setBrightness(0); setContrast(0); setSaturation(0); setSharpness(0); }}
//         className="ie-reset-adj-btn">
//         Reset adjustments
//       </button>
//     </>
//   );
// }

'use client';

import { EnhanceState } from '../types/editorTypes';
import { ENHANCE_SLIDERS } from '../constants/editorConfig';

type Props = EnhanceState;

export default function EnhancePanel({
  brightness, setBrightness,
  contrast,   setContrast,
  saturation, setSaturation,
  sharpness,  setSharpness,
}: Props) {
  const setters: Record<string, (v: number) => void> = {
    brightness: setBrightness,
    contrast:   setContrast,
    saturation: setSaturation,
    sharpness:  setSharpness,
  };

  const values: Record<string, number> = {
    brightness, contrast, saturation, sharpness,
  };

  const resetAll = () => {
    setBrightness(0); setContrast(0); setSaturation(0); setSharpness(0);
  };

  return (
    <>
      {ENHANCE_SLIDERS.map(({ key, label, min, max }) => {
        const val = values[key];
        return (
          <div className="ie-ctrl-group" key={key}>
            <label className="ie-ctrl-label">
              {label}
              <span className="ie-ctrl-val" style={{ marginLeft: '6px' }}>
                {val > 0 ? `+${val}` : val}
              </span>
            </label>
            <input
              type="range"
              min={min}
              max={max}
              value={val}
              onChange={(e) => setters[key](Number(e.target.value))}
              className="ie-slider"
            />
            <div className="ie-slider-ticks">
              <span>{min}</span>
              <span>0</span>
              <span>+{max}</span>
            </div>
          </div>
        );
      })}

      <button onClick={resetAll} className="ie-reset-adj-btn">
        Reset adjustments
      </button>
    </>
  );
}
