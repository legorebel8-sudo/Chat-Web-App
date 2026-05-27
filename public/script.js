// ============================================================
// Quantum-Link — Frontend Logic
// WhatsApp-inspired web chat application
// ============================================================
// This file controls everything the user sees and interacts with:
//   - Fetching the logged-in username from the server session
//   - Avatar generation (coloured circles with initials)
//   - Sidebar chat list with search/filter
//   - Creating, joining, and deleting rooms
//   - Sending and displaying real-time messages
//   - Online user list
//   - Logout button
//   - Mobile-friendly slide navigation
// ============================================================


// ============================================================
// SOCKET.IO CONNECTION
// ============================================================
// io() connects this browser tab to the server.
// All real-time communication goes through this 'socket' object.

const socket = io();


// ============================================================
// DOM ELEMENTS
// ============================================================
// Grab references to every HTML element we'll need to update.

// --- Sidebar ---
const appDiv           = document.getElementById("app");
const myAvatar         = document.getElementById("my-avatar");
const myUsername       = document.getElementById("my-username");
const createChatButton = document.getElementById("createChatButton");
const logoutButton     = document.getElementById("logoutButton");
const joinChatButton   = document.getElementById("joinChatButton");
const chatListDiv      = document.getElementById("chatList");
const searchInput      = document.getElementById("searchInput");

// --- Chat area ---
const welcomeScreen   = document.getElementById("welcome-screen");
const activeChat      = document.getElementById("active-chat");
const chatAvatar      = document.getElementById("chat-avatar");
const chatNameDisplay = document.getElementById("chat-name-display");
const onlineCount     = document.getElementById("online-count");
const backBtn         = document.getElementById("back-btn");
const toggleUsersBtn  = document.getElementById("toggle-users-btn");
const usersPanel      = document.getElementById("users-panel");
const userListDiv     = document.getElementById("userList");
const messagesDiv     = document.getElementById("messages");
const messageInput    = document.getElementById("messageInput");
const sendButton      = document.getElementById("sendButton");


// ============================================================
// APP STATE
// ============================================================
// These variables track what the app is doing right now.

const state = {
    currentChat: null,   // name of the room that is currently open (null = none)
    username:    null,   // the logged-in username (fetched from the server session)
    isAdmin:     false,  // true only if the server confirmed this user is the admin
    rooms:       [],     // full list of room names received from the server
};


// ============================================================
// AVATAR UTILITIES
// ============================================================
// We generate coloured circles with initials instead of profile pictures.

const AVATAR_COLORS = [
    "#00a884", "#25d366", "#128c7e",
    "#34b7f1", "#e67e22", "#9b59b6",
    "#e74c3c", "#3498db", "#f39c12",
];

// Returns the first initial (or first two if there are two words)
function getInitials(name) {
    if (!name) return "?";
    const words = name.trim().split(" ");
    if (words.length >= 2) return words[0][0] + words[1][0];
    return words[0][0];
}

// Picks a colour from the palette based on the characters in a name.
// The same name always produces the same colour — even after a refresh!
function getAvatarColor(name) {
    if (!name) return AVATAR_COLORS[0];
    let total = 0;
    for (let i = 0; i < name.length; i++) {
        total += name.charCodeAt(i);
    }
    return AVATAR_COLORS[total % AVATAR_COLORS.length];
}

// Applies initials text and background colour to an avatar element
function setAvatar(element, name) {
    element.textContent      = getInitials(name).toUpperCase();
    element.style.background = getAvatarColor(name);
}


// ============================================================
// STARTUP
// ============================================================

async function init() {
    setupEventListeners();
    setupSocketListeners();

    // Ask the server who is currently logged in.
    // The server reads the session cookie and returns { username: "..." }.
    // If there is no active session, the server returns 401 and the
    // auth-check script in index.html will have already redirected to login.html.
    try {
        const response = await fetch("/api/me");

        if (!response.ok) {
            // Not logged in — redirect to login (safety net, index.html already checks)
            window.location.href = "/login.html";
            return;
        }

        const data = await response.json();

        // Store the username and admin flag, then update the sidebar
        state.username = data.username;
        state.isAdmin  = data.isAdmin === true; // defaults to false if missing
        myUsername.textContent = data.username;
        setAvatar(myAvatar, data.username);

        // Ask the server for the current room list
        socket.emit("get rooms");

        // Automatically join the default room so the user isn't on an empty screen
        socket.emit("join room", { name: "Example Chat", password: "" });

    } catch (err) {
        // Network error — send to login as a fallback
        window.location.href = "/login.html";
    }
}


