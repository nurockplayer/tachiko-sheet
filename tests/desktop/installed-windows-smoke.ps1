param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$diagnostics = Join-Path $env:RUNNER_TEMP 'tachiko-desktop-smoke-installed'
New-Item -ItemType Directory -Path $diagnostics -Force | Out-Null
Start-Transcript -Path (Join-Path $diagnostics 'installed.log') | Out-Null
$work = Join-Path $diagnostics 'work'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$app = $null
$window = $null
$uninstaller = $null
$installedByThisRun = $false
$failure = $null
$copyName = $null
$copyCreated = $false
$case = 'setup'
$uiaCase = $false

try {
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
# INPUT's union includes MOUSEINPUT to preserve the native size/alignment on x64.
# All keystrokes go through SendInput, never a webview/e2e command channel.
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class InstalledSmokeInput {
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT {
        public ushort vk, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT {
        public int x, y; public uint data, flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)] struct UNION {
        [FieldOffset(0)] public KEYBDINPUT key;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    static IntPtr targetWindow;
    public static void Activate(IntPtr target) {
        targetWindow = target;
        if (target == IntPtr.Zero) throw new InvalidOperationException("input delivery: target has no HWND");
        if (GetForegroundWindow() == target) return;
        bool activated = SetForegroundWindow(target);
        if (activated && GetForegroundWindow() == target) return;
        uint pid;
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        uint currentThread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != currentThread &&
            AttachThreadInput(currentThread, foregroundThread, true);
        try { activated = SetForegroundWindow(target); }
        finally { if (attached) AttachThreadInput(currentThread, foregroundThread, false); }
        if (!activated || GetForegroundWindow() != target) {
            IntPtr foreground = GetForegroundWindow();
            GetWindowThreadProcessId(foreground, out pid);
            throw new InvalidOperationException($"input delivery: SetForegroundWindow refused; target HWND={target}, foreground HWND={foreground}, PID={pid}, attached={attached}, activation={activated}");
        }
    }
    static void CheckForeground() {
        IntPtr foreground = GetForegroundWindow();
        if (targetWindow == IntPtr.Zero || foreground != targetWindow) {
            uint pid;
            GetWindowThreadProcessId(foreground, out pid);
            throw new InvalidOperationException($"input delivery: before SendInput target HWND={targetWindow}, foreground HWND={foreground}, PID={pid}");
        }
    }
    static void Send(ushort vk, ushort scan, uint flags) {
        var input = new INPUT { type = 1, data = new UNION {
            key = new KEYBDINPUT { vk = vk, scan = scan, flags = flags }
        }};
        if (SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>()) != 1)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "input delivery: SendInput failed");
    }
    static void Press(ushort vk) { Send(vk, 0, 0); Send(vk, 0, 2); }
    public static void Key(ushort vk) { CheckForeground(); Press(vk); }
    public static void Ctrl(ushort vk) {
        CheckForeground();
        Send(0x11, 0, 0);
        try { Press(vk); } finally { Send(0x11, 0, 2); }
    }
    public static void Text(string text) {
        CheckForeground();
        foreach (char c in text) { Send(0, c, 4); Send(0, c, 6); }
    }
}
'@
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$scope = [System.Windows.Automation.TreeScope]::Descendants
$any = [System.Windows.Automation.Condition]::TrueCondition

