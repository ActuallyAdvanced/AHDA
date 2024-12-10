require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8, // 100 MB
    pingTimeout: 120000, // Increase to 120 seconds
    pingInterval: 25000  // Add ping interval of 25 seconds
});
const OpenAI = require('openai');
const path = require('path');
const multer = require('multer');
const upload = multer({
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

const axios = require('axios');
const cheerio = require('cheerio');

const connectedClients = new Map(); // { clientId: { socket, systemInfo, connected, lastHeartbeat, webClients: Set<socket.id> } }

const conversationHistory = new Map();
const messageHistory = new Map();
const imageHistory = new Map();
const userLocations = new Map();
const clientPasswords = new Map();
const authenticatedClients = new Map();
const userLanguages = new Map();

const clientHeartbeat = new Map();


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

let systemPrompt = `You are an AI assistant that can control computers. You MUST provide executable Python code for any action-based requests, if not action based send text. Your responses should follow these rules:

1. ALWAYS wrap Python code in \`\`\`python and \`\`\` markers
2. ALWAYS include executable code for action-based requests
3. ONLY use Python code - no other programming languages
4. DO NOT explain how to do something - just provide the code to do it
5. If you need to capture the screen, use ###CAPTURE_SCREEN### within your code


Always use these markers for code, even for single lines. Never use any other format for code blocks.
If the request doesn't require code execution, respond normally.
You also have a screen capture attached. If you need it to help, use it. if not, ignore it.
Make sure to always take action if possible. that includes opening browser, apps, clicking, etc. Do not give a guide how to do something, just do it.
Whatever you do, only generate python code.

Example of a bad response:
"To open Google, you would need to use the webbrowser module..."

SPECIAL FEATURES:
- Screen Capture: Use '###CAPTURE_SCREEN###' in your code to capture the screen and analyze it before continuing execution.

How to do what:
- Weather: Open a browser and go to https://www.google.com/search?q=weather, then use the screen capture to find the temperature. You can do it since you have the required libraries. 
- Stock prices: Open browser and go to https://www.google.com/search?q=name+of+the+stock, then use the screen capture to find the stock price. You can do it since you have the required libraries. 
- News: Open browser and go to https://www.google.com/search?q=news+about+topic, then use the screen capture to find the news. You can do it since you have the required libraries. 
- Mail: Open the default mail app. When asked to write something, write it in the default mail app.
- Calendar: Open the default calendar app, wait for a bit, take a screen capture, and then continue. When asked to write something, write it in the default calendar app.
- Notes: Open the default notes app, wait for a bit, take a screen capture, and then continue. When asked to write something, write it in the default notes app.
- Calculator: Open the default calculator app, wait for a bit, take a screen capture, and then continue. When asked to write something, write it in the default calculator app.
- For any kind of file editing: make the code to actually edit the file, not only say the content of the file.
- When you are supposed to open anything, do it in the default app for that thing.
- Programming Tasks:
    - When you are asked to write code simply make a python command to write a file. 
    - When making something openable, open it.
    - Use the Desktop as a default file location.
    - Try to also design is nicely
    - Try to also make is as functional as possible
    - default to a html web app if not specified if possible
- Make sure to get things done, do not ask for clarification if you can do it
- You can create research tasks using this special command: ###CREATE_RESEARCH### followed by the research topic. You can also create and immediately start a research task using: ###CREATE_AND_START_RESEARCH### followed by the research topic. Use this for super specific research since it will look through the web for you. Only use this if neccesary since it uses a lot of tokens.

Think about what you can do with the libraries and use them, no matter what.

for browser tasks use import webbrowser; sleep(5000);webbrowser.open("https://example.com"); ###CAPTURE_SCREEN###; webbrowser.close() for example.
repeat: for screen capture, use ###CAPTURE_SCREEN###, do not try to save it locally, ever.
you can directly interact with the screen. think about what you have to do to accomplish it (eg. press keybind, etc). you can do it since you have all required libraries

If you are executing code, always print something
You have the following python libraries available, import them with 'import' statements. Only import them if neceesary and compatible with the OS:
pyautogui, pynput, os, shutil, pathlib, subprocess, winreg (Windows only), pywin32 (Windows only), psutil, platform, socket, pyperclip, ctypes, keyboard, mouse, pywinauto, auto_py_to_exe, webbrowser

NEVER use any kind of placeholders such as USERNAME etc

Always respond in the language of the user.

Example responses:
1. When providing code:
\`\`\`python
import pyautogui
pyautogui.click(100, 200)
\`\`\`
`;

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {

    socket.on('register_client', (data) => {
        console.log('Python client registered:', data.clientId);

        const hasPassword = !!data.password;

        if (hasPassword) {
            clientPasswords.set(data.clientId, data.password);
            console.log(`Password protection enabled for client: ${data.clientId}`);
        }

        connectedClients.set(data.clientId, {
            socket: socket,
            systemInfo: data.systemInfo,
            connected: true,
            lastHeartbeat: Date.now(),
            requiresAuth: hasPassword,
            webClients: new Set()
        });

        // Initialize heartbeat for this client
        clientHeartbeat.set(data.clientId, Date.now());
    });

    socket.on('heartbeat', (data) => {
        const clientId = data.clientId;
        if (connectedClients.has(clientId)) {
            connectedClients.get(clientId).lastHeartbeat = Date.now();
            clientHeartbeat.set(clientId, Date.now());
        }
    });

    socket.on('disconnect', () => {
        // Handle Python client disconnection
        for (const [clientId, clientData] of connectedClients.entries()) {
            if (clientData.socket === socket) {
                connectedClients.delete(clientId);
                clientHeartbeat.delete(clientId);
                console.log(`Python client disconnected: ${clientId}`);

                // Notify associated web clients
                clientData.webClients.forEach((socketId) => {
                    const targetSocket = io.sockets.sockets.get(socketId);
                    if (targetSocket) {
                        targetSocket.emit('client_status', {
                            connected: false,
                            clientId: clientId
                        });
                    }
                });
                break;
            }
        }

        // Handle web client disconnection
        if (authenticatedClients.has(socket.id)) {
            const clientId = authenticatedClients.get(socket.id);
            authenticatedClients.delete(socket.id);

            if (connectedClients.has(clientId)) {
                const clientData = connectedClients.get(clientId);
                clientData.webClients.delete(socket.id);

                console.log(`Web client disconnected: socket ${socket.id}, clientId: ${clientId}`);
            }
        }
    });
    socket.on("check_if_auth_required", (data) => {
        const clientData = connectedClients.get(data.clientId);
        const hasPassword = clientData?.requiresAuth || clientPasswords.has(data.clientId);
        socket.emit('auth_required_response', {
            requiresAuth: hasPassword
        });
    });



    // Also update the reconnect handler if you have one
    socket.on('reconnect', (data) => {
        if (data && data.clientId) {
            const hasPassword = clientPasswords.has(data.clientId);
            socket.emit('client_status', {
                connected: true,
                clientId: data.clientId,
                requiresAuth: hasPassword
            });
        }
    });
    socket.on('authenticate_client', (data) => {
        const { clientId, password } = data;
        const storedPassword = clientPasswords.get(clientId);

        if (!password || password.trim() === "") {
            socket.emit('auth_response', {
                success: false,
                error: 'No password provided'
            });
            return;
        }

        if (!storedPassword || storedPassword.trim() === "") {
            if (password.trim() !== "") {
                clientPasswords.set(clientId, password.trim());
                authenticatedClients.set(socket.id, clientId);

                if (connectedClients.has(clientId)) {
                    connectedClients.get(clientId).webClients.add(socket.id);
                    connectedClients.get(clientId).requiresAuth = true;
                }

                socket.emit('auth_response', {
                    success: true,
                    error: null
                });
                return;
            }

            socket.emit('auth_response', {
                success: false,
                error: 'No password set for this client'
            });
            return;
        }

        if (password.trim() == storedPassword.trim()) {
            authenticatedClients.set(socket.id, clientId);

            // Add to the `webClients` set of the `clientId`
            if (connectedClients.has(clientId)) {
                connectedClients.get(clientId).webClients.add(socket.id);
            }

            socket.emit('auth_response', {
                success: true,
                error: null
            });
        } else {

            socket.emit('auth_response', {
                success: false,
                error: 'Invalid password'
            });
        }
    });


    setInterval(() => {
        const now = Date.now();
        for (const [clientId, lastBeat] of clientHeartbeat) {
            if (now - lastBeat > 30000) { // 30 seconds timeout
                clientHeartbeat.delete(clientId);
                if (connectedClients.has(clientId)) {
                    const client = connectedClients.get(clientId);
                    client.connected = false;
                    console.log(`Client ${clientId} disconnected due to heartbeat timeout.`);

                    // Notify web clients about the disconnection
                    client.webClients.forEach((socketId) => {
                        const targetSocket = io.sockets.sockets.get(socketId);
                        if (targetSocket) {
                            targetSocket.emit('client_status', {
                                connected: false,
                                clientId: clientId
                            });
                        }
                    });

                    // Clean up the disconnected client
                    connectedClients.delete(clientId);
                }
            }
        }
    }, 15000); // Check every 15 seconds



    socket.on('request_battery_info', (data) => {
        const targetClientId = typeof data === 'object' ? data.targetClientId : data;
        const client = connectedClients.get(targetClientId);

        if (client) {
            client.socket.emit('get_battery_info');
        } else {
            console.log(`Python client not connected for clientId: ${targetClientId}`);
        }
    });

    socket.on('battery_info', (data) => {
        const { clientId, level, charging } = data;


        if (!connectedClients.has(clientId)) {

            return;
        }

        const clientData = connectedClients.get(clientId);

        clientData.webClients.forEach((socketId) => {
            const targetSocket = io.sockets.sockets.get(socketId);
            if (targetSocket) {

                targetSocket.emit('battery_update', {
                    clientId: clientId,
                    batteryLevel: level,
                    charging: charging
                });
            }
        });
    });


    socket.on('request_network_speed', (data) => {
        const targetClientId = data.targetClientId;
        const client = connectedClients.get(targetClientId);

        if (client) {
            client.socket.emit('request_network_speed');
        } else {
            socket.emit('network_speed_update', {
                clientId: targetClientId,
                error: 'Client not connected'
            });
        }
    });

    socket.on('network_speed_result', (data) => {
        const { clientId, download, upload, ping } = data;

        if (!connectedClients.has(clientId)) {

            return;
        }

        const clientData = connectedClients.get(clientId);

        clientData.webClients.forEach((socketId) => {
            const targetSocket = io.sockets.sockets.get(socketId);
            if (targetSocket) {
                targetSocket.emit('network_speed_update', {
                    clientId: clientId,
                    download: download,
                    upload: upload,
                    ping: ping
                });
            }
        });
    });


    socket.on("request_sync", (data) => {
        socket.emit('chat_sync', {
            messages: messageHistory.get(data),
            targetClientId: data.clientId,
            image: imageHistory.get(data.clientId)
        });
    });
    socket.on('chat message', async (data) => {
        const { message, targetClientId, password } = data;

        if (!authenticatedClients.has(socket.id) || authenticatedClients.get(socket.id) !== targetClientId) {
            //try to authenticate using the password
            if (password === clientPasswords.get(targetClientId)) {
                socket.emit('auth_response', {
                    success: false,
                    error: 'Invalid password'
                });
                return;
            }
        }

        // Ensure the message history is initialized
        if (!messageHistory.has(targetClientId)) {
            messageHistory.set(targetClientId, []);
        }

        messageHistory.get(targetClientId).push({
            content: `You: ${message}`,
            type: 'user'
        });

        // Send the updated chat history to all web clients for the target clientId
        const clientData = connectedClients.get(targetClientId);
        if (clientData) {
            clientData.webClients.forEach((socketId) => {
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) {
                    targetSocket.emit('chat_sync', {
                        messages: messageHistory.get(targetClientId),
                        targetClientId: targetClientId
                    });
                }
            });
        }

        try {
            await processRequestWithoutScreenCapture(message, targetClientId, socket);
        } catch (error) {
            console.error('Error processing request:', error);
            socket.emit('gpt response', 'Sorry, there was an error processing your request.');
        }
    });


    async function processRequestWithoutScreenCapture(message, targetClientId, socket) {
        try {
            let targetSystemInfo = '';
            if (targetClientId && connectedClients.has(targetClientId)) {
                const clientData = connectedClients.get(targetClientId);
                const location = userLocations.get(targetClientId) || 'unknown location';
                const language = userLanguages.get(targetClientId) || 'unknown language';
                targetSystemInfo = `\nTarget system: ${clientData.systemInfo.os}\nUser location: ${location}\nUser language: ${language}`;
            }

            // Get or initialize conversation history
            if (!conversationHistory.has(targetClientId)) {
                conversationHistory.set(targetClientId, []);
            }
            const history = conversationHistory.get(targetClientId);

            // Add user's message to history
            history.push({
                role: "user",
                content: message
            });

            // Add ability for AI to request clarification or additional steps
            const systemPromptWithMultiStep = systemPrompt + targetSystemInfo + `
If you need clarification or additional information to complete a task, you can:
1. Request screen capture by using ###CAPTURE_SCREEN### in your code
2. Ask follow-up questions by responding with "###FOLLOW_UP###" followed by your question
3. Chain multiple actions by separating them with "###NEXT_STEP###"

Example of multi-step response:
###FOLLOW_UP### What specific application should I open?
or
###NEXT_STEP### First, let me check what's on the screen
\`\`\`python
import webbrowser
webbrowser.open("https://example.com")
###CAPTURE_SCREEN###
\`\`\`
`;

            // Prepare messages array with system prompt and history
            const messages = [
                {
                    role: "system",
                    content: systemPromptWithMultiStep
                },
                ...history.slice(-10)
            ];

            const completion = await openai.chat.completions.create({
                messages: messages,
                model: "gpt-4o",
                max_tokens: 500,
                temperature: 0.7,
                stream: true
            });

            let accumulatedResponse = '';
            let containsCode = false;

            for await (const chunk of completion) {
                const content = chunk.choices[0]?.delta?.content || '';
                accumulatedResponse += content;

                // Check if the accumulated response contains code blocks
                if (content.includes('```')) {
                    containsCode = true;
                }

                // Only stream if we haven't detected code
                if (!containsCode) {
                    socket.emit('gpt_stream', {
                        content: content,
                        type: 'analysis'
                    });
                }
            }

            // Emit the complete response at once if it contained code
            if (containsCode) {
                socket.emit('gpt_stream', {
                    content: accumulatedResponse,
                    type: 'analysis'
                });
            }

            socket.emit('gpt_stream_end', {
                finalMessage: accumulatedResponse,
                type: 'analysis'
            });

            // Handle multi-step responses
            if (accumulatedResponse.includes('###FOLLOW_UP###')) {
                const followUpQuestion = accumulatedResponse.split('###FOLLOW_UP###')[1].trim();
                // Store the follow-up as AI's response
                history.push({
                    role: "assistant",
                    content: followUpQuestion
                });
                messageHistory.get(targetClientId).push({
                    content: `🤔 ${followUpQuestion}`,
                    type: 'ai'
                });

                // Wait for user's response and then continue
                socket.emit('request_follow_up', {
                    question: followUpQuestion,
                    originalMessage: message
                });
                return;
            }

            if (accumulatedResponse.includes('###NEXT_STEP###')) {
                const steps = accumulatedResponse.split('###NEXT_STEP###');
                for (const step of steps) {
                    if (step.trim()) {
                        // Process each step sequentially
                        await processStep(step.trim(), targetClientId, socket, history);
                    }
                }
                return;
            }

            // Handle regular response
            socket.emit('gpt_stream_end', {
                finalMessage: accumulatedResponse,
                type: 'analysis'
            });

            history.push({
                role: "assistant",
                content: accumulatedResponse
            });
            messageHistory.get(targetClientId).push({
                content: accumulatedResponse,
                type: 'ai'
            });

            if (targetClientId && connectedClients.has(targetClientId)) {
                const clientData = connectedClients.get(targetClientId);
                clientData.socket.emit('execute_command', accumulatedResponse);
            }

            if (accumulatedResponse.includes('###CREATE_RESEARCH###')) {
                const researchTopic = accumulatedResponse.split('###CREATE_RESEARCH###')[1].trim();
                socket.emit('create_research_task', {
                    title: researchTopic,
                    startResearch: false
                });
                return;
            }

            if (accumulatedResponse.includes('###CREATE_AND_START_RESEARCH###')) {
                const researchTopic = accumulatedResponse.split('###CREATE_AND_START_RESEARCH###')[1].trim();
                socket.emit('create_research_task', {
                    title: researchTopic,
                    startResearch: true
                });
                return;
            }
        } catch (error) {
            console.error('Error processing request:', error);
            socket.emit('gpt response', 'Sorry, there was an error processing your request.');
        }
    }

    async function processStep(step, targetClientId, socket, history) {
        // Process individual steps in multi-step responses
        socket.emit('gpt_stream', {
            content: step,
            type: 'analysis'
        });

        history.push({
            role: "assistant",
            content: step
        });
        messageHistory.get(targetClientId).push({
            content: step,
            type: 'ai'
        });

        if (targetClientId && connectedClients.has(targetClientId)) {
            const clientData = connectedClients.get(targetClientId);
            clientData.socket.emit('execute_command', step);
        }

        // Wait for a short time between steps
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Add new socket handler for follow-up responses
    socket.on('follow_up_response', async (data) => {
        const { response, originalMessage, targetClientId } = data;
        // Process the follow-up response with the original context
        await processRequestWithoutScreenCapture(
            `Original request: ${originalMessage}\nFollow-up response: ${response}`,
            targetClientId,
            socket
        );
    });

    socket.on("start_research_task", async (data) => {
        const { pageCount, message } = data;
        //scrape google search and look through the first few pages, then summarize it with AI and give it back
        let searchQuery = await getSearchQueryFromQuestion(message);
        const searchResults = await scrapeGoogleSearch(searchQuery, socket, pageCount);
        const summary = await summarizeSearchResults(searchResults, message, socket);
        socket.emit('research_task_result', summary);
    });

    socket.on('screen_capture_response', async (data) => {
        const { clientId, image, originalMessage, remainingCode } = data;

        if (!connectedClients.has(clientId)) {
            console.error(`Client with ID ${clientId} not found.`);
            socket.emit('gpt response', {
                message: 'Target client not connected or invalid client ID.',
                type: 'error'
            });
            return;
        }

        const client = connectedClients.get(clientId);

        try {
            // Ensure the image data is properly formatted
            const imageDataUrl = image.startsWith('data:image')
                ? image
                : `data:image/png;base64,${image}`;

            // Store the screenshot in the history
            imageHistory.set(clientId, imageDataUrl);

            // Emit the screenshot and GPT response only to authenticated web clients for this clientId
            authenticatedClients.forEach((authClientId, socketId) => {
                if (authClientId === clientId) {
                    const targetSocket = io.sockets.sockets.get(socketId);
                    if (targetSocket) {
                        targetSocket.emit('screen_capture_response', {
                            image: imageDataUrl,
                            originalMessage: originalMessage,
                            clientId: clientId
                        });
                    }
                }
            });

            // Prepare GPT processing
            if (!conversationHistory.has(clientId)) {
                conversationHistory.set(clientId, []);
            }
            const history = conversationHistory.get(clientId);

            // Add user's message to history
            history.push({
                role: "user",
                content: [
                    { type: "text", text: originalMessage },
                    { type: "image_url", image_url: { url: imageDataUrl } }
                ]
            });

            // Prepare messages array with system prompt and history
            const messages = [
                {
                    role: "system",
                    content: `${systemPrompt}\nTarget system: ${client.systemInfo.os}, User location: ${userLocations.get(clientId) || 'unknown location'}, User language: ${userLanguages.get(clientId) || 'unknown language'}`
                },
                ...history.slice(-10) // Keep the last 10 messages for context
            ];

            const completion = await openai.chat.completions.create({
                messages: messages,
                model: "gpt-4o",
                max_tokens: 1200,
                stream: true // Enable streaming
            });

            let accumulatedResponse = '';
            let containsCode = false;

            // Process GPT response stream
            for await (const chunk of completion) {
                const content = chunk.choices[0]?.delta?.content || '';
                accumulatedResponse += content;

                if (content.includes('```')) {
                    containsCode = true;
                }

                if (!containsCode) {
                    authenticatedClients.forEach((authClientId, socketId) => {
                        if (authClientId === clientId) {
                            const targetSocket = io.sockets.sockets.get(socketId);
                            if (targetSocket) {
                                targetSocket.emit('gpt_stream', {
                                    content: content,
                                    type: 'analysis'
                                });
                            }
                        }
                    });
                }
            }

            // Emit the complete response if it contained code
            if (containsCode) {
                authenticatedClients.forEach((authClientId, socketId) => {
                    if (authClientId === clientId) {
                        const targetSocket = io.sockets.sockets.get(socketId);
                        if (targetSocket) {
                            targetSocket.emit('gpt_stream', {
                                content: accumulatedResponse,
                                type: 'analysis'
                            });
                        }
                    }
                });
            }

            authenticatedClients.forEach((authClientId, socketId) => {
                if (authClientId === clientId) {
                    const targetSocket = io.sockets.sockets.get(socketId);
                    if (targetSocket) {
                        targetSocket.emit('gpt_stream_end', {
                            finalMessage: accumulatedResponse,
                            type: 'analysis'
                        });
                    }
                }
            });

            // Add the GPT response to the conversation history
            history.push({
                role: "assistant",
                content: accumulatedResponse
            });
            messageHistory.get(clientId).push({
                content: accumulatedResponse,
                type: 'ai'
            });

            // Emit the response and screenshot together to the web clients
            authenticatedClients.forEach((authClientId, socketId) => {
                if (authClientId === clientId) {
                    const targetSocket = io.sockets.sockets.get(socketId);
                    if (targetSocket) {
                        targetSocket.emit('gpt_response_with_screenshot', {
                            gptResponse: accumulatedResponse,
                            screenshot: imageDataUrl,
                            clientId: clientId
                        });
                    }
                }
            });

            // Execute the remaining code if provided
            if (remainingCode) {
                socket.emit('execute_command', remainingCode);
            }
        } catch (error) {
            console.error('Error processing screen capture response:', error);
            socket.emit('gpt response', {
                message: 'An error occurred while processing the request.',
                type: 'error'
            });
        }
    });


    socket.on('execution_result', (result) => {
        const { clientId, success, output, error } = result;



        if (!connectedClients.has(clientId)) {

            return;
        }

        const clientData = connectedClients.get(clientId);

        clientData.webClients.forEach((socketId) => {
            const targetSocket = io.sockets.sockets.get(socketId);
            if (targetSocket) {

                targetSocket.emit('execution_output', {
                    type: success ? 'output' : 'error',
                    content: success ? output : error
                });
            }
        });
    });



    socket.on('disconnect', () => {
        // Check if the socket was authenticated
        if (authenticatedClients.has(socket.id)) {
            const clientId = authenticatedClients.get(socket.id);
            authenticatedClients.delete(socket.id);

            if (connectedClients.has(clientId)) {
                const clientData = connectedClients.get(clientId);
                clientData.webClients.delete(socket.id);

                // Optionally, log the web client disconnection
                console.log(`Web client disconnected: socket ${socket.id}, clientId: ${clientId}`);
            }
        }

        // Clean up Python client if it disconnects
        for (const [clientId, clientData] of connectedClients.entries()) {
            if (clientData.socket === socket) {
                connectedClients.delete(clientId);
                console.log(`Python client disconnected: ${clientId}`);
                break;
            }
        }
    });


    socket.on('check_client_status', (data) => {
        const { targetClientId } = data;
        let requiresAuth = false;
        if (clientPasswords.has(targetClientId)) {
            requiresAuth = true;
        }
        if (targetClientId && connectedClients.has(targetClientId)) {
            socket.emit('client_status', {
                connected: true,
                clientId: targetClientId,
                requiresAuth: requiresAuth
            });
        } else {
            socket.emit('client_status', {
                connected: false,
                clientId: targetClientId,
                requiresAuth: requiresAuth
            });
        }
    });

    socket.on('system_resources', (data) => {
        const { clientId, cpu, memory, disk } = data;

        if (!connectedClients.has(clientId)) {

            return;
        }

        const clientData = connectedClients.get(clientId);

        clientData.webClients.forEach((socketId) => {
            const targetSocket = io.sockets.sockets.get(socketId);
            if (targetSocket) {
                targetSocket.emit('resource_update', {
                    clientId: clientId,
                    cpu: cpu,
                    memory: memory,
                    disk: disk
                });
            }
        });
    });



    socket.on('request_chat_history', (data) => {
        const { targetClientId } = data;

        if (messageHistory.has(targetClientId)) {
            const clientData = connectedClients.get(targetClientId);

            clientData.webClients.forEach((socketId) => {
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) {
                    targetSocket.emit('chat_sync', {
                        messages: messageHistory.get(targetClientId),
                        targetClientId: targetClientId,
                        image: imageHistory.get(targetClientId)
                    });
                }
            });
        } else {
            console.log(`No chat history found for clientId: ${targetClientId}`);
        }
    });

    socket.on('update_location', (data) => {
        const clientId = Array.from(connectedClients.entries())
            .find(([_, client]) => client.socket === socket)?.[0];

        if (clientId) {
            userLocations.set(clientId, data.location);

            const clientData = connectedClients.get(clientId);

            clientData.webClients.forEach((socketId) => {
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) {
                    targetSocket.emit('location_update', {
                        clientId: clientId,
                        location: data.location
                    });
                }
            });
        }
    });

    socket.on("update_language", (data) => {
        const clientID = Array.from(connectedClients.entries())
            .find(([_, client]) => client.socket === socket)?.[0];
        if (clientID) {
            userLanguages.set(clientID, data.language);

            const clientData = connectedClients.get(clientID);

            clientData.webClients.forEach((socketId) => {
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) {
                    targetSocket.emit('language_update', {
                        clientId: clientID, language: data.language
                    });
                }
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});



async function getSearchQueryFromQuestion(question) {
    const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: "You are a helpful assistant that extracts search queries from questions." }, { role: "user", content: question }],
        model: "gpt-4o",
        max_tokens: 400,
    });
    return completion.choices[0].message.content;
}

