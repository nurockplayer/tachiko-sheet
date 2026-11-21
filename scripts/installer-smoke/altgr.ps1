param(
    [Parameter(Mandatory=$true)][int]$AppPid,
    [ValidateSet('V','Q')][string]$Key = 'V'
)
$ErrorActionPreference = 'Stop'
trap { Write-Error "AltGr native input NOT DELIVERED: $_"; exit 1 }
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class AltGrInput {
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr LoadKeyboardLayoutW([MarshalAs(UnmanagedType.LPWStr)] string id, uint flags);
    [DllImport("user32.dll")] public static extern bool UnloadKeyboardLayout(IntPtr layout);
    [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr window);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    public static void Activate(IntPtr target) {
        uint owner;
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out owner);
        uint helperThread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != helperThread;
        if (attached && !AttachThreadInput(helperThread, foregroundThread, true))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "AttachThreadInput failed");
        try {
            bool activated = SetForegroundWindow(target);
            if (!activated || GetForegroundWindow() != target)
                throw new InvalidOperationException("foreground transfer refused: target=" + target + ", actual=" + GetForegroundWindow());
        } finally {
            if (attached && !AttachThreadInput(helperThread, foregroundThread, false))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "AttachThreadInput detach failed");
        }
    }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
        public int cbSize; public uint flags; public IntPtr active, focus, capture, menu, move, caret; public RECT caretRect;
    }
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll")] public static extern int GetKeyboardLayoutList(int count, [Out] IntPtr[] layouts);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder name, int length, out int needed);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    public static string InputDesktopName() {
        IntPtr desktop = OpenInputDesktop(0, false, 1);
        if (desktop == IntPtr.Zero) return "unavailable:" + Marshal.GetLastWin32Error();
        try { var name = new StringBuilder(256); int needed;
            return GetUserObjectInformationW(desktop, 2, name, 512, out needed) ? name.ToString() : "unavailable:" + Marshal.GetLastWin32Error();
        } finally { CloseDesktop(desktop); }
    }
    public static string Layouts() {
        int count = GetKeyboardLayoutList(0, null); var layouts = new IntPtr[count];
        int actual = GetKeyboardLayoutList(count, layouts); var values = new string[actual];
        for (int i = 0; i < actual; i++) values[i] = layouts[i].ToInt64().ToString("X");
        return String.Join(",", values);
    }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {
        public ushort vk, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {
        public int x, y; public uint data, flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)] struct UNION {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    static INPUT Key(ushort scan, uint flags) {
        return new INPUT { type = 1, data = new UNION { keyboard = new KEYBDINPUT { scan = scan, flags = flags | 8 } } };
    }
    public static void Send(IntPtr target, ushort scan) {
        var info = new GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)) };
        if (GetForegroundWindow() != target || !GetGUIThreadInfo(0, ref info) ||
            info.focus == IntPtr.Zero || (info.focus != target && !IsChild(target, info.focus)))
            throw new InvalidOperationException("app lost foreground/keyboard focus before SendInput");
        var keys = new[] { Key(0x38, 1), Key(scan, 0), Key(scan, 2), Key(0x38, 3) };
        uint sent = SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT)));
        if (sent != keys.Length) throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput delivered " + sent + "/4 events");
    }
}
'@
$process = Get-Process -Id $AppPid
$process.Refresh()
$window = $process.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw "PID $AppPid has no main window" }
[uint32]$owner = 0
$thread = [AltGrInput]::GetWindowThreadProcessId($window, [ref]$owner)
Add-Type -AssemblyName System.Windows.Forms
$loader = New-Object System.Windows.Forms.Form
$loader.Text = 'AltGr layout setup'
$loader.ShowInTaskbar = $false
$loader.Show()
$layout = [IntPtr]::Zero
try {
    # The loader must own keyboard focus when LoadKeyboardLayoutW is called.
    [AltGrInput]::Activate($loader.Handle)
    $layout = [AltGrInput]::LoadKeyboardLayoutW('00000407', 0)
    if ($layout -eq [IntPtr]::Zero -or ($layout.ToInt64() -band 0xFFFF) -ne 0x0407) { throw "German keyboard layout unavailable; install German keyboard layout for this user (returned $($layout.ToInt64().ToString('X')))" }
[AltGrInput]::Activate($window)
Start-Sleep -Milliseconds 200
$info = New-Object AltGrInput+GUITHREADINFO
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
$gotInfo = [AltGrInput]::GetGUIThreadInfo($thread, [ref]$info)
$focus = $info.focus
[uint32]$focusOwner = 0
$focusedThread = if ($focus -ne [IntPtr]::Zero) { [AltGrInput]::GetWindowThreadProcessId($focus, [ref]$focusOwner) } else { 0 }
$previous = if ($focusedThread) { [AltGrInput]::GetKeyboardLayout($focusedThread) } else { [IntPtr]::Zero }
$layouts = [AltGrInput]::Layouts()
Write-Host "AltGr diagnostics: focusedHWND=$($focus.ToInt64().ToString('X')) focusedThread=$focusedThread focusedHKL=$($previous.ToInt64().ToString('X')) appSession=$($process.SessionId) helperSession=$((Get-Process -Id $PID).SessionId) inputDesktop=$([AltGrInput]::InputDesktopName()) layouts=$layouts"
if ([AltGrInput]::GetForegroundWindow() -ne $window) { throw "SetForegroundWindow could not focus app PID $AppPid" }
if (-not $gotInfo -or -not $focusedThread) { throw "GetGUIThreadInfo could not resolve the focused input window for app thread $thread" }
# WebView2's focused child HWND can belong to its separate browser process.
if ($focus -ne $window -and -not [AltGrInput]::IsChild($window, $focus)) { throw "focused input HWND $focus (PID $focusOwner) is outside app HWND $window" }
    if (-not [AltGrInput]::PostMessageW($focus, 0x50, [IntPtr]::Zero, $layout)) {
        throw "WM_INPUTLANGCHANGEREQUEST failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    for ($i = 0; $i -lt 100 -and [AltGrInput]::GetKeyboardLayout($focusedThread) -ne $layout; $i++) { Start-Sleep -Milliseconds 50 }
    $actual = [AltGrInput]::GetKeyboardLayout($focusedThread)
    Write-Host "AltGr focused layout: HWND=$($focus.ToInt64().ToString('X')) thread=$focusedThread requested=$($layout.ToInt64().ToString('X')) actual=$($actual.ToInt64().ToString('X'))"
    if ($actual -ne $layout) { throw "focused thread did not activate German AltGr layout: requested=$($layout.ToInt64().ToString('X')) actual=$($actual.ToInt64().ToString('X'))" }
    [AltGrInput]::Send($window, $(if ($Key -eq 'Q') { 0x10 } else { 0x2f }))
    Start-Sleep -Milliseconds 300
    Write-Host "AltGr native input queued: PID $AppPid, layout 00000407, Right-Alt+$Key via SendInput (4/4); foreground/focus verified; app receipt still required"
} finally {
    if ($focus -and $previous) { [void][AltGrInput]::PostMessageW($focus, 0x50, [IntPtr]::Zero, $previous) }
    # Give the app thread time to release the test layout before unloading it.
    Start-Sleep -Milliseconds 200
    if ($layout -ne [IntPtr]::Zero) { [void][AltGrInput]::UnloadKeyboardLayout($layout) }
    $loader.Dispose()
}
