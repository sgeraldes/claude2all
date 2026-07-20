@echo off
rem claude2personal - thin shim for cmd/PowerShell: delegates to the Git Bash wrapper.
"C:\Program Files\Git\bin\bash.exe" -l "%USERPROFILE%\.local\bin\claude2personal" %*
