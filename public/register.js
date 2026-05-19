// ============================================================
// Quantum-Link — Register Page Logic
// ============================================================
// This script handles the registration form.
// Steps on page load:
//   1. Fetch the security question text from the server and display it
// Steps when the user submits:
//   1. Validate the form (passwords match, nothing empty)
//   2. Send the data to the server
//   3. If success → show a message and redirect to the login page
//   4. If failure → show the error (wrong answer, username taken, etc.)
// ============================================================


// ============================================================
// DOM ELEMENTS
// ============================================================

const registerForm         = document.getElementById("registerForm");
const usernameInput        = document.getElementById("username");
const passwordInput        = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const securityAnswerInput  = document.getElementById("securityAnswer");
const securityQuestionText = document.getElementById("securityQuestionText");
const registerBtn          = document.getElementById("registerBtn");
const errorMsg             = document.getElementById("errorMsg");
const successMsg           = document.getElementById("successMsg");


// ============================================================
// HELPER: Show / Hide Messages
// ============================================================

function showError(message) {
    // Show the red error box with the given text
    errorMsg.textContent = message;
    errorMsg.style.display = "block";
    // Make sure the success box is hidden at the same time
    successMsg.style.display = "none";
}

function showSuccess(message) {
    // Show the green success box with the given text
    successMsg.textContent = message;
    successMsg.style.display = "block";
    // Make sure the error box is hidden at the same time
    errorMsg.style.display = "none";
}

function hideMessages() {
    errorMsg.style.display = "none";
    successMsg.style.display = "none";
}


// ============================================================
// LOAD SECURITY QUESTION ON PAGE OPEN
// ============================================================
// When this page first loads, we ask the server for the question text.
// We never ask for the answer — that stays secret on the server.

async function loadSecurityQuestion() {
    try {
        // GET /api/security-question returns: { question: "..." }
        const response = await fetch("/api/security-question");
        const data = await response.json();

        // Put the question text into the box on the page
        securityQuestionText.textContent = data.question;

    } catch (err) {
        // If the server is unreachable, show a fallback message
        securityQuestionText.textContent = "Could not load question — is the server running?";
    }
}

// Run as soon as the page opens
loadSecurityQuestion();


// ============================================================
// HANDLE REGISTER FORM SUBMIT
// ============================================================

registerForm.addEventListener("submit", async (event) => {

    // Stop the browser from doing a page reload
    event.preventDefault();

    // Read what the user typed
    const username        = usernameInput.value.trim();
    const password        = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    const securityAnswer  = securityAnswerInput.value.trim();

    // --- Client-side validation (checks before sending to the server) ---

    if (!username) {
        showError("Please enter a username.");
        return;
    }

    if (username.length < 3) {
        showError("Username must be at least 3 characters long.");
        return;
    }

    if (!password) {
        showError("Please enter a password.");
        return;
    }

    if (password.length < 6) {
        showError("Password must be at least 6 characters long.");
        return;
    }

    if (password !== confirmPassword) {
        // The two password fields don't match — tell the user right away
        showError("Passwords do not match. Please try again.");
        return;
    }

    if (!securityAnswer) {
        showError("Please answer the security question.");
        return;
    }

    // All basic checks passed — disable the button and send the request
    hideMessages();
    registerBtn.disabled = true;
    registerBtn.textContent = "Creating account...";

    try {
        // Send a POST request to the server with all the form data
        const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, securityAnswer }),
        });

        if (response.ok) {
            // Account created successfully!
            showSuccess("Account created! Redirecting to login...");

            // Wait 1.5 seconds so the user can read the success message,
            // then send them to the login page
            setTimeout(() => {
                window.location.href = "/login.html";
            }, 1500);

        } else {
            // Server returned an error (wrong security answer, username taken, etc.)
            const data = await response.json();
            showError(data.error || "Registration failed. Please try again.");

            // Re-enable the button so the user can correct their input
            registerBtn.disabled = false;
            registerBtn.textContent = "Create Account";
        }

    } catch (err) {
        // Network error — server might be offline
        showError("Could not reach the server. Is it running?");
        registerBtn.disabled = false;
        registerBtn.textContent = "Create Account";
    }
});


// ============================================================
// CLEAR ERRORS WHEN USER STARTS TYPING
// ============================================================

usernameInput.addEventListener("input", hideMessages);
passwordInput.addEventListener("input", hideMessages);
confirmPasswordInput.addEventListener("input", hideMessages);
securityAnswerInput.addEventListener("input", hideMessages);
