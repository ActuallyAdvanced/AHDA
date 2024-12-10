let serverStatusBool = false;
let clientStatusBool = false;
let currentClientPassword = '';
let clientRequiresAuth = false;
let initialAuthentificationSuccess = false;

const savedLanguage = localStorage.getItem('speech-language') || 'en-US';
const tts = initializeTextToSpeech();

const savedManualInput = localStorage.getItem('mobile-manual-input') || 'disabled';

const socket = io();
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const clientIdInput = document.getElementById('client-id');
const serverStatus = document.getElementById('server-status');
const clientStatus = document.getElementById('client-status');

// Status handling
socket.on('connect', () => {
    serverStatus.classList.add('online');
    serverStatusBool = true;
    dismissNotification("disconnect");
});

socket.on('disconnect', () => {
    serverStatus.classList.remove('online');
    clientStatus.classList.remove('online');
    showNotification("Disconnected", "disconnect");
    console.log("Disconnected from server");
    serverStatusBool = false;
});

// Add these helper functions if not already present
function getSavedPassword(clientId) {
    const passwords = JSON.parse(localStorage.getItem('client-passwords') || '{}');
    return passwords[clientId];
}

function getFromQueryParams(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}


document.addEventListener('DOMContentLoaded', () => {
    if (getFromQueryParams('client')) {
        clientIdInput.value = getFromQueryParams('client');
    } else {

        const clientId = prompt('Please enter the client ID:');
        if (clientId) {
            clientIdInput.value = clientId;
        }
    }
});

socket.on('connect', () => {
    console.log("Checking if auth is required");

    socket.emit('check_if_auth_required', {
        clientId: clientIdInput.value.trim()
    });
    socket.once('auth_required_response', (data) => {
        console.log("Auth required response: ");
        console.log(data);

        if (data.no_client) {
            showNotification("Client not found", "auth");
            return;
        }

        updateLastCommunication();
        if (data.requiresAuth) {
            const savedPassword = getSavedPassword(clientIdInput.value.trim());
            console.log("saved password: " + savedPassword);
            if (!savedPassword) {
                promptForPassword(clientIdInput.value.trim());
            } else {
                console.log("Authenticating client with password: " + savedPassword);
                socket.emit('authenticate_client', {
                    clientId: clientIdInput.value.trim(),
                    password: savedPassword
                });
            }



        }
    });


});

// Frontend: Handle 'client_status' event
socket.on('client_status', (data) => {
    updateLastCommunication();
    const targetClientId = clientIdInput.value.trim();

    if (data.clientId === targetClientId) {
        if (data.connected) {
            initialAuthentificationSuccess = true;
            dismissNotification("auth");

            clientStatus.classList.add('online');
            clientStatusBool = true;
            clientRequiresAuth = data.requiresAuth;
            console.log('Client connected:', data.clientId);

            // If authentication is required, only prompt once
            if (data.requiresAuth && !currentClientPassword) {
                const savedPassword = getSavedPassword(targetClientId);
                if (savedPassword) {
                    currentClientPassword = savedPassword;
                    authenticateClient(targetClientId, savedPassword);

                } else {
                    promptForPassword(targetClientId);
                }
            }
        } else {
            clientStatus.classList.remove('online');
            clientStatusBool = false;
            console.log('Client disconnected:', data.clientId);
        }
    }
});


function authenticateClient(clientId, password) {
    socket.emit('authenticate_client', {
        clientId: clientId,
        password: password
    });
}

let authFailedCount = 0;
socket.on('auth_response', (data) => {
    updateLastCommunication();
    const targetClientId = clientIdInput.value.trim();
    if (data.success) {
        console.log('Authentication successful');
        saveClientPassword(targetClientId, currentClientPassword);

    } else {
        authFailedCount++;
        showNotification('Authentication failed: ' + (data.error || 'Invalid password') + ". Retrying...", 'auth', 1000);
        //if authFailedCount is under 3, try authing again. else ask for password again
        if (authFailedCount < 4) {
            console.log("Retrying authentication");

            socket.emit('authenticate_client', {
                clientId: targetClientId,
                password: currentClientPassword
            });
        } else {
            showNotification('Authentication failed too many times. Please try again later.', 'auth', 1000);
            promptForPassword(targetClientId);
        }
    }
});

function appendMessage(message, type = 'user') {
    // Guard against undefined or null messages
    if (!message) {
        console.warn('Attempted to append undefined or null message');
        return;
    }

    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;

    // Strip out code blocks for display and TTS
    let displayMessage = message;
    if (type === 'ai' || type === 'analysis') {
        const parts = message.split('```');
        displayMessage = parts[0].trim();
        if (parts.length > 2) {
            displayMessage += ' ' + parts[parts.length - 1].trim();
        }
        if (displayMessage === '') {
            displayMessage = '<em>[CODE]</em>';
        }
    }

    // Handle bold text (words between **)
    displayMessage = displayMessage.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    messageElement.innerHTML = displayMessage;

    // Append to both desktop and mobile message containers
    const desktopMessages = document.getElementById('messages');
    const mobileMessages = document.getElementById('mobile-messages');
    const chatIsland = document.getElementById('chat-island');

    if (desktopMessages) {
        const desktopElement = messageElement.cloneNode(true);
        desktopMessages.appendChild(desktopElement);
        desktopMessages.scrollTop = desktopMessages.scrollHeight;
        if (chatIsland) {
            const chatContent = chatIsland.querySelector('.island-content');
            if (chatContent) {
                chatContent.scrollTop = chatContent.scrollHeight;
            }
        }
    }

    if (mobileMessages) {
        const mobileElement = messageElement.cloneNode(true);
        mobileMessages.appendChild(mobileElement);

        // Ensure smooth scrolling to bottom
        requestAnimationFrame(() => {
            mobileMessages.scrollTo({
                top: mobileMessages.scrollHeight,
                behavior: 'smooth'
            });
            // Also scroll the parent container
            const mobileChat = document.querySelector('.mobile-chat');
            if (mobileChat) {
                mobileChat.scrollTo({
                    top: mobileChat.scrollHeight,
                    behavior: 'smooth'
                });
            }
        });
    }
}

socket.on('chat_sync', (data) => {
    updateLastCommunication();
    // Clear both containers once before the loop
    const desktopMessages = document.getElementById('messages');
    const mobileMessages = document.getElementById('mobile-messages');

    if (desktopMessages) desktopMessages.innerHTML = '';
    if (mobileMessages) mobileMessages.innerHTML = '';

    if (data.messages) {
        data.messages.forEach(message => {
            appendMessage(message.content, message.type);
        });
    }

});

// Add at the top with other variables
let lastCommTime = null;

setInterval(() => {
    updateLastCommunication(false);
}, 1000);

// Add this function
function updateLastCommunication(update = true) {
    const lastCommSpan = document.getElementById('last-comm-time');

    if (update) lastCommTime = new Date();

    if (!lastCommSpan) return;


    const now = new Date();
    const diff = now - lastCommTime;

    let timeString;
    if (diff < 5000) { // less than 1 minute
        timeString = 'Just now';
        lastCommSpan.style.color = "green";
    } else if (diff < 60000) { // less than 1 minute
        const seconds = Math.floor(diff / 1000);
        timeString = `${seconds}s ago`;
        lastCommSpan.style.color = "green";
    } else if (diff < 3600000) { // less than 1 hour
        const minutes = Math.floor(diff / 60000);
        timeString = `${minutes}m ago`;
        lastCommSpan.style.color = "orange";
    } else if (diff < 86400000) { // less than 1 day
        const hours = Math.floor(diff / 3600000);
        timeString = `${hours}h ago`;
        lastCommSpan.style.color = "red";
    } else {
        const days = Math.floor(diff / 86400000);
        timeString = `${days}d ago`;
        lastCommSpan.style.color = "red";
    }

    lastCommSpan.textContent = timeString;
}

