// ============================================================
// Quantum-Link — Backend Server
// ============================================================
// This file starts the web server and manages real-time chat
// connections using Socket.IO.
//
// To start the server, run:
//   npm start
// Then open http://localhost:3000 in your browser.
// ============================================================

// --- Imports ---

// Express handles serving web pages and files
const express = require("express");

// Node's built-in http module wraps Express so Socket.IO can use it
const http = require("http");

// Socket.IO lets the server and browser talk in real time
const { Server } = require("socket.io");

// fs and path are built-in Node modules for reading/writing files
const fs   = require("fs");
const path = require("path");


// --- App Setup ---

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Tell Express to serve everything inside the "public" folder
app.use(express.static("public"));


// ============================================================
// Data Persistence
// ============================================================
// Rooms and messages are saved to data/rooms.json so they
// survive a server restart.
//
// The file is loaded once when the server starts, and written
// to disk every time something changes (new room, new message,
// deleted room).
//
// Room passwords are stored as plain text here because this is
// a school project — in a real app you would hash them first.
// ============================================================

// Path to the save file
const DATA_FILE = path.join(__dirname, "data", "rooms.json");

// The room that is always present and can never be deleted
const DEFAULT_ROOMS = {
    "Example Chat": {
        password: "",
        messages: [],
    },
};

function loadRooms() {
    // Try to read saved data from disk
    try {
        const raw = fs.readFileSync(DATA_FILE, "utf8");
        return JSON.parse(raw);
    } catch (err) {
        // File doesn't exist yet — use the defaults and save them
        console.log("No saved data found. Starting with default rooms.");
        return { ...DEFAULT_ROOMS };
    }
}

function saveRooms() {
    // Create the data/ folder if it doesn't exist yet
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    // Write the rooms object to disk as readable JSON
    fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2), "utf8");
}

// Load room data when the server starts
const rooms = loadRooms();


// ============================================================
// Helper Functions
// ============================================================

// Returns an array of usernames for every socket currently in a room
function getUsersInRoom(roomName) {
    const usernames = [];
    io.sockets.sockets.forEach((s) => {
        if (s.currentRoom === roomName) {
            usernames.push(s.username || "Guest");
        }
    });
    return usernames;
}

// Sends the updated user list to everyone currently in a room
function broadcastUserList(roomName) {
    io.to(roomName).emit("user list", getUsersInRoom(roomName));
}


// ============================================================
// Socket.IO — Real-Time Connection Handling
// ============================================================
// Socket.IO fires a "connection" event every time a user opens
// the page. Inside we set up listeners for everything that
// user might do: set a username, ask for rooms, join a room,
// send a message, or delete a room.
// ============================================================

io.on("connection", (socket) => {

    // Store the user's name and current room on the socket object.
    // We use socket.username instead of a local variable so the
    // helper functions above can read it from any socket.
    socket.username    = "Guest";
    socket.currentRoom = null;

    console.log("A user connected");


    // ----------------------------------------------------------
    // Event: "set username"
    // The browser sends the user's chosen display name right
    // after connecting.
    // ----------------------------------------------------------
    socket.on("set username", (username) => {
        socket.username = username || "Guest";
        console.log(`User identified as: ${socket.username}`);
    });


    // ----------------------------------------------------------
    // Event: "get rooms"
    // The browser asks for the current list of room names so
    // the sidebar can be drawn.
    // ----------------------------------------------------------
    socket.on("get rooms", () => {
        // Only the names are sent — passwords stay on the server
        socket.emit("room list", Object.keys(rooms));
    });


    // ----------------------------------------------------------
    // Event: "create room"
    // The browser wants to create a brand-new chat room.
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("create room", (data) => {
        const { name, password } = data;

        if (rooms[name]) {
            socket.emit("room error", `A room called "${name}" already exists.`);
            return;
        }

        // Add the new room and save it to disk
        rooms[name] = {
            password: password || "",
            messages: [],
        };
        saveRooms();

        console.log(`Room created: "${name}" by ${socket.username}`);

        // Tell every connected user to refresh their sidebar
        io.emit("room list", Object.keys(rooms));

        // Confirm to the creator and move them into the room
        socket.emit("room joined", { name, messages: [] });
        socket.join(name);
        socket.currentRoom = name;
        broadcastUserList(name);
    });


    // ----------------------------------------------------------
    // Event: "join room"
    // The browser wants to enter an existing chat room.
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("join room", (data) => {
        const { name, password } = data;
        const room = rooms[name];

        if (!room) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        if (room.password && room.password !== password) {
            socket.emit("room error", "Wrong password.");
            return;
        }

        // Leave the previous room and update its user list
        if (socket.currentRoom && socket.currentRoom !== name) {
            socket.leave(socket.currentRoom);
            broadcastUserList(socket.currentRoom);
        }

        socket.join(name);
        socket.currentRoom = name;

        console.log(`${socket.username} joined room: "${name}"`);

        // Send the full message history so the user can catch up
        socket.emit("room joined", { name, messages: room.messages });

        // Tell everyone in the room who is here now
        broadcastUserList(name);
    });


    // ----------------------------------------------------------
    // Event: "chat message"
    // The browser is sending new message text to a room.
    // data = { room: "Room Name", text: "Hello!" }
    // ----------------------------------------------------------
    socket.on("chat message", (data) => {
        const { room, text } = data;

        if (!rooms[room]) return;

        // Build a message object with the sender, text, and time
        const message = {
            user: socket.username,
            text: text,
            // toLocaleTimeString gives a short "HH:MM AM/PM" format
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        // Store the message and keep a max of 100 per room
        rooms[room].messages.push(message);
        if (rooms[room].messages.length > 100) {
            rooms[room].messages.shift(); // remove the oldest message
        }

        saveRooms();

        // Broadcast to everyone in the room (including the sender)
        io.to(room).emit("chat message", { room, message });

        console.log(`[${room}] ${message.user}: ${message.text}`);
    });


    // ----------------------------------------------------------
    // Event: "delete room"
    // The browser wants to permanently remove a chat room.
    // data = { name: "Room Name" }
    // ----------------------------------------------------------
    socket.on("delete room", (data) => {
        const { name } = data;

        if (name === "Example Chat") {
            socket.emit("room error", "The Example Chat cannot be deleted.");
            return;
        }

        if (!rooms[name]) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        delete rooms[name];
        saveRooms();

        console.log(`Room deleted: "${name}" by ${socket.username}`);

        // Refresh everyone's sidebar
        io.emit("room list", Object.keys(rooms));

        // Tell anyone inside the deleted room to go back to Example Chat
        io.to(name).emit("room deleted", name);
    });


    // ----------------------------------------------------------
    // Event: "disconnect"
    // The user closed the tab or lost their connection.
    // ----------------------------------------------------------
    socket.on("disconnect", () => {
        console.log(`${socket.username} disconnected`);

        // Update the user list for the room they were in
        if (socket.currentRoom) {
            broadcastUserList(socket.currentRoom);
        }
    });

});


// ============================================================
// Start the Server
// ============================================================

const PORT = 3000;

server.listen(PORT, () => {
    console.log(`Quantum-Link is running at http://localhost:${PORT}`);
});
