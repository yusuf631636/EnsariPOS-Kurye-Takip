# AlfaPOS Kurye Takip - guncel disaridan erisim linkini gosterir.
# Servis yeni kuruldugu icin tunel linkinin olusmasi birkac saniye surebilir.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

# config.json'da kalici bir domain (publicUrl) tanimliysa - Named Tunnel ile
# kurulmus bu restoranda oldugu gibi - o her zaman hazirdir, beklemeye gerek yok.
$publicUrl = $null
try {
  $config = Get-Content (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
  if ($config.publicUrl) { $publicUrl = $config.publicUrl }
} catch {}

$linkFile = Join-Path $env:ProgramData 'EnsariPOS\KuryeTakip\tunnel-link.txt'
if (-not $publicUrl) {
  $deadline = (Get-Date).AddSeconds(30)
  Write-Host 'Tünel linki bekleniyor...' -ForegroundColor Cyan
  while (-not (Test-Path $linkFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 800 }
}

Write-Host ''
Write-Host '  Yerel adres:' -ForegroundColor Green
Write-Host '    Kurye:    http://127.0.0.1:4021/courier'
Write-Host '    Yönetim:  http://127.0.0.1:4021/admin'
$url = if ($publicUrl) { $publicUrl } elseif (Test-Path $linkFile) { Get-Content $linkFile } else { $null }
if ($url) {
  Write-Host ''
  Write-Host "  Dışarıdan erişim linki: $url" -ForegroundColor Cyan
  Write-Host '  Bu link kurye ve yöneticiye WhatsApp ile otomatik gönderildi/gönderilecek.' -ForegroundColor DarkGray
  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($url) } catch {}
} else {
  Write-Host ''
  Write-Host '  Dış erişim linki henüz hazır değil (cloudflared kurulu olmayabilir).' -ForegroundColor Yellow
  Write-Host '  "Servisleri Yeniden Kur" kısayolunu birkaç dakika sonra tekrar deneyin.' -ForegroundColor DarkGray
}
Write-Host ''
Start-Sleep -Seconds 8
