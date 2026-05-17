// ============================================================
// Quantum-Link — Frontend Logic
// ============================================================
// This file controls everything the user interacts with:
//   - Showing the username modal on first visit
//   - Creating and joining chat rooms
//   - Sending and displaying messages in real time via Socket.IO
//   - Showing who is currently online in each room
// ============================================================


// ============================================================
// SOCKET.IO CONNECTION
// ============================================================
// io() connects this browser tab to the server.
// All real-time communication goes through this socket object.

const socket = io();


// ============================================================
// DOM ELEMENTS
// ============================================================
// Grab all the HTML elements we need to read or update.

const sendButton         = document.getElementById("sendButton");
const messageInput       = document.getElementById("messageInput");
const messagesDiv        = document.getElementById("messages");
const createChatButton   = document.getElementById("createChatButton");
const joinChatButton     = document.getElementById("joinChatButton");
const chatList           = document.getElementById("chatList");
const currentChatDisplay = document.getElementById("currentChatDisplay");
const userListDiv        = document.getElementById("userList");
const usernameModal      = document.getElementById("usernameModal");
const usernameInput      = document.getElementById("usernameInput");
const usernameSubmit     = document.getElementById("usernameSubmit");
const appDiv             = document.getElementById("app");


// ============================================================
// APP STATE
// ============================================================

const state = {
    currentChat: "Example Chat",  // which room is open right now
    username:    null,            // the user's chosen display name
};


// ============================================================
// STARTUP
// ============================================================

function init() {
    // Wire up button click handlers and keyboard shortcuts
    setupEventListeners();

    // Wire up all Socket.IO event listeners
    setupSocketListeners();

    // Check if the user already set a username in a previous visit
    const storedUsername = localStorage.getItem("username");

    if (storedUsername) {
        // Returning user — skip the modal and go straight to the app
        state.username = storedUsername;
        usernameModal.style.display = "none";
        appDiv.style.display = "flex";
    } else {
        // New user — show the modal and hide the app until they choose a name
        usernameModal.style.display = "flex";
        appDiv.style.display = "none";
    }
}


// ============================================================
// USERNAME MODAL
// ============================================================
// Instead of using the browser's built-in prompt() dialog,
// we show a styled card overlay that matches the app's design.

function handleUsernameSubmit() {
    const input = usernameInput.value.trim();

    // Don't allow an empty name
    if (!input) {
        usernameInput.placeholder = "Please enter a name!";
        return;
    }

    state.username = input;

    // Save it to localStorage so we never ask again
    localStorage.setItem("username", input);

    // Hide the modal and show the main app
    usernameModal.style.display = "none";
    appDiv.style.display = "flex";

    // If the socket is already connected, send the startup events now.
    // If not yet connected, the "connect" handler below will do it.
    if (socket.connected) {
        socket.emit("set username", state.username);
        socket.emit("get rooms");
        socket.emit("join room", { name: "Example Chat", password: "" });
    }
}


// ============================================================
// SOCKET.IO — SERVER EVENT LISTENERS
// ============================================================

function setupSocketListeners() {

    // --- Connected to the server ---
    // Fires when the socket first connects (or reconnects).
    socket.on("connect", () => {
        // Only proceed once the user has chosen a username
        if (!state.username) return;

        socket.emit("set username", state.username);
        socket.emit("get rooms");
        socket.emit("join room", { name: "Example Chat", password: "" });
    });

    // --- Room list update ---
    // The server sends the full list of room names whenever it changes.
    socket.on("room list", (roomNames) => {
        renderChatList(roomNames);
    });

    // --- Successfully joined a room ---
    // The server confirms we joined and sends the full message history.
    // data = { name: "Room Name", messages: [ { user, text, time }, ... ] }
    socket.on("room joined", (data) => {
        state.currentChat = data.name;
        currentChatDisplay.textContent = `Current Chat: ${data.name}`;

        // Clear old messages and show this room's history
        messagesDiv.innerHTML = "";
        data.messages.forEach((message) => {
            displayMessage(message);
        });
    });

    // --- Incoming chat message ---
    // The server broadcasts this whenever anyone sends a message.
    // data = { room: "Room Name", message: { user, text, time } }
    socket.on("chat message", (data) => {
        if (data.room === state.currentChat) {
            displayMessage(data.message);
        }
    });

    // --- Online user list ---
    // The server sends this when someone joins or leaves the room.
    socket.on("user list", (users) => {
        renderUserList(users);
    });

    // --- Room error ---
    // The server sends this if something went wrong (wrong password, etc.).
    socket.on("room error", (errorMessage) => {
        alert(errorMessage);
    });

    // --- Room deleted ---
    // Another user deleted the room we were in — fall back to Example Chat.
    socket.on("room deleted", (deletedRoomName) => {
        if (state.currentChat === deletedRoomName) {
            alert(`The room "${deletedRoomName}" was deleted. Returning to Example Chat.`);
            socket.emit("join room", { name: "Example Chat", password: "" });
        }
    });

}


