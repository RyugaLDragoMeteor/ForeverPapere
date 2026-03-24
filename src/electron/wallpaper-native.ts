// wallpaper-native.ts — Win32 FFI via koffi
// Replicates the core Lively Wallpaper technique:
//   1. FindWindow("Progman") → get Program Manager
//   2. SendMessageTimeout(progman, 0x052C, 0xD, 1) → spawn WorkerW
//   3. EnumWindows → find the WorkerW behind desktop icons
//   4. SetParent(hwnd, workerW) → embed as wallpaper

import koffi from "koffi";

// ── Load user32.dll ──────────────────────────────────────────
const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

// ── Type definitions ─────────────────────────────────────────
const HWND = "intptr_t";
const BOOL = "int";
const UINT = "uint32";
const WPARAM = "uintptr_t";
const LPARAM = "intptr_t";
const LRESULT = "intptr_t";
const LONG_PTR = "intptr_t";
const DWORD = "uint32";

const WNDENUMPROC = koffi.proto("WNDENUMPROC", BOOL, [HWND, LPARAM]);

// ── Win32 function bindings ──────────────────────────────────
const FindWindowA = user32.func("FindWindowA", HWND, ["str", "str"]);
const FindWindowExA = user32.func("FindWindowExA", HWND, [HWND, HWND, "str", "str"]);
const EnumWindows = user32.func("EnumWindows", BOOL, [koffi.pointer(WNDENUMPROC), LPARAM]);
const SendMessageTimeoutA = user32.func("SendMessageTimeoutA", LRESULT, [
  HWND, UINT, WPARAM, LPARAM, UINT, UINT, "intptr_t",
]);
const SetParent = user32.func("SetParent", HWND, [HWND, HWND]);
const GetParent = user32.func("GetParent", HWND, [HWND]);
const ShowWindow = user32.func("ShowWindow", BOOL, [HWND, "int"]);
const SetWindowPos = user32.func("SetWindowPos", BOOL, [
  HWND, HWND, "int", "int", "int", "int", UINT,
]);
const GetWindowLongPtrA = user32.func("GetWindowLongPtrA", LONG_PTR, [HWND, "int"]);
const SetWindowLongPtrA = user32.func("SetWindowLongPtrA", LONG_PTR, [HWND, "int", LONG_PTR]);
const GetSystemMetrics = user32.func("GetSystemMetrics", "int", ["int"]);
const SystemParametersInfoA = user32.func("SystemParametersInfoA", BOOL, [
  UINT, UINT, HWND, UINT,
]);
const IsWindow = user32.func("IsWindow", BOOL, [HWND]);
const MoveWindow = user32.func("MoveWindow", BOOL, [HWND, "int", "int", "int", "int", BOOL]);
const Sleep = kernel32.func("Sleep", "void", [DWORD]);

// POINT struct for MapWindowPoints
const POINT = koffi.struct("POINT", { x: "long", y: "long" });
const MapWindowPoints = user32.func("MapWindowPoints", "int", [HWND, HWND, koffi.inout(koffi.pointer(POINT)), UINT]);

// ── Win32 constants ──────────────────────────────────────────
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;

const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_CHILD = 0x40000000;
const WS_CLIPSIBLINGS = 0x04000000;

const WS_EX_DLGMODALFRAME = 0x00000001;
const WS_EX_COMPOSITED = 0x02000000;
const WS_EX_WINDOWEDGE = 0x00000100;
const WS_EX_CLIENTEDGE = 0x00000200;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_STATICEDGE = 0x00020000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;

const SW_SHOW = 5;
const SMTO_NORMAL = 0x0000;

const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;

const SPI_SETDESKWALLPAPER = 0x0014;
const SPIF_SENDCHANGE = 0x0002;

// SetWindowPos constants
const HWND_BOTTOM = 1;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;

// ── State ────────────────────────────────────────────────────
interface AttachedWindow {
  hwnd: number;
  savedStyle: number;
  savedExStyle: number;
  savedParent: number;
  targetParent: number;
}
let attachedWindows: AttachedWindow[] = [];
let cachedWorkerW: number = 0;
let cachedProgman: number = 0;

// ── Helpers ──────────────────────────────────────────────────

