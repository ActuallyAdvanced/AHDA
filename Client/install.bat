@echo off
:: Check if Python is installed
python --version
IF %ERRORLEVEL% NEQ 0 (
    echo Python is not installed. Please install Python first.
    exit /b
)

:: Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

:: Install required packages
echo Installing required packages...
pip install socketio qrcode pyautogui pytesseract opencv-python numpy websockets asyncio json5 psutil pywin32 keyboard ics

echo Installation complete!
pause
