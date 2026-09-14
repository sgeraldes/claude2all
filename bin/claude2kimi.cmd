@echo off
rem claude2kimi - thin shim for cmd/PowerShell: delegates to the Git Bash
rem wrapper of the same name. claude.exe on this machine re-execs itself via
rem `bash -c claude` when launched from cmd/PowerShell (fails: "claude: command
rem not found"), so all launches must go through real Git Bash.
"C:\Program Files\Git\bin\bash.exe" "%~dp0claude2kimi" %*
