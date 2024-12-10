@echo off
REM ANSI color codes are not natively supported in cmd; using plain text or alternative methods.
REM Clearing the screen
cls

echo Client Setup and Execution
REM Check if Python is installed
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not installed. Please install Python and try again.
    exit /b 1
)


REM Check if config.json exists
if not exist Client\config\config.json (
    echo Server configuration not found!
    set /p server_domain=Please enter the server domain (e.g., https://server.domain.com):
    set /p password=Please enter a password:

    echo Writing to config.json...
    mkdir Client\config >nul 2>&1
    echo { > Client\config\config.json
    echo     "server_url": "%server_domain%", >> Client\config\config.json
    echo     "client_password": "%password%" >> Client\config\config.json
    echo } >> Client\config\config.json
)

REM Install Python dependencies
echo Creating Python virtual environment...
python -m venv Client\venv
if %errorlevel% neq 0 (
    echo Failed to create virtual environment. Ensure Python is installed and try again.
    exit /b 1
)

call Client\venv\Scripts\activate
if %errorlevel% neq 0 (
    echo Failed to activate the virtual environment.
    exit /b 1
)

pip install -r Client\requirements.txt
if %errorlevel% neq 0 (
    echo Failed to install dependencies. Check the requirements.txt file and try again.
    exit /b 1
)

REM Start the client
echo Starting Client...
cd Client
call venv\Scripts\activate
start /b python main.py

REM Wait for user to terminate the script
echo Press Ctrl+C to terminate the Client.
:loop
timeout /t 1 >nul
goto loop
