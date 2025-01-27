document.addEventListener("DOMContentLoaded", () => {
    const apiKeyInput = document.getElementById("apiKeyInput");
    const saveButton = document.getElementById("saveButton");

    // Focus the input field when the popup is opened
    apiKeyInput.focus();

    // Enable/Disable the Save button based on input value
    apiKeyInput.addEventListener("input", (event) => {
        saveButton.disabled = event.target.value.trim() === "";
    });

    // Save the API key to Chrome storage
    saveButton.addEventListener("click", () => {
        const apiKey = apiKeyInput.value.trim();

        if (apiKey) {
            chrome.storage.sync.set({ API_KEY: apiKey }, () => {
                alert("API Key saved successfully!");
                window.close(); // Close the popup after saving
            });
        }
    });
});