async function scrapeGoogleSearch(query, socket, pageCount = 5) {
    try {
        console.log("Scraping Google search for:", query);

        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl);

        // Extract URLs using regex
        let urls = response.data.match(/https?:\/\/[^\s"]+/g) || [];
        urls = urls.filter(url => !url.includes('google.com'))
            .map(url => new URL(url).origin)
            .filter((url, index, self) => self.indexOf(url) === index)
            .slice(0, pageCount);

        console.log("Extracted URLs:", urls);

        let websiteContent = '';
        const maxLength = 20000;

        for (let i = 0; i < urls.length; i++) {
            try {
                const url = urls[i];
                console.log(`Scraping content from: ${url}`);
                const websiteResponse = await axios.get(url);

                const $ = cheerio.load(websiteResponse.data);
                const text = $('body').text().replace(/\s+/g, ' ').trim();

                // Add content with length check
                const relevantContent = text.substring(0, Math.min(text.length, 4000));
                websiteContent += relevantContent;

                if (websiteContent.length >= maxLength) {
                    console.log("Content limit reached. Stopping further scraping.");
                    break;
                }

                // Calculate progress: 10% initial + 80% for scraping + 10% for final processing
                const progress = Math.round(10 + ((i + 1) / urls.length) * 80);

                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (websiteError) {
                console.error(`Failed to scrape content from ${urls[i]}:`, websiteError.message);
                // Emit error but continue processing
                socket.emit('research_progress', {
                    error: `Failed to scrape ${urls[i]}: ${websiteError.message}`,
                    progress: Math.round(10 + ((i + 1) / urls.length) * 80),
                    clientId: socket.id
                });
            }
        }

        websiteContent = websiteContent.substring(0, maxLength);
        socket.emit('research_progress', { progress: 90, clientId: socket.id });

        return websiteContent;
    } catch (error) {
        console.error("Error in scraping Google search:", error.message);
        socket.emit('research_progress', {
            progress: 0,
            error: "Failed to complete the scraping process.",
            clientId: socket.id
        });
        throw new Error("Scraping process failed.");
    }
}


async function summarizeSearchResults(results, originalQuestion, socket) {
    //use gpt-4o to summarize the results
    const completion = await openai.chat.completions.create({
        messages: [
            { role: "system", content: "You are a helpful assistant that summarizes web pages. you are given a string of content from a list of websites, and you need to summarize it. do not include useless fill words or any repeat of the question. just the answer. the original query is: " + originalQuestion },
            { role: "user", content: results }
        ],
        model: "gpt-4o",
        max_tokens: 1000,
    });
    socket.emit('research_progress', {
        progress: 100
    });
    return completion.choices[0].message.content;
}

app.post('/analyze-file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileContent = req.file.buffer.toString('utf-8');
        const fileName = req.file.originalname;
        const instructions = req.body.instructions || ''; // Get custom instructions

        const completion = await openai.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `You are a code and file analysis expert. ${instructions}\nAnalyze the provided file and give detailed insights about its content, structure, and potential improvements.`
                },
                {
                    role: "user",
                    content: `Please analyze this file named "${fileName}":\n\n${fileContent}`
                }
            ],
            model: "gpt-4o",
            max_tokens: 1000,
            stream: true
        });

        // Stream the response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let accumulatedResponse = '';

        for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || '';
            accumulatedResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }

        res.write(`data: ${JSON.stringify({ done: true, finalResponse: accumulatedResponse })}\n\n`);
        res.end();
    } catch (error) {
        console.error('Error analyzing file:', error);
        res.status(500).json({ error: 'Error analyzing file' });
    }
});
