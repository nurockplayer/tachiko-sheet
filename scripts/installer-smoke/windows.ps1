param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
trap { Write-Error "installer-smoke windows: $_"; exit 1 }
function DefaultValue($path) {
  $key = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
  if ($key) { return $key.GetValue('') }
  return $null
}
$diagnosticRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$diagnosticDir = Join-Path $diagnosticRoot ("tachiko-installer-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $diagnosticDir | Out-Null
$env:TACHIKO_CLOSE_DIAGNOSTICS = Join-Path $diagnosticDir 'app-close.log'
# EnumWindows includes owned top-level dialogs, which MainWindowHandle omits.
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class InstallerSmokeWindow {
    delegate bool EnumProc(IntPtr handle, IntPtr param);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")]
    static extern bool IsWindowEnabled(IntPtr handle);
    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")]
    static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr param);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr handle, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SendMessageTimeout(IntPtr handle, uint message, IntPtr count,
        StringBuilder text, uint flags, uint timeout, out IntPtr result);
    static string Text(IntPtr handle) {
        var text = new StringBuilder(1024);
        IntPtr result;
        if (SendMessageTimeout(handle, 13, (IntPtr)text.Capacity, text, 2, 200, out result) == IntPtr.Zero)
            return "<WM_GETTEXT timed out/failed>";
        return text.ToString();
    }
    static string Class(IntPtr handle) {
        var text = new StringBuilder(256);
        GetClassName(handle, text, text.Capacity);
        return text.ToString();
    }
    public static string Describe(uint pid) {
        var report = new StringBuilder();
        EnumWindows((handle, param) => {
            uint windowPid;
            GetWindowThreadProcessId(handle, out windowPid);
            if (windowPid != pid) return true;
            var owner = GetWindow(handle, 4); // GW_OWNER
            report.AppendLine(String.Format("window=0x{0:X} owner=0x{1:X} class={2} visible={3} enabled={4} title={5}",
                handle.ToInt64(), owner.ToInt64(), Class(handle), IsWindowVisible(handle), IsWindowEnabled(handle), Text(handle)));
            EnumChildWindows(handle, (child, unused) => {
                if (Class(child).IndexOf("Button", StringComparison.OrdinalIgnoreCase) >= 0)
                    report.AppendLine(String.Format("  button=0x{0:X} visible={1} enabled={2} text={3}",
                        child.ToInt64(), IsWindowVisible(child), IsWindowEnabled(child), Text(child)));
                return true;
            }, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        return report.Length == 0 ? "no top-level windows for PID" : report.ToString();
    }
}
'@
function TraceLines($process) {
  if (-not (Test-Path -LiteralPath $env:TACHIKO_CLOSE_DIAGNOSTICS)) { return @() }
  return @(Get-Content -LiteralPath $env:TACHIKO_CLOSE_DIAGNOSTICS | Where-Object { $_.Contains(" pid=$($process.Id) ") })
}
# $kind is 'startup-stall' (page never loaded) or 'close-timeout' (loaded, then did not exit).
function CloseTimeoutDiagnostics($process, $launch, $started, $visibleMs, $closeMs, $kind = 'close-timeout') {
  $elapsedMs = [math]::Round(([DateTime]::UtcNow - $started).TotalMilliseconds)
  $process.Refresh()
  $responding = if ($process.HasExited) { 'exited' } else { $process.Responding }
  $summary = "$launch $kind UTC=$([DateTime]::UtcNow.ToString('o')) PID=$($process.Id) responding=$responding launch_UTC=$($started.ToString('o')) visible_ms=$visibleMs close_ms=$closeMs elapsed_ms=$elapsedMs since_close_ms=$($elapsedMs - $closeMs)"
  Write-Host $summary
  $windows = [InstallerSmokeWindow]::Describe($process.Id)
  Write-Host $windows
  # WebView2 runs in msedgewebview2.exe children; none means its environment never started.
  $webviews = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ParentProcessId -eq $process.Id -or ($_.CommandLine -and $_.CommandLine.IndexOf('--webview-exe-name=' + [IO.Path]::GetFileName($process.Path), [StringComparison]::OrdinalIgnoreCase) -ge 0)
  } | ForEach-Object { "webview2 PID=$($_.ProcessId) parent=$($_.ParentProcessId) created=$($_.CreationDate.ToUniversalTime().ToString('o'))" })
  $webviewReport = if ($webviews.Count) { $webviews -join [Environment]::NewLine } else { 'webview2: no msedgewebview2.exe processes for this app' }
  Write-Host $webviewReport
  @($summary, $windows, $webviewReport) | Set-Content (Join-Path $diagnosticDir "windows-$($process.Id).txt")
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $screenshot = Join-Path $diagnosticDir "$kind-$($process.Id).png"
      $bitmap.Save($screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Host "$kind screenshot: $screenshot"
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  } catch { Write-Host "$kind screenshot failed: $_" }
  $trace = TraceLines $process
  if ($trace.Count) {
    Write-Host "$kind app trace for PID $($process.Id):"
    $trace | ForEach-Object { Write-Host $_ }
  } else { Write-Host "$kind app trace for PID $($process.Id): no events recorded" }
}
function CheckWindow($process, $launch) {
  if (-not $process) { throw 'shell dispatch did not return an app process' }
  try {
    $started = $process.StartTime.ToUniversalTime()
    Write-Host "$launch launch UTC=$($started.ToString('o')) PID=$($process.Id)"
    $window = $false
    for ($i = 0; $i -lt 60; $i++) {
      $process.Refresh()
      if ($process.HasExited) { throw 'process exited before window' }
      if ($process.MainWindowHandle -ne [IntPtr]::Zero -and [InstallerSmokeWindow]::IsWindowVisible($process.MainWindowHandle)) { $window = $true; break }
      Start-Sleep -Seconds 1
    }
    if (-not $window) { throw 'no window within 60 seconds' }
    $visibleMs = [math]::Round(([DateTime]::UtcNow - $started).TotalMilliseconds)
    Write-Host "$launch visible PID=$($process.Id) elapsed_ms=$visibleMs"
    # The native window shows before WebView2 starts, and a close sent before
    # then is held until it has; wait for the page so a stall is named as one.
    $loaded = $false
    for ($i = 0; $i -lt 120; $i++) {
      $process.Refresh()
      if ($process.HasExited) { throw 'process exited before its page loaded' }
      if (@(TraceLines $process | Where-Object { $_.Contains(' page-loaded ') }).Count) { $loaded = $true; break }
      Start-Sleep -Milliseconds 500
    }
    $loadedMs = [math]::Round(([DateTime]::UtcNow - $started).TotalMilliseconds)
    if (-not $loaded) {
      try { CloseTimeoutDiagnostics $process $launch $started $visibleMs $loadedMs 'startup-stall' }
      catch { Write-Host "startup-stall diagnostics failed: $_" }
      $stage = if (@(TraceLines $process | Where-Object { $_.Contains(' window-built ') }).Count) { 'page navigation' } else { 'WebView2 creation (window-built missing)' }
      throw "startup stall in ${stage}: page did not load within 60 seconds of the window appearing (no close was sent)"
    }
    Write-Host "$launch page loaded PID=$($process.Id) elapsed_ms=$loadedMs"
    Start-Sleep -Seconds 10
    $process.Refresh()
    if ($process.HasExited) { throw 'process exited during 10-second hold' }
    $closeMs = [math]::Round(([DateTime]::UtcNow - $started).TotalMilliseconds)
    Write-Host "$launch close requested PID=$($process.Id) elapsed_ms=$closeMs"
    if (-not $process.CloseMainWindow()) { throw 'could not close main window' }
    if (-not $process.WaitForExit(15000)) {
      try { CloseTimeoutDiagnostics $process $launch $started $visibleMs $closeMs }
      catch { Write-Host "close-timeout diagnostics failed: $_" }
      throw 'process did not exit within 15 seconds'
    }
  } finally {
    $process.Refresh()
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
  }
}
$classes = 'Registry::HKEY_CLASSES_ROOT'
$userClasses = 'Registry::HKEY_CURRENT_USER\Software\Classes'
$fileExts = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts'
$original = @{}
$fakeIds = @{}
foreach ($extension in @('.xlsx', '.csv')) {
  if (Test-Path -LiteralPath "$fileExts\$extension\UserChoice") {
    throw "$extension has an Explorer UserChoice; run this smoke with a clean test user"
  }
  $key = Get-Item -LiteralPath "$userClasses\$extension" -ErrorAction SilentlyContinue
  $hasDefault = $null -ne $key -and $key.GetValueNames() -contains ''
  $original[$extension] = @{
    KeyExisted = $null -ne $key
    HasDefault = $hasDefault
    Value = if ($hasDefault) { $key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }
    Kind = if ($hasDefault) { $key.GetValueKind('') } else { $null }
  }
  if ($key) { $key.Close() }
  $fakeIds[$extension] = "InstallerSmoke$([guid]::NewGuid().ToString('N'))$extension"
}
$mainError = $null
try {
foreach ($case in @('A', 'B')) {
  Write-Host "Case $case association baseline (A: no default; B: fake existing default)"
  $before = @{}
  $userKeyBefore = @{}
  foreach ($extension in @('.xlsx', '.csv')) {
    $fake = $fakeIds[$extension]
    if (-not (Test-Path -LiteralPath "$userClasses\$extension")) {
      New-Item -Path "$userClasses\$extension" | Out-Null
    }
    # An empty per-user default masks a machine default without changing it.
    Set-Item -LiteralPath "$userClasses\$extension" -Value ''
    if ($case -eq 'B') {
      New-Item -Path "$userClasses\$fake\shell\open\command" -Force | Out-Null
      Set-Item -LiteralPath "$userClasses\$fake\shell\open\command" -Value '"C:\Windows\System32\notepad.exe" "%1"'
      Set-Item -LiteralPath "$userClasses\$extension" -Value $fake
    }
    $before[$extension] = DefaultValue "$classes\$extension"
    if ($case -eq 'A' -and $before[$extension]) { throw "$extension case A default is not empty" }
    if ($case -eq 'B' -and $before[$extension] -cne $fake) { throw "$extension case B default is not $fake" }
    Write-Host "Case $case $extension before install default: $($before[$extension])"
    $userKeyBefore[$extension] = Test-Path -LiteralPath "$userClasses\$extension"
  }
  $setup = Start-Process -FilePath (Resolve-Path $Installer).Path -ArgumentList '/S' -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "installer exited with code $($setup.ExitCode)" }
  $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
  $entry = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Tachiko Sheet' })
  if ($entry.Count -ne 1) { throw "expected one uninstall entry, found $($entry.Count)" }
  $uninstall = $entry[0].UninstallString
  if ($uninstall -notmatch '^\s*"([^"]+\.exe)"|^\s*([^"].*?\.exe)') { throw "cannot find uninstaller in: $uninstall" }
  $uninstaller = $(if ($Matches[1]) { $Matches[1] } else { $Matches[2] }).Trim().Trim('"').Trim()
  $rawInstallDir = $entry[0].InstallLocation
  $installDir = if ($rawInstallDir) { $rawInstallDir.Trim().Trim('"').Trim() } else { Split-Path $uninstaller }
  if (-not (Test-Path -LiteralPath $installDir -PathType Container)) { throw "install directory is not a folder: $installDir (raw InstallLocation: $rawInstallDir)" }
  $installDir = (Resolve-Path -LiteralPath $installDir).Path
  Write-Host "Install directory: $installDir"
  $exe = @(Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File | Where-Object { $_.FullName -ne $uninstaller })
  if ($exe.Count -ne 1) { throw "expected one installed executable in $installDir, found $($exe.Count)" }
  $exePath = $exe[0].FullName
  Write-Host "Installed executable: $exePath"
  CheckWindow (Start-Process -FilePath $exePath -PassThru) "Case $case direct"
  $fixture = Join-Path $env:TEMP "tachiko-installer-$case.ro"
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../../public/templates/budget.ro') -Destination $fixture
  try {
    Write-Host "Case $case shell-dispatched .ro open: $fixture"
    $existingIds = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exePath)) -ErrorAction SilentlyContinue | Where-Object {
      try { [String]::Equals($_.Path, $exePath, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    } | ForEach-Object { $_.Id })
    $opened = Start-Process -FilePath $fixture -PassThru
    $dispatched = $null
    if ($opened) {
      try {
        if ([String]::Equals($opened.Path, $exePath, [StringComparison]::OrdinalIgnoreCase)) { $dispatched = $opened }
      } catch { }
    }
    for ($i = 0; -not $dispatched -and $i -le 30; $i++) {
      if ($i -gt 0) { Start-Sleep -Seconds 1 }
      $dispatched = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exePath)) -ErrorAction SilentlyContinue | Where-Object {
        try {
          $id = $_.Id
          $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop).CommandLine
          $id -notin $existingIds -and [String]::Equals($_.Path, $exePath, [StringComparison]::OrdinalIgnoreCase) -and $commandLine -and $commandLine.IndexOf('"' + $fixture + '"', [StringComparison]::OrdinalIgnoreCase) -ge 0
        } catch { $false }
      } | Select-Object -First 1
    }
    if (-not $dispatched) {
      $openedId = $null; $openedPath = $null; $openedExited = $null
      if ($opened) {
        try { $openedId = $opened.Id } catch { $openedId = "unavailable: $_" }
        try { $openedPath = $opened.Path } catch { $openedPath = "unavailable: $_" }
        try { $openedExited = $opened.HasExited } catch { $openedExited = "unavailable: $_" }
      }
      $processes = @(Get-Process -Name '*tachiko*' -ErrorAction SilentlyContinue | ForEach-Object {
        $processPath = try { $_.Path } catch { "unavailable: $_" }
        $id = $_.Id
        $processCommandLine = try { (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop).CommandLine } catch { "unavailable: $_" }
        "Id=$id Path=$processPath CommandLine=$processCommandLine"
      }) -join '; '
      throw ".ro shell dispatch did not start the installed executable; opened null=$($null -eq $opened), Id=$openedId, Path=$openedPath, HasExited=$openedExited; tachiko processes: $processes"
    }
    CheckWindow $dispatched "Case $case shell"
  } finally {
    Remove-Item -LiteralPath $fixture -ErrorAction SilentlyContinue
  }
  $progId = DefaultValue "$classes\.ro"
  if (-not $progId) { throw '.ro has no registered ProgID' }
  $command = DefaultValue "$classes\$progId\shell\open\command"
  if (-not $command -or $command.IndexOf($exePath, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw ".ro ProgID $progId does not open the installed executable: $command" }
  Write-Host ".ro default: $progId; command: $command"
  foreach ($extension in @('.xlsx', '.csv')) {
    $default = DefaultValue "$classes\$extension"
    $appProgId = "TachikoSheet$extension"
    $openWith = Get-Item -LiteralPath "$userClasses\$extension\OpenWithProgids" -ErrorAction SilentlyContinue
    $names = if ($openWith) { $openWith.GetValueNames() } else { @() }
    $command = DefaultValue "$userClasses\$appProgId\shell\open\command"
    Write-Host "$extension after install default: $default; OpenWithProgids: $($names -join ', '); command: $command"
    if (Test-Path -LiteralPath "$fileExts\$extension\UserChoice") { throw "$extension UserChoice changed" }
    if ($default -cne $before[$extension]) { throw "$extension default changed after install" }
    if ($appProgId -notin $names) { throw "$extension OpenWithProgids missing $appProgId" }
    if (-not $command -or $command.IndexOf($exePath, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw "$appProgId does not open the installed executable: $command" }
  }
  $removed = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($removed.ExitCode -ne 0) { throw "uninstaller exited with code $($removed.ExitCode)" }
  if (Test-Path -LiteralPath $exePath) { throw "executable remains after uninstall: $exePath" }
  foreach ($extension in @('.xlsx', '.csv')) {
    $default = DefaultValue "$classes\$extension"
    $appProgId = "TachikoSheet$extension"
    $openWith = Get-Item -LiteralPath "$userClasses\$extension\OpenWithProgids" -ErrorAction SilentlyContinue
    $names = if ($openWith) { $openWith.GetValueNames() } else { @() }
    $progIdRemains = Test-Path -LiteralPath "$userClasses\$appProgId"
    Write-Host "$extension after uninstall default: $default; OpenWithProgids: $($names -join ', '); ProgID remains: $progIdRemains"
    if (Test-Path -LiteralPath "$fileExts\$extension\UserChoice") { throw "$extension UserChoice changed" }
    if ($default -cne $before[$extension]) { throw "$extension default changed after uninstall" }
    if ($appProgId -in $names -or $progIdRemains) { throw "$appProgId registration remains after uninstall" }
    if (-not $userKeyBefore[$extension] -and (Test-Path -LiteralPath "$userClasses\$extension")) { throw "$extension per-user key left behind after uninstall" }
  }
  if (Test-Path -LiteralPath "$classes\$progId") { throw ".ro ProgID $progId remains after uninstall" }
  Write-Host "Case $case install, visible window, shell open, association preservation and uninstall: PASS"
}
} catch {
  $mainError = $_
  Write-Host "installer-smoke windows: $_"
  Write-Host $_.ScriptStackTrace
} finally {
  try {
  foreach ($extension in @('.xlsx', '.csv')) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Classes\$extension", $true)
    if (-not $key -and $original[$extension].KeyExisted) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$extension")
    }
    if ($key) {
      try {
        if ($original[$extension].HasDefault) {
          $key.SetValue('', $original[$extension].Value, $original[$extension].Kind)
        } else {
          $key.DeleteValue('', $false)
        }
        $empty = $key.GetValueNames().Count -eq 0 -and $key.GetSubKeyNames().Count -eq 0
      } finally {
        $key.Close()
      }
      if (-not $original[$extension].KeyExisted -and $empty) {
        Remove-Item -LiteralPath "$userClasses\$extension"
      }
    }
    $fakePath = "$userClasses\$($fakeIds[$extension])"
    if (Test-Path -LiteralPath $fakePath) { Remove-Item -LiteralPath $fakePath -Recurse -Force }
  }
  } catch {
    Write-Host "installer-smoke windows restore: $_"
    Write-Host $_.ScriptStackTrace
    if (-not $mainError) { throw }
  }
}
if ($mainError) { throw $mainError }
Write-Host 'installer-smoke windows: PASS'
