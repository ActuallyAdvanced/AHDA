@echo off
:: ANSI color codes are not natively supported in Windows Command Prompt. 
:: However, you can use external tools or Windows Terminal for similar effects.

:: Clear the screen
cls

:: Print the header
echo ╔════════════════════════════════════════════╗
echo ║            Client Setup and Execution      ║
echo ╚════════════════════════════════════════════╝

:: Function to check if a file exists (no direct function for command existence in .bat)
if not exist "Client\config\config.json" (
    echo Server configuration not found!
    echo Please enter the server domain (eg. https://server.domain.com):
    set /p server_domain=
    echo Please enter a password:
    set /p password=
    echo Writing to config.json...
    
    :: Create config directory if it doesn't exist
    if not exist "Client\config" mkdir "Client\config"
    
    :: Write to config.json using echo with proper escaping
    (
        echo {
        echo     "server_url": "%server_domain%",
        echo     "client_password": "%password%"
        echo }
    ) > "Client\config\config.json"

    exit /b 1
)

:: Install Python dependencies
echo Creating Python virtual environment...
python -m venv Client\venv
call Client\venv\Scripts\activate.bat
pip install -r Client\requirements.txt

:: Start client
echo Starting Client...
cd Client
call venv\Scripts\activate.bat
start python main.py

:: Wait for the client process (Windows batch lacks direct process wait)
echo Press any key to stop the client.
pause
taskkill /IM python.exe /F >nul 2>&1

:: Cleanup
exit /b 0
