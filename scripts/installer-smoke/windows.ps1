param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
trap { Write-Error "installer-smoke windows: $_"; exit 1 }
$setup = Start-Process -FilePath (Resolve-Path $Installer).Path -ArgumentList '/S' -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "installer exited with code $($setup.ExitCode)" }
$keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
$entry = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Tachiko Sheet' })
if ($entry.Count -ne 1) { throw "expected one uninstall entry, found $($entry.Count)" }
$uninstall = $entry[0].UninstallString
if ($uninstall -notmatch '^\s*"([^"]+\.exe)"|^\s*([^"].*?\.exe)') { throw "cannot find uninstaller in: $uninstall" }
$uninstaller = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
$installDir = if ($entry[0].InstallLocation) { $entry[0].InstallLocation } else { Split-Path $uninstaller }
$exe = @(Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File | Where-Object { $_.FullName -ne $uninstaller })
if ($exe.Count -ne 1) { throw "expected one installed executable in $installDir, found $($exe.Count)" }
$exePath = $exe[0].FullName
$process = Start-Process -FilePath $exePath -PassThru
try {
  $window = $false
  for ($i = 0; $i -lt 60; $i++) {
    $process.Refresh()
    if ($process.HasExited) { throw 'process exited before window' }
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $window = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $window) { throw 'no window within 60 seconds' }
  Start-Sleep -Seconds 10
  $process.Refresh()
  if ($process.HasExited) { throw 'process exited during 10-second hold' }
  if (-not $process.CloseMainWindow()) { throw 'could not close main window' }
  if (-not $process.WaitForExit(15000)) { throw 'process did not exit within 15 seconds' }
} finally {
  $process.Refresh()
  if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
}
function DefaultValue($path) {
  $key = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
  if ($key) { return $key.GetValue('') }
  return $null
}
$classes = 'Registry::HKEY_CLASSES_ROOT'
$progId = DefaultValue "$classes\.ro"
if (-not $progId) { throw '.ro has no registered ProgID' }
$command = DefaultValue "$classes\$progId\shell\open\command"
if (-not $command -or $command.IndexOf($exePath, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw ".ro ProgID $progId does not open the installed executable: $command" }
Write-Host ".ro default: $progId; command: $command"
foreach ($extension in @('.xlsx', '.csv')) {
  $default = DefaultValue "$classes\$extension"
  $openWith = Get-Item -LiteralPath "$classes\$extension\OpenWithProgids" -ErrorAction SilentlyContinue
  $names = if ($openWith) { $openWith.GetValueNames() -join ', ' } else { '(none)' }
  Write-Host "$extension default: $default; OpenWithProgids: $names"
  if ($default -and $default -eq $progId) { throw "$extension default points to $progId" }
  if ($default) {
    $defaultCommand = DefaultValue "$classes\$default\shell\open\command"
    if ($defaultCommand -and $defaultCommand.IndexOf($exePath, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw "$extension default points to the installed app via $default" }
  }
}
$removed = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
if ($removed.ExitCode -ne 0) { throw "uninstaller exited with code $($removed.ExitCode)" }
if (Test-Path -LiteralPath $exePath) { throw "executable remains after uninstall: $exePath" }
Write-Host 'installer-smoke windows: PASS'