/** Enumerate top-level windows to find the WorkerW behind desktop icons. */
function findWorkerW(progman: number): number {
  let workerW: number = 0;

  const callback = koffi.register((hwnd: number, _lParam: number) => {
    try {
      const defView = Number(FindWindowExA(hwnd, 0, "SHELLDLL_DefView", null));
      if (defView) {
        console.log(`[native] SHELLDLL_DefView found in 0x${hwnd.toString(16)}`);
        // Classic path: WorkerW is the next top-level sibling
        const worker = Number(FindWindowExA(0, hwnd, "WorkerW", null));
        if (worker) {
          console.log(`[native] WorkerW sibling: 0x${worker.toString(16)}`);
          workerW = worker;
        }
      }
    } catch (e) {
      console.error("[native] EnumWindows callback error:", e);
    }
    return 1;
  }, koffi.pointer(WNDENUMPROC));

  EnumWindows(callback, 0);
  koffi.unregister(callback);

  // Win11 26002+ path: WorkerW is a CHILD of Progman, not a sibling.
  // Look for a WorkerW child of Progman that does NOT contain SHELLDLL_DefView.
  if (!workerW) {
    console.log("[native] Trying Win11 26002+ path: WorkerW as child of Progman");
    let child = Number(FindWindowExA(progman, 0, "WorkerW", null));
    while (child) {
      // Skip any WorkerW that contains SHELLDLL_DefView (that's the icons layer)
      const hasDefView = Number(FindWindowExA(child, 0, "SHELLDLL_DefView", null));
      if (!hasDefView) {
        console.log(`[native] Found WorkerW child of Progman: 0x${child.toString(16)}`);
        workerW = child;
        break;
      }
      // Look for next WorkerW child
      child = Number(FindWindowExA(progman, child, "WorkerW", null));
    }
  }

  return workerW;
}

/** Send the 0x052C message and try to find an unused WorkerW. */
function spawnAndFindWorkerW(): { workerW: number; progman: number } {
  const progman = Number(FindWindowA("Progman", null));
  if (!progman) {
    throw new Error("Could not find Progman window");
  }
  console.log(`[native] Found Progman: 0x${progman.toString(16)}`);

  // Send the undocumented 0x052C message to spawn WorkerW.
  for (let attempt = 0; attempt < 3; attempt++) {
    SendMessageTimeoutA(progman, 0x052c, 0xd, 0, SMTO_NORMAL, 1000, 0);
    SendMessageTimeoutA(progman, 0x052c, 0xd, 1, SMTO_NORMAL, 1000, 0);
    Sleep(100);

    const workerW = findWorkerW(progman);
    if (workerW) {
      return { workerW, progman };
    }

    console.log(`[native] Attempt ${attempt + 1}: WorkerW not found, retrying...`);
    Sleep(200);
  }

  return { workerW: 0, progman };
}



// ── Public API ───────────────────────────────────────────────

export function attach(hwndBuffer: Buffer, screenWidth?: number, screenHeight?: number, screenX?: number, screenY?: number): boolean {
  const hwnd = process.arch === "x64"
    ? Number(hwndBuffer.readBigUInt64LE(0))
    : hwndBuffer.readUInt32LE(0);

  console.log(`[native] HWND: 0x${hwnd.toString(16)}`);

  if (!IsWindow(hwnd)) {
    throw new Error(`Invalid window handle: 0x${hwnd.toString(16)}`);
  }

  // Cache WorkerW so all monitors share the same parent
  if (!cachedProgman) {
    const result = spawnAndFindWorkerW();
    cachedWorkerW = result.workerW;
    cachedProgman = result.progman;
  }
  const workerW = cachedWorkerW;
  const progman = cachedProgman;

  // Save original state for detach
  const entry: AttachedWindow = {
    hwnd,
    savedStyle: Number(GetWindowLongPtrA(hwnd, GWL_STYLE)),
    savedExStyle: Number(GetWindowLongPtrA(hwnd, GWL_EXSTYLE)),
    savedParent: Number(GetParent(hwnd)),
    targetParent: 0,
  };

  // Positions are relative to WorkerW origin (passed from Electron)
  const posX = screenX || 0;
  const posY = screenY || 0;
  const screenW = screenWidth || GetSystemMetrics(SM_CXSCREEN);
  const screenH = screenHeight || GetSystemMetrics(SM_CYSCREEN);

  if (workerW) {
    console.log(`[native] Using WorkerW: 0x${workerW.toString(16)}`);
    entry.targetParent = workerW;

    // Step 1: Position window at screen coordinates BEFORE parenting (like Lively)
    SetWindowPos(hwnd, HWND_BOTTOM, posX, posY, screenW, screenH, SWP_NOACTIVATE);
    console.log(`[native] Pre-parent pos: (${posX},${posY}) size: ${screenW}x${screenH}`);

    // Step 2: Strip window chrome
    let style = entry.savedStyle;
    style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MAXIMIZEBOX | WS_MINIMIZEBOX);
    style |= WS_CHILD;
    SetWindowLongPtrA(hwnd, GWL_STYLE, style);

    let exStyle = entry.savedExStyle;
    exStyle &= ~(WS_EX_DLGMODALFRAME | WS_EX_COMPOSITED | WS_EX_WINDOWEDGE |
      WS_EX_CLIENTEDGE | WS_EX_LAYERED | WS_EX_STATICEDGE |
      WS_EX_TOOLWINDOW | WS_EX_APPWINDOW);
    SetWindowLongPtrA(hwnd, GWL_EXSTYLE, exStyle);

    // Step 3: MapWindowPoints — map {0,0} from window's client area to WorkerW
    // (like Lively: maps the window's top-left corner to WorkerW coords)
    const pts = [{ x: 0, y: 0 }];
    MapWindowPoints(hwnd, workerW, pts, 1);
    const mappedX = pts[0].x;
    const mappedY = pts[0].y;
    console.log(`[native] Mapped pos: (${mappedX},${mappedY})`);

    // Step 4: SetParent to WorkerW
    SetParent(hwnd, workerW);

    // Step 5: Position using mapped coordinates
    SetWindowPos(hwnd, HWND_BOTTOM, mappedX, mappedY, screenW, screenH,
      SWP_NOACTIVATE);
    ShowWindow(hwnd, SW_SHOW);

  } else {
    console.log("[native] No WorkerW, parenting to Progman (WS_CHILD)");
    entry.targetParent = progman;

    const defView = Number(FindWindowExA(progman, 0, "SHELLDLL_DefView", null));
    console.log(`[native] SHELLDLL_DefView: 0x${defView.toString(16)}`);

    let style = entry.savedStyle;
    style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MAXIMIZEBOX | WS_MINIMIZEBOX);
    style |= WS_CHILD | WS_CLIPSIBLINGS;
    SetWindowLongPtrA(hwnd, GWL_STYLE, style);

    let exStyle = entry.savedExStyle;
    exStyle &= ~(WS_EX_DLGMODALFRAME | WS_EX_COMPOSITED | WS_EX_WINDOWEDGE |
      WS_EX_CLIENTEDGE | WS_EX_LAYERED | WS_EX_STATICEDGE |
      WS_EX_TOOLWINDOW | WS_EX_APPWINDOW);
    SetWindowLongPtrA(hwnd, GWL_EXSTYLE, exStyle);

    SetParent(hwnd, progman);

    const HWND_TOP = 0;
    SetWindowPos(hwnd, HWND_TOP, posX, posY, screenW, screenH, SWP_NOACTIVATE);
    ShowWindow(hwnd, SW_SHOW);

    if (defView) {
      SetWindowPos(defView, HWND_TOP, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      console.log("[native] Raised SHELLDLL_DefView above us");
    }
  }

  attachedWindows.push(entry);
  console.log(`[native] Attached! Screen: ${screenW}x${screenH} at (${posX},${posY})`);
  return true;
}

