; AlfaPOS Kurye Takip - Inno Setup 6 ile kurulum programi uretir.
; Node.js/cloudflared/sqlcmd gerekiyorsa otomatik kurar, SQL+yonetici telefon
; bilgilerini sihirbazla alir, iki Windows servisi (sunucu + kendi tuneli) kurar.
#define AppName "AlfaPOS Kurye Takip"
#define AppVersion "1.0.0"
#define AppPublisher "AlfaPOS"
#define AppExeName "AlfaPOSKuryeTakip"

[Setup]
AppId={{B7A1E9C3-4F2D-4A8E-9C6B-KURYETAKIP001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\AlfaPOS\KuryeTakip
OutputDir=dist
OutputBaseFilename=AlfaPOSKuryeTakipSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
SetupIconFile=assets\alfapos.ico
UninstallDisplayIcon={app}\assets\alfapos.ico

[Files]
Source: "server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "sql.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "sambapos.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "auth.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "db.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "poll.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "ws.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "whatsapp.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "tunnel-watch.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-requirements.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-services.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "remove-services.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "show-tunnel-link.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\AlfaPOS Kurye Yönetim"; Filename: "http://127.0.0.1:{code:GetPort}/admin"; IconFilename: "{app}\assets\alfapos.ico"
Name: "{group}\AlfaPOS Kurye Yönetim"; Filename: "http://127.0.0.1:{code:GetPort}/admin"; IconFilename: "{app}\assets\alfapos.ico"
Name: "{group}\Servisleri Yeniden Kur"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-services.ps1"""; IconFilename: "{app}\assets\alfapos.ico"
Name: "{group}\Servisleri Durdur"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\remove-services.ps1"""; IconFilename: "{app}\assets\alfapos.ico"

[Run]
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""AlfaPOS Kurye Takip"" dir=in action=allow protocol=TCP localport={code:GetPort}"; Flags: runhidden; StatusMsg: "Güvenlik duvarı kuralı ekleniyor..."
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-requirements.ps1"""; StatusMsg: "Gereksinimler kuruluyor (Node.js, cloudflared, sqlcmd)..."; Flags: waituntilterminated runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-services.ps1"""; StatusMsg: "Servisler kuruluyor ve başlatılıyor..."; Flags: waituntilterminated
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\show-tunnel-link.ps1"""; Description: "Erişim linkini göster"; Flags: postinstall skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\remove-services.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveServices"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AlfaPOS Kurye Takip"""; Flags: runhidden; RunOnceId: "DelFwRule"

[Code]
var
  DBPage: TInputQueryWizardPage;

function GetPort(Param: String): String;
begin
  Result := '4021';
end;

procedure InitializeWizard;
begin
  DBPage := CreateInputQueryPage(wpSelectDir,
    'SQL Server ve Yönetici Bilgileri',
    'SambaPOS veritabanı bağlantısı ve yönetici telefon numarası',
    'Bu bilgiler kurulum sonunda config.json dosyasına otomatik yazılacak. ' +
    'SQL kullanıcı adı/şifresi boş bırakılırsa Windows kimlik doğrulama kullanılır.');
  DBPage.Add('SQL Server adresi  (ör: DESKTOP-ADI veya localhost):', False);
  DBPage.Add('Veritabanı adı:', False);
  DBPage.Add('SQL kullanıcı adı  (boş = Windows kimlik doğrulama):', False);
  DBPage.Add('SQL şifresi:', True);
  DBPage.Add('Yönetici (patron) telefon numarası  (ör: 05XX XXX XX XX):', False);

  DBPage.Values[0] := 'localhost';
  DBPage.Values[1] := 'SAMBAPOS5';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (PageID = DBPage.ID) and FileExists(ExpandConstant('{app}\config.json')) then
    Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = DBPage.ID then
  begin
    if Trim(DBPage.Values[0]) = '' then
    begin
      MsgBox('SQL sunucu adresi boş bırakılamaz.', mbError, MB_OK);
      Result := False;
    end
    else if Trim(DBPage.Values[1]) = '' then
    begin
      MsgBox('Veritabanı adı boş bırakılamaz.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath, JsonContent, ManagerPhone: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\config.json');
    if not FileExists(ConfigPath) then
    begin
      ManagerPhone := Trim(DBPage.Values[4]);
    StringChangeEx(ManagerPhone, ' ', '', True);
      JsonContent :=
        '{' + #13#10 +
        '  "appName": "AlfaPOS Kurye Takip",' + #13#10 +
        '  "server": "' + JsonEscape(DBPage.Values[0]) + '",' + #13#10 +
        '  "database": "' + JsonEscape(DBPage.Values[1]) + '",' + #13#10 +
        '  "user": "' + JsonEscape(DBPage.Values[2]) + '",' + #13#10 +
        '  "password": "' + JsonEscape(DBPage.Values[3]) + '",' + #13#10 +
        '  "options": {' + #13#10 +
        '    "encrypt": false,' + #13#10 +
        '    "trustServerCertificate": true' + #13#10 +
        '  },' + #13#10 +
        '  "port": 4021,' + #13#10 +
        '  "managerPhone": "' + JsonEscape(ManagerPhone) + '",' + #13#10 +
        '  "whatsappApiUrl": "http://localhost:3055"' + #13#10 +
        '}';
      SaveStringToFile(ConfigPath, JsonContent, False);
    end;
  end;
end;
