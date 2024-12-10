import socketio
import platform
import uuid
import re
import sys
import traceback
from io import StringIO
import contextlib
import pyautogui
import base64
import io
from PIL import Image
import argparse
import json
import os
import psutil
import qrcode
from urllib.parse import urljoin, urlencode
from qrcode.main import QRCode
import time
import speedtest
import getpass

sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=1, reconnection_delay_max=5)

@contextlib.contextmanager
def capture_output():
    """Capture stdout and stderr"""
    new_out, new_err = StringIO(), StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    try:
        sys.stdout, sys.stderr = new_out, new_err
        yield sys.stdout, sys.stderr
    finally:
        sys.stdout, sys.stderr = old_out, old_err

def generate_client_id():
    """Generate a unique client ID based on system information"""
    system_info = platform.node() + platform.processor() + platform.machine()
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, system_info))

CLIENT_ID = generate_client_id()

def extract_python_code(response):
    """Extract Python code from various possible formats"""
    patterns = [
        r'```python\s*(.*?)\s*```',  # Standard markdown Python code blocks
        r'```\s*(.*?)\s*```',        # Generic code blocks
        r'---EXECUTE_CODE---\s*(.*?)\s*---END_CODE---',  # Legacy format
        r'`(.*?)`'                   # Inline code blocks
    ]
    for pattern in patterns:
        matches = re.findall(pattern, response, re.DOTALL)
        if matches:
            return matches[0].strip()
    return None

def handle_screen_capture_and_continue(code_parts, globals_dict, locals_dict):
    """Handle screen capture and continue code execution"""
    # Execute the first part
    if code_parts[0].strip():
        safe_exec(code_parts[0], globals_dict, locals_dict)
    
    # Capture screen and send to AI
    screen_image = capture_screen()
    if screen_image:
        print("Screen capture successful, sending to AI...")
        sio.emit('screen_capture_response', {
            'clientId': CLIENT_ID,
            'image': screen_image,
            'originalMessage': 'Continuing execution...',
            'remainingCode': code_parts[1] if len(code_parts) > 1 else ''
        })
    else:
        print("Screen capture failed")



def safe_exec(code, globals_dict=None, locals_dict=None):
    """Safely execute Python code with error handling"""
    if globals_dict is None:
        globals_dict = {
            '__builtins__': __builtins__,
            'print': print
        }
    
    # Check for screen capture placeholder
    if '###CAPTURE_SCREEN###' in code:
        code_parts = code.split('###CAPTURE_SCREEN###')
        handle_screen_capture_and_continue(code_parts, globals_dict, locals_dict)
        return
        
    with capture_output() as (out, err):
        try:
            exec(code, globals_dict, locals_dict)
            output = out.getvalue()
            error = err.getvalue()
            if output or error:
                result = {
                    'output': output,
                    'error': error,
                    'success': True,
                    'type': 'output',
                    "clientId": CLIENT_ID
                }
                sio.emit('execution_result', result)
        except Exception as e:
            error = f"Error: {str(e)}\nTraceback:\n{traceback.format_exc()}"
            result = {
                'output': '',
                'error': error,
                'success': False,
                'type': 'error',
                "clientId": CLIENT_ID
            }
            sio.emit('execution_result', result)

def get_system_info():
    """Get basic system information"""
    return {'os': platform.system()}

@sio.event
def connect():
    """Handle connection to the server"""
    system_info = get_system_info()
    print(f'Connected to server. Client ID: {CLIENT_ID}')

@sio.event
def disconnect():
    """Handle disconnection from the server"""
    print('Disconnected from server')

def capture_screen():
    """Capture screen and convert to base64"""
    try:
        screenshot = pyautogui.screenshot()
        buffered = io.BytesIO()
        # Save with reduced quality to minimize file size while keeping text readable
        screenshot.save(buffered, format="PNG", optimize=True, quality=30)
        img_str = base64.b64encode(buffered.getvalue()).decode()
        return img_str
    except Exception as e:
        print(f"Screen capture failed: {e}")
        return None

