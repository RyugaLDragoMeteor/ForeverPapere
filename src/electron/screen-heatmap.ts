// Screen activity heatmap — pure logic, no Electron imports.
// Tracks which screen regions are calm vs active over a sliding window.

const GRID_COLS = 16;
const GRID_ROWS = 9;
const GRID_CELLS = GRID_COLS * GRID_ROWS; // 144
const MAX_FRAMES = 20; // 5-second window at 4fps
const SCENE_CHANGE_THRESHOLD = 0.85; // 85% of cells changed = full screen swap
const CELL_CHANGE_THRESHOLD = 15; // avg pixel diff to count a cell as "changed"
const REPOSITION_HYSTERESIS = 0.7; // new spot must be 70% calmer to trigger move (very sticky)

export interface HeatmapState {
  grid: Float32Array;           // accumulated activity per cell
  frameBuffer: Float32Array[];  // circular buffer of frame diffs
  bufferIndex: number;
  bufferCount: number;
  previousFrame: Uint8Array | null;
  cooldownFrames: number;       // skip frames after scene change
  currentPos: { row: number; col: number } | null;
  lastMoveTime: number;
}

export function createHeatmapState(): HeatmapState {
  const frameBuffer: Float32Array[] = [];
  for (let i = 0; i < MAX_FRAMES; i++) {
    frameBuffer.push(new Float32Array(GRID_CELLS));
  }
  return {
    grid: new Float32Array(GRID_CELLS),
    frameBuffer,
    bufferIndex: 0,
    bufferCount: 0,
    previousFrame: null,
    cooldownFrames: 0,
    currentPos: null,
    lastMoveTime: 0,
  };
}

// Compare two RGBA frames, return per-cell average difference
export function computeFrameDiff(
  prev: Uint8Array, curr: Uint8Array,
  captureW: number, captureH: number,
): Float32Array {
  const cellW = captureW / GRID_COLS;
  const cellH = captureH / GRID_ROWS;
  const result = new Float32Array(GRID_CELLS);

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const startX = Math.floor(col * cellW);
      const endX = Math.floor((col + 1) * cellW);
      const startY = Math.floor(row * cellH);
      const endY = Math.floor((row + 1) * cellH);

      let totalDiff = 0;
      let pixelCount = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = (y * captureW + x) * 4; // RGBA
          const dr = Math.abs(curr[i] - prev[i]);
          const dg = Math.abs(curr[i + 1] - prev[i + 1]);
          const db = Math.abs(curr[i + 2] - prev[i + 2]);
          totalDiff += (dr + dg + db) / 3;
          pixelCount++;
        }
      }

      result[row * GRID_COLS + col] = pixelCount > 0 ? totalDiff / pixelCount : 0;
    }
  }

  return result;
}

// Check if >85% of cells changed significantly (= app switch / scene change)
export function isSceneChange(cellDiffs: Float32Array): boolean {
  let changedCount = 0;
  for (let i = 0; i < cellDiffs.length; i++) {
    if (cellDiffs[i] > CELL_CHANGE_THRESHOLD) changedCount++;
  }
  return changedCount / cellDiffs.length > SCENE_CHANGE_THRESHOLD;
}

// Update the sliding window circular buffer and recompute grid
export function updateSlidingWindow(state: HeatmapState, cellDiffs: Float32Array): void {
  // Write into circular buffer
  state.frameBuffer[state.bufferIndex].set(cellDiffs);
  state.bufferIndex = (state.bufferIndex + 1) % MAX_FRAMES;
  if (state.bufferCount < MAX_FRAMES) state.bufferCount++;

  // Recompute grid by summing all valid frames
  state.grid.fill(0);
  for (let f = 0; f < state.bufferCount; f++) {
    const frame = state.frameBuffer[f];
    for (let i = 0; i < GRID_CELLS; i++) {
      state.grid[i] += frame[i];
    }
  }
}

// Reset sliding window (after scene change)
export function resetSlidingWindow(state: HeatmapState): void {
  for (const frame of state.frameBuffer) frame.fill(0);
  state.grid.fill(0);
  state.bufferIndex = 0;
  state.bufferCount = 0;
  state.cooldownFrames = 2;
}

