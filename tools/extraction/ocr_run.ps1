param(
  [string]$ImageDir = "D:\dsh workspace\tools\extraction\pdf_pages_hi",
  [string]$OutDir   = "D:\dsh workspace\tools\extraction\ocr_out",
  [string]$Lang     = "en-US"
)

$ErrorActionPreference = 'Stop'

# ---------- WinRT async helper ----------
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

# ---------- load WinRT types ----------
[Windows.Storage.StorageFile,            Windows.Storage,         ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,            Windows.Foundation,      ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language,         Windows.Globalization,   ContentType=WindowsRuntime] | Out-Null

$language = New-Object Windows.Globalization.Language($Lang)
$engine   = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) { throw "Could not create OCR engine for $Lang" }
Write-Output "engine lang: $($engine.RecognizerLanguage.LanguageTag)  maxDim: $($engine.MaxImageDimension)"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$files = Get-ChildItem $ImageDir -Filter *.png | Sort-Object Name
foreach ($f in $files) {
  $sf     = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($f.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec    = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp    = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res    = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])

  $sb = New-Object System.Text.StringBuilder
  foreach ($line in $res.Lines) { [void]$sb.AppendLine($line.Text) }
  $outPath = Join-Path $OutDir ($f.BaseName + ".txt")
  [System.IO.File]::WriteAllText($outPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

  $bmp.Dispose(); $stream.Dispose()
  Write-Output ("{0}: {1} lines, {2} chars" -f $f.BaseName, $res.Lines.Count, $sb.Length)
}
Write-Output "DONE -> $OutDir"
