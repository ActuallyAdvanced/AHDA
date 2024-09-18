
### Server & Tunnel Setup Guide 🌐

Currently, the official server is not yet available. This feature will be added in a future update. For now, follow these steps to set up your own server and tunnel:

---

### 1. Download & Setup the Server 📁
1. **Download the Server**:  
   Get the `server` folder from the source code and place it in a suitable location.
   
2. **Navigate**:  
   Open a terminal or file explorer and navigate to the `server` folder.

---

### 2. Tunnel Setup (NGROK) 🌍

1. **Register on NGROK**:  
   Sign up and obtain your [NGROK API Token](https://dashboard.ngrok.com/get-started/your-authtoken).
   
2. **Get a Static Domain**:  
   Acquire a static [NGROK Domain](https://dashboard.ngrok.com/cloud-edge/domains) for your tunnel.
   
3. **Update Client Config**:  
   Paste the static domain into the `config.json` file inside the server folder.

4. **Edit the Tunnel Script**:  
   Open `starttunnel.bat` in a text editor and replace the placeholders with your NGROK API key and domain:
   ```bash
   set "NGROK_API_KEY=APIKEY"
   set "STATIC_NGROK_DOMAIN=DOMAIN"
   ```

5. **Start the Tunnel**:  
   Run the `starttunnel.bat` script every time **before** starting the main server to activate the tunnel.

---

### 3. Server Setup ⚙️
1. **Install Node.js**:  
   Ensure **Node.js** is installed on your machine.
   
2. **Install Dependencies**:  
   Run `install.bat` inside the `server` folder to install all required packages.

3. **Update Config**:
   Open the `config.json` file inside the server folder and update it to your needs
   
3. **Start the Server**:  
   Launch the server by running `start.bat`.
