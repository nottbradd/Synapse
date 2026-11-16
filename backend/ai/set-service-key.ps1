#requires -Version 7.0
# Owner-only interactive entry. No key in argv, environment, files or diagnostics.
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Synapse - private service key upload'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$wranglerPath = Join-Path $PSScriptRoot 'node_modules/wrangler/bin/wrangler.js'
$configPath = Join-Path $PSScriptRoot 'wrangler.jsonc'
& $nodePath (Join-Path $PSScriptRoot 'owner.mjs') check-target --target remote
if ($LASTEXITCODE -ne 0) { throw 'Synapse target verification failed.' }
Write-Host 'Paste only the dedicated Synapse service-account key. Input is hidden.'
Write-Host 'The key goes directly to Cloudflare as OPENAI_SERVICE_KEY. It is not saved locally.'
$secureKey = Read-Host 'Synapse service key' -AsSecureString
$keyMemory = [IntPtr]::Zero
$keyChars = $null
try {
    if ($secureKey.Length -lt 30) { throw 'The supplied key is incomplete.' }
    $keyMemory = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secureKey)
    $keyChars = [char[]]::new($secureKey.Length)
    [Runtime.InteropServices.Marshal]::Copy($keyMemory, $keyChars, 0, $keyChars.Length)
    if ($keyChars[0] -ne 's' -or $keyChars[1] -ne 'k' -or $keyChars[2] -ne '-') {
        throw 'Expected a dedicated OpenAI service-account key.'
    }
    $uploadInfo = [Diagnostics.ProcessStartInfo]::new($nodePath)
    $uploadInfo.WorkingDirectory = $PSScriptRoot
    $uploadInfo.UseShellExecute = $false
    $uploadInfo.CreateNoWindow = $true
    $uploadInfo.RedirectStandardInput = $true
    $uploadInfo.RedirectStandardOutput = $true
    $uploadInfo.RedirectStandardError = $true
    foreach ($uploadArg in @($wranglerPath, 'secret', 'put', 'OPENAI_SERVICE_KEY', '--config', $configPath)) {
        $uploadInfo.ArgumentList.Add($uploadArg)
    }
    $upload = [Diagnostics.Process]::Start($uploadInfo)
    $uploadOutput = $upload.StandardOutput.ReadToEndAsync()
    $uploadError = $upload.StandardError.ReadToEndAsync()
    $upload.StandardInput.WriteLine($keyChars)
    $upload.StandardInput.Close()
    $upload.WaitForExit()
    # Never print child diagnostics: a provider error could reflect submitted data.
    $null = $uploadOutput.GetAwaiter().GetResult()
    $null = $uploadError.GetAwaiter().GetResult()
    if ($upload.ExitCode -ne 0) { throw 'Secret upload failed; no secret value was logged. Check owner authentication.' }
    Write-Host 'Cloudflare accepted OPENAI_SERVICE_KEY for Synapse. Generation remains paused.' -ForegroundColor Green
} finally {
    if ($null -ne $keyChars) { [Array]::Clear($keyChars, 0, $keyChars.Length) }
    if ($keyMemory -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($keyMemory) }
    $secureKey.Dispose()
}
