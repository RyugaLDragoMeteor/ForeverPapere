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
const Sleep = kernel32.func("Sleep", "void", [DWORD]);

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
let savedStyle: number = 0;
let savedExStyle: number = 0;
let savedParent: number = 0;
let attachedHwnd: number = 0;
let targetParent: number = 0;

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

/** Send the 0x052C message and try to find WorkerW, with retries. */
function spawnAndFindWorkerW(): { workerW: number; progman: number } {
  const progman = Number(FindWindowA("Progman", null));
  if (!progman) {
    throw new Error("Could not find Progman window");
  }
  console.log(`[native] Found Progman: 0x${progman.toString(16)}`);

  // Send the undocumented 0x052C message to spawn WorkerW.
  // We try multiple times with delays because Windows sometimes
  // needs a moment to create the WorkerW.
  for (let attempt = 0; attempt < 3; attempt++) {
    SendMessageTimeoutA(progman, 0x052c, 0xd, 0, SMTO_NORMAL, 1000, 0);
    SendMessageTimeoutA(progman, 0x052c, 0xd, 1, SMTO_NORMAL, 1000, 0);

    // Give Windows time to create the WorkerW
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

export function attach(hwndBuffer: Buffer, screenWidth?: number, screenHeight?: number): boolean {
  const hwnd = process.arch === "x64"
    ? Number(hwndBuffer.readBigUInt64LE(0))
    : hwndBuffer.readUInt32LE(0);

  console.log(`[native] HWND: 0x${hwnd.toString(16)}`);

  if (!IsWindow(hwnd)) {
    throw new Error(`Invalid window handle: 0x${hwnd.toString(16)}`);
  }

  const { workerW, progman } = spawnAndFindWorkerW();

  // Save original state for detach
  savedStyle = Number(GetWindowLongPtrA(hwnd, GWL_STYLE));
  savedExStyle = Number(GetWindowLongPtrA(hwnd, GWL_EXSTYLE));
  savedParent = Number(GetParent(hwnd));
  attachedHwnd = hwnd;

  // Use dimensions passed from Electron (which correctly handles DPI scaling)
  // Fall back to GetSystemMetrics if not provided
  const screenX = 0;
  const screenY = 0;
  const screenW = screenWidth || GetSystemMetrics(SM_CXSCREEN);
  const screenH = screenHeight || GetSystemMetrics(SM_CYSCREEN);

  if (workerW) {
    // ── Best case: WorkerW exists ──
    // Parent into WorkerW which is already positioned behind desktop icons.
    console.log(`[native] Using WorkerW: 0x${workerW.toString(16)}`);
    targetParent = workerW;

    // Strip window chrome
    let style = savedStyle;
    style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MAXIMIZEBOX | WS_MINIMIZEBOX);
    style |= WS_CHILD;
    SetWindowLongPtrA(hwnd, GWL_STYLE, style);

    let exStyle = savedExStyle;
    exStyle &= ~(WS_EX_DLGMODALFRAME | WS_EX_COMPOSITED | WS_EX_WINDOWEDGE |
      WS_EX_CLIENTEDGE | WS_EX_LAYERED | WS_EX_STATICEDGE |
      WS_EX_TOOLWINDOW | WS_EX_APPWINDOW);
    SetWindowLongPtrA(hwnd, GWL_EXSTYLE, exStyle);

    SetParent(hwnd, workerW);
    SetWindowPos(hwnd, 0, screenX, screenY, screenW, screenH, SWP_NOACTIVATE);
    ShowWindow(hwnd, SW_SHOW);

  } else {
    // ── Fallback: Don't parent to Progman (Z-order is broken on Win11 26100+).
    // Instead, keep the window as a top-level window and place it directly
    // behind Progman in the Z-order. This makes it visible above the desktop
    // wallpaper but below desktop icons and all other windows.
    console.log("[native] No WorkerW, parenting to Progman (WS_CHILD)");
    targetParent = progman;

    const defView = Number(FindWindowExA(progman, 0, "SHELLDLL_DefView", null));
    console.log(`[native] SHELLDLL_DefView: 0x${defView.toString(16)}`);

    // Use WS_CHILD — same approach that worked for particles
    let style = savedStyle;
    style &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MAXIMIZEBOX | WS_MINIMIZEBOX);
    style |= WS_CHILD | WS_CLIPSIBLINGS;
    SetWindowLongPtrA(hwnd, GWL_STYLE, style);

    let exStyle = savedExStyle;
    exStyle &= ~(WS_EX_DLGMODALFRAME | WS_EX_COMPOSITED | WS_EX_WINDOWEDGE |
      WS_EX_CLIENTEDGE | WS_EX_LAYERED | WS_EX_STATICEDGE |
      WS_EX_TOOLWINDOW | WS_EX_APPWINDOW);
    SetWindowLongPtrA(hwnd, GWL_EXSTYLE, exStyle);

    SetParent(hwnd, progman);

    const HWND_TOP = 0;
    SetWindowPos(hwnd, HWND_TOP, screenX, screenY, screenW, screenH, SWP_NOACTIVATE);
    ShowWindow(hwnd, SW_SHOW);

    if (defView) {
      SetWindowPos(defView, HWND_TOP, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      console.log("[native] Raised SHELLDLL_DefView above us");
    }
  }

  console.log(`[native] Attached! Screen: ${screenW}x${screenH} at (${screenX},${screenY})`);
  return true;
}

export function detach(): boolean {
  if (!attachedHwnd) return false;

  try {
    SetParent(attachedHwnd, savedParent);
    SetWindowLongPtrA(attachedHwnd, GWL_STYLE, savedStyle);
    SetWindowLongPtrA(attachedHwnd, GWL_EXSTYLE, savedExStyle);
    ShowWindow(attachedHwnd, SW_SHOW);
  } catch (e) {
    console.error("[native] Detach error:", e);
  }

  attachedHwnd = 0;
  targetParent = 0;
  return true;
}

export function reset(): boolean {
  try {
    SystemParametersInfoA(SPI_SETDESKWALLPAPER, 0, 0, SPIF_SENDCHANGE);
  } catch (e) {
    console.error("[native] Reset error:", e);
  }
  attachedHwnd = 0;
  targetParent = 0;
  return true;
}