// Update the socket.on('gpt response') handler
socket.on('gpt response', (data) => {
    if (!data || (!data.message && !data.error)) {
        console.log(currentClientPassword);
        console.warn('Received invalid GPT response:', data);
        return;
    }

    // Check if there's an existing streaming message
    const streamingMessage = document.querySelector('.message.streaming');
    if (streamingMessage) {
        // If there's a streaming message, wait for it to complete
        return;
    }

    const message = data.message || data.error;
    const type = data.type || (data.error ? 'error' : 'ai');
    appendMessage(message, type);
    updateLastCommunication();
});

// Load saved client ID from cookie
document.addEventListener('DOMContentLoaded', () => {

    updateBatteryInfo(); // Initial battery update
});

function setCookie(name, value, days = 365) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

function sendMessage() {
    if (!serverStatusBool) {
        appendMessage('❌ Server is offline', 'error');
        return;
    }
    if (!clientStatusBool) {
        appendMessage('❌ Client is offline', 'warning');
        return;
    }

    const message = messageInput.value || document.getElementById('mobile-message-input').value;
    const targetClientId = clientIdInput.value.trim();

    if (clientRequiresAuth && !currentClientPassword) {
        const savedPassword = getSavedPassword(targetClientId);
        if (savedPassword) {
            currentClientPassword = savedPassword;
        } else {
            promptForPassword(targetClientId);
            return;
        }
    }

    if (message.trim()) {

        socket.emit('chat message', {
            message: message,
            targetClientId: targetClientId,
            password: currentClientPassword
        });

        appendMessage('You: ' + message);

        messageInput.value = '';
        const mobileInput = document.getElementById('mobile-message-input');
        if (mobileInput) mobileInput.value = '';
    }
}

socket.on('execution_output', (data) => {
    updateLastCommunication();
    const prefix = data.type === 'error' ? '❌ Error: ' : '📤 Output: ';
    const messageClass = data.type === 'error' ? 'error-message' : 'output-message';
    appendMessage(`${prefix}${data.content}`, messageClass);
});


// Add this function after the appendMessage function
function appendStreamingMessage(content, type = 'ai') {
    // Check if there's already a streaming message in desktop view
    let desktopElement = document.querySelector('#messages .message.streaming');
    let mobileElement = document.querySelector('#mobile-messages .message.streaming');

    // Create elements only if they don't exist
    if (!desktopElement) {
        desktopElement = document.createElement('div');
        desktopElement.className = `message ${type} streaming`;
        messagesDiv.appendChild(desktopElement);
    }

    if (!mobileElement) {
        mobileElement = document.createElement('div');
        mobileElement.className = `message ${type} streaming`;
        document.getElementById('mobile-messages').appendChild(mobileElement);
    }

    // Update content by appending the new content without replacing existing content
    desktopElement.textContent = (desktopElement.textContent || '').replace(/\.\.\.$/, '') + content;
    mobileElement.textContent = (mobileElement.textContent || '').replace(/\.\.\.$/, '') + content;

    // Add the ellipsis back
    desktopElement.textContent += '...';
    mobileElement.textContent += '...';

    // Scroll both containers and island
    const chatIsland = document.getElementById('chat-island');
    if (chatIsland) {
        const chatContent = chatIsland.querySelector('.island-content');
        if (chatContent) {
            chatContent.scrollTop = chatContent.scrollHeight;
        }
    }

    if (messagesDiv) {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    const mobileMessages = document.getElementById('mobile-messages');
    const mobileChat = document.querySelector('.mobile-chat');
    if (mobileMessages) {
        requestAnimationFrame(() => {
            mobileMessages.scrollTo({
                top: mobileMessages.scrollHeight,
                behavior: 'smooth'
            });
            if (mobileChat) {
                mobileChat.scrollTo({
                    top: mobileChat.scrollHeight,
                    behavior: 'smooth'
                });
            }
        });
    }
}

socket.on('screen_capture_response', (data) => {
    updateLastCommunication();
    if (!data || !data.image) {
        console.error('No image data received');
        return;
    }

    showNotification("Screen capture received", "image", 1000);

    console.log('Received screen capture response');

    const imageIsland = document.getElementById('image-island');
    const mobileImage = document.getElementById('mobile-image');
    const imageIslandImage = document.getElementById('image-island-image');
    const mobileImageImage = document.getElementById('mobile-image-image');

    // For desktop view
    if (imageIsland && imageIslandImage) {
        imageIsland.style.display = 'block';
        imageIslandImage.src = data.image;
        imageIslandImage.style.display = 'block';
        console.log('Updated desktop image');
    }

    // For mobile view
    if (mobileImage && mobileImageImage) {
        mobileImage.style.display = 'block';
        mobileImageImage.src = data.image;
        mobileImageImage.style.display = 'block';
        console.log('Updated mobile image');
    }
});

// Add this socket listener for streaming
socket.on('gpt_stream', (data) => {
    updateLastCommunication();
    appendStreamingMessage(data.content, 'ai');
});

// Update the gpt_stream_end handler
socket.on('gpt_stream_end', (data) => {
    updateLastCommunication();
    let finalMessage = data.finalMessage;

    // Remove the streaming class from the current streaming message
    const streamingDiv = document.querySelector('#messages .message.streaming');
    if (streamingDiv) {
        streamingDiv.classList.remove('streaming');
        streamingDiv.textContent = finalMessage;
    }

    const mobileStreamingDiv = document.querySelector('#mobile-messages .message.streaming');
    if (mobileStreamingDiv) {
        mobileStreamingDiv.classList.remove('streaming');
        mobileStreamingDiv.textContent = finalMessage;
    }

    tts.speak(finalMessage, savedLanguage);
});

// Add at the top of the file with other constants
const ISLAND_DEFAULTS = {
    'greeting': {
        width: 961,
        height: 209,
        minWidth: 250,
        minHeight: 120,
        minimized: false,
        position: { x: -20, y: -20 }
    },
    'status': {
        width: 154,
        height: 40,
        minWidth: 150,
        minHeight: 40,
        minimized: true,
        position: { x: -20, y: 672 }
    },
    'weather': {
        width: 346,
        height: 207,
        minWidth: 250,
        minHeight: 150,
        minimized: false,
        position: { x: 861, y: -20 }
    },
    'chat': {
        width: 398,
        height: 409,
        minWidth: 300,
        minHeight: 400,
        minimized: false,
        position: { x: 788, y: 392 }
    },
    'system': {
        width: 199,
        height: 67,
        minWidth: 190,
        minHeight: 67,
        minimized: true,
        position: { x: -20, y: 738 }
    },
    'microphone': {
        width: 300,
        height: 300,
        minWidth: 300,
        minHeight: 300,
        minimized: false,
        position: { x: -20, y: 222 }
    },
    'image': {
        width: 400,
        height: 300,
        minWidth: 300,
        minHeight: 200,
        minimized: false,
        position: { x: 660, y: 340 }
    },
    'todo': {
        width: 300,
        height: 400,
        minWidth: 250,
        minHeight: 300,
        minimized: true,
        position: { x: 400, y: 20 }
    },
    'notes': {
        width: 300,
        height: 400,
        minWidth: 250,
        minHeight: 300,
        minimized: true,
        position: { x: 400, y: 220 }
    },
    'timer': {
        width: 200,
        height: 150,
        minWidth: 200,
        minHeight: 150,
        minimized: true,
        position: { x: 720, y: 20 }
    },
    'memes': {
        width: 400,
        height: 450,
        minWidth: 300,
        minHeight: 400,
        minimized: true,
        position: { x: 720, y: 220 }
    },
    'quotes': {
        width: 300,
        height: 200,
        minWidth: 250,
        minHeight: 150,
        minimized: true,
        position: { x: 720, y: 420 }
    },
    'network': {
        width: 300,
        height: 200,
        minWidth: 250,
        minHeight: 150,
        minimized: true,
        position: { x: 400, y: 420 }
    },
    'countdown': {
        width: 250,
        height: 150,
        minWidth: 200,
        minHeight: 150,
        minimized: true,
        position: { x: 400, y: 620 }
    },
    'research': {
        width: 350,
        height: 400,
        minWidth: 300,
        minHeight: 300,
        minimized: true,
        position: { x: 400, y: 420 }
    },
    'spotify': {
        width: 300,
        height: 450,
        position: { x: 20, y: 500 }
    }
};

if ('serviceWorker' in navigator) {
    navigator.serviceWorker
        .register('/service-worker.js')
        .then(() => console.log('Service Worker registered'))
        .catch((err) => console.log('Service Worker registration failed:', err));
}

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    if (document.querySelector('#installButton')) {
        // Show a custom install button
        document.querySelector('#installButton').style.display = 'block';

        document.querySelector('#installButton').addEventListener('click', () => {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted the install prompt');
                } else {
                    console.log('User dismissed the install prompt');
                }
                deferredPrompt = null;
            });
        });
    }
});


