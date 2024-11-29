@echo off
:: ANSI color codes are not natively supported in Windows Command Prompt. 
:: For better output, use Windows Terminal or tools like PowerShell.

:: Clear the screen
cls

:: Print the header
echo ╔════════════════════════════════════════════╗
echo ║         Server Setup and Execution         ║
echo ╚════════════════════════════════════════════╝

:: Load existing configuration and restart ngrok if valid
setlocal enabledelayedexpansion
set "config_file=Client\config\config.json"

if exist "!config_file!" (
    for /f "delims=" %%i in ('jq -r ".server_url" "!config_file!"') do set "static_domain=%%i"
    echo Found existing static domain in config: !static_domain!
    taskkill /IM ngrok.exe /F >nul 2>&1
    del ngrok.log >nul 2>&1
    start /B ngrok http --domain=!static_domain:~8! 3000 --log=ngrok.log >nul
    timeout /t 10 >nul
    findstr "command failed" ngrok.log >nul && (
        echo Failed to restart ngrok with static domain.
    ) || (
        echo Ngrok restarted successfully with domain: !static_domain!
        set "NGROK_URL=!static_domain!"
        goto ngrok_setup_done
    )
)

:: Function to setup ngrok
:setup_ngrok
echo Setting up ngrok...
taskkill /IM ngrok.exe /F >nul 2>&1
del ngrok.log >nul 2>&1

if not exist ".\ngrok.exe" (
    echo Downloading ngrok...
    powershell -Command "& { iwr -Uri https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip -OutFile ngrok.zip }"
    powershell -Command "& { Expand-Archive -Path ngrok.zip -DestinationPath . -Force }"
    del ngrok.zip
)

ngrok config check >nul 2>&1
if errorlevel 1 (
    echo Please enter your ngrok authtoken:
    set /p authtoken=
    ngrok config add-authtoken !authtoken!
)

echo Would you like to use a static domain? (y/n)
set /p use_static=
if /i "!use_static!"=="y" (
    echo Please enter your static domain (e.g., your-domain.ngrok.io):
    set /p static_domain=
    start /B ngrok http --domain=!static_domain! 3000 --log=ngrok.log >nul
    set "ngrok_url=https://!static_domain!"
) else (
    start /B ngrok http 3000 --log=ngrok.log >nul
    timeout /t 10 >nul
    for /f "delims=" %%i in ('powershell -Command "& { (Invoke-RestMethod http://localhost:4040/api/tunnels).tunnels[0].public_url }"') do set "ngrok_url=%%i"
)

if "!ngrok_url!"=="" (
    echo Failed to establish ngrok tunnel.
    exit /b 1
)

echo Ngrok tunnel established at: !ngrok_url!
set "NGROK_URL=!ngrok_url!"

mkdir Client\config >nul 2>&1
echo {"server_url": "!NGROK_URL!"} > Client\config\config.json
echo Saved ngrok URL to Client\config\config.json
:ngrok_setup_done

:: Server setup
cd Server
if not exist ".env" (
    echo Creating .env file...
    echo Please enter your OpenAI API key:
    set /p api_key=
    echo OPENAI_API_KEY=!api_key! > .env
)
npm install
cd ..

:: Start server
echo Starting Server...
cd Server
start /B node index.js
cd ..

pause
exit /b 0
