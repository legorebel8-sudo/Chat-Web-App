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


// --- App Setup ---

// Create the Express application
const app = express();

// Wrap Express in a plain HTTP server (Socket.IO needs this)
const server = http.createServer(app);

// Attach Socket.IO to the HTTP server
const io = new Server(server);

// Tell Express to serve everything inside the "public" folder.
// This is how the browser gets index.html, style.css, and script.js.
app.use(express.static("public"));


// ============================================================
// Shared Room State
// ============================================================
// This object stores ALL chat rooms on the server.
// Because it lives here (not in the browser), every user
// connected to the server shares the same rooms and messages.
//
// Structure of each room:
//   password : string  — empty string means no password required
//   messages : array   — all messages sent in this room, in order
// ============================================================

const rooms = {
    "Example Chat": {
        password: "",
        messages: [],
    },
};


// ============================================================
// Socket.IO — Real-Time Connection Handling
// ============================================================
// Socket.IO fires a "connection" event every time a user opens
// the page. Inside we set up listeners for everything that
// user might do: ask for the room list, create a room, join
// a room, or send a message.
// ============================================================

io.on("connection", (socket) => {

    // Track which room this socket is currently in
    let currentUsername = "Guest";

    // A new browser tab connected — log it for debugging
    console.log("A user connected");


    // ----------------------------------------------------------
    // Event: "set username"
    // The browser sends the user's chosen display name right
    // after connecting. We store it so we can use it in logs.
    // ----------------------------------------------------------
    socket.on("set username", (username) => {
        currentUsername = username || "Guest";
        console.log(`User identified as: ${currentUsername}`);
    });


    // ----------------------------------------------------------
    // Event: "get rooms"
    // The browser asks for the current list of room names.
    // We reply with just the names (not passwords/messages) so
    // the sidebar can be drawn.
    // ----------------------------------------------------------
    socket.on("get rooms", () => {
        // Send only the room names — passwords stay on the server
        socket.emit("room list", Object.keys(rooms));
    });


    // ----------------------------------------------------------
    // Event: "create room"
    // The browser wants to create a brand-new chat room.
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("create room", (data) => {
        const { name, password } = data;

        // Reject if the room already exists
        if (rooms[name]) {
            socket.emit("room error", `A room called "${name}" already exists.`);
            return;
        }

        // Add the new room to our shared state
        rooms[name] = {
            password: password || "",
            messages: [],
        };

        console.log(`Room created: "${name}" by ${currentUsername}`);

        // Tell EVERY connected user to refresh their room list
        io.emit("room list", Object.keys(rooms));

        // Confirm to the creator that the room was made successfully
        socket.emit("room joined", { name, messages: [] });

        // Put this socket into the Socket.IO room (for message routing)
        socket.join(name);
    });


    // ----------------------------------------------------------
    // Event: "join room"
    // The browser wants to enter an existing chat room.
    // data = { name: "Room Name", password: "secret" }
    // ----------------------------------------------------------
    socket.on("join room", (data) => {
        const { name, password } = data;
        const room = rooms[name];

        // Reject if the room doesn't exist
        if (!room) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        // Reject if the password is wrong
        if (room.password && room.password !== password) {
            socket.emit("room error", "Wrong password.");
            return;
        }

        // Put this socket into the Socket.IO room
        socket.join(name);

        console.log(`${currentUsername} joined room: "${name}"`);

        // Send the full message history so the user can catch up
        socket.emit("room joined", { name, messages: room.messages });
    });


    // ----------------------------------------------------------
    // Event: "chat message"
    // The browser is sending a new message to a room.
    // data = { room: "Room Name", message: "username: text" }
    // ----------------------------------------------------------
    socket.on("chat message", (data) => {
        const { room, message } = data;

        // Make sure the room actually exists before saving anything
        if (!rooms[room]) return;

        // Save the message to the room's history
        rooms[room].messages.push(message);

        // Broadcast the message to EVERYONE in that room
        // (including the sender, so their bubble appears the same way)
        io.to(room).emit("chat message", { room, message });

        console.log(`[${room}] ${message}`);
    });


    // ----------------------------------------------------------
    // Event: "delete room"
    // The browser wants to permanently remove a chat room.
    // data = { name: "Room Name" }
    // ----------------------------------------------------------
    socket.on("delete room", (data) => {
        const { name } = data;

        // The default room cannot be deleted
        if (name === "Example Chat") {
            socket.emit("room error", "The Example Chat cannot be deleted.");
            return;
        }

        // Make sure the room actually exists
        if (!rooms[name]) {
            socket.emit("room error", `Room "${name}" does not exist.`);
            return;
        }

        // Remove the room from shared state
        delete rooms[name];

        console.log(`Room deleted: "${name}" by ${currentUsername}`);

        // Tell every connected user to refresh their sidebar
        io.emit("room list", Object.keys(rooms));

        // Tell anyone currently inside the deleted room to fall back to Example Chat
        io.to(name).emit("room deleted", name);
    });


    // ----------------------------------------------------------
    // Event: "disconnect"
    // The user closed the tab or lost their connection.
    // ----------------------------------------------------------
    socket.on("disconnect", () => {
        console.log(`${currentUsername} disconnected`);
    });

});


// ============================================================
// Start the Server
// ============================================================

const PORT = 3000;

server.listen(PORT, () => {
    console.log(`Quantum-Link is running at http://localhost:${PORT}`);
});
