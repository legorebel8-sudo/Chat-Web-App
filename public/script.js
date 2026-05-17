// ============================================================
// Quantum-Link — Frontend Logic
// ============================================================
// This file controls everything the user interacts with:
//   - Asking for a username
//   - Creating and joining chat rooms
//   - Sending and displaying messages in real time via Socket.IO
// ============================================================


// ============================================================
// SOCKET.IO CONNECTION
// ============================================================
// io() connects this browser tab to the server.
// All real-time communication (sending messages, joining rooms)
// goes through this single "socket" object.

const socket = io();


// ============================================================
// DOM ELEMENTS
// ============================================================
// These variables grab the HTML elements we need to read or update.

const sendButton         = document.getElementById("sendButton");
const messageInput       = document.getElementById("messageInput");
const messagesDiv        = document.getElementById("messages");
const createChatButton   = document.getElementById("createChatButton");
const joinChatButton     = document.getElementById("joinChatButton");
const chatList           = document.getElementById("chatList");
const currentChatDisplay = document.getElementById("currentChatDisplay");


// ============================================================
// APP STATE
// ============================================================
// All the data the app needs to run is stored in one object.
// This makes it easy to see everything in one place.

const state = {
    currentChat: "Example Chat",  // which chat room is open right now
    username:    null,            // the user's chosen display name
};


// ============================================================
// STARTUP
// ============================================================

function init() {
    // Step 1: Get or ask for the username (saved in localStorage)
    state.username = loadUsername();

    // Step 2: Wire up all the button click handlers
    setupEventListeners();

    // Step 3: Wire up all the Socket.IO event listeners
    setupSocketListeners();
}


// ============================================================
// USERNAME
// ============================================================

function loadUsername() {
    // Check if the user already set a name in a previous visit
    const storedName = localStorage.getItem("username");
    if (storedName) return storedName;

    // First time — ask the user to pick a name
    const chosenName = prompt("Choose your username (you'll only be asked once):");

    // If they clicked Cancel or left it blank, fall back to "Guest"
    const username = chosenName ? chosenName.trim() : "Guest";

    // Save it so we never ask again
    localStorage.setItem("username", username);
    return username;
}


// ============================================================
// SOCKET.IO — SERVER EVENT LISTENERS
// ============================================================
// These functions run when the server sends something to us.

function setupSocketListeners() {

    // --- Connected to the server ---
    // As soon as we connect, tell the server our username and
    // ask for the current list of rooms.
    socket.on("connect", () => {
        socket.emit("set username", state.username);
        socket.emit("get rooms");
        // Auto-join Example Chat so messages load immediately on page open
        socket.emit("join room", { name: "Example Chat", password: "" });
    });

    // --- Room list update ---
    // The server sends us the list of room names whenever it changes
    // (on connect, after a room is created, etc.).
    socket.on("room list", (roomNames) => {
        renderChatList(roomNames);
    });

    // --- Successfully joined a room ---
    // The server confirms we joined and sends the full message history.
    // data = { name: "Room Name", messages: [...] }
    socket.on("room joined", (data) => {
        // Switch the chat area to this room
        state.currentChat = data.name;
        currentChatDisplay.textContent = `Current Chat: ${data.name}`;

        // Clear old messages and display this room's history
        messagesDiv.innerHTML = "";
        data.messages.forEach((message) => {
            displayMessage(message);
        });
    });

    // --- Incoming chat message ---
    // The server broadcasts this whenever anyone in the room sends a message.
    // data = { room: "Room Name", message: "username: text" }
    socket.on("chat message", (data) => {
        // Only display the message if it belongs to the room we're looking at
        if (data.room === state.currentChat) {
            displayMessage(data.message);
        }
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
    // Clear the sidebar and rebuild it from the server's room list
    chatList.innerHTML = "";

    roomNames.forEach((chatName) => {
        chatList.appendChild(createChatListItem(chatName));
    });
}

function createChatListItem(chatName) {
    // Build the container div for one chat in the list
    const chatItem = document.createElement("div");
    chatItem.classList.add("chat-item");

    // Highlight it blue if this is the currently open chat
    if (chatName === state.currentChat) {
        chatItem.classList.add("active-chat");
    }

    // The chat name — clicking it tries to join the room
    const nameSpan = document.createElement("span");
    nameSpan.textContent = chatName;
    nameSpan.style.cursor = "pointer";
    nameSpan.addEventListener("click", () => handleJoinChat(chatName));

    chatItem.append(nameSpan);

    // Add a delete button for every room except "Example Chat"
    if (chatName !== "Example Chat") {
        chatItem.appendChild(createDeleteChatButton(chatName));
    }

    return chatItem;
}

function createDeleteChatButton(chatName) {
    // Build the small red "X" button shown next to each room name
    const button = document.createElement("button");
    button.textContent = "X";
    button.classList.add("delete-chat-btn");

    button.addEventListener("click", (event) => {
        // Stop the click from also triggering the join-room handler
        event.stopPropagation();

        // Ask the user to confirm before permanently deleting
        if (!confirm(`Delete chat "${chatName}"?`)) return;

        // Tell the server to delete the room
        socket.emit("delete room", { name: chatName });
    });

    return button;
}


// ============================================================
// OPENING AND JOINING CHATS
// ============================================================

function handleCreateChat() {
    const name = prompt("Enter a name for the new chat:");
    if (!name) return; // user pressed Cancel

    // Every new room needs a password to keep it private
    const password = prompt("Set a password for this chat:");
    if (!password) {
        alert("A password is required!");
        return;
    }

    // Ask the server to create the room
    socket.emit("create room", { name, password });
}

function handleJoinChat(chatName) {
    // If no name was passed in, ask the user to type one
    const name = chatName || prompt("Enter the name of the chat you want to join:");
    if (!name) return; // user pressed Cancel

    // Example Chat has no password — all other rooms do
    let password = "";
    if (name !== "Example Chat") {
        password = prompt(`Enter the password for "${name}" (leave blank if none):`);
        if (password === null) return; // user pressed Cancel
    }

    // Ask the server to add us to the room
    socket.emit("join room", { name, password });
}


// ============================================================
// SENDING AND DISPLAYING MESSAGES
// ============================================================

function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text) return; // don't send empty messages

    // Format: "username: message text"
    const message = `${state.username}: ${text}`;

    // Send the message to the server — it will broadcast it to
    // everyone in the room (including us) via the "chat message" event.
    socket.emit("chat message", { room: state.currentChat, message });

    // Clear the text field so the user can type the next message
    messageInput.value = "";
}

function displayMessage(message) {
    // Create a new bubble div and add it to the messages area
    const messageElement = document.createElement("div");
    messageElement.classList.add("message");
    messageElement.textContent = message;
    messagesDiv.appendChild(messageElement);

    // Scroll down so the newest message is always visible
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


// ============================================================
// EVENT LISTENERS
// ============================================================
// Connect all buttons and keyboard shortcuts to their functions.

function setupEventListeners() {
    createChatButton.addEventListener("click", handleCreateChat);
    joinChatButton.addEventListener("click", () => handleJoinChat(null));
    sendButton.addEventListener("click", handleSendMessage);

    // Allow pressing Enter to send a message (same as clicking Send)
    messageInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") handleSendMessage();
    });
}


// ============================================================
// START THE APP
// ============================================================

init();
