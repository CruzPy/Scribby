chrome.runtime.onInstalled.addListener(() => {
    // Main context menu option for Scribby
    chrome.contextMenus.create({
        id: "scribby",
        title: "Scribby - Urology Smart Note Assistant",
        contexts: ["all"], // Available in all contexts (selection, page, editable, etc.)
    });

    // Actions for selected text
    const actions = [
        "Summarize",
        "Generate HPI",
        "Create SOAP Note",
        "Highlight Symptoms",
        "Generate Medication Plan",
        "Interpret Lab Results",
        "Generate Assessment",
        "Follow-Up Recommendations",
        "First Line of Treatment",
    ];

    actions.forEach(action => {
        chrome.contextMenus.create({
            id: `chatgpt-${action.toLowerCase().replace(/ /g, "-")}`,
            title: action,
            contexts: ["selection"], // Only show when text is selected
        });
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const actionIdPrefix = "chatgpt-";

    // Check if API key is set
    const apiKey = await new Promise(resolve => {
        chrome.storage.sync.get("API_KEY", data => {
            resolve(data.API_KEY);
        });
    });

    if (!apiKey) {
        displayApiKeyPrompt(tab.id);
        return;
    }

    // Handle the main Scribby action
    if (info.menuItemId === "scribby") {
        await createPatientNote(tab.id);
        return;
    }

    // Handle specific actions for selected text
    if (info.menuItemId.startsWith(actionIdPrefix)) {
        const actionId = info.menuItemId.replace(actionIdPrefix, "");
        const action = actionId.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

        let selectedText = info.selectionText;

        // Fetch content from an editable element if no text is selected
        if (info.editable && !selectedText) {
            selectedText = await getEditableContent(tab.id);
        }

        if (selectedText) {
            const loadingWindowId = await showLoadingWindow(tab.id);
            const response = await sendToChatGPT(selectedText, action);
            hideLoadingWindow(tab.id, loadingWindowId);
            displayResult(response, tab.id);
        } else {
            console.error("No text selected or available in the editable field.");
        }
    }
});

// Fetch content from an editable element
async function getEditableContent(tabId) {
    return new Promise((resolve) => {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                func: () => {
                    const activeElement = document.activeElement;
                    return activeElement && activeElement.isContentEditable
                        ? activeElement.innerText
                        : activeElement.value || "";
                },
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                    resolve("");
                } else {
                    resolve(results[0]?.result || "");
                }
            }
        );
    });
}

function displayApiKeyPrompt(tabId) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const container = document.createElement('div');
            Object.assign(container.style, {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: '#fff',
                padding: '20px',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
                borderRadius: '10px',
                zIndex: '10000',
            });

            const content = document.createElement('div');
            Object.assign(content.style, {
                padding: '20px',
                fontSize: '14px',
                lineHeight: '1.6',
                textAlign: 'justify',
                color: '#333',
                backgroundColor: '#f9f9f9',
            });

            const info = document.createElement('p');
            info.textContent = "API key is not set. Please set it in the extension settings.";
            content.appendChild(info);

            const input = document.createElement('input');
            Object.assign(input.style, {
                width: '100%',
                margin: '10px 0',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '5px',
            });
            input.type = 'text';
            input.placeholder = 'Enter your ChatGPT API Key';
            content.appendChild(input);

            const saveButton = document.createElement('button');
            saveButton.textContent = 'Save API Key';
            Object.assign(saveButton.style, {
                padding: '10px 15px',
                border: 'none',
                borderRadius: '5px',
                backgroundColor: '#4CAF50',
                color: '#fff',
                cursor: 'pointer',
            });
            saveButton.disabled = true;

            input.addEventListener('input', () => {
                saveButton.disabled = !input.value.trim();
            });

            saveButton.addEventListener('click', () => {
                const apiKey = input.value.trim();
                if (apiKey) {
                    chrome.storage.sync.set({ API_KEY: apiKey }, () => {
                        alert('API Key saved successfully!');
                        container.remove();
                    });
                }
            });

            content.appendChild(saveButton);
            container.appendChild(content);
            document.body.appendChild(container);
        }
    });
}