// ============================================================
// SIDEBAR — CHAT LIST
// ============================================================

function renderChatList(roomNames) {
    chatList.innerHTML = "";
    roomNames.forEach((chatName) => {
        chatList.appendChild(createChatListItem(chatName));
    });
}

function createChatListItem(chatName) {
    const chatItem = document.createElement("div");
    chatItem.classList.add("chat-item");

    if (chatName === state.currentChat) {
        chatItem.classList.add("active-chat");
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = chatName;
    nameSpan.style.cursor = "pointer";
    nameSpan.addEventListener("click", () => handleJoinChat(chatName));

    chatItem.append(nameSpan);

    if (chatName !== "Example Chat") {
        chatItem.appendChild(createDeleteChatButton(chatName));
    }

    return chatItem;
}

function createDeleteChatButton(chatName) {
    const button = document.createElement("button");
    button.textContent = "X";
    button.classList.add("delete-chat-btn");

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!confirm(`Delete chat "${chatName}"?`)) return;
        socket.emit("delete room", { name: chatName });
    });

    return button;
}


// ============================================================
// ONLINE USERS PANEL
// ============================================================

function renderUserList(users) {
    // Clear the panel and rebuild it from the server's list
    userListDiv.innerHTML = "";

    users.forEach((username) => {
        const item = document.createElement("div");
        item.classList.add("user-item");
        item.textContent = username;
        userListDiv.appendChild(item);
    });
}


// ============================================================
// OPENING AND JOINING CHATS
// ============================================================

function handleCreateChat() {
    const name = prompt("Enter a name for the new chat:");
    if (!name) return;

    const password = prompt("Set a password for this chat:");
    if (!password) {
        alert("A password is required!");
        return;
    }

    socket.emit("create room", { name, password });
}

function handleJoinChat(chatName) {
    const name = chatName || prompt("Enter the name of the chat you want to join:");
    if (!name) return;

    let password = "";
    if (name !== "Example Chat") {
        password = prompt(`Enter the password for "${name}" (leave blank if none):`);
        if (password === null) return;
    }

    socket.emit("join room", { name, password });
}


// ============================================================
// SENDING AND DISPLAYING MESSAGES
// ============================================================

function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    // Send just the text — the server adds the username and timestamp
    socket.emit("chat message", { room: state.currentChat, text });

    messageInput.value = "";
}

function displayMessage(message) {
    // Create the outer bubble container
    const bubble = document.createElement("div");
    bubble.classList.add("message");

    // Header row: username on the left, timestamp on the right
    const header = document.createElement("div");
    header.classList.add("message-header");

    const userSpan = document.createElement("span");
    userSpan.classList.add("message-user");
    userSpan.textContent = message.user;

    const timeSpan = document.createElement("span");
    timeSpan.classList.add("message-time");
    timeSpan.textContent = message.time;

    header.appendChild(userSpan);
    header.appendChild(timeSpan);

    // The actual message text
    const body = document.createElement("div");
    body.classList.add("message-body");
    body.textContent = message.text;

    bubble.appendChild(header);
    bubble.appendChild(body);
    messagesDiv.appendChild(bubble);

    // Scroll down so the newest message is always visible
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
    // Main app buttons
    createChatButton.addEventListener("click", handleCreateChat);
    joinChatButton.addEventListener("click", () => handleJoinChat(null));
    sendButton.addEventListener("click", handleSendMessage);

    // Enter key sends a message
    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") handleSendMessage();
    });

    // Username modal: button click and Enter key
    usernameSubmit.addEventListener("click", handleUsernameSubmit);
    usernameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") handleUsernameSubmit();
    });
}


// ============================================================
// START THE APP
// ============================================================

init();
