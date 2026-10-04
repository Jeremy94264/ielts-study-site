# Probe WinRT OCR capability: try 4 rotations of one scanned page and score which is upright.
# Use this when a scanned PDF's page images are stored sideways (page dict has /Rotate 90):
# run it first to learn the correct -Rotate value for ocr_run.ps1 (Chapter 4 needed CW90).
# ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI.
param(
  # 不指定时自动取 ch4_pages/p01.jpg 或 pdf_pages_hi/p01.png
  [string]$Image,
  [string]$Lang  = "en-US"
)
$ErrorActionPreference = 'Stop'

if (-not $Image) {
  foreach ($c in @((Join-Path $PSScriptRoot 'ch4_pages\p01.jpg'),
                   (Join-Path $PSScriptRoot 'pdf_pages_hi\p01.png'))) {
    if (Test-Path $c) { $Image = $c; break }
  }
}
if (-not $Image -or -not (Test-Path $Image)) {
  throw "找不到待测图片：请用 -Image 指定（例如 -Image <dir>\p01.jpg）"
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  return $task.Result
}

[Windows.Storage.StorageFile,                  Windows.Storage,          ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream,  Windows.Storage.Streams,  ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,       Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapTransform,     Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap,      Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapPixelFormat,   Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapAlphaMode,     Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ExifOrientationMode, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ColorManagementMode, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapRotation,      Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,                  Windows.Foundation,       ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language,               Windows.Globalization,    ContentType=WindowsRuntime] | Out-Null

$language = New-Object Windows.Globalization.Language($Lang)
$engine   = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) {
  Write-Output "ERROR: cannot create OCR engine for $Lang (language pack missing?)"
  Write-Output ("available languages: " + (([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) -join ', '))
  exit 2
}
Write-Output ("OCR engine: " + $engine.RecognizerLanguage.LanguageTag + "  maxDim=" + $engine.MaxImageDimension)

$rotMap = @{
  'None'  = [Windows.Graphics.Imaging.BitmapRotation]::None
  'CW90'  = [Windows.Graphics.Imaging.BitmapRotation]::Clockwise90Degrees
  'CCW90' = [Windows.Graphics.Imaging.BitmapRotation]::Counterclockwise90Degrees
  'CW180' = [Windows.Graphics.Imaging.BitmapRotation]::Clockwise180Degrees
}

foreach ($k in @('None','CW90','CCW90','CW180')) {
  $sf     = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Image)) ([Windows.Storage.StorageFile])
  $stream = Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec    = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])

  $tf = New-Object Windows.Graphics.Imaging.BitmapTransform
  $tf.Rotation = $rotMap[$k]
  $bmp = Await ($dec.GetSoftwareBitmapAsync(
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
      [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
      $tf,
      [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
      [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $res  = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $text = ($res.Lines | ForEach-Object { $_.Text }) -join "`n"

  $lower  = [regex]::Matches($text, '\b[a-z]{3,}\b')
  $allTok = [regex]::Matches($text, '\S+')
  $score  = 0
  if ($allTok.Count -gt 0) { $score = [math]::Round(100.0 * $lower.Count / $allTok.Count, 1) }
  $first3 = (($res.Lines | Select-Object -First 3 | ForEach-Object { $_.Text }) -join ' | ')
  if ($first3.Length -gt 90) { $first3 = $first3.Substring(0, 90) }

  Write-Output ("{0,-6} {1,-12} lines={2,-4} chars={3,-6} lowerWords={4,-5} ratio={5}%  | {6}" -f `
      $k, "$($bmp.PixelWidth)x$($bmp.PixelHeight)", $res.Lines.Count, $text.Length, $lower.Count, $score, $first3)
  $bmp.Dispose(); $stream.Dispose()
}
