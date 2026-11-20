param(
    [string]$Sdk,
    [ValidateRange(5554,5682)][int]$Port = 5562,
    [switch]$SoftwareCpu,
    [switch]$MinimalCpu,
    [switch]$HiddenQt,
    [switch]$ShowWindow,
    [string]$EmulatorDirectory,
    [ValidateRange(1,120)][int]$BootTimeoutMinutes = 30
)
$ErrorActionPreference = 'Stop'
if ($Port % 2) { throw 'Emulator console port must be even.' }
if ($HiddenQt -and $ShowWindow) { throw 'Select one window mode.' }
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (!$Sdk) { $Sdk = Join-Path $project '.work/toolchain/android-sdk' }
$avdRoot = Join-Path $project '.work/avd'
$registry = Join-Path $avdRoot 'devices'
$name = if ($EmulatorDirectory) {'RiverNotes_API35_archive_offline'} else {'RiverNotes_API35_offline'}
$device = Join-Path $registry "$name.avd"
$serial = "emulator-$Port"
$sdkRoot = (Resolve-Path -LiteralPath $Sdk).Path
$emulatorLocation=if ($EmulatorDirectory) {(Resolve-Path -LiteralPath $EmulatorDirectory).Path} else {Join-Path $sdkRoot 'emulator'}
$useSoftwareCpu = $SoftwareCpu -or $MinimalCpu
if (!$useSoftwareCpu) {
    $accelCheck = Join-Path $emulatorLocation 'emulator-check.exe'
    if (!(Test-Path -LiteralPath $accelCheck -PathType Leaf)) { throw "Missing Android SDK runtime file: $accelCheck" }
    # Invoke the SDK helper directly. The emulator wrapper can split Windows paths at spaces.
    $acceleration = & {
        $PSNativeCommandUseErrorActionPreference = $false
        & $accelCheck accel
    }
    if ($LASTEXITCODE -ne 0) {
        throw @"
Android x86_64 VM acceleration is unavailable. SDK probe: $($acceleration -join ' ')
In an administrator PowerShell, run:
  Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All -NoRestart
Save your work, restart Windows, then run this launcher again.
"@
    }
}
# Some restricted Windows hosts exclude PATH from the DLL loader's search. In
# the project SDK, expose the official runtime DLLs beside the QEMU executable.
if ($emulatorLocation.StartsWith((Join-Path $project '.work')+'\',[StringComparison]::OrdinalIgnoreCase)) {
    $qemuDir=Join-Path $emulatorLocation 'qemu/windows-x86_64'
    $libraries=@('lib64','lib64/vulkan','lib64/gles_swiftshader')
    if ($HiddenQt -or $ShowWindow) {$libraries+='lib64/qt/lib'}
    $dllDirs=$libraries | ForEach-Object {Join-Path $emulatorLocation $_} | Where-Object {Test-Path -LiteralPath $_}
    foreach ($library in Get-ChildItem -LiteralPath $dllDirs -Filter '*.dll' -File) {
        $link=Join-Path $qemuDir $library.Name
        if (!(Test-Path -LiteralPath $link)) { [void](New-Item -ItemType HardLink -Path $link -Target $library.FullName) }
    }
}
# Windows emulator 37 may split its own helper executable at a space in the SDK
# directory. Use the host's short alias if available (still the same project).
$fso=New-Object -ComObject Scripting.FileSystemObject
$sdkRoot=$fso.GetFolder($sdkRoot).ShortPath
$emulatorDir=$fso.GetFolder($emulatorLocation).ShortPath
$adb = Join-Path $sdkRoot 'platform-tools/adb.exe'
$emulator = Join-Path $emulatorDir 'emulator.exe'
$image = 'system-images/android-35/default/x86_64/'
foreach ($item in @($adb,$emulator,(Join-Path $sdkRoot ($image+'system.img')))) {
    if (!(Test-Path -LiteralPath $item -PathType Leaf)) { throw "Missing Android SDK runtime file: $item" }
}
foreach ($dir in @($device,(Join-Path $avdRoot 'user'),(Join-Path $avdRoot 'tmp'))) {
    [void][IO.Directory]::CreateDirectory($dir)
}
$env:ANDROID_HOME=$sdkRoot
$env:ANDROID_SDK_ROOT=$sdkRoot
$env:PATH=(($emulatorDir,(Join-Path $emulatorDir 'lib64'),(Join-Path $emulatorDir 'lib64/qt/lib'),$env:PATH) -join ';')
$env:ANDROID_USER_HOME=Join-Path $avdRoot 'user'
$env:ANDROID_USER_HOME=$fso.GetFolder($env:ANDROID_USER_HOME).ShortPath
$env:ANDROID_EMULATOR_HOME=$env:ANDROID_USER_HOME
$env:ANDROID_AVD_HOME=$fso.GetFolder($registry).ShortPath
$env:TEMP=Join-Path $avdRoot 'tmp'
$env:TEMP=$fso.GetFolder($env:TEMP).ShortPath
$env:TMP=$env:TEMP
if ($ShowWindow) {
    if (!('RiverNotes.EmulatorWindow' -as [type])) {
        Add-Type -Path (Join-Path $PSScriptRoot 'EmulatorWindow.cs')
    }
    if (![RiverNotes.EmulatorWindow]::OnInputDesktop()) {
        throw 'Launch Start-Poker-Android.cmd from File Explorer on your Windows desktop.'
    }
    $windowTitle="Android Emulator - ${name}:$Port"
}
# Explicit device selection below permits the standard adb server to be shared:
# never stop that server or touch any other devices it lists.
$utf8=[Text.UTF8Encoding]::new($false)
$ini=Join-Path $registry "$name.ini"
if (!(Test-Path -LiteralPath $ini)) {
    $devicePath=$fso.GetFolder($device).ShortPath
    [IO.File]::WriteAllLines($ini,@('avd.ini.encoding=UTF-8',"path=$devicePath",'target=android-35'),$utf8)
}
$config=Join-Path $device 'config.ini'
if (!(Test-Path -LiteralPath $config)) {
    [IO.File]::WriteAllLines($config, @(
        'avd.ini.encoding=UTF-8',"AvdId=$name","avd.ini.displayname=$name",
        'target=android-35','tag.id=default','tag.display=Default','abi.type=x86_64',
        'hw.cpu.arch=x86_64','hw.cpu.ncore=2','hw.ramSize=2048','vm.heapSize=256',
        'hw.lcd.width=480','hw.lcd.height=800','hw.lcd.density=160',
        'hw.mainKeys=no','hw.keyboard=yes','hw.gpu.enabled=yes','hw.gpu.mode=software',
        'hw.audioInput=no','hw.audioOutput=no','hw.camera.back=none','hw.camera.front=none',
        'hw.sdCard=no','showDeviceFrame=no','disk.dataPartition.size=3G',
        'PlayStore.enabled=false',"image.sysdir.1=$image"
    ),$utf8)
}
$devices=(& $adb devices)
if ($LASTEXITCODE -ne 0) { throw 'adb devices failed' }
function Open-InstalledApp {
    $appDeadline=(Get-Date).AddMinutes($BootTimeoutMinutes)
    while (!(Test-GuestBootCompleted)) {
        if ((Get-Date) -ge $appDeadline) { throw "Android did not finish booting on $serial." }
        Start-Sleep -Seconds 2
    }
    $installed=& $adb -s $serial shell pm path org.rivernotes.poker
    if ($installed -match '^package:') {
        # The package path can be available before the user's launcher activity.
        do {
            $resolved=& $adb -s $serial shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER org.rivernotes.poker
            if ($resolved -match '^org\.rivernotes\.poker/') { break }
            if ((Get-Date) -ge $appDeadline) { throw 'The installed launcher activity is unavailable.' }
            Start-Sleep -Seconds 2
        } while ($true)
        & $adb -s $serial shell am start -W -n org.rivernotes.poker/.MainActivity
        if ($LASTEXITCODE -ne 0) { throw 'Could not open the installed app.' }
    }
}
function Test-GuestBootCompleted {
    # PowerShell 5.1 wraps native stderr while the transport is offline.
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $completed = & $adb -s $serial shell getprop sys.boot_completed 2>$null
    return ($LASTEXITCODE -eq 0 -and $completed -eq '1')
}
$bootIdFile=Join-Path $device 'launcher-boot-id.txt'
function Get-GuestBootId {
    $ErrorActionPreference='Continue'
    $id=& $adb -s $serial shell cat /proc/sys/kernel/random/boot_id 2>$null
    if ($LASTEXITCODE -eq 0 -and $id -match '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') { return $id }
}
if ($devices -match "^$serial\s") {
    if (!$ShowWindow) { throw "$serial is already occupied." }
    # The emulator console can reject commands from a different Windows account.
    # A guest boot ID recorded by this launcher also identifies this exact running AVD.
    $bootId=Get-GuestBootId
    $owned=$bootId -and (Test-Path -LiteralPath $bootIdFile) -and
        ($bootId -eq [IO.File]::ReadAllText($bootIdFile).Trim())
    if (!$owned) {
        $activeName=@(& $adb -s $serial emu avd name)[0]
        $activePath=@(& $adb -s $serial emu avd path)[0]
        $owned=$activeName -and $activeName.Trim() -eq $name -and $activePath -and
            (Test-Path -LiteralPath $activePath.Trim() -PathType Container) -and
            $fso.GetFolder($activePath.Trim()).ShortPath -eq $fso.GetFolder($device).ShortPath
    }
    if (!$owned) {
        throw "$serial is occupied. Only this project's AVD can switch to window mode."
    }
    if ([RiverNotes.EmulatorWindow]::BringForward($windowTitle)) {
        Open-InstalledApp
        return
    }
    # Shut down Android cleanly before reopening its existing data partition.
    $reply=@(& $adb -s $serial emu kill)
    if (!(($reply -join ' ') -match 'OK: killing emulator')) {
        Write-Output "Console did not confirm shutdown of $serial. Requesting Android shutdown."
        & $adb -s $serial shell svc power shutdown
    }
    $shutdownDeadline=(Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 1
        $devices=& $adb devices
        if ($LASTEXITCODE -ne 0) { throw 'adb devices failed during shutdown' }
        $stillRunning=($devices -match "^$serial\s") -or (Test-Path -LiteralPath (Join-Path $device 'hardware-qemu.ini.lock'))
    } while ($stillRunning -and (Get-Date) -lt $shutdownDeadline)
    if ($stillRunning) { throw "Timed out waiting for $serial to finish shutdown." }
}
$accel=if ($useSoftwareCpu) {'off'} else {'on'}
$gpu=if ($MinimalCpu) {'off'} elseif ($EmulatorDirectory) {'swiftshader_indirect'} else {'swiftshader'}
$cores=if ($MinimalCpu) {'1'} else {'2'}
$emulatorArgs=@('-avd',$name,'-port',"$Port",'-accel',$accel,'-gpu',$gpu,'-feature','-Vulkan','-cores',$cores,'-memory','2048',
    '-no-audio','-no-snapshot','-no-boot-anim','-camera-back','none','-camera-front','none','-verbose')
if ($HiddenQt) {$emulatorArgs+='-qt-hide-window'} elseif (!$ShowWindow) {$emulatorArgs+='-no-window'}
if (!$EmulatorDirectory) {$emulatorArgs+=@('-crash-report-mode','disabled')}
if ($MinimalCpu) {$emulatorArgs+=@('-feature','-QuickbootFileBacked','-qemu','-cpu','max','-accel','tcg,thread=single')} else {$emulatorArgs+=@('-show-kernel')}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout=Join-Path $avdRoot "emulator-$stamp.stdout.log"
$stderr=Join-Path $avdRoot "emulator-$stamp.stderr.log"
$windowStyle=if ($ShowWindow) {'Normal'} else {'Hidden'}
$process=Start-Process -FilePath $emulator -ArgumentList $emulatorArgs -WorkingDirectory $project -WindowStyle $windowStyle -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Write-Output "Started $name, PID $($process.Id) serial $serial. Logs $stdout and $stderr"
$booted=$false
$deadline=(Get-Date).AddMinutes($BootTimeoutMinutes)
while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw "Emulator exited with code $($process.ExitCode). See $stderr and $stdout." }
    $booted=Test-GuestBootCompleted
    if ($booted) { break }
    Start-Sleep -Seconds 5
}
if (!$booted) { throw "Boot timeout for $serial; inspect the live emulator and its logs before retrying." }
$realName=(& $adb -s $serial shell getprop ro.boot.qemu.avd_name)
if (!$realName) { $realName=@(& $adb -s $serial emu avd name)[0] }
$isQemu=(& $adb -s $serial shell getprop ro.kernel.qemu)
if ($isQemu -ne '1') { $isQemu=(& $adb -s $serial shell getprop ro.boot.qemu) }
if ($realName -ne $name -or $isQemu -ne '1') { throw 'Unexpected AVD identity; no network change performed.' }
$bootId=Get-GuestBootId
if ($bootId) { [IO.File]::WriteAllText($bootIdFile,$bootId,$utf8) }
# Only this project-private guest is changed. Disable its Wi-Fi and mobile data
# before the app is installed so offline launch is observable independently of WebView.
$offline=$false
while ((Get-Date) -lt $deadline) {
    $phone=& $adb -s $serial shell service check phone
    $wifi=& $adb -s $serial shell service check wifi
    if ($phone -eq 'Service phone: found' -and $wifi -eq 'Service wifi: found') {
        # Airplane mode can restore the guest's remembered Wi-Fi preference.
        & $adb -s $serial shell cmd connectivity airplane-mode enable
        & $adb -s $serial shell svc data disable
        & $adb -s $serial shell svc wifi disable
        $airplane=& $adb -s $serial shell cmd connectivity airplane-mode
        $wifiStatus=& $adb -s $serial shell cmd wifi status
        $net=& $adb -s $serial shell dumpsys connectivity | Select-String -Pattern '^\s*Active default network:\s*(none|null|-1)\s*$'
        if ($airplane -eq 'enabled' -and $wifiStatus -contains 'Wifi is disabled' -and $net) {
            $offline=$true
            break
        }
    }
    Start-Sleep -Seconds 2
}
if (!$offline) { throw 'Guest booted, but its offline state was not confirmed.' }
Write-Output "Ready: $serial / $name / guest default network disconnected."
if ($ShowWindow) {
    Open-InstalledApp
    if (![RiverNotes.EmulatorWindow]::BringForward($windowTitle)) {
        throw "Android has booted, but its window was not found on this desktop: $windowTitle"
    }
    Write-Output "Desktop window: $windowTitle"
}
Write-Output "Run: node tests/android-emulator.cjs --serial $serial --avd $name --apk <APK> --adb ""$adb"""
