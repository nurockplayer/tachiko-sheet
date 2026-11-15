param(
    [Parameter(Mandatory=$true, ParameterSetName='Send')][int]$AppPid,
    [Parameter(Mandatory=$true, ParameterSetName='Prepare')][switch]$Prepare
)
$ErrorActionPreference = 'Stop'
trap { Write-Error "AltGr native input: $_"; exit 1 }
if ($Prepare) {
    # Run before launching the test app; loading a layout in this PowerShell
    # process alone does not install/select it for the app's UI thread.
    $languages = Get-WinUserLanguageList
    if (-not ($languages.LanguageTag -contains 'de-DE')) {
        $languages.Add((New-WinUserLanguageList 'de-DE')[0])
    }
    Set-WinUserLanguageList -LanguageList $languages -Force
    Set-WinDefaultInputMethodOverride -InputTip '0407:00000407'
    Write-Host "AltGr layout prepared before app launch: languages=$((Get-WinUserLanguageList).LanguageTag -join ','); default=$((Get-WinDefaultInputMethodOverride).InputMethodTip)"
    exit 0
}
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AltGrInput {
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr LoadKeyboardLayoutW([MarshalAs(UnmanagedType.LPWStr)] string id, uint flags);
    [DllImport("user32.dll")] public static extern bool UnloadKeyboardLayout(IntPtr layout);
    [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
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
    public static void Send() {
        // Scan codes: extended Right Alt, V down/up, extended Right Alt up.
        var keys = new[] { Key(0x38, 1), Key(0x2f, 0), Key(0x2f, 2), Key(0x38, 3) };
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
$previous = [AltGrInput]::GetKeyboardLayout($thread)
$layout = [AltGrInput]::LoadKeyboardLayoutW('00000407', 0)
if ($layout -eq [IntPtr]::Zero) { throw "LoadKeyboardLayoutW(00000407) failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
try {
    [void][AltGrInput]::SetForegroundWindow($window)
    Start-Sleep -Milliseconds 200
    if ([AltGrInput]::GetForegroundWindow() -ne $window) { throw "SetForegroundWindow could not focus app PID $AppPid" }
    Write-Host "AltGr layout request: PID=$AppPid owner=$owner thread=$thread window=$($window.ToInt64().ToString('X')) previous=$($previous.ToInt64().ToString('X')) requested=$($layout.ToInt64().ToString('X'))"
    if (-not [AltGrInput]::PostMessageW($window, 0x50, [IntPtr]::Zero, $layout)) {
        throw "WM_INPUTLANGCHANGEREQUEST failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    for ($i = 0; $i -lt 100 -and [AltGrInput]::GetKeyboardLayout($thread) -ne $layout; $i++) { Start-Sleep -Milliseconds 50 }
    $actual = [AltGrInput]::GetKeyboardLayout($thread)
    if ($actual -ne $layout) { throw "app thread did not activate German AltGr layout after pre-launch default setup and WM_INPUTLANGCHANGEREQUEST: thread=$thread requested=$($layout.ToInt64().ToString('X')) actual=$($actual.ToInt64().ToString('X'))" }
    Write-Host "AltGr layout verified on app thread $thread`: $($actual.ToInt64().ToString('X'))"
    [AltGrInput]::Send()
    Start-Sleep -Milliseconds 300
    Write-Host "AltGr native input sent: PID $AppPid, layout 00000407, Right-Alt+V via SendInput"
} finally {
    [void][AltGrInput]::PostMessageW($window, 0x50, [IntPtr]::Zero, $previous)
    # Give the app thread time to release the test layout before unloading it.
    Start-Sleep -Milliseconds 200
    [void][AltGrInput]::UnloadKeyboardLayout($layout)
}