export function detach(): boolean {
  if (attachedWindows.length === 0) return false;

  for (const entry of attachedWindows) {
    try {
      SetParent(entry.hwnd, entry.savedParent);
      SetWindowLongPtrA(entry.hwnd, GWL_STYLE, entry.savedStyle);
      SetWindowLongPtrA(entry.hwnd, GWL_EXSTYLE, entry.savedExStyle);
      ShowWindow(entry.hwnd, SW_SHOW);
    } catch (e) {
      console.error(`[native] Detach error for 0x${entry.hwnd.toString(16)}:`, e);
    }
  }

  attachedWindows = [];
  cachedWorkerW = 0;
  cachedProgman = 0;
  return true;
}

export function reset(): boolean {
  try {
    SystemParametersInfoA(SPI_SETDESKWALLPAPER, 0, 0, SPIF_SENDCHANGE);
  } catch (e) {
    console.error("[native] Reset error:", e);
  }
  attachedWindows = [];
  cachedWorkerW = 0;
  cachedProgman = 0;
  return true;
}

// ── Middle-click detection via polling (no hook overhead) ────
const VK_MBUTTON = 0x04;
const GetAsyncKeyState = user32.func("GetAsyncKeyState", "short", ["int"]);

const POINT_STRUCT = koffi.struct("CURSORPOINT", { x: "long", y: "long" });
const GetCursorPos = user32.func("GetCursorPos", BOOL, [koffi.inout(POINT_STRUCT)]);

let mclickTimer: ReturnType<typeof setInterval> | null = null;
let mclickWasDown = false;

export function startMiddleClickHook(cb: (x: number, y: number) => void): boolean {
  if (mclickTimer) return true;
  mclickTimer = setInterval(() => {
    const state = GetAsyncKeyState(VK_MBUTTON);
    const isDown = (state & 0x8000) !== 0;
    if (isDown && !mclickWasDown) {
      // Middle button just pressed — get cursor position
      const pt = { x: 0, y: 0 };
      GetCursorPos(pt);
      cb(pt.x, pt.y);
    }
    mclickWasDown = isDown;
  }, 50); // poll every 50ms — responsive enough, negligible overhead
  console.log("[native] Middle-click poll started");
  return true;
}

export function stopMiddleClickHook(): void {
  if (mclickTimer) {
    clearInterval(mclickTimer);
    mclickTimer = null;
    console.log("[native] Middle-click poll stopped");
  }
}