// Update the initialization code - keep existing interact.js setup
function initializeIslands() {
    document.querySelectorAll('.island').forEach(island => {
        const islandId = island.dataset.islandId;
        const defaults = ISLAND_DEFAULTS[islandId];
        if (!defaults) return;

        // Set minimum dimensions
        if (defaults.minWidth) island.style.minWidth = `${defaults.minWidth}px`;
        if (defaults.minHeight) island.style.minHeight = `${defaults.minHeight}px`;

        // Load saved position or use default
        const savedPosition = loadIslandPosition(islandId);
        const position = savedPosition || defaults.position;

        // Load saved size or use default
        const savedSize = loadIslandSize(islandId);
        const size = savedSize || {
            width: defaults.width,
            height: defaults.height
        };

        // Apply position and size
        island.style.width = `${size.width}px`;
        island.style.height = `${size.height}px`;

        // Use transform to set position
        setTransform(island, position.x, position.y);

        // Store initial position in data attributes
        island.setAttribute('data-x', position.x);
        island.setAttribute('data-y', position.y);

        // Initialize minimize button
        const minimizeBtn = island.querySelector('.minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => toggleMinimize(islandId));
        }

        // Load minimized state
        const isMinimized = loadIslandMinimized(islandId);
        if (isMinimized) {
            island.classList.add('minimized');
            if (minimizeBtn) minimizeBtn.textContent = '+';
        }
    });
}

// Keep all your existing functions (dragMoveListener, createParticle, etc.)

function createParticle(x, y) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.cssText = `
        left: ${x}px;
        top: ${y}px;
        width: ${Math.random() * 8 + 4}px;
        height: ${particle.style.width};
    `;

    document.body.appendChild(particle);

    requestAnimationFrame(() => {
        particle.animate([
            { transform: 'scale(1)', opacity: 0.6 },
            { transform: 'scale(0)', opacity: 0 }
        ], {
            duration: 400,
            easing: 'ease-out'
        }).onfinish = () => particle.remove();
    });
}

function setTransform(element, x, y) {
    // Ensure numbers and prevent NaN
    x = parseFloat(x) || 0;
    y = parseFloat(y) || 0;

    // Get dashboard boundaries
    const dashboard = document.querySelector('.dashboard');
    const dashboardRect = dashboard.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Calculate bounds
    const maxX = dashboardRect.width - elementRect.width;
    const maxY = dashboardRect.height - elementRect.height;

    // Ensure position is within bounds
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

    // Apply transform without any initial transform
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    element.setAttribute('data-x', x);
    element.setAttribute('data-y', y);
}

function saveIslandPosition(islandId, position) {
    localStorage.setItem(`island-position-${islandId}`, JSON.stringify(position));
}

function loadIslandPosition(islandId) {
    const saved = localStorage.getItem(`island-position-${islandId}`);
    return saved ? JSON.parse(saved) : null;
}

function updateGreeting() {

    const hour = new Date().getHours();
    setInterval(function () {
        updateGreeting();
    }, 60000);
    updateGreeting();

    function updateGreeting() {
        // Request battery info from client
        //socket.emit('get_battery_info', clientId);
        const greetings = {
            night: [
                "🌙 Working late? Don't forget to rest!",
                "🌠 The night is still young...",
                "🦉 Burning the midnight oil?",
                "✨ Stars are out, but you're still here!",
                "🌙 Night owl mode: activated"
            ],
            morning: [
                "🌅 Rise and shine, superstar!",
                "☀️ Another beautiful morning to conquer",
                "🌄 Ready to seize the day?",
                "🍳 Morning vibes and positive times",
                "🌞 Hello sunshine!"
            ],
            afternoon: [
                "🌤️ Hope your day is going great!",
                "☀️ Keeping the momentum going!",
                "🎯 Crushing those afternoon goals",
                "💪 Powering through the day",
                "🚀 Still going strong!"
            ],
            evening: [
                "🌆 Winding down for the day?",
                "🌅 Making the most of the evening",
                "🎮 Time to relax and recharge",
                "🌇 Beautiful evening, isn't it?",
                "🍵 Evening peace and productivity"
            ]
        };

        let timeOfDay;
        let greetingArray;

        if (hour >= 22 || hour < 5) {
            timeOfDay = 'night';
            greetingArray = greetings.night;
        } else if (hour >= 5 && hour < 12) {
            timeOfDay = 'morning';
            greetingArray = greetings.morning;
        } else if (hour >= 12 && hour < 17) {
            timeOfDay = 'afternoon';
            greetingArray = greetings.afternoon;
        } else {
            timeOfDay = 'evening';
            greetingArray = greetings.evening;
        }

        // Get a random greeting from the appropriate array
        const randomIndex = Math.floor(Math.random() * greetingArray.length);
        const greeting = greetingArray[randomIndex];

        // Update both desktop and mobile greetings
        document.getElementById('greeting-text').textContent = greeting;
        const mobileGreeting = document.getElementById('greeting-text-mobile');
        if (mobileGreeting) {
            mobileGreeting.textContent = greeting;
        }
    }

    setInterval(function () {
        // Update current time
        const timeString = new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        document.getElementById('current-time').textContent = timeString;
        const mobileTime = document.getElementById('current-time-mobile');
        if (mobileTime) {
            mobileTime.textContent = timeString;
        }
    }, 1000);
}

