param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$setup = (Get-Item -LiteralPath $Installer).FullName
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$menuLink = Join-Path $programs 'Synapse.lnk'
$desktopLink = Join-Path $desktop 'Synapse.lnk'
$registration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Synapse'
foreach ($existing in @($registration, $menuLink, $desktopLink, (Join-Path $env:APPDATA 'com.synapse.study'))) {
    if (Test-Path -LiteralPath $existing) {
        throw 'Run this installer test in a clean Windows user profile.'
    }
}

$folder = Join-Path ([IO.Path]::GetTempPath()) ('synapse-shortcut-' + [guid]::NewGuid())
$exe = Join-Path $folder 'synapse.exe'
$icon = Join-Path $folder 'synapse-frost.ico'
$ws = New-Object -ComObject WScript.Shell
$shell = New-Object -ComObject Shell.Application

function Install-Synapse([string[]]$Options) {
    # NSIS requires /D to be the last argument and permits spaces in its unquoted value.
    $run = Start-Process -FilePath $setup -ArgumentList (@('/S') + $Options + ('/D=' + $folder)) -Wait -PassThru -WindowStyle Hidden
    if ($run.ExitCode -ne 0) { throw "Installer exited with $($run.ExitCode)" }
}

function Assert-MenuIcon {
    $link = $ws.CreateShortcut($menuLink)
    if ($link.TargetPath -ne $exe -or $link.IconLocation -ne "$icon,0") {
        throw 'The Start menu shortcut does not point to the installed executable and its dedicated icon.'
    }
    $item = $shell.Namespace($programs).ParseName('Synapse.lnk')
    if ($item.ExtendedProperty('System.AppUserModel.ID') -ne 'com.synapse.study') {
        throw 'The taskbar grouping ID changed.'
    }
}

try {
    Install-Synapse @()
    Assert-MenuIcon
    $source = Join-Path $PSScriptRoot '../src-tauri/icons/icon.ico'
    if ((Get-FileHash -LiteralPath $icon).Hash -ne (Get-FileHash -LiteralPath $source).Hash) {
        throw 'The installed shell icon differs from the application artwork.'
    }

    # Older shortcuts inherited the icon from the executable. Keep a launch argument across repair.
    $legacy = $ws.CreateShortcut($menuLink)
    $legacy.IconLocation = "$exe,0"
    $legacy.Arguments = '--background'
    $legacy.Save()
    if (Test-Path -LiteralPath $desktopLink) { Remove-Item -LiteralPath $desktopLink }

    Install-Synapse @('/UPDATE')
    Assert-MenuIcon
    if ($ws.CreateShortcut($menuLink).Arguments -ne '--background' -or (Test-Path -LiteralPath $desktopLink)) {
        throw 'Updating the shell icon changed the launch arguments or recreated a removed shortcut.'
    }
} finally {
    $uninstaller = Join-Path $folder 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $run = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
        if ($run.ExitCode -ne 0) { throw "Uninstaller exited with $($run.ExitCode)" }
    }
}