function Wait-For([string]$Label, [scriptblock]$Check) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $answer = & $Check
        if ($answer) { return $answer }
        if ($app -and $app.HasExited) { throw "$case : app exited ($($app.ExitCode)) while waiting for $Label" }
        Start-Sleep -Milliseconds 250
    } while ($timer.Elapsed.TotalSeconds -lt 60)
    throw "$case : timed out waiting for $Label"
}
function Find-Named($Root, [string]$Name, $Type = $null) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    if ($Type) {
        $condition = [System.Windows.Automation.AndCondition]::new($condition,
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $Type))
    }
    return $Root.FindFirst($scope, $condition)
}
function Need-Named($Root, [string]$Name, $Type = $null) {
    Wait-For "accessible '$Name'" { Find-Named $Root $Name $Type }
}
function Invoke-Button($Root, [string]$Name) {
    $button = Wait-For "enabled button '$Name'" {
        $found = Find-Named $Root $Name ([System.Windows.Automation.ControlType]::Button)
        if ($found -and $found.Current.IsEnabled) { $found }
    }
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}
function Native-Dialog([string]$Title) {
    # Native dialogs can be siblings of the main window; only inspect our PID.
    Wait-For "native dialog '$Title'" {
        $roots = $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $any)
        foreach ($root in $roots) {
            if ($root.Current.ProcessId -ne $app.Id) { continue }
            if ($root.Current.Name -eq $Title) { return $root }
            $child = Find-Named $root $Title ([System.Windows.Automation.ControlType]::Window)
            if ($child) { return $child }
        }
    }
}
function Focus-Input($Element, $NativeWindow = $window) {
    [InstalledSmokeInput]::Activate([IntPtr]$NativeWindow.Current.NativeWindowHandle)
    try { $Element.SetFocus() } catch { throw "$case : input delivery: UIA could not focus '$($Element.Current.Name)': $_" }
}
function Invoke-NativeButton($Dialog, [string]$Name) {
    # This runner exposes native Button-class controls as Pane, too.
    $button = Wait-For "native button '$Name'" {
        $condition = [System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name),
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button'))
        $found = $Dialog.FindFirst($scope, $condition)
        if ($found -and $found.Current.IsEnabled) { $found }
    }
    Focus-Input $button $Dialog
    [InstalledSmokeInput]::Key(0x20) # Space activates the focused Cancel button.
}
function Dump-Tree([string]$Label) {
    $lines = [Collections.Generic.List[string]]::new()
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    function Visit($Node, [int]$Depth) {
        if ($lines.Count -ge 2000 -or $Depth -gt 50) { return }
        try {
            $c = $Node.Current
            $value = $null
            if ($Node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
                $value = $value.Current.Value
            }
            $lines.Add(('  ' * $Depth) + "$($c.ControlType.ProgrammaticName) Name=[$($c.Name)] Id=[$($c.AutomationId)] Class=[$($c.ClassName)] PID=$($c.ProcessId) Enabled=$($c.IsEnabled) Offscreen=$($c.IsOffscreen) Value=[$value]")
            $child = $walker.GetFirstChild($Node)
            while ($child -and $lines.Count -lt 2000) {
                Visit $child ($Depth + 1)
                $child = $walker.GetNextSibling($child)
            }
        } catch { $lines.Add("UIA read failed: $_") }
    }
    if ($app) {
        foreach ($root in $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, $any)) {
            if ($root.Current.ProcessId -eq $app.Id) { Visit $root 0 }
        }
    }
    $lines | Set-Content -LiteralPath (Join-Path $diagnostics "$Label-tree.txt")
    Write-Host "UIA $Label : $($lines.Count) elements (up to 2000); tree in $diagnostics"
}
function Launch-App([string]$File = '') {
    $launch = @{ FilePath = $exePath; PassThru = $true
        RedirectStandardOutput = (Join-Path $diagnostics "$case-stdout.txt")
        RedirectStandardError = (Join-Path $diagnostics "$case-stderr.txt") }
    if ($File) { $launch.ArgumentList = '"' + $File + '"' }
    $script:app = Start-Process @launch
    $script:window = Wait-For 'visible installed-app main window' {
        $app.Refresh()
        if ($app.MainWindowHandle -ne [IntPtr]::Zero) {
            $element = [System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
            if (-not $element.Current.IsOffscreen) { $element }
        }
    }
    $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).SetWindowVisualState(
        [System.Windows.Automation.WindowVisualState]::Maximized)
    [InstalledSmokeInput]::Activate($app.MainWindowHandle)
}
function Close-App {
    $window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
    if (-not $app.WaitForExit(15000)) { throw "$case : installed app did not quit within 15 seconds" }
    if ($app.ExitCode -ne 0) { throw "$case : installed app exited with code $($app.ExitCode)" }
}
function Grid-Value([string]$Value) {
    Wait-For "grid cell value '$Value'" {
        $grid = Find-Named $window 'Table' ([System.Windows.Automation.ControlType]::DataGrid)
        if ($grid) { Find-Named $grid $Value }
    }
}
function Edit-Value([string]$Before, [string]$After) {
    $cell = Grid-Value $Before
    # The text leaf may not be focusable; its containing gridcell is.
    while (-not $cell.Current.IsKeyboardFocusable) {
        $cell = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cell)
        if (-not $cell -or $cell.Current.ControlType -eq [System.Windows.Automation.ControlType]::DataGrid) {
            throw "$case : '$Before' has no keyboard-focusable gridcell in UIA"
        }
    }
    Focus-Input $cell
    [InstalledSmokeInput]::Key(0x71) # F2
    $editor = Need-Named $window 'Edit cell' ([System.Windows.Automation.ControlType]::Edit)
    Focus-Input $editor
    [InstalledSmokeInput]::Ctrl(0x41)
    [InstalledSmokeInput]::Text($After)
    [InstalledSmokeInput]::Key(0x0D)
    Wait-For 'cell editor closed' { -not (Find-Named $window 'Edit cell' ([System.Windows.Automation.ControlType]::Edit)) } | Out-Null
    Grid-Value $After | Out-Null
}