// Function to update weather data
async function updateWeather() {
    try {
        // Get user's current location using Geolocation API
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject);
        });

        // Fetch weather data from API
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`);
        const data = await response.json();

        // Update DOM elements with weather data
        if (data.current) {
            const { temperature_2m, relative_humidity_2m, wind_speed_10m, weather_code } = data.current;
            document.getElementById('weather-temp').textContent = `${Math.round(temperature_2m)}°C`;
            document.getElementById('weather-desc').textContent = getWeatherDescription(weather_code);
            document.getElementById('weather-humidity').textContent = `Humidity: ${Math.round(relative_humidity_2m)}%`;
            document.getElementById('weather-wind').textContent = `Wind: ${Math.round(wind_speed_10m)} km/h`;

            document.getElementById('mobile-weather-temp').textContent = `${Math.round(temperature_2m)}°C`;
            document.getElementById('mobile-weather-desc').textContent = getWeatherDescription(weather_code);


            const temp = Math.round(temperature_2m);
            if (temp > 30) {
                showNotification(`🌡️ High temperature alert: ${temp}°C`, "warning", 5000);
            } else if (temp < 0) {
                showNotification(`❄️ Freezing temperature alert: ${temp}°C`, "warning", 5000);
            }

            // Show notification for severe weather codes
            if ([95, 96, 99].includes(weather_code)) {
                showNotification("⛈️ Severe weather warning: Thunderstorm", "warning", 5000);
            }

        } else {
            throw new Error('Weather data unavailable');
        }
    } catch (error) {
        console.error('Weather update failed:', error);
        document.getElementById('weather-desc').textContent = 'Failed to fetch weather';
    }
}

// Helper function to map weather codes to descriptions
function getWeatherDescription(code) {
    const weatherCodes = {
        0: 'Clear sky',
        1: 'Mainly clear',
        2: 'Partly cloudy',
        3: 'Overcast',
        45: 'Foggy',
        48: 'Depositing rime fog',
        51: 'Light drizzle',
        53: 'Moderate drizzle',
        55: 'Dense drizzle',
        61: 'Slight rain',
        63: 'Moderate rain',
        65: 'Heavy rain',
        71: 'Slight snow',
        73: 'Moderate snow',
        75: 'Heavy snow',
        77: 'Snow grains',
        80: 'Slight rain showers',
        81: 'Moderate rain showers',
        82: 'Violent rain showers',
        85: 'Slight snow showers',
        86: 'Heavy snow showers',
        95: 'Thunderstorm',
        96: 'Thunderstorm with slight hail',
        99: 'Thunderstorm with heavy hail',
    };
    return weatherCodes[code] || `Weather code: ${code}`;
}


// Make islands resizable
interact('.island')
    .draggable({
        inertia: false,
        modifiers: [
            interact.modifiers.restrictRect({
                restriction: 'parent',
                endOnly: true
            })
        ],
        listeners: {
            start(event) {
                event.target.classList.add('dragging');
            },
            move(event) {
                const target = event.target;
                const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
                const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

                // Update position
                setTransform(target, x, y);

                // Update data attributes
                target.setAttribute('data-x', x);
                target.setAttribute('data-y', y);

                // Create particle effect (throttled)
                if (!target.lastParticleTime || Date.now() - target.lastParticleTime > 50) {
                    createParticle(event.clientX, event.clientY);
                    target.lastParticleTime = Date.now();
                }
            },
            end(event) {
                const target = event.target;
                target.classList.remove('dragging');

                // Get the final position
                const x = parseFloat(target.getAttribute('data-x')) || 0;
                const y = parseFloat(target.getAttribute('data-y')) || 0;

                // Save position
                const islandId = target.dataset.islandId;
                saveIslandPosition(islandId, { x, y });
            }
        }
    })
    .resizable({
        edges: { top: false, left: false, bottom: true, right: true },
        listeners: {
            move: function (event) {
                let { x, y } = event.target.dataset;
                x = (parseFloat(x) || 0) + event.deltaRect.left;
                y = (parseFloat(y) || 0) + event.deltaRect.top;

                Object.assign(event.target.style, {
                    width: `${event.rect.width}px`,
                    height: `${event.rect.height}px`
                });

                Object.assign(event.target.dataset, { x, y });
            },
            end: function (event) {
                const target = event.target;
                const islandId = target.dataset.islandId;
                saveIslandSize(islandId, {
                    width: event.rect.width,
                    height: event.rect.height
                });
            }
        }
    });

// Save and load island sizes
function saveIslandSize(islandId, size) {
    localStorage.setItem(`island-size-${islandId}`, JSON.stringify(size));
}

function loadIslandSize(islandId) {
    const saved = localStorage.getItem(`island-size-${islandId}`);
    return saved ? JSON.parse(saved) : null;
}




// Add this socket listener for resource updates
socket.on('resource_update', (data) => {
    updateLastCommunication();
    const targetClientId = clientIdInput.value.trim();

    if (data.clientId === targetClientId) {
        // Update CPU usage
        const cpuElement = document.getElementById('cpu-usage');
        if (cpuElement) {
            cpuElement.style.width = `${data.cpu}%`;
            cpuElement.textContent = `${Math.round(data.cpu)}%`;
            // Add color based on usage
            if (data.cpu > 80) {
                cpuElement.style.backgroundColor = '#ff4444';
            } else if (data.cpu > 60) {
                cpuElement.style.backgroundColor = '#ffbb33';
            } else {
                cpuElement.style.backgroundColor = '#00C851';
            }
        }

        // Update Memory usage
        const memoryElement = document.getElementById('memory-usage');
        if (memoryElement) {
            memoryElement.style.width = `${data.memory}%`;
            memoryElement.textContent = `${Math.round(data.memory)}%`;
            // Add color based on usage
            if (data.memory > 80) {
                memoryElement.style.backgroundColor = '#ff4444';
            } else if (data.memory > 60) {
                memoryElement.style.backgroundColor = '#ffbb33';
            } else {
                memoryElement.style.backgroundColor = '#00C851';
            }
        }

        // Update Disk usage
        const diskElement = document.getElementById('disk-usage');
        if (diskElement) {
            diskElement.style.width = `${data.disk}%`;
            diskElement.textContent = `${Math.round(data.disk)}%`;
            // Add color based on usage
            if (data.disk > 80) {
                diskElement.style.backgroundColor = '#ff4444';
            } else if (data.disk > 60) {
                diskElement.style.backgroundColor = '#ffbb33';
            } else {
                diskElement.style.backgroundColor = '#00C851';
            }
        }
    }
});

function updateResourceBar(elementId, value) {
    const bar = document.getElementById(elementId);
    if (!bar) return;

    // Ensure value is a number and within bounds
    const usage = Math.min(Math.max(0, parseFloat(value) || 0), 100);

    // Update width with smooth transition
    bar.style.width = `${usage}%`;
    bar.textContent = `${Math.round(usage)}%`;

    // Update color based on usage
    if (usage > 90) {
        bar.style.background = 'linear-gradient(90deg, var(--error-color), #d32f2f)';
    } else if (usage > 70) {
        bar.style.background = 'linear-gradient(90deg, var(--warning-color), #ff8f00)';
    } else {
        bar.style.background = 'linear-gradient(90deg, var(--success-color), #2e7d32)';
    }
}

// Update the Speech Recognition Setup
function initializeSpeechRecognition() {
    // Get the saved language or default to en-US
    const savedLanguage = localStorage.getItem('speech-language') || 'en-US';

    // Get button references
    const mobileMicButton = document.getElementById('mic-button');
    const desktopMicButton = document.querySelector('.mic-button2.mobile-hidden');
    const mobileInput = document.getElementById('mobile-message-input');
    const desktopInput = document.getElementById('message-input');

    // Create a new SpeechRecognition instance
    window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new window.SpeechRecognition();

    // Set initial recognition properties
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = savedLanguage;

    let timer = null;

    const startRecording = (e) => {
        e.preventDefault();
        const button = e.currentTarget;
        button.classList.add('recording');
        recognition.start();
        timer = new Date();
    };

    const stopRecording = (e) => {
        e.preventDefault();
        const button = e.currentTarget;
        button.classList.remove('recording');
        recognition.stop();
        if (new Date() - timer < 1000) {
            appendMessage("Hold button to talk", "warning");
        }
    };

    // Add listeners to both mobile and desktop buttons
    [mobileMicButton, desktopMicButton].forEach(button => {
        if (button) {
            // Remove existing listeners first
            button.removeEventListener('touchstart', startRecording);
            button.removeEventListener('touchend', stopRecording);
            button.removeEventListener('mousedown', startRecording);
            button.removeEventListener('mouseup', stopRecording);
            button.removeEventListener('mouseleave', stopRecording);

            // Add new listeners
            button.addEventListener('touchstart', startRecording);
            button.addEventListener('touchend', stopRecording);
            button.addEventListener('mousedown', startRecording);
            button.addEventListener('mouseup', stopRecording);
            button.addEventListener('mouseleave', stopRecording);
        }
    });

    recognition.onstart = () => {
        console.log('Recording started');
        if (mobileInput) mobileInput.placeholder = 'Listening...';
        if (desktopInput) desktopInput.placeholder = 'Listening...';
    };

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join('');

        // Update both inputs
        if (mobileInput) mobileInput.value = transcript;
        if (desktopInput) desktopInput.value = transcript;
    };

    recognition.onend = () => {
        console.log('Recording ended');
        if (mobileInput) mobileInput.placeholder = 'Type your message...';
        if (desktopInput) desktopInput.placeholder = 'Type your message...';

        [mobileMicButton, desktopMicButton].forEach(button => {
            if (button) button.classList.remove('recording');
        });

        const message = (mobileInput?.value || desktopInput?.value || '').trim();
        if (message) {
            sendMessage();
            if (mobileInput) mobileInput.value = '';
            if (desktopInput) desktopInput.value = '';
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        [mobileMicButton, desktopMicButton].forEach(button => {
            if (button) button.classList.remove('recording');
        });

        if (mobileInput) mobileInput.placeholder = 'Type your message...';
        if (desktopInput) desktopInput.placeholder = 'Type your message...';

        if (event.error === 'not-allowed') {
            appendMessage(' Microphone access denied', 'error');
        }
    };
}

// Add mobile send functionality
function initializeMobileChat() {
    const mobileInput = document.getElementById('mobile-message-input');
    const desktopInput = document.getElementById('message-input');
    const mobileSubmit = document.getElementById('mobile-submit');

    // Sync inputs both ways
    if (mobileInput && desktopInput) {
        mobileInput.addEventListener('input', () => {
            desktopInput.value = mobileInput.value;
        });
        desktopInput.addEventListener('input', () => {
            mobileInput.value = desktopInput.value;
        });
    }

    // Handle mobile submit button click
    if (mobileSubmit) {
        mobileSubmit.addEventListener('click', () => {
            const message = mobileInput.value.trim();
            if (message) {
                sendMessage(); // Use the same send function as desktop
                mobileInput.value = '';
                desktopInput.value = '';
            }
        });
    }

    // Handle mobile input enter key
    if (mobileInput) {
        mobileInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const message = mobileInput.value.trim();
                if (message) {
                    sendMessage(); // Use the same send function as desktop
                    mobileInput.value = '';
                    desktopInput.value = '';
                }
            }
        });
    }
}

function sendMessageFromMobile(message) {
    if (!serverStatusBool) {
        appendMessage('❌ Server is offline', 'error');
        return;
    }
    if (!clientStatusBool) {
        appendMessage('❌ Client is offline', 'warning');
        return;
    }

    const targetClientId = clientIdInput.value.trim();

    socket.emit('chat message', {
        message: message,
        targetClientId: targetClientId
    });
    appendMessage('You: ' + message);
}

// Add at the end of the file
function initializeThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme') || 'light';

    // Set initial theme
    document.documentElement.setAttribute('data-theme', savedTheme);
    toggle.textContent = savedTheme === 'light' ? '' : '☀️';

    toggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';

        // Update theme
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);

        // Update button text
        toggle.textContent = newTheme === 'light' ? '🌓' : '☀️';

        showNotification("Theme changed!", "theme", 1000);

        // Force a repaint to ensure all theme variables are updated
        document.body.style.display = 'none';
        document.body.offsetHeight; // Trigger a reflow
        document.body.style.display = '';
    });
}

// Update the initializeSettings function to save language in localStorage
function initializeSettings() {
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsModal = document.getElementById('settings-modal');
    const settingsClose = document.querySelector('.settings-close');
    const languageSelect = document.getElementById('speech-language');

    // Load saved language
    const savedLanguage = localStorage.getItem('speech-language') || 'en-US';
    languageSelect.value = savedLanguage;

    languageSelect.addEventListener('change', (e) => {
        const selectedLanguage = e.target.value;
        localStorage.setItem('speech-language', selectedLanguage);

        // Stop any ongoing speech
        window.speechSynthesis.cancel();

        // Stop the current recognition instance if it exists
        if (typeof recognition !== 'undefined') {
            recognition.stop();
        }

        // Reinitialize speech recognition with new language
        initializeSpeechRecognition();
    });

    settingsToggle.addEventListener('click', () => {
        settingsModal.style.display = 'block';
    });

    settingsClose.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    });

    const manualInputSelect = document.getElementById('mobile-manual-input');
    manualInputSelect.value = savedManualInput;

    // Update mobile input visibility based on saved setting
    updateMobileInputVisibility(savedManualInput);

    manualInputSelect.addEventListener('change', (e) => {
        const setting = e.target.value;
        localStorage.setItem('mobile-manual-input', setting);
        updateMobileInputVisibility(setting);
    });
}

// Initialize everything
window.addEventListener('load', () => {
    if (isSpeechRecognitionSupported()) {
        initializeSpeechRecognition();
    } else {
        document.getElementById('mic-button').style.display = 'none';
        document.getElementById('desktop-mic-button').style.display = 'none';
        let microphoneIsland = document.getElementById('microphone-island');
        if (microphoneIsland) microphoneIsland.style.display = 'none';
        console.log('Speech recognition not supported');
    }
    initializeIslands();
    updateGreeting();
    updateWeather();
    initializeMobileChat();
    initializeThemeToggle();
    initializeSettings();


    initializeGeolocation();

    // Load saved positions and sizes
    document.querySelectorAll('.island').forEach(island => {
        const islandId = island.dataset.islandId;
        const position = loadIslandPosition(islandId);
        const size = loadIslandSize(islandId);

        if (position) {
            setTransform(island, position.x, position.y);
        }
        if (size) {
            island.style.width = `${size.width}px`;
            island.style.height = `${size.height}px`;
        }
    });

    setInterval(updateWeather, 300000);

    initializeFileDropZone();
});

// Add helper functions for snap guidelines
function createSnapGuideline(type, position) {
    const guideline = document.createElement('div');
    guideline.className = `snap-guideline ${type}`;
    if (type === 'horizontal') {
        guideline.style.top = `${position}px`;
    } else {
        guideline.style.left = `${position}px`;
    }
    document.querySelector('.dashboard').appendChild(guideline);
}

function removeSnapGuidelines() {
    document.querySelectorAll('.snap-guideline').forEach(el => el.remove());
}

// Add new storage functions
function saveIslandMinimized(islandId, minimized) {
    localStorage.setItem(`island-minimized-${islandId}`, JSON.stringify(minimized));
}

function loadIslandMinimized(islandId) {
    const saved = localStorage.getItem(`island-minimized-${islandId}`);
    return saved ? JSON.parse(saved) : false;
}



function initializeTextToSpeech() {
    try {
        window.speechSynthesis.getVoices(); // Force load voices

        // Get saved language or default to en-US
        const savedLanguage = localStorage.getItem('speech-language') || 'en-US';

        function speak(text, lang) {
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();

            // Find a voice that matches the language
            const voice = voices.find(v => v.lang.startsWith(lang)) ||
                voices.find(v => v.lang.startsWith(lang.split('-')[0])) ||
                voices[0];

            utterance.voice = voice;
            utterance.lang = lang;
            window.speechSynthesis.speak(utterance);
        }

        return { speak };
    } catch (error) {
        console.error('Error initializing text-to-speech:', error);
    }
}

function updateMobileInputVisibility(setting) {
    const mobileInput = document.querySelector('.mobile-input');
    if (mobileInput) {
        mobileInput.style.display = setting === 'enabled' ? 'flex' : 'none';
    }
}

function isSpeechRecognitionSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

function updateView() {
    const isMobile = isMobileDevice();
    const manualInputSetting = localStorage.getItem('mobile-manual-input') || 'disabled';

    // ... existing updateView code ...

    if (isMobile) {
        updateMobileInputVisibility(manualInputSetting);
    }
}

let userLocation = '';

function initializeGeolocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(async position => {
            try {
                const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&localityLanguage=en`);
                const data = await response.json();
                userLocation = data.city || data.locality || data.principalSubdivision || data.countryName;
                socket.emit('update_location', { location: userLocation });
            } catch (error) {
                console.error('Error getting location details:', error);
            }
        }, error => {
            console.error('Error getting location:', error);
        });
    }
}