// ============================================================
// LOGOUT
// ============================================================

async function handleLogout() {
    try {
        // Tell the server to destroy the session
        await fetch("/api/logout", { method: "POST" });
    } catch (err) {
        // Even if the request fails, still redirect to login
    }
    // Redirect to the login page
    window.location.href = "/login.html";
}


// ============================================================
// SOCKET.IO — EVENTS COMING FROM THE SERVER
// ============================================================

function setupSocketListeners() {

    // --- Connected ---
    // Fires when our socket first connects (or reconnects after a drop).
    socket.on("connect", () => {
        // Only ask for rooms once we have the username from the session
        if (!state.username) return;
        socket.emit("get rooms");
        socket.emit("join room", { name: "Example Chat", password: "" });
    });

    // --- Room list ---
    // Server sends an array of room name strings whenever the list changes.
    socket.on("room list", (roomNames) => {
        state.rooms = roomNames;
        renderChatList(roomNames);
    });

    // --- Room joined ---
    // Server confirms we entered a room and sends its full message history.
    // data = { name: "Room Name", messages: [ { user, text, time }, ... ] }
    socket.on("room joined", (data) => {
        state.currentChat = data.name;

        chatNameDisplay.textContent = data.name;
        setAvatar(chatAvatar, data.name);

        welcomeScreen.classList.add("hidden");
        activeChat.classList.remove("hidden");

        appDiv.classList.add("chat-open");

        updateActiveChatInList(data.name);

        messagesDiv.innerHTML = "";
        data.messages.forEach((msg) => displayMessage(msg));
    });

    // --- New message ---
    // data = { room: "Room Name", message: { user, text, time } }
    socket.on("chat message", (data) => {
        if (data.room === state.currentChat) {
            displayMessage(data.message);
        }
    });

    // --- User list ---
    // Server sends this when someone joins or leaves the room.
    socket.on("user list", (users) => {
        renderUserList(users);
        onlineCount.textContent = `${users.length} online`;
    });

    // --- Room error ---
    socket.on("room error", (errorMessage) => {
        alert(errorMessage);
    });

    // --- Room deleted ---
    socket.on("room deleted", (deletedRoomName) => {
        if (state.currentChat === deletedRoomName) {
            alert(`"${deletedRoomName}" was deleted. Returning to Example Chat.`);
            socket.emit("join room", { name: "Example Chat", password: "" });
        }
    });
}


// ============================================================
// SIDEBAR — CHAT LIST
// ============================================================

function renderChatList(roomNames) {
    const filter = searchInput.value.toLowerCase().trim();
    chatListDiv.innerHTML = "";

    const filtered = roomNames.filter((name) =>
        name.toLowerCase().includes(filter)
    );

    if (filtered.length === 0) {
        chatListDiv.innerHTML = '<div class="chat-list-empty">No chats found</div>';
        return;
    }

    filtered.forEach((name) => {
        chatListDiv.appendChild(createChatListItem(name));
    });
}

function createChatListItem(roomName) {
    const item = document.createElement("div");
    item.classList.add("chat-item");

    if (roomName === state.currentChat) {
        item.classList.add("active-chat");
    }

    const avatarEl = document.createElement("div");
    avatarEl.classList.add("avatar", "avatar-sm");
    setAvatar(avatarEl, roomName);

    const info = document.createElement("div");
    info.classList.add("chat-item-info");

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("chat-item-name");
    nameDiv.textContent = roomName;

    const previewDiv = document.createElement("div");
    previewDiv.classList.add("chat-item-preview");
    previewDiv.textContent = "Tap to open";

    info.appendChild(nameDiv);
    info.appendChild(previewDiv);

    item.appendChild(avatarEl);
    item.appendChild(info);

    // Only show the delete button to the admin (non-admins see no button at all)
    if (roomName !== "Example Chat" && state.isAdmin) {
        const deleteBtn = document.createElement("button");
        deleteBtn.classList.add("delete-chat-btn");
        deleteBtn.title       = "Delete room";
        deleteBtn.textContent = "✕";

        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleDeleteChat(roomName);
        });

        item.appendChild(deleteBtn);
    }

    item.addEventListener("click", () => {
        if (roomName === state.currentChat) {
            appDiv.classList.add("chat-open");
            return;
        }
        handleJoinChat(roomName);
    });

    return item;
}