@sio.on('request_screen_capture')
def handle_screen_capture_request(data):
    """Handle screen capture request from server"""
    print("Capturing screen for AI analysis...")
    screen_image = capture_screen()
    if screen_image:
        print("Screen capture successful, sending to AI...")
        sio.emit('screen_capture_response', {
            'clientId': CLIENT_ID,
            'image': screen_image,
            'originalMessage': data['message']
        })
    else:
        print("Screen capture failed.")

@sio.on('execute_command')
def handle_command(response):
    """Handle commands received from the server"""
    print("\nReceived response from AI:", response)
    
    code = extract_python_code(response)
    if code:
        print("\nExtracted code to execute:")
        print("-" * 40)
        print(code)
        print("-" * 40)
        safe_exec(code)
    else:
        print("No executable code found in response")

def load_config():
    """Load configuration from config file"""
    config_path = os.path.join(os.path.dirname(__file__), 'config', 'config.json')
    print(f"Looking for config file at: {config_path}")  # Debug line
    if os.path.exists(config_path):
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
                print(f"Loaded config: {config}")  # Debug line
                return config
        except Exception as e:
            print(f"Error loading config: {e}")
    else:
        print("Config file not found")  # Debug line
    return {}

def save_config(config_data):
    """Save configuration to config file"""
    config_path = os.path.join(os.path.dirname(__file__), 'config', 'config.json')
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    try:
        with open(config_path, 'w') as f:
            json.dump(config_data, f, indent=4)
    except Exception as e:
        print(f"Error saving config: {e}")

def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='AHDA Client')
    parser.add_argument('--url', help='Server URL (e.g., http://localhost:3000)')
    return parser.parse_args()

def get_server_url():
    """Get server URL from arguments or config"""
    args = parse_arguments()
    config = load_config()
    
    # Priority: 1. Command line argument, 2. Config file, 3. Default value
    return args.url or config.get('server_url') or 'http://localhost:3000'

def get_system_resources():
    """Get current system resource usage"""
    cpu = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory().percent
    disk = psutil.disk_usage('/').percent
    
    # Add battery info to system resources
    battery_info = get_battery_info()
    
    return {
        'clientId': CLIENT_ID,
        'cpu_percent': cpu,
        'memory_percent': memory,
        'disk_percent': disk,
        'battery': battery_info  # Include battery info
    }

def get_battery_info():
    """Get battery information"""
    try:
        battery = psutil.sensors_battery()
        if battery:
            return {
                'level': round(battery.percent),
                'charging': battery.power_plugged
            }
        return {
            'level': 'N/A',
            'charging': False
        }
    except Exception as e:
        print(f"Battery info error: {e}")
        return {
            'level': 'N/A',
            'charging': False
        }

def emit_system_resources():
    """Emit system resource usage to server"""
    try:
        resources = get_system_resources()
        resources['clientId'] = CLIENT_ID  # Add client ID to resources
        sio.emit('system_resources', resources)
        
        # Also emit battery info with client ID
        battery_info = resources['battery']
        battery_info['clientId'] = CLIENT_ID
        sio.emit('battery_info', battery_info)
    except Exception as e:
        print(f"Error sending resource update: {e}")

def generate_qr_code(server_url, client_id):
    """Generate QR code and display it in the console"""
    try:
        # Create URL with client ID parameter
        params = {'client': client_id}
        full_url = f"{server_url}?{urlencode(params)}"
        
        # Create QR code
        qr = QRCode()
        qr.add_data(full_url)
        qr.make()
        
        # Print QR code to console
        print("\nScan this QR code to connect directly:")
        qr.print_ascii()
        print(f"\nOr use this URL: {full_url}")
            
    except Exception as e:
        print(f"Error generating QR code: {e}")

