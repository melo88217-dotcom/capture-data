$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")).TrimEnd("\\")
$processes = @(Get-CimInstance Win32_Process)
$targetIds = [System.Collections.Generic.HashSet[int]]::new()

foreach ($process in $processes) {
  $commandLine = [string]$process.CommandLine
  if ($process.Name -ne "node.exe" -or $commandLine -notlike "*$projectRoot*") {
    continue
  }

  [void]$targetIds.Add([int]$process.ProcessId)
}

if ($targetIds.Count -eq 0) {
  Write-Host "No running server process was found for this project."
  exit 0
}

Write-Host ("Stopping project process IDs: " + (($targetIds | Sort-Object) -join ", "))
foreach ($processId in $targetIds) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