function initializeFileDropZone() {
    const overlay = document.getElementById('file-drop-overlay');
    const analyzeBtn = document.getElementById('analyze-file-btn');
    const fileNameDisplay = document.getElementById('selected-file-name');
    const dropMessage = document.querySelector('.drop-message');
    let selectedFile = null;

    function closeOverlay() {
        overlay.classList.remove('active');
        selectedFile = null;
        fileNameDisplay.textContent = 'Drop file or click to select';
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyze File';
        document.getElementById('file-analysis-instructions').value = '';
    }

    // Close overlay when clicking outside the drop message
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeOverlay();
        }
    });

    // Prevent clicks inside drop-message from closing the overlay
    dropMessage.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Handle file drop
    overlay.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        handleFileSelection(file);
    });

    // Allow clicking to select file
    fileNameDisplay.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = (e) => {
            const file = e.target.files[0];
            handleFileSelection(file);
        };
        input.click();
    });

    function handleFileSelection(file) {
        if (!file) return;

        // Check file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
            appendMessage('❌ File too large. Maximum size is 10MB', 'error');
            closeOverlay();
            return;
        }

        selectedFile = file;
        fileNameDisplay.textContent = `Selected: ${file.name}`;
        analyzeBtn.disabled = false;
        overlay.classList.add('active');
    }

    // Handle analyze button click
    analyzeBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';

        const instructions = document.getElementById('file-analysis-instructions').value;
        appendMessage(`📁 Analyzing file: ${selectedFile.name}...`, 'system');

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('instructions', instructions);

        try {
            const response = await fetch('/analyze-file', {
                method: 'POST',
                body: formData
            });

            // Close the overlay immediately after submitting
            closeOverlay();

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));

                        if (data.done) {
                            appendMessage(`📊 Analysis complete`, 'system');
                            appendMessage(data.finalResponse, 'ai');
                        } else if (data.content) {
                            appendStreamingMessage(data.content, 'ai');
                        }
                    }
                }
            }
        } catch (error) {
            appendMessage(`❌ Error analyzing file: ${error.message}`, 'error');
        }
    });

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
        overlay.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Handle drag enter/leave
    ['dragenter', 'dragover'].forEach(eventName => {
        document.body.addEventListener(eventName, () => {
            overlay.classList.add('active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        overlay.addEventListener(eventName, (e) => {
            if (eventName === 'dragleave' && e.target !== overlay) return;
            if (!selectedFile) {
                overlay.classList.remove('active');
            }
        }, false);
    });
}