def start_heartbeat():
    """Start the heartbeat loop in a separate thread"""
    while True:
        try:
            if sio.connected:
                sio.emit('heartbeat', {'clientId': CLIENT_ID})
                # Emit system resources along with heartbeat
                emit_system_resources()
            time.sleep(5)  # Send heartbeat every 5 seconds
        except Exception as e:
            print(f"Heartbeat error: {e}")
            time.sleep(1)  # Brief pause before retry

# Make sure this is running in a separate thread
import threading
heartbeat_thread = threading.Thread(target=start_heartbeat, daemon=True)
heartbeat_thread.start()

@sio.event
def connect_error(error):
    """Handle connection error"""
    print(f"Connection error: {error}")
    
@sio.event
def reconnect(attempt_number):
    """Handle reconnection"""
    print(f"Reconnecting... (attempt {attempt_number})")
    if sio.connected:
        sio.emit('register_client', {
            'clientId': CLIENT_ID,
            'systemInfo': get_system_info()
        })

@sio.on('request_network_speed')
def handle_network_speed_request():
    try:
        st = speedtest.Speedtest()
        print("Starting speed test...")
        download = round(st.download() / 1_000_000, 2)  # Convert to Mbps
        upload = round(st.upload() / 1_000_000, 2)  # Convert to Mbps
        ping = round(st.results.ping, 2)

        print(f"Speed test results: Download: {download} Mbps, Upload: {upload} Mbps, Ping: {ping} ms")
        
        sio.emit('network_speed_result', {
            'clientId': CLIENT_ID,
            'download': download,
            'upload': upload,
            'ping': ping
        })
    except Exception as e:
        print(f"Speed test error: {e}")
        sio.emit('network_speed_result', {
            'clientId': CLIENT_ID,
            'error': str(e)
        })

@sio.on('get_battery_info')
def handle_battery_info():
    """Handle battery info request"""
    battery_info = get_battery_info()
    sio.emit('battery_info', battery_info)

def ensure_config_directory():
    """Ensure config directory exists with correct permissions"""
    config_dir = os.path.join(os.path.dirname(__file__), 'config')
    if not os.path.exists(config_dir):
        os.makedirs(config_dir, exist_ok=True)
        print(f"Created config directory at: {config_dir}")
    return config_dir


def main():
    """Main function to connect to the server and start listening for commands"""
    import threading
    
    ensure_config_directory()
    
    while True:
        try:
            if sio.connected:
                sio.disconnect()
                time.sleep(1)

            server_url = get_server_url()
            print(f"Connecting to server at: {server_url}")
            
            # Load existing config
            config = load_config()
            
            # Check for existing password
            existing_password = config.get('client_password')
            if existing_password:
                print("Using saved password from config")
                password = existing_password
            else:
                # Ask for password during setup, password is required
                password = getpass.getpass("Enter a password for client authentication: ")
                if password:
                    # Save password to config
                    config['client_password'] = password
                    save_config(config)
                    print("Password saved to config")
                else:
                    print("No password provided, exiting")
                    exit()

            
            sio.connect(server_url, wait_timeout=10)
            print(f"Your Client ID is: {CLIENT_ID}")
            
            # Register with password if provided
            register_data = {
                'clientId': CLIENT_ID,
                'systemInfo': get_system_info()
            }
            if password:
                register_data['password'] = password
                print("Password protection enabled")
            
            sio.emit('register_client', register_data)
            
            # Start heartbeat in separate thread
            heartbeat_thread = threading.Thread(target=start_heartbeat, daemon=True)
            heartbeat_thread.start()
            
            # Generate QR code after successful connection
            generate_qr_code(server_url, CLIENT_ID)
            
            print("\nWaiting for commands...")
            
            while True:
                if not sio.connected:
                    raise Exception("Socket disconnected")
                sio.sleep(1)
                
        except Exception as e:
            print(f"Connection error: {e}")
            print("Attempting to reconnect in 5 seconds...")
            time.sleep(5)

if __name__ == '__main__':
    main()
