Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\project-root - copia\startup-plataforma.ps1""", 0, False
Set WshShell = Nothing