// Initialize the file drop zone when the page loads
document.addEventListener('DOMContentLoaded', initializeFileDropZone);

// Todo List Functions
function addTodo() {
    const input = document.getElementById('todo-input');
    const text = input.value.trim();
    if (!text) return;

    const todos = JSON.parse(localStorage.getItem('todos') || '[]');
    todos.push({ text, completed: false });
    localStorage.setItem('todos', JSON.stringify(todos));

    updateTodoList();
    input.value = '';
}

function updateTodoList() {
    const todoList = document.getElementById('todo-list');
    const todos = JSON.parse(localStorage.getItem('todos') || '[]');

    todoList.innerHTML = '';
    todos.forEach((todo, index) => {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
        li.innerHTML = `
            <input type="checkbox" ${todo.completed ? 'checked' : ''} 
                onchange="toggleTodo(${index})">
            <span>${todo.text}</span>
            <button onclick="deleteTodo(${index})">❌</button>
        `;
        todoList.appendChild(li);
    });
}

function toggleTodo(index) {
    const todos = JSON.parse(localStorage.getItem('todos') || '[]');
    todos[index].completed = !todos[index].completed;
    localStorage.setItem('todos', JSON.stringify(todos));
    if (todos[index].completed) {
        showNotification("Todo completed!", "todo", 1000);
    }
    updateTodoList();
}

function deleteTodo(index) {
    const todos = JSON.parse(localStorage.getItem('todos') || '[]');
    todos.splice(index, 1);
    localStorage.setItem('todos', JSON.stringify(todos));
    updateTodoList();
}

// Notes Functions
function initializeNotes() {
    const notesContent = document.getElementById('notes-content');
    notesContent.value = localStorage.getItem('notes') || '';
    notesContent.addEventListener('input', () => {
        localStorage.setItem('notes', notesContent.value);
    });
}

// Timer Functions
let timerInterval;
let timerSeconds = 0;

function startTimer() {
    const minutes = parseInt(document.getElementById('timer-minutes').value) || 0;
    if (!timerInterval && (minutes > 0 || timerSeconds > 0)) {
        timerSeconds = timerSeconds || minutes * 60;
        timerInterval = setInterval(updateTimer, 1000);
    }
}

function updateTimer() {
    if (timerSeconds <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        showNotification("Timer finished!", "timer", 5000);
        return;
    }

    timerSeconds--;
    const hours = Math.floor(timerSeconds / 3600);
    const minutes = Math.floor((timerSeconds % 3600) / 60);
    const seconds = timerSeconds % 60;

    document.querySelector('.timer-display').textContent =
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function pauseTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
}

function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = 0;
    document.querySelector('.timer-display').textContent = '00:00:00';
    document.getElementById('timer-minutes').value = '';
}

// Memes Function
async function loadNewMeme() {
    try {
        const response = await fetch('https://meme-api.com/gimme');
        const data = await response.json();
        document.getElementById('meme-image').src = data.url;
    } catch (error) {
        console.error('Error loading meme:', error);
    }
}

// Quotes Function
async function loadNewQuote() {
    try {
        const response = await fetch('https://quoteslate.vercel.app/api/quotes/random');
        const data = await response.json();
        document.getElementById('quote-text').textContent = `"${data.quote}"`;
        document.getElementById('quote-author').textContent = `- ${data.author}`;
    } catch (error) {
        console.error('Error loading quote:', error);
    }
}

// Network Speed Test
function testNetworkSpeed() {
    const targetClientId = clientIdInput.value.trim();
    if (!targetClientId) {
        appendMessage('❌ No client ID specified', 'error');
        return;
    }

    if (!clientStatusBool) {
        appendMessage('❌ Client is offline', 'warning');
        return;
    }

    // Update UI to show testing state
    document.getElementById('download-speed').textContent = 'Testing...';
    document.getElementById('upload-speed').textContent = 'Testing...';
    document.getElementById('ping-speed').textContent = 'Testing...';

    // Request network speed test
    socket.emit('request_network_speed', { targetClientId });
}

