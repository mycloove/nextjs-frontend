/** Fabric 5 callback adapters. Factories are injected; this module never imports the browser runtime. */
type FabricCloneable<T> = {
  clone?: (callback: (object: T | null, error?: boolean) => void, properties?: string[]) => unknown;
};

type FabricSnapshotObject = {
  isEditing?: boolean;
  _savedProps?: Record<string, unknown>;
  getObjects?: () => FabricSnapshotObject[];
};

/** V5 temporarily locks IText while typing; those interaction flags are not document edits. */
export function snapshotPdfEditorFabricCanvas<T extends Record<string, unknown>>(
  canvas: { toJSON: (properties?: string[]) => T; getObjects?: () => FabricSnapshotObject[] },
  properties: string[],
): T {
  const state = canvas.toJSON(properties);
  const normalize = (objects: FabricSnapshotObject[], serialized: unknown) => {
    if (!Array.isArray(serialized)) return;
    objects.forEach((object, index) => {
      const json = serialized[index];
      if (!json || typeof json !== 'object') return;
      if (object.isEditing && object._savedProps) {
        for (const key of properties) {
          if (Object.prototype.hasOwnProperty.call(object._savedProps, key)) json[key] = object._savedProps[key];
        }
      }
      normalize(object.getObjects?.() ?? [], json.objects);
    });
  };
  normalize(canvas.getObjects?.() ?? [], state.objects);
  return state;
}

export function clonePdfEditorFabricObject<T extends { dispose?: () => void }>(
  object: FabricCloneable<T>,
  properties: string[],
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof object.clone !== 'function') {
      reject(new Error('This object cannot be copied by the installed canvas engine.'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('The object could not finish loading for Copy or Duplicate. Please retry.'));
    }, timeoutMs);
    try {
      object.clone((clone, error) => {
        if (settled) {
          if (clone !== object) clone?.dispose?.();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error || !clone || clone === object) {
          if (clone !== object) clone?.dispose?.();
          reject(new Error('The canvas engine could not copy this object. Nothing was added.'));
        } else {
          resolve(clone);
        }
      }, properties);
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

type FabricIdentityObject = {
  set: (values: Record<string, unknown>) => unknown;
  getObjects?: () => FabricIdentityObject[];
};

/** A copied group must not resurrect its source children's ids when ungrouped. */
export function renewPdfEditorFabricObjectIds(object: FabricIdentityObject, nextId: () => string): void {
  object.set({ peId: nextId() });
  object.getObjects?.().forEach(child => renewPdfEditorFabricObjectIds(child, nextId));
}

type FabricStack<T> = {
  getObjects?: () => T[];
  bringToFront?: (object: T) => unknown;
  sendToBack?: (object: T) => unknown;
  bringForward?: (object: T) => unknown;
  sendBackwards?: (object: T) => unknown;
};

export function movePdfEditorFabricObject<T>(
  canvas: FabricStack<T>,
  object: T,
  direction: 'front' | 'back' | 'forward' | 'backward',
): boolean {
  const method = { front: 'bringToFront', back: 'sendToBack', forward: 'bringForward', backward: 'sendBackwards' } as const;
  const move = canvas[method[direction]];
  const before = canvas.getObjects?.().slice();
  if (!before?.includes(object) || typeof move !== 'function') {
    throw new Error('Layer ordering is unavailable for this object. Nothing was changed.');
  }
  move.call(canvas, object);
  const after = canvas.getObjects!();
  const changed = before.some((item, index) => after[index] !== item);
  const atEdge = before.indexOf(object) === (direction === 'front' || direction === 'forward' ? before.length - 1 : 0);
  if (!changed && !atEdge) throw new Error('The canvas engine did not change the layer order. Please retry.');
  return changed;
}

type FabricJsonCanvas = {
  loadFromJSON: (state: Record<string, unknown>, callback: () => void) => unknown;
  toJSON: (properties?: string[]) => Record<string, unknown>;
  dispose: () => unknown;
};

function assertObjectsRestored(expected: Record<string, unknown>, actual: Record<string, unknown>, properties: string[]) {
  for (const key of new Set(['type', 'peId', 'peLocked', 'peHidden', 'text', 'left', 'top', 'angle', 'visible', 'opacity', ...properties])) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) {
      throw new Error('A restored object lost its type, identity or visibility/lock state. The saved page was kept.');
    }
  }
  if (Array.isArray(expected.objects)) {
    const objects = actual.objects;
    if (!Array.isArray(objects) || objects.length !== expected.objects.length) {
      throw new Error('Some saved objects could not be restored. The saved page was kept; reopen it to retry.');
    }
    expected.objects.forEach((object, index) => {
      if (!object || typeof object !== 'object' || !objects[index] || typeof objects[index] !== 'object') {
        throw new Error('A saved object is invalid. The saved page was kept.');
      }
      assertObjectsRestored(object, objects[index], properties);
    });
  }
  for (const key of ['clipPath', 'backgroundImage', 'overlayImage']) {
    if (expected[key] && typeof expected[key] === 'object') {
      if (!actual[key] || typeof actual[key] !== 'object') throw new Error('A saved image or clipping path could not be restored.');
      assertObjectsRestored(expected[key] as Record<string, unknown>, actual[key] as Record<string, unknown>, properties);
    }
  }
}

/**
 * V5 mutates the receiving canvas before its callback. Load into a staging canvas,
 * then commit synchronously only while the caller still owns the target. A late
 * callback after timeout may clean up staging, but must never touch the live page.
 */
export async function restorePdfEditorFabricCanvas<T extends FabricJsonCanvas>(
  state: Record<string, unknown>,
  properties: string[],
  deps: { createCanvas: () => T; isCurrent: () => boolean; commit: (canvas: T) => void },
  timeoutMs = 10_000,
): Promise<boolean> {
  const canvas = deps.createCanvas();
  let completed = false;
  let expired = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        expired = true;
        reject(new Error('Restoring the saved page took too long. The saved objects were kept; reopen the page to retry.'));
      }, timeoutMs);
      try {
        canvas.loadFromJSON(structuredClone(state), () => {
          completed = true;
          clearTimeout(timer);
          if (expired) canvas.dispose();
          else resolve();
        });
      } catch (error) {
        completed = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    assertObjectsRestored(state, canvas.toJSON(properties), properties);
    if (!deps.isCurrent()) return false;
    deps.commit(canvas);
    return true;
  } finally {
    // Disposing a still-loading V5 canvas makes its late callback crash. It owns
    // cleanup in that case; it is detached and cannot mutate the editor.
    if (completed && !expired) canvas.dispose();
  }
}