$installerPath = (Resolve-Path -LiteralPath $Installer).Path
Get-FileHash -LiteralPath $installerPath | Format-List | Out-String | Write-Host
$keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
function Installed-Entry {
    @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Tachiko Sheet' })
}
# windows.ps1 currently uninstalls both A/B cases. Check registry rather than assuming reuse.
$entries = @(Installed-Entry)
if ($entries.Count -eq 0) {
    $setup = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "NSIS installer exited with code $($setup.ExitCode)" }
    $installedByThisRun = $true
    $entries = @(Installed-Entry)
}
if ($entries.Count -ne 1) { throw "expected one production uninstall entry, found $($entries.Count)" }
$entry = $entries[0]
if ($entry.UninstallString -notmatch '^\s*"([^"]+\.exe)"|^\s*([^"].*?\.exe)') {
    throw "cannot parse production uninstaller: $($entry.UninstallString)"
}
$uninstaller = $(if ($Matches[1]) { $Matches[1] } else { $Matches[2] }).Trim()
$installDir = if ($entry.InstallLocation) { $entry.InstallLocation.Trim().Trim('"') } else { Split-Path $uninstaller }
$executables = @(Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File | Where-Object { $_.FullName -ne $uninstaller })
if ($executables.Count -ne 1) { throw "expected one installed production executable in $installDir, found $($executables.Count)" }
$exePath = $executables[0].FullName
Write-Host "Installed production identity: $exePath (no e2e binary, flags or environment)"
Get-FileHash -LiteralPath $exePath | Format-List | Out-String | Write-Host

$case = '1-Home'; $uiaCase = $true
Launch-App
Need-Named $window 'Saved copies' | Out-Null
Need-Named $window 'Import a CSV or Excel file' | Out-Null
Need-Named $window 'Choose file…' | Out-Null
Dump-Tree $case
Write-Host 'Case 1 PASS: installed production Home content is accessible'
Close-App

$case = '2-runtime'
$fixture = Join-Path $work 'text-sentinels.csv'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../../acceptance/j3-interop/fixtures/text-sentinels.csv') -Destination $fixture
Launch-App $fixture
$preview = Need-Named $window 'Review import preview' ([System.Windows.Automation.ControlType]::Window)
Invoke-Button $preview 'Import file'
Grid-Value '0012' | Out-Null
Dump-Tree $case
Write-Host 'Case 2 PASS: installed native runtime imported fixture; grid contains 0012'

$case = '3-save-reopen'
$edited = 'R7 saved edit'
Edit-Value '0012' $edited
# Save commits a private local copy. Portable .ro Download uses the native Save
# panel for the temp-path file that a fresh production process can reopen.
[InstalledSmokeInput]::Ctrl(0x53)
$copy = Need-Named $window 'Save a copy' ([System.Windows.Automation.ControlType]::Window)
$name = Need-Named $copy 'Copy name' ([System.Windows.Automation.ControlType]::Edit)
Focus-Input $name
[InstalledSmokeInput]::Ctrl(0x41)
$copyName = 'R7 installed smoke ' + [guid]::NewGuid().ToString('N')
[InstalledSmokeInput]::Text($copyName)
Invoke-Button $copy 'Create copy'
Wait-For 'Save a copy dialog closed' { -not (Find-Named $window 'Save a copy' ([System.Windows.Automation.ControlType]::Window)) } | Out-Null
$copyCreated = $true
$tab = Need-Named $window 'Import & export' ([System.Windows.Automation.ControlType]::TabItem)
$tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
Invoke-Button $window 'Download work file (.ro)'
$download = Need-Named $window 'Confirm download' ([System.Windows.Automation.ControlType]::Window)
Invoke-Button $download 'Download'
$save = Native-Dialog 'Save As'
# CI's raw UIA tree exposes FileNameControlHost > Pane (class Edit, id 1001).
# Scope to that host: the address toolbar also has id 1001.
$filename = Wait-For 'native Save As filename (FileNameControlHost > 1001/Edit)' {
    $hostCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'FileNameControlHost')
    $filenameHost = $save.FindFirst($scope, $hostCondition)
    $condition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001'),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit'))
    if ($filenameHost) { $filenameHost.FindFirst($scope, $condition) }
}
$savedPath = Join-Path $work 'edited.ro'
Focus-Input $filename $save
[InstalledSmokeInput]::Ctrl(0x41)
[InstalledSmokeInput]::Text($savedPath)
[InstalledSmokeInput]::Key(0x0D)
Wait-For 'nonempty saved .ro file' { (Test-Path -LiteralPath $savedPath) -and (Get-Item -LiteralPath $savedPath).Length -gt 0 } | Out-Null
Wait-For 'download dialog closed' { -not (Find-Named $window 'Confirm download' ([System.Windows.Automation.ControlType]::Window)) } | Out-Null
Dump-Tree '3-before-quit'
Close-App
Launch-App $savedPath
Grid-Value $edited | Out-Null
Dump-Tree $case
Write-Host 'Case 3 PASS: edit, Save, native Save As, quit and fresh-process .ro reopen retained the edit'

