; StellarHub installer (Inno Setup 6.6 or later). Built by packaging/build.ps1, which passes the version:
;   ISCC.exe /DAppVersion=0.2.0 packaging\StellarHub.iss
;
; What it does, and nothing else: copies StellarHub to Program Files, adds a Start menu shortcut (and a desktop one
; if you tick it), installs the WebView2 runtime only if Windows lacks it, and registers a normal uninstaller.
; The uninstaller also removes what the app registered itself (its scheduled task and "open with Windows" entry).

#ifndef AppVersion
  #error Pass the version: ISCC /DAppVersion=x.y.z StellarHub.iss
#endif

#define AppName "StellarHub"
#define AppExe "StellarHub.exe"
#define AppUrl "https://github.com/estebanarosemena/StellarHub"

[Setup]
; never change AppId: Windows uses it to recognize upgrades and the uninstaller
AppId={{0F1795D8-7D52-45CC-8518-7A1E4E76E43E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Esteban Arosemena
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
AppCopyright=Copyright (C) Esteban Arosemena. GNU GPL v3.
AppComments=The control center for your Windows PC.

DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
DisableWelcomePage=no
ShowLanguageDialog=no
PrivilegesRequired=admin
; /CURRENTUSER installs for one user without administrator rights (used by the automated tests)
PrivilegesRequiredOverridesAllowed=commandline
UsedUserAreasWarning=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; WebView2 needs Windows 10 1809 or later
MinVersion=10.0.17763

; dark, in the blue "polar" variant: closest to StellarHub's deep-space navy
WizardStyle=modern dark polar hidebevels
WizardImageFile=..\build\assets\wizard-202.png,..\build\assets\wizard-269.png,..\build\assets\wizard-336.png,..\build\assets\wizard-403.png,..\build\assets\wizard-534.png
WizardSmallImageFile=..\build\assets\wizard-small-58.png,..\build\assets\wizard-small-77.png,..\build\assets\wizard-small-97.png,..\build\assets\wizard-small-116.png,..\build\assets\wizard-small-159.png
SetupIconFile=..\build\assets\StellarHub.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}

OutputDir=..\dist
OutputBaseFilename=StellarHub-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes

; the installer first asks a running StellarHub to close (see PrepareToInstall); this is the fallback
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

VersionInfoVersion={#AppVersion}
VersionInfoCompany=Esteban Arosemena
VersionInfoDescription={#AppName} Setup
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoCopyright=Copyright (C) Esteban Arosemena

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to StellarHub
WelcomeLabel2=This will install [name/ver] on your PC.%n%nLive hardware stats, drivers, apps, disk space, cleanup and hardware tests, in one place.
FinishedHeadingLabel=StellarHub is ready
FinishedLabelNoIcons=StellarHub is installed.
FinishedLabel=StellarHub is installed. You will find it in the Start menu.
ClickFinish=
SelectTasksDesc=Anything else?
SelectTasksLabel2=

[Tasks]
Name: "desktopicon"; Description: "Add a shortcut to the desktop"; Flags: unchecked

[InstallDelete]
; an update replaces the runtime folder completely, so no file from an older version is left behind
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\build\dist\StellarHub\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "..\build\redist\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "StellarHub.App"; Comment: "The control center for your Windows PC"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "StellarHub.App"; Comment: "The control center for your Windows PC"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing the Microsoft Edge WebView2 Runtime..."; Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\{#AppExe}"; Description: "Open StellarHub"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{app}\{#AppExe}"; Parameters: "--quit"; RunOnceId: "CloseStellarHub"; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExe}"; Parameters: "--uninstall-cleanup"; RunOnceId: "CleanupStellarHub"; Flags: runhidden waituntilterminated

[UninstallDelete]
; the interface cache (rebuilt on demand); settings are only removed if the user says so (see below)
Type: filesandordirs; Name: "{localappdata}\StellarHub\webview"
Type: dirifempty; Name: "{localappdata}\StellarHub"

[Code]
const
  WebView2Key = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Key32 = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebView2In(Root: Integer; Key: String): Boolean;
var
  V: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0');
end;

{ Microsoft's documented check: the runtime's version under EdgeUpdate, per machine or per user }
function NeedsWebView2: Boolean;
begin
  Result := not (HasWebView2In(HKLM, WebView2Key32) or HasWebView2In(HKLM, WebView2Key) or
                 HasWebView2In(HKCU, WebView2Key));
end;

{ before copying files, politely ask a running StellarHub to close (it saves its settings on the way out) }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  Exe: String;
begin
  Result := '';
  Exe := ExpandConstant('{app}\{#AppExe}');
  if FileExists(Exe) then
    Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ the ready page is skipped, so the tasks page is the last step before installing: say so on the button }
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpSelectTasks then
    WizardForm.NextButton.Caption := SetupMessage(msgButtonInstall);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant('{userappdata}\StellarHub');
    if DirExists(Data) and not UninstallSilent then
      if MsgBox('Also remove your StellarHub settings and Autopilot history?' + #13#10#13#10 +
                'Choose No to keep them for a future installation.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Data, True, True, True);
  end;
end;
