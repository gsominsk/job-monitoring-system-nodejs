@echo off
REM Dummy process for Windows
REM Simulates a C++ process with random failures

REM Parse arguments
set JOB_NAME=%1
shift
set ARGS=%*

REM Generate random number (0-99) using built-in %RANDOM% variable
set /a RANDOM_NUM=%RANDOM% %% 100

REM Simulate work (100-500ms)
set /a SLEEP_MS=(%RANDOM% %% 401) + 100
powershell -Command "Start-Sleep -Milliseconds %SLEEP_MS%"

REM 20%% failure rate
if %RANDOM_NUM% LSS 20 (
  echo Process failed: %JOB_NAME% with args: %ARGS% 1>&2
  exit /b 1
) else (
  echo Process succeeded: %JOB_NAME% with args: %ARGS%
  exit /b 0
)
