# AlfaPOS Kurye Takip - NSSM servislerini kaldirir (kaldirma/guncelleme oncesi).
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot
$nssm = Join-Path $PSScriptRoot 'nssm.exe'
foreach ($name in @('AlfaPOSKuryeTakip', 'AlfaPOSKuryeTunnel')) {
  if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
    & $nssm stop $name | Out-Null
    & $nssm remove $name confirm | Out-Null
    Write-Host "$name kaldirildi." -ForegroundColor Yellow
  }
}