function updateActiveChatInList(roomName) {
    document.querySelectorAll(".chat-item").forEach((item) => {
        const name = item.querySelector(".chat-item-name")?.textContent;
        item.classList.toggle("active-chat", name === roomName);
    });
}


// ============================================================
// ONLINE USERS PANEL
// ============================================================

function renderUserList(users) {
    userListDiv.innerHTML = "";

    users.forEach((username) => {
        const item = document.createElement("div");
        item.classList.add("user-item");

        const avatarEl = document.createElement("div");
        avatarEl.classList.add("avatar", "avatar-xs");
        setAvatar(avatarEl, username);

        const dot = document.createElement("div");
        dot.classList.add("online-dot");

        const name = document.createElement("span");
        name.textContent = username;

        item.appendChild(avatarEl);
        item.appendChild(dot);
        item.appendChild(name);
        userListDiv.appendChild(item);
    });
}


// ============================================================
// ROOM MANAGEMENT
// ============================================================

function handleCreateChat() {
    const name = prompt("Name your new chat room:");
    if (!name || !name.trim()) return;

    const password = prompt("Set a password for this room:");
    if (!password) {
        alert("A password is required to create a room.");
        return;
    }

    socket.emit("create room", { name: name.trim(), password });
}

function handleJoinChat(roomName) {
    const name = roomName || prompt("Enter the room name to join:");
    if (!name) return;

    let password = "";
    if (name !== "Example Chat") {
        const entered = prompt(`Password for "${name}"? (leave blank if none)`);
        if (entered === null) return;
        password = entered;
    }

    socket.emit("join room", { name, password });
}

function handleDeleteChat(roomName) {
    if (!confirm(`Delete "${roomName}"? This cannot be undone.`)) return;
    socket.emit("delete room", { name: roomName });
}


// ============================================================
// MESSAGES
// ============================================================

function handleSendMessage() {
    const text = messageInput.value.trim();
    if (!text || !state.currentChat) return;

    socket.emit("chat message", { room: state.currentChat, text });

    messageInput.value = "";
    messageInput.focus();
}

function displayMessage(message) {
    const isOwn = message.user === state.username;

    const wrapper = document.createElement("div");
    wrapper.classList.add("message", isOwn ? "sent" : "received");

    if (!isOwn) {
        const sender = document.createElement("div");
        sender.classList.add("message-sender");
        sender.textContent = message.user;
        sender.style.color = getAvatarColor(message.user);
        wrapper.appendChild(sender);
    }

    const bubble = document.createElement("div");
    bubble.classList.add("message-bubble");

    const text = document.createElement("div");
    text.textContent = message.text;

    const time = document.createElement("span");
    time.classList.add("message-time");
    time.textContent = message.time;

    bubble.appendChild(text);
    bubble.appendChild(time);
    wrapper.appendChild(bubble);
    messagesDiv.appendChild(wrapper);

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {

    // --- Sidebar buttons ---
    createChatButton.addEventListener("click", handleCreateChat);
    joinChatButton.addEventListener("click", () => handleJoinChat(null));

    // --- Logout button ---
    logoutButton.addEventListener("click", handleLogout);

    // --- Search box ---
    searchInput.addEventListener("input", () => {
        renderChatList(state.rooms);
    });

    // --- Message sending ---
    sendButton.addEventListener("click", handleSendMessage);
    messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSendMessage();
    });

    // --- Mobile: back button ---
    backBtn.addEventListener("click", () => {
        appDiv.classList.remove("chat-open");
    });

    // --- Toggle online members panel ---
    toggleUsersBtn.addEventListener("click", () => {
        usersPanel.classList.toggle("hidden");
    });
}


// ============================================================
// START THE APP
// ============================================================

init();