async function createPatientNote(tabId) {
    chrome.scripting.executeScript(
        {
            target: { tabId },
            func: () => {
                const modal = document.createElement('div');

                modal.style.position = 'fixed';
                modal.style.top = '50%';
                modal.style.left = '50%';
                modal.style.transform = 'translate(-50%, -50%)';
                modal.style.width = '1000px';
                modal.style.height = '1000px';
                modal.style.maxWidth = '95%';
                modal.style.maxHeight = '95%';
                modal.style.backgroundColor = '#f4f4f4';
                modal.style.color = '#000';
                modal.style.border = '1px solid #ddd';
                modal.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                modal.style.borderRadius = '10px';
                modal.style.fontFamily = 'Arial, sans-serif';
                modal.style.display = 'flex';
                modal.style.flexDirection = 'column';
                modal.style.overflow = 'auto';
                modal.style.zIndex = '10000';
                modal.style.resize = 'both'; // Enable resizing

                // Ensure the modal remains centered after resizing
                modal.addEventListener('resize', () => {
                    modal.style.top = '50%';
                    modal.style.left = '50%';
                    modal.style.transform = 'translate(-50%, -50%)';
                });

                // Dragging logic
                let isDragging = false;
                let startX = 0;
                let startY = 0;
                let initialX = 0;
                let initialY = 0;

                const onMouseDown = (e) => {
                    isDragging = true;
                    startX = e.clientX;
                    startY = e.clientY;
                    const rect = modal.getBoundingClientRect(); // Get the modal's position
                    initialX = rect.left;
                    initialY = rect.top;

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);

                    // Disable text selection during drag
                    document.body.style.userSelect = 'none';
                    document.body.style.cursor = 'grabbing';
                };

                const onMouseMove = (e) => {
                    if (isDragging) {
                        const deltaX = e.clientX - startX;
                        const deltaY = e.clientY - startY;

                        // Constrain movement within the viewport
                        const newLeft = Math.min(
                            Math.max(0, initialX + deltaX),
                            window.innerWidth - modal.offsetWidth
                        );
                        const newTop = Math.min(
                            Math.max(0, initialY + deltaY),
                            window.innerHeight - modal.offsetHeight
                        );

                        modal.style.left = `${newLeft}px`;
                        modal.style.top = `${newTop}px`;
                        modal.style.transform = ''; // Remove translate after manual positioning
                    }
                };

                const onMouseUp = () => {
                    if (isDragging) {
                        isDragging = false;

                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);

                        // Re-enable text selection
                        document.body.style.userSelect = '';
                        document.body.style.cursor = '';
                    }
                };

                const header = document.createElement('div');
                header.style.backgroundColor = '#74B8FC';
                header.style.padding = '10px';
                header.style.color = '#fff';
                header.style.textAlign = 'center';
                header.style.borderTopLeftRadius = '10px';
                header.style.borderTopRightRadius = '10px';
                header.style.fontWeight = 'bold';
                header.style.display = 'flex'; // Flexbox for alignment
                header.style.justifyContent = 'space-between'; // Space between text and icons
                header.style.alignItems = 'center'; // Align items vertically
                header.style.cursor = 'grab';

                const headerTitle = document.createElement('div');
                headerTitle.textContent = 'Scribby';
                header.appendChild(headerTitle);

                // Add Close Icon
                const closeIcon = document.createElement('span');
                closeIcon.textContent = '✖'; // Unicode for "X"
                closeIcon.style.cursor = 'pointer';
                closeIcon.style.marginLeft = '10px';
                closeIcon.style.color = '#fff';
                closeIcon.style.padding = '0 10px';
                closeIcon.title = 'Close';
                closeIcon.onclick = () => {
                    document.body.removeChild(modal); // Remove modal
                };

                // Add icons to header
                const iconContainer = document.createElement('div');
                iconContainer.style.display = 'flex';
                iconContainer.style.gap = '5px';
                iconContainer.appendChild(closeIcon);
                header.appendChild(iconContainer);

                // Append header to modal
                modal.appendChild(header);


                // Attach the onMouseDown event to the modal (or its drag handle)
                header.addEventListener('mousedown', onMouseDown);

                const contentWrapper = document.createElement('div');
                contentWrapper.style.display = 'flex'; // Ensure flexbox layout for row alignment
                contentWrapper.style.flexDirection = 'row'; // Row layout
                contentWrapper.style.width = '100%'; // Occupy full width
                contentWrapper.style.height = '100%'; // Occupy full height
                contentWrapper.style.flexGrow = '1'; // Allow it to grow in the parent container
                contentWrapper.style.overflow = 'hidden'; // Prevent overflow

                // Append contentWrapper to modal
                modal.appendChild(contentWrapper);



                // Sidebar
                const sidebar = document.createElement('div');
                sidebar.style.width = '35%'; // Fixed width for the sidebar
                sidebar.style.flexShrink = '0'; // Prevent sidebar from shrinking
                sidebar.style.borderRight = '1px solid #ddd'; // Add a border to separate
                sidebar.style.padding = '15px'; // Padding inside sidebar
                sidebar.style.overflowY = 'auto'; // Enable vertical scrolling

                // Function to create a sidebar field with auto-expanding textarea
                const createSidebarField = (labelText, id, placeholder = '') => {
                    const field = document.createElement('div');
                    field.style.marginBottom = '10px';

                    const label = document.createElement('label');
                    label.textContent = labelText;
                    label.style.display = 'block';
                    label.style.marginBottom = '5px';
                    label.style.color = '#333';
                    field.appendChild(label);

                    const input = document.createElement('textarea');
                    input.id = id;
                    input.style.width = '100%';
                    input.style.minHeight = '40px'; // Set an initial minimum height
                    input.style.maxHeight = '200px'; // Set an initial minimum height
                    input.style.padding = '10px';
                    input.style.border = '1px solid #ccc';
                    input.style.borderRadius = '5px';
                    input.style.fontSize = '14px';
                    input.style.backgroundColor = '#fff';
                    input.style.color = '#000';
                    input.placeholder = placeholder;

                    // Auto-expanding logic
                    input.addEventListener('input', () => {
                        input.style.height = 'auto'; // Reset height to calculate new size
                        input.style.height = `${input.scrollHeight}px`; // Set height based on content
                    });

                    field.appendChild(input);
                    return field;
                };

                // Add Medical History section
                sidebar.appendChild(createSidebarField('Medical History', 'medical-history', 'e.g., Hypertension, Diabetes'));
                sidebar.appendChild(createSidebarField('Family Medical History', 'family-medical-history', 'e.g., Diabetes, Heart Disease, Cancer'));
                sidebar.appendChild(createSidebarField('Previous Surgeries', 'previous-surgeries', 'e.g., Appendectomy (2018), Kidney Stone Removal (2020)'));

                // Add Current Health section
                sidebar.appendChild(createSidebarField('Current Medications', 'current-medications', 'e.g., Metformin'));
                sidebar.appendChild(createSidebarField('Lifestyle Factors', 'lifestyle-factors', 'e.g., Non-smoker, drinks occasionally, exercises 3 times a week'));
                sidebar.appendChild(createSidebarField('Duration of Symptoms', 'duration-of-symptoms', 'e.g., 2 weeks, intermittent for 6 months'));

                // Add Travel and Allergies section
                sidebar.appendChild(createSidebarField('Recent Travel History', 'recent-travel-history', 'e.g., Traveled to tropical areas recently'));
                sidebar.appendChild(createSidebarField('Allergies', 'allergies', 'e.g., Penicillin'));
                sidebar.appendChild(createSidebarField('Allergy Severity', 'allergy-severity', 'e.g., Mild (rash), Severe (anaphylaxis)'));

                // Add Other Information section
                sidebar.appendChild(createSidebarField('Current Diet or Nutrition', 'current-diet', 'e.g., Low-carb diet, high protein, vegetarian'));
                sidebar.appendChild(createSidebarField('Pain Severity', 'pain-severity', 'Rate pain on a scale of 1-10'));
                sidebar.appendChild(createSidebarField('Immunization History', 'immunization-history', 'e.g., Flu vaccine (2022), Tetanus booster (2020)'));


                // Main Content
                const content = document.createElement('div');
                content.style.flexGrow = '1'; // Allow main content to take the remaining space
                content.style.flexShrink = '1'; // Allow main content to shrink if necessary
                content.style.padding = '20px'; // Padding inside the main content
                content.style.overflowY = 'auto'; // Enable vertical scrolling

                const title = document.createElement('h3');
                title.textContent = 'Patient Notes';
                title.style.marginBottom = '20px';
                title.style.textAlign = 'center';
                title.style.color = '#333';
                content.appendChild(title);

                // Function to create a main content field
                const createField = (labelText, id, placeholder = '', isTextArea = true) => {
                    const field = document.createElement('div');
                    field.style.marginBottom = '10px';

                    const label = document.createElement('label');
                    label.textContent = labelText;
                    label.style.display = 'block';
                    label.style.marginBottom = '5px';
                    label.style.color = '#333';
                    field.appendChild(label);

                    let input;
                    if (isTextArea) {
                        input = document.createElement('textarea');
                        input.style.minHeight = '40px'; // Set an initial minimum height
                        input.addEventListener('input', () => {
                            input.style.height = 'auto'; // Reset height to calculate new size
                            input.style.height = `${input.scrollHeight}px`; // Set height based on content
                        });
                    } else {
                        input = document.createElement('input');
                        input.type = 'text';
                        input.style.height = '40px';
                    }

                    input.id = id;
                    input.style.width = '100%';
                    input.style.padding = '10px';
                    input.style.border = '1px solid #ccc';
                    input.style.borderRadius = '5px';
                    input.style.fontSize = '14px';
                    input.style.backgroundColor = '#fff';
                    input.style.color = '#000';
                    input.placeholder = placeholder;

                    field.appendChild(input);
                    return field;
                };

                content.appendChild(createField('Name', 'patient-name', 'Full Name', false));

                // Age Dropdown
                const ageField = document.createElement('div');
                ageField.style.marginBottom = '10px';

                const ageLabel = document.createElement('label');
                ageLabel.textContent = 'Age';
                ageLabel.style.display = 'block';
                ageLabel.style.marginBottom = '5px';
                ageLabel.style.color = '#333';
                ageField.appendChild(ageLabel);

                const ageSelect = document.createElement('select');
                ageSelect.id = 'patient-age';
                ageSelect.style.padding = '10px';
                ageSelect.style.border = '1px solid #ccc';
                ageSelect.style.borderRadius = '5px';
                ageSelect.style.fontSize = '14px';

                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = 'Select Age';
                defaultOption.disabled = true;
                defaultOption.selected = true;
                ageSelect.appendChild(defaultOption);

                const ageOptions = Array.from({ length: 100 }, (_, i) => i + 1); // Ages 1 to 100
                ageOptions.forEach(age => {
                    const option = document.createElement('option');
                    option.value = age;
                    option.textContent = age;
                    ageSelect.appendChild(option);
                });

                ageField.appendChild(ageSelect);
                content.appendChild(ageField);

                // Reason for Visit Dropdown
                const reasonField = document.createElement('div');
                reasonField.style.marginBottom = '20px';
                const reasonLabel = document.createElement('label');
                reasonLabel.textContent = 'Reason for Visit';
                reasonLabel.style.display = 'block';
                reasonLabel.style.marginBottom = '5px';
                reasonLabel.style.color = '#333';

                const reasonSelect = document.createElement('select');
                reasonSelect.id = 'reason-for-visit';
                reasonSelect.style.width = '100%';
                reasonSelect.style.height = '100%';
                reasonSelect.style.padding = '10px';
                reasonSelect.style.border = '1px solid #ccc';
                reasonSelect.style.borderRadius = '5px';
                reasonSelect.style.fontSize = '14px';

                const reasons = {
                    'Select Reason...': [],
                    'Urinary Tract Infection': [
                        { question: 'Do you feel a burning sensation during urination?', type: 'binary', additionalField: true },
                        { question: 'Have you noticed an increased frequency of urination?', type: 'binary', additionalField: true },
                        { question: 'Is there any blood visible in your urine?', type: 'binary', additionalField: true },
                        { question: 'Are you experiencing fever or chills?', type: 'binary', additionalField: true },
                        { question: 'Do you have lower abdominal pain?', type: 'binary', additionalField: true },
                        { question: 'Have you had recent sexual activity or used new hygiene products?', type: 'binary', additionalField: true },
                        { question: 'Describe your fluid intake habits.', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Kidney Stones': [
                        { question: 'Do you have pain in the flank or lower back?', type: 'binary', additionalField: true },
                        { question: 'Have you noticed blood in your urine?', type: 'binary', additionalField: true },
                        { question: 'Are you experiencing nausea or vomiting?', type: 'binary', additionalField: true },
                        { question: 'Do you have difficulty urinating?', type: 'binary', additionalField: true },
                        { question: 'Do you have a history of kidney stones?', type: 'binary', additionalField: true },
                        { question: 'Have you made any recent dietary changes (e.g., high oxalate intake)?', type: 'text' },
                        { question: 'Can you rate the pain severity on a scale of 1-10?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Prostate Exam': [
                        { question: 'Do you have difficulty starting urination?', type: 'binary', additionalField: true },
                        { question: 'Is your urine stream weak?', type: 'binary', additionalField: true },
                        { question: 'Do you experience dribbling after urination?', type: 'binary', additionalField: true },
                        { question: 'Do you feel incomplete bladder emptying?', type: 'binary', additionalField: true },
                        { question: 'Do you have pain or discomfort in your pelvic area?', type: 'binary', additionalField: true },
                        { question: 'How many times per night do you wake to urinate?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Erectile Dysfunction': [
                        { question: 'Do you still experience morning erections?', type: 'binary', additionalField: true },
                        { question: 'Do you have any associated conditions (e.g., diabetes, cardiovascular disease)?', type: 'binary', additionalField: true },
                        { question: 'Do you feel stress, anxiety, or relationship issues?', type: 'binary', additionalField: true },
                        { question: 'Are you taking any medications or using substances (e.g., smoking, alcohol)?', type: 'binary', additionalField: true },
                        { question: 'Do you feel pain during intercourse?', type: 'binary', additionalField: true },
                        { question: 'Did your symptoms develop gradually or suddenly?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Incontinence': [
                        { question: 'Are there specific triggers (e.g., coughing, sneezing, laughing)?', type: 'binary', additionalField: true },
                        { question: 'Do you use pads or protective garments?', type: 'binary', additionalField: true },
                        { question: 'Do you have a history of pelvic surgeries or childbirth?', type: 'binary', additionalField: true },
                        { question: 'What type of incontinence do you experience (stress, urge, mixed)?', type: 'text' },
                        { question: 'How often do leaks occur, and how severe are they?', type: 'text' },
                        { question: 'What are your fluid intake habits?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Bladder Pain': [
                        { question: 'Is the pain related to urination (before, during, or after)?', type: 'binary', additionalField: true },
                        { question: 'Have you seen visible blood in your urine?', type: 'binary', additionalField: true },
                        { question: 'Do you experience urgency or frequency when urinating?', type: 'binary', additionalField: true },
                        { question: 'Do you have a history of bladder infections or interstitial cystitis?', type: 'binary', additionalField: true },
                        { question: 'Where is the pain located, and how severe is it?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Hematuria': [
                        { question: 'Do you experience pain or burning during urination?', type: 'binary', additionalField: true },
                        { question: 'Do you have a history of trauma?', type: 'binary', additionalField: true },
                        { question: 'Have you engaged in strenuous activity recently?', type: 'binary', additionalField: true },
                        { question: 'Do you have fever or unexplained weight loss?', type: 'binary', additionalField: true },
                        { question: 'Have you seen visible clots in your urine?', type: 'binary', additionalField: true },
                        { question: 'Is the blood in your urine gross or microscopic?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Urinary Retention': [
                        { question: 'Have you had any recent surgeries or anesthesia?', type: 'binary', additionalField: true },
                        { question: 'Do you feel pain in your bladder or lower abdomen?', type: 'binary', additionalField: true },
                        { question: 'Have you used a catheter before?', type: 'binary', additionalField: true },
                        { question: 'Do you have a history of neurological disorders (e.g., spinal injury)?', type: 'binary', additionalField: true },
                        { question: 'Did the symptoms start suddenly or gradually?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Frequent Urination': [
                        { question: 'Do you wake up at night to urinate (nocturia)?', type: 'binary', additionalField: true },
                        { question: 'Do you feel urgency or experience accidents?', type: 'binary', additionalField: true },
                        { question: 'Do you have a history of diabetes or UTIs?', type: 'binary', additionalField: true },
                        { question: 'How often do you urinate during the day?', type: 'text' },
                        { question: 'What are your fluid intake habits?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Pelvic Pain': [
                        { question: 'Is the pain related to urination, bowel movements, or menstruation?', type: 'binary', additionalField: true },
                        { question: 'Do you have other symptoms (e.g., fever, chills, nausea)?', type: 'binary', additionalField: true },
                        { question: 'Do you have a history of pelvic surgeries or infections?', type: 'binary', additionalField: true },
                        { question: 'Where is the pain located (lower abdomen, pelvis)?', type: 'text' },
                        { question: 'What is the pain severity and nature (sharp, dull, burning)?', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ],
                    'Other': [
                        { question: 'Please describe your symptoms or concerns in detail.', type: 'text' },
                        { question: 'Additional Information', type: 'text', id: 'additional-info' }
                    ]
                };



                Object.keys(reasons).forEach(reason => {
                    const option = document.createElement('option');
                    option.value = reason;
                    option.textContent = reason;
                    reasonSelect.appendChild(option);
                });

                reasonField.appendChild(reasonLabel);
                reasonField.appendChild(reasonSelect);
                content.appendChild(reasonField);

                const questionContainer = document.createElement('div');
                questionContainer.id = 'dynamic-questions';
                content.appendChild(questionContainer);

                // Add Submit and Cancel Buttons
                const buttons = document.createElement('div');
                buttons.style.display = 'flex';
                buttons.style.justifyContent = 'space-between';
                buttons.style.marginTop = '20px';

                const submitButton = document.createElement('button');
                submitButton.textContent = 'Submit';
                submitButton.style.padding = '10px 20px';
                submitButton.style.border = 'none';
                submitButton.style.borderRadius = '5px';
                submitButton.style.backgroundColor = '#4CAF50';
                submitButton.style.color = '#fff';
                submitButton.style.cursor = 'pointer';
                submitButton.addEventListener('click', () => {
                    const nameField = document.querySelector('#patient-name');
                    const ageField = document.querySelector('#patient-age');
                    const reasonField = document.querySelector('#reason-for-visit');

                    if (!nameField || !ageField || !reasonField) {
                        alert('Required fields are missing from the form.');
                        return;
                    }

                    const name = nameField.value.trim();
                    const age = ageField.value.trim();
                    const reason = reasonField.value;

                    let description = '';

                    // Track binary questions and their additional text fields
                    document.querySelectorAll('#dynamic-questions div').forEach((div) => {
                        const questionLabel = div.querySelector('label').textContent;
                        const yesChecked = div.querySelector('input[type="radio"][value="Yes"]')?.checked;
                        const additionalInput = div.querySelector('input[type="text"]')?.value.trim();

                        if (yesChecked) {
                            description += `${questionLabel}: Yes`;

                            if (additionalInput) {
                                description += `, ${additionalInput}`;
                            }
                            description += '\n';
                        }
                    });


                    // Track all textarea inputs (including additional-info fields)
                    document.querySelectorAll('#dynamic-questions textarea').forEach((textarea) => {
                        const questionLabel = textarea.previousElementSibling?.textContent || 'Additional Information';
                        const value = textarea.value.trim();
                        if (value) {
                            description += `${questionLabel}: ${value}\n`;
                        }
                    });

                    // Track sidebar fields
                    const sidebarFields = [
                        { id: 'medical-history', label: 'Medical History' },
                        { id: 'family-medical-history', label: 'Family Medical History' },
                        { id: 'current-medications', label: 'Current Medications' },
                        { id: 'previous-surgeries', label: 'Previous Surgeries' },
                        { id: 'lifestyle-factors', label: 'Lifestyle Factors' },
                        { id: 'duration-of-symptoms', label: 'Duration of Symptoms' },
                        { id: 'recent-travel-history', label: 'Recent Travel History' },
                        { id: 'allergies', label: 'Allergies' },
                        { id: 'allergy-severity', label: 'Allergy Severity' },
                        { id: 'current-diet', label: 'Current Diet or Nutrition' },
                        { id: 'pain-severity', label: 'Pain Severity' },
                        { id: 'immunization-history', label: 'Immunization History' },
                    ];

                    sidebarFields.forEach(({ id, label }) => {
                        const fieldValue = document.querySelector(`#${id}`)?.value.trim();
                        if (fieldValue) {
                            description += `${label}: ${fieldValue}\n`;
                        }
                    });

                    const patientNote = `Patient Details:\nName: ${name}\nAge: ${age}\nReason for Visit: ${reason}\nDetails:\n${description}`;
                    chrome.runtime.sendMessage({ type: 'send-to-chatgpt', data: patientNote });
                    modal.remove();
                });



                const cancelButton = document.createElement('button');
                cancelButton.textContent = 'Cancel';
                cancelButton.style.padding = '10px 20px';
                cancelButton.style.border = 'none';
                cancelButton.style.borderRadius = '5px';
                cancelButton.style.backgroundColor = '#f44336';
                cancelButton.style.color = '#fff';
                cancelButton.style.cursor = 'pointer';
                cancelButton.addEventListener('click', () => {
                    modal.remove();
                });

                buttons.appendChild(cancelButton);
                buttons.appendChild(submitButton);

                content.appendChild(buttons);
                reasonSelect.addEventListener('change', () => {
                    const selectedReason = reasonSelect.value;
                    questionContainer.innerHTML = '';

                    const questions = reasons[selectedReason] || [];
                    questions.forEach(({ question, type, additionalField }) => {
                        const questionDiv = document.createElement('div');
                        questionDiv.style.marginBottom = '10px';

                        const questionLabel = document.createElement('label');
                        questionLabel.textContent = question;
                        questionLabel.style.display = 'block';
                        questionLabel.style.marginBottom = '5px';
                        questionLabel.style.color = '#333';
                        questionDiv.appendChild(questionLabel);

                        if (type === 'binary') {
                            // Create Yes/No options
                            const yesOption = document.createElement('input');
                            yesOption.type = 'radio';
                            yesOption.name = question;
                            yesOption.value = 'Yes';
                            yesOption.id = `${question}-yes`;

                            const yesLabel = document.createElement('label');
                            yesLabel.textContent = 'Yes';
                            yesLabel.htmlFor = yesOption.id;
                            yesLabel.style.marginRight = '15px';

                            const noOption = document.createElement('input');
                            noOption.type = 'radio';
                            noOption.name = question;
                            noOption.value = 'No';
                            noOption.id = `${question}-no`;

                            const noLabel = document.createElement('label');
                            noLabel.textContent = 'No';
                            noLabel.htmlFor = noOption.id;
                            noLabel.style.marginRight = '15px';

                            questionDiv.appendChild(yesOption);
                            questionDiv.appendChild(yesLabel);
                            questionDiv.appendChild(noOption);
                            questionDiv.appendChild(noLabel);

                            // Add small text input if additionalField is true
                            if (additionalField) {
                                const additionalInput = document.createElement('input');
                                additionalInput.type = 'text';
                                additionalInput.placeholder = 'Provide additional info...';
                                additionalInput.style.marginLeft = '10px';
                                additionalInput.style.padding = '5px';
                                additionalInput.style.border = '1px solid #ccc';
                                additionalInput.style.borderRadius = '5px';
                                additionalInput.style.width = 'calc(100% - 150px)';

                                questionDiv.appendChild(additionalInput);
                            }
                        } else if (type === 'text') {
                            // Create text area for detailed responses
                            const textArea = document.createElement('textarea');
                            textArea.style.width = '100%';
                            textArea.style.minHeight = '40px';
                            questionDiv.appendChild(textArea);
                        }

                        questionContainer.appendChild(questionDiv);
                    });

                });


                // Append sidebar to contentWrapper
                contentWrapper.appendChild(sidebar);
                // Append main content to contentWrapper
                contentWrapper.appendChild(content);
                document.body.appendChild(modal);
            }
        }
    );
}


chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === 'send-to-chatgpt') {
        const tabId = sender.tab.id;
        const loadingWindowId = await showLoadingWindow(tabId); // Show loading window

        try {
            const response = await sendToChatGPT(message.data, 'Scribby');
            hideLoadingWindow(tabId); // Hide loading window
            displayResult(response, tabId); // Display the result
        } catch (error) {
            console.error("Error processing the ChatGPT API response:", error);
            hideLoadingWindow(tabId); // Ensure loading window is hidden
            displayResult("An error occurred while processing the request.", tabId); // Show error message
        }
    }
});


async function sendToChatGPT(text, action) {
    console.log("Action: ", action)
    console.log("Text: ", text)
    try {
        const { API_KEY } = await chrome.storage.sync.get("API_KEY");
        if (!API_KEY) {
            throw new Error("API key is not set. Please set it in the extension settings.");
        }
        if(action == 'Scribby'){
            content = `
                Based on this patient data, generate a SOAP note that is concise, professional, and well-organized, suitable for clinical documentation:
                ${text}
                
                Strictly, follow these guidelines:

                Subjective (HPI):
                Write a detailed, elaborative paragraph for the History of Present Illness (HPI) based on the chief complaint.
                Include all relevant details such as onset, duration, frequency, severity, associated symptoms, triggers, previous episodes, and the impact on the patient’s daily life.
                Maintain a formal and clinical tone.
                Objective:

                Include this section only if at least one of the following is provided:
                Physical Examination Findings
                Laboratory Results
                Diagnostic Imaging
                If all relevant data is marked as "Not provided" or "Pending," the Objective section should be entirely omitted. Do not include placeholder text or headings.
                When included, organize the information into concise and structured bullet points or paragraphs.

                Assessment:
                Provide a concise summary of the clinical impression, including a likely diagnosis or differential diagnoses.
                Avoid using phrases like "Based on the subjective information provided." Instead, state the assessment directly in a professional tone.
                
                Plan:
                Include detailed information on:
                Medications: Provide specific drug names, dosages, administration routes, and frequencies. For each medication, list:
                Side Effects: Highlight common and significant adverse effects.
                Benefits: Explain the therapeutic advantages and intended outcomes.
                If a medication name is not determined, recommend commonly used options for the condition.
                Imaging Studies: Outline the next steps, including rationale and expected outcomes.
                Labs and Testing Studies: Specify required laboratory or diagnostic tests, with rationale and expected insights.
                Surgical Interventions: If indicated, include a discussion of risks, benefits, and alternatives.
            `
        }
        else{
            content = `${action} based on:\n${text}`
        }
        console.log("action: ", action)
        console.log("text: ", text)
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4",
                messages: [
                    {
                        "role": "system",
                        "content": `
                            You are a highly efficient assistant specialized in analyzing, structuring, and processing data 
                            and patient notes for urological cases. Ensure all responses are concise and well-organized
                            clearly for easy readability and usability in clinical settings.
                        `
                    },

                    { role: "user", content: content}
                ],
                temperature: 0
            })
        });

        if (!response.ok) {
            throw new Error("Error communicating with the ChatGPT API.");
        }

        const data = await response.json();
        return data.choices[0]?.message?.content?.trim() || "No response from ChatGPT.";
    } catch (error) {
        console.error(error.message);
        return error.message;
    }
}


async function showLoadingWindow(tabId) {
    return new Promise((resolve) => {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                func: () => {
                    const loadingContainer = document.createElement('div');
                    loadingContainer.className = 'loading-container'; // Assign the class here
                    loadingContainer.style.position = 'fixed';
                    loadingContainer.style.top = '50%';
                    loadingContainer.style.left = '50%';
                    loadingContainer.style.transform = 'translate(-50%, -50%)';
                    loadingContainer.style.padding = '20px';
                    loadingContainer.style.backgroundColor = '#fff';
                    loadingContainer.style.border = '1px solid #ccc';
                    loadingContainer.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
                    loadingContainer.style.borderRadius = '8px';
                    loadingContainer.style.zIndex = '10000';
                    loadingContainer.innerHTML = `
                                                <div style="display: flex; align-items: center; justify-content: center;">
                                                    <div class="spinner" style="width: 24px; height: 24px; border: 3px solid #ccc; border-top: 3px solid #000; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                                                    <div style="margin-left: 10px; color: #333;">Loading...</div>
                                                </div>
                                            `;

                    document.body.appendChild(loadingContainer);
                },
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    console.error("Error with Chrome scripting API:", chrome.runtime.lastError.message);
                    resolve(null);
                } else {
                    resolve(results[0]?.result);
                }
            }
        );
    });
}

function hideLoadingWindow(tabId) {
    chrome.scripting.executeScript(
        {
            target: { tabId },
            func: () => {
                const loadingContainer = document.querySelector('.loading-container');
                if (loadingContainer) {
                    loadingContainer.remove();
                }
            },
        }
    );
}

function displayResult(result, tabId) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: (output) => {
            if (!output) return; // Prevent errors if output is empty

            // Remove existing result if already displayed
            document.querySelectorAll('.scribby-result-container').forEach(el => el.remove());

            // Play Sound
            const playSound = () => {
                const audio = new Audio('ding.mp3');
                audio.play().catch(err => console.error('Error playing sound:', err));
            };
            playSound(); // Play sound when result is displayed

            const container = document.createElement('div');
            container.classList.add('scribby-result-container');
            container.style.position = 'fixed';
            container.style.top = '100px';
            container.style.left = '100px';
            container.style.padding = '15px';
            container.style.backgroundColor = '#fff';
            container.style.color = '#000';
            container.style.border = '1px solid #ccc';
            container.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            container.style.borderRadius = '10px';
            container.style.zIndex = '10000';
            container.style.maxWidth = '500px';
            container.style.maxHeight = '80vh';
            container.style.overflowY = 'auto';
            container.style.fontFamily = 'Arial, sans-serif';

            // Dragging logic
            let isDragging = false;
            let startX = 0, startY = 0, initialX = 0, initialY = 0;

            const onMouseDown = (e) => {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = container.getBoundingClientRect();
                initialX = rect.left;
                initialY = rect.top;

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);

                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'grabbing';
            };

            const onMouseMove = (e) => {
                if (isDragging) {
                    const deltaX = e.clientX - startX;
                    const deltaY = e.clientY - startY;
                    container.style.left = `${initialX + deltaX}px`;
                    container.style.top = `${initialY + deltaY}px`;
                }
            };

            const onMouseUp = () => {
                isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
            };

            // Header Bar
            const header = document.createElement('div');
            header.style.backgroundColor = '#4CAF50';
            header.style.padding = '10px';
            header.style.cursor = 'grab';
            header.style.color = '#fff';
            header.style.textAlign = 'center';
            header.style.borderTopLeftRadius = '10px';
            header.style.borderTopRightRadius = '10px';
            header.textContent = 'Scribby';

            header.addEventListener('mousedown', onMouseDown);
            header.addEventListener('mouseup', () => {
                header.style.cursor = 'grab';
            });

            container.appendChild(header);

            // Editable Content Area
            const content = document.createElement('div');
            content.style.padding = '20px';
            content.style.fontSize = '14px';
            content.style.lineHeight = '1.6';
            content.style.textAlign = 'justify';
            content.style.color = '#333';
            content.style.backgroundColor = '#f9f9f9';
            content.style.border = '1px solid #ccc';
            content.style.borderRadius = '5px';
            content.style.minHeight = '100px';
            content.style.overflowY = 'auto';
            content.style.whiteSpace = 'pre-wrap';
            content.contentEditable = 'true'; // Enable text modification

            // Format keywords with bold tags
            const formattedOutput = output.replace(/(Subjective|Assessment|Objective|Plan)/g, '<strong>$1</strong>');

            // Load previously saved content or display formatted output
            chrome.storage.local.get(['scribbyContent'], (data) => {
                content.innerHTML = data.scribbyContent || formattedOutput
                    .split('\n')
                    .map(line => `<p>${line.trim()}</p>`)
                    .join('');
            });

            // Save content to Chrome storage on input
            content.addEventListener('input', () => {
                const updatedContent = content.innerHTML;
                chrome.storage.local.set({ scribbyContent: updatedContent });
            });

            container.appendChild(content);

            // Buttons Container
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.justifyContent = 'center';
            buttonsContainer.style.gap = '10px';
            buttonsContainer.style.marginTop = '15px';
            buttonsContainer.style.paddingTop = '10px';
            buttonsContainer.style.borderTop = '1px solid #ddd';

            // Copy Text Button
            const copyButton = document.createElement('button');
            copyButton.textContent = 'Copy Text';
            copyButton.style.marginRight = '10px';
            copyButton.style.padding = '10px 15px';
            copyButton.style.border = 'none';
            copyButton.style.borderRadius = '5px';
            copyButton.style.backgroundColor = '#2196F3';
            copyButton.style.color = '#fff';
            copyButton.style.cursor = 'pointer';

            copyButton.addEventListener('click', () => {
                // Use innerHTML to get rich formatting
                const formattedContent = content.innerHTML;

                // Create a temporary container for sanitized content
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = formattedContent;

                // Copy the sanitized text to clipboard
                const sanitizedText = Array.from(tempDiv.childNodes)
                    .map(node => node.textContent.trim())
                    .filter(text => text.length > 0) // Remove empty lines
                    .join('\n\n'); // Add a line break for each paragraph

                navigator.clipboard.writeText(sanitizedText).then(() => {
                    const notification = document.createElement('div');
                    notification.textContent = 'Copied!';
                    notification.style.position = 'absolute';
                    notification.style.top = '10px';
                    notification.style.left = '50%';
                    notification.style.transform = 'translateX(-50%)';
                    notification.style.padding = '5px 10px';
                    notification.style.backgroundColor = '#4CAF50';
                    notification.style.color = '#fff';
                    notification.style.borderRadius = '5px';
                    notification.style.fontSize = '12px';
                    notification.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.2)';
                    notification.style.opacity = '1';
                    notification.style.transition = 'opacity 0.5s ease, top 0.5s ease';

                    container.appendChild(notification);

                    setTimeout(() => {
                        notification.style.opacity = '0';
                        setTimeout(() => notification.remove(), 500);
                    }, 2000);
                }).catch(err => console.error('Failed to copy text:', err));
            });

            container.appendChild(copyButton);

            // Close Button
            const closeButton = document.createElement('button');
            closeButton.textContent = 'Close';
            closeButton.style.padding = '10px 15px';
            closeButton.style.border = 'none';
            closeButton.style.borderRadius = '5px';
            closeButton.style.backgroundColor = '#f44336';
            closeButton.style.color = '#fff';
            closeButton.style.cursor = 'pointer';

            closeButton.addEventListener('click', () => {
                container.remove();
            });

            // Append buttons in order
            buttonsContainer.appendChild(copyButton);
            buttonsContainer.appendChild(closeButton);

            container.appendChild(buttonsContainer);
            document.body.appendChild(container);
        },
        args: [result],
    });
}