// Update the network speed update handler
socket.on('network_speed_update', (data) => {
    const targetClientId = clientIdInput.value.trim();
    showNotification("Network speed test completed", "network", 1000);
    if (data.clientId !== targetClientId) return;

    if (data.error) {
        document.getElementById('download-speed').textContent = 'Error';
        document.getElementById('upload-speed').textContent = 'Error';
        document.getElementById('ping-speed').textContent = 'Error';
        appendMessage(`❌ Network test failed: ${data.error}`, 'error');
        return;
    }

    // Update all network metrics
    document.getElementById('download-speed').textContent = `${data.download.toFixed(2)} Mbps`;
    document.getElementById('upload-speed').textContent = `${data.upload.toFixed(2)} Mbps`;
    document.getElementById('ping-speed').textContent = `${data.ping.toFixed(0)} ms`;

    // Show success message
    appendMessage('✅ Network speed test completed', 'success');
});

// Request battery info periodically
function updateBatteryInfo() {
    const targetClientId = clientIdInput.value.trim();
    if (!targetClientId) return;

    socket.emit('request_battery_info', { targetClientId });
}

socket.on('battery_update', (data) => {

    if (data.batteryLevel && data.batteryLevel <= 20 && !data.charging) {
        showNotification(`🔋 Low battery: ${data.batteryLevel}%`, "battery");
    }

    // Add full charge notification
    if (data.batteryLevel === 100 && data.charging) {
        showNotification("🔋 Battery fully charged", "battery", 3000);
    }

    const batteryLevel = document.getElementById('battery-level');
    if (data.level === 'N/A') {
        batteryLevel.textContent = 'No battery detected';
    } else {

        batteryLevel.textContent = `${data.batteryLevel}%${data.charging ? ' (Charging)' : ''}`;
    }
});



// Countdown Functions
function setCountdown() {
    const targetDate = document.getElementById('countdown-date').value;
    if (!targetDate) return;

    localStorage.setItem('countdown-date', targetDate);
    updateCountdown();
}

function updateCountdown() {
    const targetDate = localStorage.getItem('countdown-date');
    if (!targetDate) return;

    const now = new Date();
    const target = new Date(targetDate);
    const diff = target - now;

    if (diff <= 0) {
        document.getElementById('countdown-display').textContent = 'Countdown finished!';
        showNotification("Countdown finished!", "countdown", 5000);
        return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    document.getElementById('countdown-display').textContent =
        `${days} days, ${hours} hours, ${minutes} minutes`;
}

// Initialize everything
window.addEventListener('load', () => {
    // Add to existing load event listener
    updateTodoList();
    initializeNotes();
    loadNewMeme();
    loadNewQuote();
    setInterval(updateCountdown, 60000); // Update countdown every minute

    // Load countdown if exists
    const savedDate = localStorage.getItem('countdown-date');
    if (savedDate) {
        document.getElementById('countdown-date').value = savedDate;
        updateCountdown();
    }
});

// Island visibility management
function initializeIslandToggles() {
    // Load saved visibility states
    const savedStates = JSON.parse(localStorage.getItem('islandVisibility') || '{}');

    // Get all toggle checkboxes
    const toggles = document.querySelectorAll('.islands-toggle-grid input[type="checkbox"]');

    toggles.forEach(toggle => {
        const islandId = toggle.dataset.island;
        const island = document.getElementById(`${islandId}-island`);

        // Set initial checkbox state from localStorage or default
        if (savedStates.hasOwnProperty(islandId)) {
            toggle.checked = savedStates[islandId];
        }

        // Set initial island visibility
        if (island) {
            island.style.display = toggle.checked ? 'block' : 'none';
        }

        // Add change event listener
        toggle.addEventListener('change', (e) => {
            const isVisible = e.target.checked;
            if (island) {
                island.style.display = isVisible ? 'block' : 'none';

                // Save state to localStorage
                const currentStates = JSON.parse(localStorage.getItem('islandVisibility') || '{}');
                currentStates[islandId] = isVisible;
                localStorage.setItem('islandVisibility', JSON.stringify(currentStates));

                // If making visible, ensure proper positioning
                if (isVisible) {
                    const savedPosition = ISLAND_DEFAULTS[islandId]?.position;
                    if (savedPosition) {
                        island.style.transform = `translate(${savedPosition.x}px, ${savedPosition.y}px)`;
                    }
                }
            }
        });
    });
}

// Add to your existing window.addEventListener('load', ...)
window.addEventListener('load', () => {
    // ... existing code ...
    initializeIslandToggles();
});

function toggleMinimize(islandId) {
    const island = document.querySelector(`[data-island-id="${islandId}"]`);
    if (!island) return;

    const isMinimized = island.classList.toggle('minimized');
    saveIslandMinimized(islandId, isMinimized);

    // Update button text
    const minimizeBtn = island.querySelector('.minimize-btn');
    if (minimizeBtn) {
        minimizeBtn.textContent = isMinimized ? '+' : '−';
    }
}

// Research Task Functions
function addResearchTask() {
    const input = document.getElementById('research-input');
    const text = input.value.trim();
    if (!text) return;

    const tasks = getResearchTasks();
    tasks.push({
        id: Date.now(),
        title: text,
        progress: 0,
        notes: '',
        createdAt: new Date().toISOString(),
        completed: false
    });

    saveResearchTasks(tasks);
    updateResearchList();
    input.value = '';
}

function getResearchTasks() {
    return JSON.parse(localStorage.getItem('research-tasks') || '[]');
}

function saveResearchTasks(tasks) {
    localStorage.setItem('research-tasks', JSON.stringify(tasks));
}

function calculateTitleFontSize(title) {
    const baseSize = 1;
    if (title.length > 100) return 0.7;
    if (title.length > 70) return 0.8;
    if (title.length > 40) return 0.9;
    return baseSize;
}

function updateResearchList() {
    const list = document.getElementById('research-list');
    const tasks = getResearchTasks();

    tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));


    list.innerHTML = '';
    tasks.forEach(task => {
        const fontSize = calculateTitleFontSize(task.title);
        const item = document.createElement('div');
        item.className = `research-item ${task.completed ? 'completed' : ''}`;

        // Create the title span separately to set the custom property
        const titleSpan = `<span class="research-item-title" style="--title-size: ${fontSize}em">${task.title}</span>`;

        item.innerHTML = `
            <div class="research-item-header">
                ${titleSpan}
                <div class="research-item-controls">
                    <button onclick="toggleResearchTask(${task.id})">
                        Research
                    </button>
                    <button onclick="deleteResearchTask(${task.id})">❌</button>
                </div>
            </div>
            <div class="research-progress">
                <div class="research-progress-bar" style="width: 0%"></div>
            </div>
            <textarea
                class="research-item-notes"
                placeholder="Add notes..."
                onchange="updateResearchNotes(${task.id}, this.value)"
                style="width: 90%; height: 100px;"
            >${task.notes}</textarea>
        `;

        if (task.completed) {
            const toggle = item.querySelector('.research-item-controls button:nth-child(1)');
            toggle.style.display = 'none';

            const progressBar = item.querySelector('.research-progress-bar');
            progressBar.style.width = "100%";
        }

        list.appendChild(item);
    });
}