$case = '4-cancellation'
$unsaved = 'R7 unsaved edit'
Edit-Value $edited $unsaved
$window.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
$dialog = Native-Dialog 'Close Tachiko Sheet?'
Need-Named $dialog 'You have changes that are not saved, or a change still in progress. If you continue, they will be lost.' | Out-Null
Dump-Tree '4-unsaved-dialog'
Invoke-NativeButton $dialog 'Cancel'
Wait-For 'Cancel dismissed the native close dialog' {
    -not (Find-Named $window 'Close Tachiko Sheet?' ([System.Windows.Automation.ControlType]::Window)) -and $window.Current.IsEnabled
} | Out-Null
Grid-Value $unsaved | Out-Null
# Another edit proves cancellation released the host/runtime, beyond a stale tree.
Edit-Value $unsaved 'R7 after Cancel'
Dump-Tree $case
Write-Host 'Case 4 PASS: native Cancel kept the window and unsaved edit; further editing works'
$uiaCase = $false
} catch {
    $failure = $_
    Write-Host "FAIL installed production case $case : $_"
    Write-Host $_.ScriptStackTrace
    if ($_.ToString() -match 'input delivery') {
        "$case : $_" | Set-Content -LiteralPath (Join-Path $diagnostics 'input-delivery.txt')
    }
    try { Dump-Tree "$case-failure" } catch { Write-Host "diagnostic tree failed: $_" }
    if ($uiaCase) {
        Write-Host "Case $case diagnostics: $case-failure-tree.txt. Lead disposition: repair UIA/native-input navigation; retain all four cases."
    }
} finally {
    try {
        if ($app -and -not $app.HasExited) { $app.Kill(); $app.WaitForExit() }
    } catch {
        Write-Host "process cleanup failed: $_"
        if (-not $failure) { $failure = $_ }
    }
    # Delete only the local copy this run created, through the normal UI.
    if ($copyCreated -and (-not $app -or $app.HasExited)) {
        try {
            $case = 'cleanup-copy'
            Launch-App
            Need-Named $window 'Saved copies' | Out-Null
            Invoke-Button $window "Delete saved $copyName"
            $delete = Need-Named $window 'Delete copy' ([System.Windows.Automation.ControlType]::Window)
            Invoke-Button $delete 'Delete'
            Wait-For 'test copy deleted' { -not (Find-Named $window "Open saved $copyName") } | Out-Null
            Close-App
        } catch {
            $cleanupFailure = $_
            Write-Host "local-copy cleanup failed: $_"
            try { Dump-Tree 'cleanup-copy-failure' } catch { Write-Host "cleanup diagnostic tree failed: $_" }
            if (-not $failure) { $failure = $cleanupFailure }
        } finally {
            try {
                if ($app -and -not $app.HasExited) { $app.Kill(); $app.WaitForExit() }
            } catch {
                Write-Host "cleanup-copy process cleanup failed: $_"
                if (-not $failure) { $failure = $_ }
            }
        }
    }
    try {
        # A reused installation and its integrations belong to the existing user.
        if ($installedByThisRun -and $uninstaller -and (Test-Path -LiteralPath $uninstaller)) {
            $removed = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
            if ($removed.ExitCode -ne 0) { throw "uninstaller exited with code $($removed.ExitCode)" }
            if (Test-Path -LiteralPath $exePath) { throw "installed executable remains after uninstall: $exePath" }
        }
    } catch {
        Write-Host "cleanup failed: $_"
        if (-not $failure) { $failure = $_ }
    }
    try {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Host "temporary-file cleanup failed: $_"
        if (-not $failure) { $failure = $_ }
    }
    try { Stop-Transcript | Out-Null } catch {
        Write-Host "transcript cleanup failed: $_"
        if (-not $failure) { $failure = $_ }
    }
}
if ($failure) { throw $failure }
Write-Host 'installed-production Windows acceptance: PASS (4 cases)'
