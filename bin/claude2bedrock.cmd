@echo off
rem claude2bedrock - thin shim for cmd/PowerShell: delegates to the Git Bash
rem wrapper of the same name (consistent with claude2kimi / claude2kiro).
"C:\Program Files\Git\bin\bash.exe" -l "%USERPROFILE%\.local\bin\claude2bedrock" %*