// Infer activity of cells occupied by the chatbox from surrounding neighbors
// Since the chatbox is static and monotone, it masks real activity underneath
function inferOccupiedScore(
  grid: Float32Array, row: number, col: number, blockW: number, blockH: number,
): number {
  let sum = 0;
  let count = 0;

  for (let br = -1; br <= blockH; br++) {
    for (let bc = -1; bc <= blockW; bc++) {
      if (br >= 0 && br < blockH && bc >= 0 && bc < blockW) continue;
      const r = row + br;
      const c = col + bc;
      if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
        sum += grid[r * GRID_COLS + c];
        count++;
      }
    }
  }

  return count > 0 ? (sum / count) * blockW * blockH : 0;
}

// Find the calmest position for a blockW x blockH region on the grid
// Returns null if not enough data or current position is still good
export function findCalmestPosition(
  state: HeatmapState,
  blockW: number,
  blockH: number,
  colorVariance?: Float32Array,
): { row: number; col: number } | null {
  if (state.bufferCount < 8) return null; // need ~2 seconds of data at 4fps

  let bestScore = Infinity;
  let bestRow = 0;
  let bestCol = 0;

  const minRow = 1;
  const maxRow = GRID_ROWS - blockH;
  const maxCol = GRID_COLS - blockW;

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      let motionScore = 0;
      let varianceScore = 0;
      for (let br = 0; br < blockH; br++) {
        for (let bc = 0; bc < blockW; bc++) {
          const idx = (row + br) * GRID_COLS + (col + bc);
          motionScore += state.grid[idx];
          if (colorVariance) varianceScore += colorVariance[idx];
        }
      }

      // Combined: motion (weight 1) + color variance (weight 0.5)
      // Monotone static areas score lowest
      let score = motionScore + (colorVariance ? varianceScore * 0.5 : 0);

      const edgeBias = (col === 0 || col === maxCol) ? 0.95 : 1.0;
      score *= edgeBias;

      if (score < bestScore) {
        bestScore = score;
        bestRow = row;
        bestCol = col;
      }
    }
  }

  // Infer activity UNDER the chatbox from surrounding neighbor cells
  // (the chatbox itself appears static in screenshots, masking real activity)
  if (state.currentPos) {
    const inferredScore = inferOccupiedScore(
      state.grid, state.currentPos.row, state.currentPos.col, blockW, blockH,
    );

    if (bestScore >= inferredScore * (1 - REPOSITION_HYSTERESIS)) {
      return null;
    }
  }

  return { row: bestRow, col: bestCol };
}

// Convert grid position to screen coordinates
export function gridToScreen(
  row: number, col: number,
  screenW: number, screenH: number,
): { x: number; y: number } {
  return {
    x: Math.round((col / GRID_COLS) * screenW),
    y: Math.round((row / GRID_ROWS) * screenH),
  };
}

// Compute per-cell color variance (low = monotone, good for placement)
export function computeColorVariance(
  frame: Uint8Array,
  captureW: number, captureH: number,
): Float32Array {
  const cellW = captureW / GRID_COLS;
  const cellH = captureH / GRID_ROWS;
  const result = new Float32Array(GRID_CELLS);

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const startX = Math.floor(col * cellW);
      const endX = Math.floor((col + 1) * cellW);
      const startY = Math.floor(row * cellH);
      const endY = Math.floor((row + 1) * cellH);

      let sumR = 0, sumG = 0, sumB = 0;
      let sumR2 = 0, sumG2 = 0, sumB2 = 0;
      let count = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = (y * captureW + x) * 4;
          const r = frame[i], g = frame[i + 1], b = frame[i + 2];
          sumR += r; sumG += g; sumB += b;
          sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
          count++;
        }
      }

      if (count > 0) {
        const varR = sumR2 / count - (sumR / count) ** 2;
        const varG = sumG2 / count - (sumG / count) ** 2;
        const varB = sumB2 / count - (sumB / count) ** 2;
        result[row * GRID_COLS + col] = (varR + varG + varB) / 3;
      }
    }
  }

  return result;
}

export { GRID_COLS, GRID_ROWS };