function toggleResearchTask(id) {
    const tasks = getResearchTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
        socket.emit("start_research_task", {
            message: task.title,
            pageCount: document.getElementById('research-page-count').value
        });

        let interval = undefined;
        // Animate progress bar
        const progressBar = document.querySelector(`.research-item:last-child .research-progress-bar`);
        if (progressBar) {
            let progress = 0;
            interval = setInterval(() => {
                progress++;
                progressBar.style.width = `${progress}%`;
                if (progress >= 100) {
                    progressBar.style.width = "0%";
                    progress = 0;
                }
            }, 10);
        }



        socket.once("research_task_result", (data) => {
            showNotification("Research task completed", "research", 1000);
            task.result = data;
            task.notes = data;
            task.completed = true;
            clearInterval(interval);
            progressBar.style.width = "100%";
            //hide toggle button
            const toggle = document.querySelector(`[data-island-id="research"] .research-item-controls button:nth-child(1)`);
            toggle.style.display = 'none';
            saveResearchTasks(tasks);
            updateResearchList();
        });

    }
}

function deleteResearchTask(id) {
    const tasks = getResearchTasks();
    const updatedTasks = tasks.filter(t => t.id !== id);
    saveResearchTasks(updatedTasks);
    updateResearchList();
}

function updateResearchNotes(id, notes) {
    const tasks = getResearchTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.notes = notes;
        saveResearchTasks(tasks);
    }
}

// Add to your existing window.addEventListener('load', ...)
window.addEventListener('load', () => {
    // ... existing code ...
    updateResearchList();
});

// Add this with the other socket handlers
socket.on('create_research_task', (data) => {
    const tasks = getResearchTasks();
    tasks.push({
        id: Date.now(),
        title: data.title,
        progress: 0,
        notes: '',
        createdAt: new Date().toISOString(),
        completed: false
    });

    saveResearchTasks(tasks);
    updateResearchList();

    //show research island
    document.getElementById('research-island').style.display = 'block';

    // If immediate research is requested, start it
    if (data.startResearch) {
        toggleResearchTask(tasks[tasks.length - 1].id);
    }
});

// Function to save password for a client
function saveClientPassword(clientId, password) {
    const passwords = JSON.parse(localStorage.getItem('client-passwords') || '{}');
    passwords[clientId] = password;
    localStorage.setItem('client-passwords', JSON.stringify(passwords));
}



// Function to remove saved password for a client
function removeSavedPassword(clientId) {
    const passwords = JSON.parse(localStorage.getItem('client-passwords') || '{}');
    delete passwords[clientId];
    localStorage.setItem('client-passwords', JSON.stringify(passwords));
}

// Add this to check authentication when changing client ID
clientIdInput.addEventListener('change', () => {
    const targetClientId = clientIdInput.value.trim();
    if (targetClientId) {
        socket.emit('request_sync', targetClientId);

        // Check if client requires authentication
        socket.emit('check_client_status', { targetClientId });

        // Reset current password
        currentClientPassword = getSavedPassword(targetClientId) || '';

    }
});

// Add new helper function for password prompting
function promptForPassword(clientId) {
    let savedPassword = getSavedPassword(clientId);
    if (!savedPassword) {
        const password = prompt('This client requires authentication. Please enter the password:');
        if (password) {
            saveClientPassword(clientId, password);
            currentClientPassword = password;
            console.log("starting authentication with password (prompted): " + password);

            socket.emit('authenticate_client', {
                clientId: clientId,
                password: password
            });
        }
    } else {
        socket.emit('authenticate_client', {
            clientId: clientId,
            password: savedPassword
        });
    }
}

// Add this new function to periodically check client status
function startClientStatusCheck() {
    const checkInterval = 30000; // Check every 30 seconds
    let lastCheck = 0;

    const performCheck = () => {
        const now = Date.now();
        const targetClientId = clientIdInput.value.trim();

        // Only check if enough time has passed and we're not already authenticated
        if (targetClientId && (now - lastCheck >= checkInterval) && !initialAuthentificationSuccess) {
            console.log("Periodic client status check for:", targetClientId);
            socket.emit('check_client_status', { targetClientId });
            lastCheck = now;
        }
    };

    // Initial check
    performCheck();

    // Set up periodic check
    setInterval(performCheck, checkInterval);
}

document.addEventListener('DOMContentLoaded', async () => {
    let authCheckAttempts = 0;
    const maxAuthAttempts = 3;

    showNotification("Authenticating...", "auth");

    socket.once('connect', async () => {
        const checkAuth = async () => {
            if (initialAuthentificationSuccess || authCheckAttempts >= maxAuthAttempts) {
                dismissNotification("auth");
                return;
            }

            const targetClientId = clientIdInput.value.trim();
            console.log(`Auth attempt ${authCheckAttempts + 1} for client: ${targetClientId}`);

            socket.emit('check_client_status', { targetClientId });
            authCheckAttempts++;

            // Wait longer between attempts
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (!initialAuthentificationSuccess) {
                checkAuth();
            }
        };

        checkAuth();
    });
});

function showNotification(message, type = "default", duration) {

    let notificationContainer = document.createElement('div');
    notificationContainer.className = 'notification-island';

    let notificationContent = document.createElement('div');
    notificationContent.className = 'notification-content';

    let notificationText = document.createElement('span');
    notificationText.textContent = message;

    notificationContent.appendChild(notificationText);
    notificationContainer.appendChild(notificationContent);

    // Add to the existing notifications area at the top of body
    document.body.insertBefore(notificationContainer, document.body.firstChild);

    // Remove hiding class if present
    notificationContainer.classList.remove('hiding');

    notificationContainer.style.display = 'block';
    notificationContainer.classList.add(type);

    if (duration) {
        setTimeout(() => {
            dismissNotification(type);
        }, duration);
    }
}

function dismissNotification(type = "default") {
    // Get all notifications of this type
    const notifications = document.querySelectorAll(`.notification-island.${type}`);
    if (!notifications.length) return;

    // Remove each notification with animation
    notifications.forEach(notification => {
        // Skip if already being removed
        if (notification.classList.contains('hiding')) return;

        // Add hiding class to trigger animation
        notification.classList.add('hiding');

        // Wait for animation to complete before removing
        setTimeout(() => {
            notification.style.display = 'none';
            notification.classList.remove('hiding');
            notification.classList.remove(type);
            notification.remove(); // Fully remove from DOM
        }, 300); // Match the CSS transition duration
    });
}

// Add these functions to handle Spotify playlist persistence
function saveSpotifyPlaylist(playlistId) {
    localStorage.setItem('spotify-playlist', playlistId);
}

function loadSpotifyPlaylist() {
    const playlistId = localStorage.getItem('spotify-playlist') || 'YOUR_DEFAULT_PLAYLIST_ID';
    const spotifyIframe = document.getElementById('spotify-iframe');
    if (spotifyIframe) {
        spotifyIframe.src = `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator`;
    }
}

// Add function to update playlist
function updateSpotifyPlaylist(playlistUrl) {
    const playlistId = extractPlaylistId(playlistUrl);
    if (playlistId) {
        saveSpotifyPlaylist(playlistId);
        loadSpotifyPlaylist();
    }
}

// Helper function to extract playlist ID from Spotify URL
function extractPlaylistId(url) {
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

// Add to your existing window.addEventListener('load', ...)
window.addEventListener('load', () => {
    // ... existing code ...
    loadSpotifyPlaylist();

    // Add playlist change functionality
    const spotifyIsland = document.getElementById('spotify-island');
    if (spotifyIsland) {
        const changeButton = document.createElement('button');
        changeButton.textContent = 'Change Playlist';
        changeButton.className = 'spotify-change-btn';
        changeButton.onclick = () => {
            const newUrl = prompt('Enter Spotify playlist URL:');
            if (newUrl) {
                updateSpotifyPlaylist(newUrl);
            }
        };
        spotifyIsland.querySelector('.island-controls').prepend(changeButton);
    }
});